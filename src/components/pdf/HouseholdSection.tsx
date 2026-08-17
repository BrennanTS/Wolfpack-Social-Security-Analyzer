import type { ReactNode } from 'react';
import { Page, Text, View, Svg, Line, Rect } from '@react-pdf/renderer';
import {
  buildMonthlyIncomeSeries,
  showSurvivorIncomeColumn,
  visibleBenefitSeries,
  type HouseholdAnalysis,
  type HouseholdStrategy,
  type MonthlyIncomePoint,
} from '../../lib/household';
import type { Person } from '../../lib/personAnalysis';
import { toNominalAmount } from '../../lib/dollarsMode';
import { incomeCliff } from '../../lib/incomeCliff';
import { seriesColor } from '../../lib/chartTheme';
import { formatCurrency, personLabel } from '../../lib/format';
import {
  benefitSeriesLabel,
  COMBINED_INCOME_SUBTITLE,
  combinedIncomeCaption,
  incomeCliffSentence,
  INCOME_CLIFF_HEADING,
  nominalFirstDeathNote,
  spousalSummary,
  survivorGapNote,
  survivorIncomeCaption,
  SURVIVOR_INCOME_COLUMN_HEADER,
} from '../methodologyCopy';
import { BORDER, CONTENT_W, MUTED, styles } from './theme';
import { PageFooter } from './ReportDocument';

interface Props {
  analysis: HouseholdAnalysis;
  footerText: string;
  appendix?: ReactNode;
  leadingHeader?: ReactNode;
}

/** Household strategy-comparison columns (must sum to CONTENT_W). */
const HCOL = { label: 130, person: 80, npv: 90, delta: 66, survivor: 70 };

/**
 * Exported for `HouseholdSection.test.tsx` for the same reason
 * `CombinedIncomeBars` is: the page's own text walk cannot see inside an
 * uncalled component element, so the column gate has to be asserted on this
 * component directly or not at all.
 */
export function StrategyTable({
  comparisons,
  people,
}: {
  comparisons: HouseholdStrategy[];
  people: Person[];
}) {
  // Married-only, same test the screen table uses — `household.ts` sets
  // `survivorIncome: null` for a single claimant, so gating on `people.length`
  // rather than reading the field keeps the column hidden even if a future
  // single-claimant row ever carried a non-null value by mistake — plus the
  // same "at least one row has a figure" test, so a household whose two
  // plan-to months coincide prints neither a column of em dashes nor the
  // caption that claims figures for it. `showSurvivorIncomeColumn` is shared
  // with the page below so the column and its caption cannot disagree.
  const showSurvivorIncome = showSurvivorIncomeColumn(comparisons, people.length);

  return (
    <View>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: HCOL.label }]}>Strategy</Text>
        {people.map((p, i) => (
          <Text key={p.id} style={[styles.th, { width: HCOL.person }]}>
            {personLabel(p.name, i)}
          </Text>
        ))}
        <Text style={[styles.th, { width: HCOL.npv }]}>Combined PV</Text>
        <Text style={[styles.th, { width: HCOL.delta }]}>vs. best</Text>
        {showSurvivorIncome && (
          <Text style={[styles.th, { width: HCOL.survivor }]}>{SURVIVOR_INCOME_COLUMN_HEADER}</Text>
        )}
      </View>
      {comparisons.map((s) => (
        <View key={s.key} style={[styles.tableRow, s.isOptimal ? styles.tableRowOptimal : {}]}>
          <View style={[styles.tdAge, { width: HCOL.label }]}>
            <Text style={styles.tdBold}>{s.label}</Text>
            {s.isOptimal && <Text style={styles.badge}>BEST</Text>}
          </View>
          {s.filingAges.map((filingAge, i) => (
            <Text key={people[i].id} style={[styles.td, { width: HCOL.person }]}>
              {filingAge.label}
            </Text>
          ))}
          <Text style={[styles.td, { width: HCOL.npv }]}>{formatCurrency(s.expectedNpv)}</Text>
          <Text style={[styles.td, { width: HCOL.delta }, s.deltaVsOptimal < 0 ? styles.negative : {}]}>
            {s.deltaVsOptimal === 0 ? '—' : formatCurrency(s.deltaVsOptimal)}
          </Text>
          {showSurvivorIncome && (
            <Text style={[styles.td, { width: HCOL.survivor }]}>
              {s.survivorIncome == null ? '—' : formatCurrency(s.survivorIncome)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * Compact stacked bar chart of combined household income at MONTHLY
 * resolution, one segment per benefit type (own benefit, spousal, survivor)
 * — the same decomposition `CombinedIncomeChart` draws on screen, from the
 * same `visibleBenefitSeries` selection, the same `seriesColor` palette and
 * the same `benefitSeriesLabel` legend text, and now the same monthly series
 * shape (`MonthlyIncomePoint`, built by `buildMonthlyIncomeSeries` from the
 * raw engine bands rather than from `analysis.combinedTimeline`) — for the
 * same reason the screen chart moved off calendar-year buckets: a bucket
 * either prorates a partial year into a ramp or, if credited at the band's
 * full annual rate instead, double-counts a transition year shared by an
 * outgoing and an incoming band. Print and screen would otherwise show two
 * different shapes for the same household under the one shared caption
 * (`combinedIncomeCaption`) — this keeps that caption true of both. Bars are
 * twelve times narrower than the old one-per-calendar-year version (~2pt
 * instead of ~16pt at this component's width), so they are drawn EDGE TO
 * EDGE — `x={padL + i * barW}`, `width={barW}`, no inset — rather than the
 * ~1pt gap a ~16pt annual bar could afford. That inset, left over from the
 * annual version, used to cost half the bar's own width at ~2pt and printed
 * a flat band as a field of half-density hairline stripes instead of a
 * block; edge-to-edge, adjacent same-colour months merge into one solid
 * region and a transition still reads as a single sharp edge. Exported so
 * `HouseholdSection.test.tsx` can assert on its decomposition in isolation
 * from the household page's own caption text.
 */
export function CombinedIncomeBars({
  monthlySeries,
  people,
}: {
  monthlySeries: MonthlyIncomePoint[];
  people: Person[];
}) {
  const W = CONTENT_W;
  const H = 100;
  const padL = 34;
  const padR = 6;
  const padT = 8;
  const padB = 14;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxTotal = Math.max(...monthlySeries.map((t) => t.total), 1);
  const barW = plotW / monthlySeries.length;

  const series = visibleBenefitSeries(monthlySeries, people).map((s) => ({
    ...s,
    name: benefitSeriesLabel(personLabel(people[s.personIndex]?.name, s.personIndex), s.type),
    color: seriesColor(s.personIndex, s.type),
  }));

  // One label per CALENDAR YEAR, at the first month of that year in the
  // series — not one per Nth data point, now that there are ~12 points per
  // year rather than one. Thinned further (same `Math.ceil(.../8)` shape the
  // old per-point version used) if there are too many years to fit.
  const yearFirstIndex = new Map<number, number>();
  const years: number[] = [];
  monthlySeries.forEach((point, i) => {
    if (!yearFirstIndex.has(point.year)) {
      yearFirstIndex.set(point.year, i);
      years.push(point.year);
    }
  });
  const yearLabelStep = Math.max(1, Math.ceil(years.length / 8));

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={BORDER} strokeWidth={0.5} />
        {monthlySeries.map((point, i) => {
          let yTop = padT + plotH;
          return series.map((s) => {
            const amount = point.bySeries[s.key] ?? 0;
            const h = (amount / maxTotal) * plotH;
            const y = yTop - h;
            yTop = y;
            return (
              <Rect
                key={`${point.monthIndex}-${s.key}`}
                x={padL + i * barW}
                y={y}
                width={barW}
                height={h}
                fill={s.color}
              />
            );
          });
        })}
        {years.map((year, yearIdx) =>
          yearIdx % yearLabelStep === 0 ? (
            <Text
              key={`lbl-${year}`}
              x={padL + yearFirstIndex.get(year)! * barW + barW / 2}
              y={H - 3}
              style={{ fontSize: 5.5, fill: MUTED }}
              textAnchor="middle"
            >
              {year}
            </Text>
          ) : null,
        )}
        <Text x={padL - 4} y={padT + 3} style={{ fontSize: 5.5, fill: MUTED }} textAnchor="end">
          ${Math.round(maxTotal / 1000)}k
        </Text>
      </Svg>
      <View style={styles.chartLegend}>
        {series.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>{s.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The household page: only rendered for married households, always first in
 * the linearized print flow. Leads with the joint recommendation, then the
 * strategy comparison table — the feature the household refactor exists for
 * — the spousal top-up (clearly labeled, since `spousalTopUp` carries two
 * distinct figures), and the combined income timeline.
 */
export function HouseholdSection({ analysis, footerText, appendix, leadingHeader }: Props) {
  const people = analysis.people.map((p) => p.person);
  const spousal = analysis.spousalTopUp;
  const gapNote = survivorGapNote(analysis.survivorGap);
  const cliff = incomeCliff(analysis);

  return (
    <Page size="LETTER" style={styles.page}>
      {leadingHeader}
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>Household</Text>

      <View style={styles.recBox}>
        <Text style={styles.recEyebrow}>Household — Recommended Strategy (ssa.tools)</Text>
        <Text style={styles.recHeadline}>{analysis.recommendation}</Text>
        <Text style={styles.recBody}>{analysis.recommendationDetail}</Text>
        {spousal && (
          // Built by the same function the on-screen panel uses. Interpolating
          // the fields here is what let this surface print an unguarded
          // absence marker while the screen branched correctly.
          //
          // The subject is driven by `lowerEarnerLabel` — the same field the
          // screen passes — not by a hardcoded string. Print used to pass
          // `'the lower earner'` unconditionally, which made
          // `spousalSummary`'s `subject === null` branch unreachable here: on
          // an exact PIA tie `atFra` is 0, so print fell into the `atFra <= 0`
          // branch and stated that "half of the higher earner's PIA does not
          // exceed the lower earner's own benefit", presupposing a higher and
          // a lower earner this household does not have — and disagreeing
          // with the screen about the same household. Only the wording of a
          // present subject stays print-specific: the PDF has no per-person
          // context to name one.
          <Text style={styles.recBody}>
            {spousalSummary(spousal, spousal.lowerEarnerLabel === null ? null : 'the lower earner')}
          </Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Strategy Comparison</Text>
      <Text style={styles.sectionDesc}>
        Combined expected present value for each filing strategy, so you can see what the
        optimizer rejected and by how much.
      </Text>
      <StrategyTable comparisons={analysis.comparisons} people={people} />
      {showSurvivorIncomeColumn(analysis.comparisons, people.length) && (
        // Same gate as the table's own column (shared, not retyped), so the
        // caption cannot print over a column that isn't there — or over one
        // that is all em dashes, which is what happens when both people reach
        // their plan-to age in the same month.
        //
        // `'real'` explicit, not the function's default: print always shows
        // real dollars and has no toggle, regardless of what the default is.
        // The rows go in because the caption's delay claim is checked against
        // them rather than asserted over them.
        <Text style={styles.sectionDesc}>
          {survivorIncomeCaption(analysis.comparisons, analysis.survivorGap, 'real')}
        </Text>
      )}

      <Text style={styles.sectionTitle}>Combined Household Income</Text>
      {/* Same function as the on-screen chart caption: the two were a verbatim
          duplicate, and both claimed survivor benefits were included even for
          the households whose gap note directly beneath said they were not.
          `'real'` is explicit, not the function's default, because print has
          no toggle and always renders real dollars regardless of what the
          default happens to be. */}
      <Text style={styles.sectionDesc}>
        {COMBINED_INCOME_SUBTITLE}.{' '}
        {combinedIncomeCaption(analysis.survivorGap, 'real')}
      </Text>
      {gapNote && <Text style={styles.sectionDesc}>{gapNote}</Text>}
      <View style={styles.chartBox}>
        <CombinedIncomeBars
          monthlySeries={buildMonthlyIncomeSeries(analysis.periods, people)}
          people={people}
        />
      </View>

      {cliff && (
        <>
          <Text style={styles.sectionTitle}>{INCOME_CLIFF_HEADING}</Text>
          {/* Same function the on-screen callout calls — the sentence an
              adviser says out loud must read identically in print. `gapNote`
              is deliberately NOT repeated here: it already printed above,
              directly under "Combined Household Income" (line ~204), and the
              caption right before it says "see the note below" pointing at
              that one copy. Printing it again here put the identical
              paragraph on the page twice — the disclosure belongs exactly
              once, at the chart it annotates.

              `nominalFirstDeathNote` extends this same paragraph rather than
              adding a second one: print can't offer the on-screen toggle, so
              this is the one nominal number preserved in prose — what the
              survivor's income actually will be, in the dollars they'll
              receive that year, not today's. The nominal figure is computed
              here, inside this `cliff &&` branch, rather than hoisted above
              as a separately-nullable variable — TypeScript can then narrow
              `cliff` to non-null on its own, with no `as number` cast
              asserting a relationship it can't otherwise see. */}
          <Text style={styles.sectionDesc}>
            {incomeCliffSentence(cliff, 'real')}{' '}
            {nominalFirstDeathNote(
              cliff,
              toNominalAmount(
                cliff.after,
                analysis.assumptions.annualCola,
                analysis.asOf.getFullYear(),
                cliff.deathYear + 1,
              ),
              analysis.assumptions.annualCola,
            )}
          </Text>
        </>
      )}

      {appendix}

      <PageFooter text={footerText} />
    </Page>
  );
}
