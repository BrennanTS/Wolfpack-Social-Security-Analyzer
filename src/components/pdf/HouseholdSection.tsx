import type { ReactNode } from 'react';
import { Page, Text, View, Svg, Line, Rect } from '@react-pdf/renderer';
import {
  visibleBenefitSeries,
  type CombinedTimelinePoint,
  type HouseholdAnalysis,
  type HouseholdStrategy,
} from '../../lib/household';
import type { Person } from '../../lib/personAnalysis';
import { incomeCliff } from '../../lib/incomeCliff';
import { seriesColor } from '../../lib/chartTheme';
import { formatCurrency, personLabel } from '../../lib/format';
import {
  benefitSeriesLabel,
  combinedIncomeCaption,
  incomeCliffSentence,
  spousalSummary,
  survivorGapNote,
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
const HCOL = { label: 160, person: 90, npv: 100, delta: 76 };

function StrategyTable({
  comparisons,
  people,
}: {
  comparisons: HouseholdStrategy[];
  people: Person[];
}) {
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
        </View>
      ))}
    </View>
  );
}

/**
 * Compact stacked bar chart of combined annual household income by year, one
 * segment per benefit type (own benefit, spousal, survivor) — the same
 * decomposition `CombinedIncomeChart` draws on screen, from the same
 * `visibleBenefitSeries` selection, the same `seriesColor` palette and the
 * same `benefitSeriesLabel` legend text. Exported so `HouseholdSection.test.tsx`
 * can assert on its decomposition in isolation from the household page's own
 * caption text.
 */
export function CombinedIncomeBars({
  timeline,
  people,
}: {
  timeline: CombinedTimelinePoint[];
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
  const maxTotal = Math.max(...timeline.map((t) => t.total), 1);
  const barW = plotW / timeline.length;
  const labelStep = Math.max(1, Math.ceil(timeline.length / 8));

  const series = visibleBenefitSeries(timeline, people).map((s) => ({
    ...s,
    name: benefitSeriesLabel(personLabel(people[s.personIndex]?.name, s.personIndex), s.type),
    color: seriesColor(s.personIndex, s.type),
  }));

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={BORDER} strokeWidth={0.5} />
        {timeline.map((point, i) => {
          let yTop = padT + plotH;
          return series.map((s) => {
            const amount = point.bySeries[s.key] ?? 0;
            const h = (amount / maxTotal) * plotH;
            const y = yTop - h;
            yTop = y;
            return (
              <Rect
                key={`${point.year}-${s.key}`}
                x={padL + i * barW + 0.5}
                y={y}
                width={Math.max(barW - 1, 0.5)}
                height={h}
                fill={s.color}
              />
            );
          });
        })}
        {timeline.map((point, i) =>
          i % labelStep === 0 ? (
            <Text
              key={`lbl-${point.year}`}
              x={padL + i * barW + barW / 2}
              y={H - 3}
              style={{ fontSize: 5.5, fill: MUTED }}
              textAnchor="middle"
            >
              {point.year}
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
          <Text style={styles.recBody}>{spousalSummary(spousal, 'the lower earner')}</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Strategy Comparison</Text>
      <Text style={styles.sectionDesc}>
        Combined expected present value for each filing strategy, so you can see what the
        optimizer rejected and by how much.
      </Text>
      <StrategyTable comparisons={analysis.comparisons} people={people} />

      <Text style={styles.sectionTitle}>Combined Household Income</Text>
      {/* Same function as the on-screen chart caption: the two were a verbatim
          duplicate, and both claimed survivor benefits were included even for
          the households whose gap note directly beneath said they were not. */}
      <Text style={styles.sectionDesc}>
        Annual Social Security income by year under the recommended filing strategy.{' '}
        {combinedIncomeCaption(analysis.survivorGap)}
      </Text>
      {gapNote && <Text style={styles.sectionDesc}>{gapNote}</Text>}
      <View style={styles.chartBox}>
        <CombinedIncomeBars timeline={analysis.combinedTimeline} people={people} />
      </View>

      {cliff && (
        <>
          <Text style={styles.sectionTitle}>Income at the First Death</Text>
          {/* Same function the on-screen callout calls — the sentence an
              adviser says out loud must read identically in print. */}
          <Text style={styles.sectionDesc}>{incomeCliffSentence(cliff)}</Text>
          {gapNote && <Text style={styles.sectionDesc}>{gapNote}</Text>}
        </>
      )}

      {appendix}

      <PageFooter text={footerText} />
    </Page>
  );
}
