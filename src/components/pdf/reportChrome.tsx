/**
 * The furniture every printed report shares: the running header, the fixed
 * page footer, and the methodology appendix.
 *
 * Split out when the layout-composed report took the `ReportDocument` name,
 * so that neither document imports the other — the sections below it also
 * need the footer, and a document importing its own sections' dependency is
 * how an import cycle starts.
 */
import { Text, View } from '@react-pdf/renderer';
import { BLS_CPI_URL, formatPercent, getCpiLast30Years } from '../../lib/cpiHistory';
import { fraLabel } from '../../lib/format';
import { householdDisplayShape, type HouseholdAnalysis } from '../../lib/household';
import { genderLabel, SSA_LIFE_TABLE_URL } from '../../lib/lifeExpectancy';
import { dataVintageLine } from '../../lib/dataVintage';
import {
  coupleModelingNote,
  SINGLE_CLAIMANT_BENEFIT_NOTE,
  spousalSummary,
} from '../methodologyCopy';
import { WIDOWED_MODELING_NOTE, WIDOWED_SURVIVOR_CARD } from '../widowedCopy';
import { styles } from './theme';

interface MethodItem {
  title: string;
  body: string;
}

export function PageFooter({ text }: { text: string }) {
  return (
    <Text
      style={styles.footer}
      fixed
      render={({ pageNumber, totalPages }) => `${text} · Page ${pageNumber} of ${totalPages}`}
    />
  );
}

/**
 * Lightweight cover treatment for the first page only — document title and
 * report date, styled with the same theme tokens as the rest of the report.
 * It exists so a printed/downloaded report reads as a finished document
 * rather than opening on a bare section heading.
 *
 * No brand line: `PageFooter` already prints the firm's name on
 * every page including this one, so a second copy 700pt above it was the
 * same name twice on one sheet. The rule that kept this header off pages 2+
 * is the same rule, applied one level in.
 */
export function ReportHeader({ dateLabel }: { dateLabel: string }) {
  return (
    <View style={styles.docHeader}>
      <View>
        <Text style={styles.docTitle}>Social Security Claiming Analysis</Text>
      </View>
      <Text style={styles.docDate}>{dateLabel}</Text>
    </View>
  );
}

export function MethodPair({ left, right }: { left: MethodItem; right?: MethodItem }) {
  if (!left.title && !right?.title) return null;
  return (
    <View style={styles.methodRow}>
      <View style={styles.methodBlock}>
        {left.title ? (
          <>
            <Text style={styles.methodTitle}>{left.title}</Text>
            <Text style={styles.methodText}>{left.body}</Text>
          </>
        ) : null}
      </View>
      {right?.title ? (
        <View style={[styles.methodBlock, styles.methodBlockLast]}>
          <Text style={styles.methodTitle}>{right.title}</Text>
          <Text style={styles.methodText}>{right.body}</Text>
        </View>
      ) : (
        <View style={[styles.methodBlock, styles.methodBlockLast]} />
      )}
    </View>
  );
}

export function formatReportDate(): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

/**
 * Methodology pairs are computed once for the whole document from the
 * representative person (`people[0]`), the same household-representative
 * convention `HouseholdPanel` uses for its break-even section — FRA/DRC
 * mechanics don't meaningfully vary per person. The spousal figure names
 * which of the two `spousalTopUp` quantities it shows, since one is reduced
 * for early filing and one isn't; no survivor figure is stated anywhere here.
 */
/**
 * Exported for `ReportDocument.test.tsx`. The pairs reach the page as PROPS
 * on a row component, not as children, so a text walk over the rendered tree
 * cannot see them — asserting on this function directly is both the honest
 * unit and the only thing that can fail.
 */
export function buildMethodPairs(analysis: HouseholdAnalysis): [MethodItem, MethodItem][] {
  const rep = analysis.people[0];
  // Empty for a widow(er) — `analyzeWidowed` clears `claimingOptions` because
  // a table of what this person's OWN record pays at each age describes income
  // they may never receive. The two cards built from it are replaced below
  // rather than guarded with a fallback figure: a `!` here threw on the very
  // first widowed export.
  const isWidowed = householdDisplayShape(analysis.status) === 'widowed';
  const age62 = rep.claimingOptions.find((o) => o.age === 62);
  const age70 = rep.claimingOptions.find((o) => o.age === 70);
  const cpi = getCpiLast30Years();
  const { annualCola } = analysis.assumptions;
  const spousal = analysis.spousalTopUp;

  return [
    [
      {
        title: 'Full Retirement Age (FRA)',
        // No arrow — see the note in `PersonSection`'s break-even cards.
        body: `FRA ${fraLabel(rep.fra)} for birth year ${rep.person.birthYear}, per SSA schedule.`,
      },
      isWidowed || age62 === undefined
        ? {
            title: 'Two Independent Dates',
            body:
              'A survivor benefit can start at 60 and an own-record benefit at 62. Deemed ' +
              'filing does not apply to survivor benefits, so neither date forces the other.',
          }
        : {
            title: 'Early Claiming Reduction',
            body: `5/9 of 1% per month (first 36 mo), then 5/12 of 1% thereafter. Age 62 = ${age62.percentOfPia}% of PIA.`,
          },
    ],
    [
      isWidowed || age70 === undefined
        ? {
            title: 'Survivor Full Retirement Age',
            body:
              'Survivor benefits use their own full-retirement-age schedule, which is not the ' +
              'retirement one. The two coincide only for birth years from 1962 onward.',
          }
        : {
            title: 'Delayed Retirement Credits',
            body: `2/3 of 1% per month past FRA to age 70. Age 70 = ${age70.percentOfPia}% of PIA.`,
          },
      {
        title: 'Lifetime Benefit Projection',
        // The engine projects no future COLA — only the historical COLAs
        // already baked into the PIA — so every dollar figure in this report
        // is in today's dollars. The household page says exactly this; these
        // two strings used to claim the opposite on the same printed page.
        body: `Lifetime totals are in today’s dollars, before any future cost-of-living adjustment, undiscounted, through age ${rep.person.lifeExpectancy}.`,
      },
    ],
    [
      {
        title: 'Inflation / COLA',
        // Stated as the assumption it is: this slider reaches the break-even
        // ages and nothing else, so it must not read as if benefit amounts
        // were inflated by it.
        body: `${formatPercent(annualCola, 2)} annual COLA, applied to break-even ages only. BLS CPI-U ${cpi.startYear}–${cpi.endYear} avg ${formatPercent(cpi.arithmeticMean, 2)}.`,
      },
      {
        title: 'Life Expectancy',
        body: `Plan-to age ${rep.person.lifeExpectancy}. SSA period life table suggests age ${rep.ssaSuggestedLifeExpectancy} for ${genderLabel(rep.person.gender).toLowerCase()} at ${rep.currentAge.years}.`,
      },
    ],
    [
      {
        title: isWidowed ? 'Survivor Benefit' : 'Spousal Benefit',
        // Both arms are shared with the household page and the on-screen
        // panel: the married one so the three cannot branch differently on an
        // absent start date again, the single one so they cannot make three
        // different claims about what a single claimant is and is not shown.
        //
        // The subject comes from `lowerEarnerLabel`, exactly as on the
        // household page and on screen. A hardcoded non-null subject here
        // made `spousalSummary`'s tie branch unreachable in print, so an
        // equal-PIA household read "half of the higher earner's PIA does not
        // exceed the lower earner's own benefit" — about a household with
        // neither a higher nor a lower earner.
        body: spousal
          ? spousalSummary(spousal, spousal.lowerEarnerLabel === null ? null : 'the lower earner')
          : isWidowed
            ? WIDOWED_SURVIVOR_CARD
            : SINGLE_CLAIMANT_BENEFIT_NOTE,
      },
      {
        title: 'Data Sources',
        // The vintages print beside the links, so a reader can tell how old
        // the figures are without opening either.
        body: `${dataVintageLine()} COLA: ${BLS_CPI_URL}. Life tables: ${SSA_LIFE_TABLE_URL}.`,
      },
    ],
  ];
}

/**
 * Exported for `HouseholdSection.test.tsx`, which places it on the household
 * page exactly as `ReportDocument` does. That co-location is the whole point:
 * for a married report this block and the combined-income caption share one
 * physical `<Page>`, and testing them apart is how they came to contradict
 * each other about survivor benefits.
 */
export function MethodologyAppendix({ analysis }: { analysis: HouseholdAnalysis }) {
  // Exhaustive, and repeated here rather than left to `ReportDocument` alone
  // because this block is exported and rendered on its own by
  // `HouseholdSection.test.tsx`. See `householdDisplayShape`.
  const appendixShape = householdDisplayShape(analysis.status);
  const hasSpouse = appendixShape === 'twoClaimants';
  const pairs = buildMethodPairs(analysis);

  return (
    <>
      <Text style={styles.sectionTitle}>Methodology & Assumptions</Text>
      {pairs.map((pair, i) => (
        <MethodPair key={i} left={pair[0]} right={pair[1]} />
      ))}
      {/* `wrap={false}`: this is a bordered box, and react-pdf will happily
          leave its text on one page and its bottom border on the next. That
          printed a whole extra sheet carrying a single hairline and a footer
          — 0.01% ink — the first time the terms and the appendix shared a
          page group. A callout box should move as one thing regardless. */}
      {/* What this report's model does and does not cover. The firm's own
          disclosures print in the disclosure block, from the theme; nothing
          here repeats them, so a report carrying both never says the same
          sentence twice. */}
      <View style={styles.disclaimer} wrap={false}>
        <Text style={styles.disclaimerTitle}>Modeling notes</Text>
        <Text style={styles.disclaimerText}>
          Benefit amounts are in today&rsquo;s dollars, before any future cost-of-living
          adjustment.{' '}
          {appendixShape === 'widowed'
            ? `${WIDOWED_MODELING_NOTE} `
            : hasSpouse
              ? `${coupleModelingNote(analysis.survivorGap)} `
              : `${SINGLE_CLAIMANT_BENEFIT_NOTE} `}
          Projections exclude taxation, the earnings test, and future rule changes. Data:{' '}
          {BLS_CPI_URL}.
        </Text>
      </View>
    </>
  );
}
