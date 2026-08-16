import { Document, Text, View } from '@react-pdf/renderer';
import { BRAND_NAME } from '../../lib/brand';
import { BLS_CPI_URL, formatPercent, getCpiLast30Years } from '../../lib/cpiHistory';
import { formatCurrencyPrecise, fraLabel } from '../../lib/format';
import type { HouseholdAnalysis } from '../../lib/household';
import { genderLabel, SSA_LIFE_TABLE_URL } from '../../lib/lifeExpectancy';
import { formatVersionLabel } from '../../lib/version';
import { HouseholdSection } from './HouseholdSection';
import { PersonSection } from './PersonSection';
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
 * Lightweight cover treatment for the first page only — document title,
 * brand name, and report date, styled with the same theme tokens as the
 * rest of the report. Every page's `PageFooter` already repeats brand +
 * date, so this isn't duplicated on subsequent pages; it exists so a
 * printed/downloaded report reads as a finished document rather than
 * opening on a bare section heading.
 */
function ReportHeader({ dateLabel }: { dateLabel: string }) {
  return (
    <View style={styles.docHeader}>
      <View>
        <Text style={styles.docTitle}>Social Security Claiming Analysis</Text>
        <Text style={styles.docBrand}>{BRAND_NAME}</Text>
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

function formatReportDate(): string {
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
function buildMethodPairs(analysis: HouseholdAnalysis): [MethodItem, MethodItem][] {
  const rep = analysis.people[0];
  const age62 = rep.claimingOptions.find((o) => o.age === 62)!;
  const age70 = rep.claimingOptions.find((o) => o.age === 70)!;
  const cpi = getCpiLast30Years();
  const { annualCola } = analysis.assumptions;
  const spousal = analysis.spousalTopUp;

  return [
    [
      {
        title: 'Full Retirement Age (FRA)',
        body: `Birth year ${rep.person.birthYear} → FRA ${fraLabel(rep.fra)} per SSA schedule.`,
      },
      {
        title: 'Early Claiming Reduction',
        body: `5/9 of 1% per month (first 36 mo), then 5/12 of 1% thereafter. Age 62 = ${age62.percentOfPia}% of PIA.`,
      },
    ],
    [
      {
        title: 'Delayed Retirement Credits',
        body: `2/3 of 1% per month past FRA to age 70. Age 70 = ${age70.percentOfPia}% of PIA.`,
      },
      {
        title: 'Lifetime Benefit Projection',
        body: `Lifetime totals use SSA cost-of-living adjustments (ssa.tools), undiscounted, through age ${rep.person.lifeExpectancy}.`,
      },
    ],
    [
      {
        title: 'Inflation / COLA',
        body: `${formatPercent(annualCola, 2)} annual COLA. BLS CPI-U ${cpi.startYear}–${cpi.endYear} avg ${formatPercent(cpi.arithmeticMean, 2)}.`,
      },
      {
        title: 'Life Expectancy',
        body: `Plan-to age ${rep.person.lifeExpectancy}. SSA period life table suggests age ${rep.ssaSuggestedLifeExpectancy} for ${genderLabel(rep.person.gender).toLowerCase()} at ${rep.currentAge.years}.`,
      },
    ],
    [
      {
        title: 'Spousal Benefit',
        body: spousal
          ? `The lower earner's spousal top-up is ${formatCurrencyPrecise(spousal.atRecommendedFilingAge)}/mo under the recommended strategy, beginning at age ${spousal.startsAtSpouseAge} — a spousal benefit cannot start before the other spouse has filed (unreduced amount at the lower earner's own FRA: ${formatCurrencyPrecise(spousal.atFra)}/mo).`
          : 'Single claimant — spousal benefits not modeled.',
      },
      {
        title: 'Data Sources',
        body: `COLA: ${BLS_CPI_URL}. Life tables: ${SSA_LIFE_TABLE_URL}.`,
      },
    ],
  ];
}

function MethodologyAppendix({ analysis }: { analysis: HouseholdAnalysis }) {
  const pairs = buildMethodPairs(analysis);
  const hasSpouse = analysis.status === 'married';

  return (
    <>
      <Text style={styles.sectionTitle}>Methodology & Assumptions</Text>
      {pairs.map((pair, i) => (
        <MethodPair key={i} left={pair[0]} right={pair[1]} />
      ))}
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerTitle}>Important Disclosures</Text>
        <Text style={styles.disclaimerText}>
          Prepared by {BRAND_NAME} using the open-source ssa.tools engine for educational
          planning only. Not affiliated with the SSA. Benefit amounts reflect SSA
          cost-of-living adjustments;{' '}
          {hasSpouse
            ? 'the spousal top-up is modeled via the ssa.tools couple optimizer. '
            : 'spousal benefits are not modeled for single claimants. '}
          Projections exclude taxation, earnings limits, and future rule changes. Data:{' '}
          {BLS_CPI_URL}. Verify at ssa.gov before claiming.
        </Text>
      </View>
    </>
  );
}

/**
 * Composes the printable report. Print has no tabs, so this linearizes what
 * the app shows as tabs on screen: for a married household, the household
 * page first, then one page per person; for a single claimant, just their
 * page. The shared methodology/disclosures block attaches to whichever
 * section is last in that flow, so it appears exactly once regardless of
 * household shape; the cover `ReportHeader` attaches to whichever section is
 * first, for the same reason. Page numbers use react-pdf's own
 * `pageNumber`/`totalPages` (see `PageFooter`) rather than a pre-computed
 * count, so they stay correct even if a section's content wraps onto more
 * than one physical page.
 */
export function ReportDocument({ analysis }: { analysis: HouseholdAnalysis }) {
  const reportDate = formatReportDate();
  const footerText = `${BRAND_NAME} · ${formatVersionLabel()} · Confidential · ${reportDate}`;
  const appendix = <MethodologyAppendix analysis={analysis} />;
  const leadingHeader = <ReportHeader dateLabel={reportDate} />;
  const isMarried = analysis.status === 'married';

  return (
    <Document
      title="Social Security Claiming Analysis"
      author={BRAND_NAME}
      subject="Social Security Claiming Analysis"
    >
      {isMarried && (
        <HouseholdSection
          analysis={analysis}
          footerText={footerText}
          appendix={appendix}
          leadingHeader={leadingHeader}
        />
      )}
      {analysis.people.map((p, i) => (
        <PersonSection
          key={p.person.id}
          analysis={p}
          index={i as 0 | 1}
          annualCola={analysis.assumptions.annualCola}
          footerText={footerText}
          appendix={isMarried ? undefined : appendix}
          leadingHeader={!isMarried && i === 0 ? leadingHeader : undefined}
        />
      ))}
    </Document>
  );
}
