/**
 * The three exhibits a competitor report carries and this one did not: the
 * year-by-year cash flow behind each strategy, the strategies as bars, and
 * their cumulative curves crossing over time.
 *
 * All three read `HouseholdStrategy.timeline` — the SAME array the household
 * value printed on the strategy table was summed from (`lifetimeValue.ts`).
 * That is the point of them existing here rather than being recomputed: an
 * adviser adding up the year column must land on the figure in the table
 * above it, and before the timeline was carried per strategy they would not
 * have.
 *
 * Off by default. They are registered in `reportLayout.ts`'s BLOCKS but are
 * absent from both preset layouts, which is how a block becomes available in
 * the editor without appearing in anyone's existing report.
 *
 * Widowed households are excluded (`LIVING` shapes only): their rows carry no
 * timeline yet, and a table of empty years is worse than no table.
 */
import React from 'react';
import { Text, View, Svg, Line, Polyline, Rect } from '@react-pdf/renderer';
import type { CombinedTimelinePoint, HouseholdStrategy } from '../../lib/household';
import type { Person } from '../../lib/personAnalysis';
import { formatCurrency, formatThousandsTick, personLabel } from '../../lib/format';
import { formatPercent } from '../../lib/cpiHistory';
import { discountFactor } from '../../lib/lifetimeValue';
import { styles, BORDER, CHART_INNER_W, GOLD, INK, MUTED, SUBTLE } from './theme';

/** Distinct enough to tell six curves apart in grayscale as well as color. */
const SERIES = [GOLD, INK, '#4f7cac', '#8a6fa8', '#5f8f6a', '#b07d4a'] as const;
const seriesColor = (i: number) => SERIES[i % SERIES.length];

/** Where the report is priced from, and at what rate — shared by all three. */
export interface ExhibitBasis {
  /** A FRACTION (0.025 means 2.5%), as the analysis carries it. */
  discountRate: number;
  asOfYear: number;
}

interface CumulativeRow {
  year: number;
  total: number;
  /** Money as received, added up. */
  run: number;
  /** The same money discounted back to `asOfYear`, added up. */
  pv: number;
}

/**
 * A strategy's years, each with both running totals through that year.
 *
 * `pv` is what reconciles the table to the figure above it. The timeline
 * arrives already stated in the report's dollars, so the discount is all that
 * separates the two: at `discountRate: 0` the columns are identical, which is
 * why only one of them is printed in that case.
 */
function cumulative(timeline: CombinedTimelinePoint[], basis: ExhibitBasis): CumulativeRow[] {
  let run = 0;
  let pv = 0;
  return timeline.map((p) => {
    run += p.total;
    pv += p.total * discountFactor(p.year, basis.asOfYear, basis.discountRate);
    return { year: p.year, total: p.total, run, pv };
  });
}

/* ------------------------------------------------------------------ *
 * 1. Year by year, per strategy
 * ------------------------------------------------------------------ */

function YearlyTable({
  strategy,
  people,
  basis,
}: {
  strategy: HouseholdStrategy;
  people: Person[];
  basis: ExhibitBasis;
}) {
  const rows = cumulative(strategy.timeline, basis);
  if (rows.length === 0) return null;
  // Two identical columns of the same figures would be worse than one. At a
  // zero discount they ARE identical, which is the comparison preset's basis.
  const discounted = basis.discountRate > 0;
  const yearW = 46;
  const runW = 86;
  const fixed = yearW + 86 + runW + (discounted ? runW : 0);
  const personW = (CHART_INNER_W - fixed) / Math.max(1, people.length);

  return (
    <View wrap>
      <Text style={[styles.sectionDesc, { marginTop: 8, marginBottom: 4 }]}>
        {strategy.label} · {formatCurrency(strategy.householdValue)} over both lifetimes
        {discounted ? ', discounted' : ''}
      </Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: yearW }]}>Year</Text>
        {people.map((p, i) => (
          <Text key={p.id} style={[styles.th, { width: personW }]}>
            {personLabel(p.name, i as 0 | 1)}
          </Text>
        ))}
        <Text style={[styles.th, { width: 86 }]}>Combined</Text>
        <Text style={[styles.th, { width: runW }]}>Running total</Text>
        {discounted ? <Text style={[styles.th, { width: runW }]}>Discounted total</Text> : null}
      </View>
      {rows.map((r) => (
        <View key={r.year} style={styles.tableRow} wrap={false}>
          <Text style={[styles.td, { width: yearW }]}>{r.year}</Text>
          {people.map((p) => {
            const amount = strategy.timeline.find((t) => t.year === r.year)?.byPersonId[p.id] ?? 0;
            return (
              <Text key={p.id} style={[styles.td, { width: personW }]}>
                {amount === 0 ? '—' : formatCurrency(amount)}
              </Text>
            );
          })}
          <Text style={[styles.td, { width: 86 }]}>{formatCurrency(r.total)}</Text>
          {/* Bold goes on whichever column ends on the household value
              printed above, because that is the one an adviser is asked to
              reconcile. Without a discount the two columns are the same
              figure and only one is drawn. */}
          <Text
            style={[styles.td, discounted ? {} : styles.tdBold, { width: runW }]}
          >
            {formatCurrency(r.run)}
          </Text>
          {discounted ? (
            <Text style={[styles.td, styles.tdBold, { width: runW }]}>{formatCurrency(r.pv)}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * What the two running totals mean, said differently depending on whether
 * there are two.
 *
 * The undiscounted column ran 1.44–1.56× ahead of the household value printed
 * above it for the household this was built against — correct, and the kind of
 * gap a client asks about on the spot. So the discounted column exists to end
 * on that figure, and this sentence says which column is which rather than
 * leaving the reader to infer it from a footnote about present value.
 */
function yearlyCaption(basis: ExhibitBasis): string {
  const shared =
    'What each strategy actually pays, year by year, and what it adds up to. A person’s column ' +
    'includes any survivor amount they are paid once the other has died, which is why one ' +
    'column can rise in the year the other ends. ';
  if (basis.discountRate <= 0) {
    return (
      shared +
      'The running total is money as it is received. No discount is applied here, so it ends on ' +
      'the household value printed in the comparison above.'
    );
  }
  return (
    shared +
    'There are two running totals because they answer different questions. The first is money as ' +
    'it is received, undiscounted — what actually reaches the bank. The second counts each ' +
    `payment at ${formatPercent(basis.discountRate * 100, 2)} less per year for being further ` +
    'away, and is the one that ends on the household value printed in the comparison above.'
  );
}

export function ScenarioYearlyBlock({
  comparisons,
  people,
  basis,
}: {
  comparisons: HouseholdStrategy[];
  people: Person[];
  basis: ExhibitBasis;
}) {
  const shown = comparisons.filter((c) => c.timeline.length > 0);
  if (shown.length === 0) return null;
  return (
    <>
      <Text style={styles.sectionTitle}>Year by year</Text>
      <Text style={styles.sectionDesc}>{yearlyCaption(basis)}</Text>
      {/* CALLED, not mounted. These blocks are composed by `renderBlock`
          without a renderer in the tests that assert on them, and an
          unrendered `<YearlyTable />` element has no children to walk — the
          tables would silently vanish from every assertion. The wrapper
          carries the key that calling the function cannot. */}
      {shown.map((s) => (
        <View key={String(s.key)}>{YearlyTable({ strategy: s, people, basis })}</View>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Strategies as bars
 * ------------------------------------------------------------------ */

export function ScenarioCumulativeBarBlock({ comparisons }: { comparisons: HouseholdStrategy[] }) {
  const shown = comparisons.filter((c) => c.timeline.length > 0);
  if (shown.length === 0) return null;

  const h = 150;
  const barGap = 10;
  const barW = Math.max(18, (CHART_INNER_W - barGap * (shown.length + 1)) / shown.length);
  const max = Math.max(...shown.map((c) => c.householdValue));
  if (max <= 0) return null;

  return (
    <>
      <Text style={styles.sectionTitle}>Total by strategy</Text>
      <Text style={styles.sectionDesc}>
        Every strategy side by side, over both lifetimes. Same figures as the comparison table,
        drawn so the size of the gap between them is visible rather than arithmetic.
      </Text>
      <Svg width={CHART_INNER_W} height={h + 34}>
        <Line x1={0} y1={h} x2={CHART_INNER_W} y2={h} strokeWidth={1} stroke={BORDER} />
        {shown.map((c, i) => {
          const barH = Math.max(1, (c.householdValue / max) * (h - 16));
          const x = barGap + i * (barW + barGap);
          return (
            <React.Fragment key={String(c.key)}>
              <Rect
                x={x}
                y={h - barH}
                width={barW}
                height={barH}
                fill={c.isOptimal ? GOLD : SUBTLE}
              />
              <Text
                x={x + barW / 2}
                y={h - barH - 4}
                style={{ fontSize: 7, textAlign: 'center', color: INK }}
              >
                {formatThousandsTick(c.householdValue)}
              </Text>
            </React.Fragment>
          );
        })}
      </Svg>
      {/* Labels as text rows rather than rotated SVG: react-pdf has no text
          rotation, and a strategy label never fits under a bar horizontally. */}
      {shown.map((c, i) => (
        <Text key={String(c.key)} style={[styles.legendItem, { color: MUTED }]}>
          <Text style={{ color: c.isOptimal ? GOLD : INK }}>■ </Text>
          {c.label} · {formatCurrency(c.householdValue)}
          {c.isOptimal ? ' · best' : ''}
          {i === shown.length - 1 ? '' : ''}
        </Text>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 3. Cumulative curves over time
 * ------------------------------------------------------------------ */

export function CumulativeOverTimeBlock({
  comparisons,
  basis,
}: {
  comparisons: HouseholdStrategy[];
  basis: ExhibitBasis;
}) {
  const shown = comparisons.filter((c) => c.timeline.length > 0);
  if (shown.length === 0) return null;

  const series = shown.map((c) => ({ strategy: c, points: cumulative(c.timeline, basis) }));
  const years = series.flatMap((s) => s.points.map((p) => p.year));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const maxRun = Math.max(...series.flatMap((s) => s.points.map((p) => p.run)));
  if (maxRun <= 0 || maxYear <= minYear) return null;

  const h = 190;
  const padL = 46;
  const w = CHART_INNER_W;
  const x = (year: number) => padL + ((year - minYear) / (maxYear - minYear)) * (w - padL - 8);
  const y = (run: number) => h - 18 - (run / maxRun) * (h - 34);

  return (
    <>
      <Text style={styles.sectionTitle}>Cumulative over time</Text>
      <Text style={styles.sectionDesc}>
        What each strategy has paid in total by any given year. Where two lines cross is the year
        the later-claiming strategy overtakes the earlier one — the break-even, seen directly
        rather than stated as an age.
        {basis.discountRate > 0
          ? ' Drawn on money as it is received rather than discounted, because the crossing an' +
            ' adviser is asked about is the one in cash: these lines therefore end above the' +
            ' household values in the comparison table, which are discounted.'
          : ''}
      </Text>
      <Svg width={w} height={h}>
        <Line x1={padL} y1={h - 18} x2={w - 8} y2={h - 18} strokeWidth={1} stroke={BORDER} />
        <Line x1={padL} y1={10} x2={padL} y2={h - 18} strokeWidth={1} stroke={BORDER} />
        <Text x={2} y={16} style={{ fontSize: 7, color: MUTED }}>
          {formatThousandsTick(maxRun)}
        </Text>
        <Text x={padL} y={h - 6} style={{ fontSize: 7, color: MUTED }}>
          {minYear}
        </Text>
        <Text x={w - 30} y={h - 6} style={{ fontSize: 7, color: MUTED }}>
          {maxYear}
        </Text>
        {series.map((s, i) => (
          <Polyline
            key={String(s.strategy.key)}
            points={s.points.map((p) => `${x(p.year)},${y(p.run)}`).join(' ')}
            fill="none"
            strokeWidth={s.strategy.isOptimal ? 1.6 : 1}
            stroke={seriesColor(i)}
          />
        ))}
      </Svg>
      {series.map((s, i) => (
        <Text key={String(s.strategy.key)} style={[styles.legendItem, { color: MUTED }]}>
          <Text style={{ color: seriesColor(i) }}>■ </Text>
          {s.strategy.label}
        </Text>
      ))}
    </>
  );
}
