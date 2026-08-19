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
import {
  cellsWithin,
  gridKey,
  gridRatio,
  type ClaimingGrid,
} from '../../lib/claimingGrid';
import { heatmapColorPdf } from '../../lib/chartData';
import { formatPercent } from '../../lib/cpiHistory';
import { filingMonth, shortMonthYearLabel } from '../../lib/filingDates';
import {
  compactUnitFor,
  formatCompactCurrency,
  formatCurrency,
  formatThousandsTick,
  personLabel,
} from '../../lib/format';
import {
  benefitSeriesLabel,
  COMBINED_INCOME_SUBTITLE,
  combinedIncomeCaption,
  incomeCliffSentence,
  INCOME_CLIFF_HEADING,
  nominalFirstDeathNote,
  spousalSummary,
  survivorClaimNote,
  survivorFloorNote,
  survivorGapNote,
  survivorIncomeCaption,
  HOUSEHOLD_VALUE_COLUMN_HEADER,
  householdValueCaption,
  SURVIVOR_INCOME_COLUMN_HEADER,
} from '../methodologyCopy';
import { scenarioEyebrow } from '../../lib/scenario';
import { BORDER, CHART_INNER_W, GREEN, INK, MUTED, styles } from './theme';
import { PageFooter } from './ReportDocument';

interface Props {
  analysis: HouseholdAnalysis;
  footerText: string;
  appendix?: ReactNode;
  leadingHeader?: ReactNode;
  /**
   * The near-best region as the adviser had it on screen. Undefined prints no
   * grid at all — the grid arrived after this component, and every existing
   * caller (the tests here, chiefly) must keep rendering the page they were
   * written against.
   */
  gridTarget?: { on: boolean; percent: number };
}

/** Household strategy-comparison columns (must sum to CONTENT_W). */
// `npv` widened and `label` narrowed by the same amount when "Combined PV"
// became "Household value": the header is four characters longer and wrapped
// at the old width. Must still sum to CONTENT_W.
const HCOL = { label: 118, person: 80, npv: 102, delta: 66, survivor: 70 };

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
        <Text style={[styles.th, { width: HCOL.npv }]}>{HOUSEHOLD_VALUE_COLUMN_HEADER}</Text>
        <Text style={[styles.th, { width: HCOL.delta }]}>vs. best</Text>
        {showSurvivorIncome && (
          <Text style={[styles.th, { width: HCOL.survivor }]}>{SURVIVOR_INCOME_COLUMN_HEADER}</Text>
        )}
      </View>
      {comparisons.map((s) => (
        <View
          key={s.key}
          style={[
            styles.tableRow,
            s.isOptimal ? styles.tableRowOptimal : {},
            s.isSelected && !s.isOptimal ? styles.tableRowSelected : {},
          ]}
        >
          <View style={[styles.tdAge, { width: HCOL.label }]}>
            <Text style={styles.tdBold}>{s.label}</Text>
            {s.isOptimal && <Text style={styles.badge}>BEST</Text>}
            {s.isSelected && !s.isOptimal && <Text style={styles.badgeShown}>SHOWN</Text>}
          </View>
          {s.filingAges.map((filingAge, i) => (
            <View key={people[i].id} style={{ width: HCOL.person }}>
              <Text style={styles.td}>{filingAge.label}</Text>
              {/* The date under the age — see the screen table. */}
              <Text style={styles.tdDate}>
                {shortMonthYearLabel(filingMonth(people[i], filingAge))}
              </Text>
            </View>
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
  // Inside the `chartBox` frame, not the full page width — see CHART_INNER_W.
  const W = CHART_INNER_W;
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

  // Contiguous months whose every series amount is unchanged collapse into
  // ONE rectangle each.
  //
  // Drawing a rect per month gave each series a barely-half-point column, and
  // the PDF rasterizer left a hairline seam at every one of the ~400 shared
  // edges — the printed chart read as vertical pinstripes rather than solid
  // colour. Merging is exact rather than cosmetic: a benefit band pays a flat
  // amount for its whole span, so every month inside a run carries the same
  // height, and the runs are the steps the chart exists to show. A typical
  // household drops from ~400 rects per series to about four.
  const runs: { start: number; end: number; key: string; point: MonthlyIncomePoint }[] = [];
  monthlySeries.forEach((point, i) => {
    const key = series.map((s) => point.bySeries[s.key] ?? 0).join('|');
    const last = runs[runs.length - 1];
    if (last !== undefined && last.key === key) last.end = i;
    else runs.push({ start: i, end: i, key, point });
  });

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={BORDER} strokeWidth={0.5} />
        {runs.map((run) => {
          let yTop = padT + plotH;
          return series.map((s) => {
            const amount = run.point.bySeries[s.key] ?? 0;
            const h = (amount / maxTotal) * plotH;
            const y = yTop - h;
            yTop = y;
            return (
              <Rect
                key={`${run.start}-${s.key}`}
                x={padL + run.start * barW}
                y={y}
                width={(run.end - run.start + 1) * barW}
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
        {/* ONE child, built as a single string. react-pdf lays out each child
            of an SVG `Text` at the element's own x, so the three-child form
            (`$`, the number, `k`) printed all three stacked on the same
            point — the "$50k" that rendered as an overlapped "$50 k". */}
        <Text x={padL - 4} y={padT + 3} style={{ fontSize: 5.5, fill: MUTED }} textAnchor="end">
          {formatThousandsTick(maxTotal)}
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
 * The claiming-age grid, in print.
 *
 * Drawn as SVG rather than a `View` grid for the same reason `PdfHeatmap` is:
 * react-pdf's box model makes a border change a cell's size, so an outlined
 * near-best square would sit a hair out of line with its neighbours across a
 * whole row. In SVG a stroke is drawn on the rect, not around it.
 *
 * The printed sheet loses the screen's hover, so every square carries its
 * percentage and the caption names the two exact ages behind the best one.
 * The near-best region uses the same two devices as the screen — a ring on
 * the members and a step back for everything else, here a paler fill rather
 * than opacity — because a ring alone reads as a faint edge on a page.
 */
export function ClaimingGridPlot({
  grid,
  names,
  target,
}: {
  grid: ClaimingGrid;
  names: [string, string];
  target: { on: boolean; percent: number };
}) {
  const [yearsA, yearsB] = grid.years;
  // 62 top-left, increasing outward — see the screen panel.
  const rows = yearsB;
  const within = target.on ? cellsWithin(grid, target.percent) : new Set<string>();
  const byKey = new Map(grid.cells.map((c) => [gridKey(c.years[0], c.years[1]), c]));
  const best = grid.cells.reduce((a, b) => (b.value > a.value ? b : a));

  const unit = compactUnitFor(grid.max);

  const labelW = 18;
  const axisH = 12;
  const cellW = Math.min(46, (CHART_INNER_W - labelW - 2) / yearsA.length);
  const cellH = 17;
  const W = labelW + cellW * yearsA.length + 2;
  const H = axisH + cellH * rows.length + axisH;

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {yearsA.map((year, i) => (
          <Text
            key={`x-${year}`}
            x={labelW + i * cellW + cellW / 2}
            y={8}
            style={{ fontSize: 6, fill: MUTED }}
            textAnchor="middle"
          >
            {String(year)}
          </Text>
        ))}
        {rows.map((yb, r) => (
          <Text
            key={`y-${yb}`}
            x={labelW - 3}
            y={axisH + r * cellH + cellH * 0.66}
            style={{ fontSize: 6, fill: MUTED }}
            textAnchor="end"
          >
            {String(yb)}
          </Text>
        ))}
        {rows.map((yb, r) =>
          yearsA.map((ya, c) => {
            const cell = byKey.get(gridKey(ya, yb));
            if (cell === undefined) return null;
            const near = within.has(gridKey(ya, yb));
            const isBest = cell === best;
            // Outside the region the ramp is compressed toward its pale end,
            // so the near-best cloud carries the ink. With the highlight off,
            // every square gets the full ramp.
            const t = gridRatio(grid, cell.value);
            const shade = !target.on || near || isBest ? t : t * 0.35;
            return (
              <Rect
                key={`${ya}-${yb}`}
                x={labelW + c * cellW + 0.5}
                y={axisH + r * cellH + 0.5}
                width={cellW - 1}
                height={cellH - 1}
                rx={1.5}
                fill={heatmapColorPdf(shade)}
                stroke={isBest ? INK : near ? GREEN : 'none'}
                strokeWidth={isBest ? 1.2 : near ? 1 : 0}
              />
            );
          }),
        )}
        {rows.map((yb, r) =>
          yearsA.map((ya, c) => {
            const cell = byKey.get(gridKey(ya, yb));
            if (cell === undefined) return null;
            return (
              <Text
                key={`t-${ya}-${yb}`}
                x={labelW + c * cellW + cellW / 2}
                y={axisH + r * cellH + cellH * 0.68}
                style={{ fontSize: 5.5, fill: INK }}
                textAnchor="middle"
              >
                {formatCompactCurrency(cell.value, unit)}
              </Text>
            );
          }),
        )}
        <Text
          x={labelW + (cellW * yearsA.length) / 2}
          y={H - 2}
          style={{ fontSize: 6, fill: MUTED }}
          textAnchor="middle"
        >
          {`${names[0]}'s claiming age (columns) — ${names[1]}'s down the side`}
        </Text>
      </Svg>
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
export function HouseholdSection({
  analysis,
  footerText,
  appendix,
  leadingHeader,
  gridTarget,
}: Props) {
  const people = analysis.people.map((p) => p.person);
  const spousal = analysis.spousalTopUp;
  const gapNote = survivorGapNote(analysis.survivorGap);
  const floorNote = survivorFloorNote(analysis.survivorFloor);
  const cliff = incomeCliff(analysis);
  // `'real'` explicit, not the function's default: print always renders real
  // dollars and has no toggle. Passing it explicitly (rather than relying on
  // the default) also means the basis clause never fires here — print's
  // cliff sentence a few lines above already states the same real-dollars
  // basis once, via `incomeCliffSentence`, and this would otherwise repeat
  // it verbatim on the same page.
  const claimNote = survivorClaimNote(analysis.survivorClaim, 'real');

  return (
    <Page size="LETTER" style={styles.page}>
      {leadingHeader}
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>Household</Text>

      <View style={styles.recBox}>
        <Text style={styles.recEyebrow}>
          Household — {scenarioEyebrow(analysis.scenarioIsBest)}
        </Text>
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
        What the optimizer rejected, and by how much.
      </Text>
      <StrategyTable comparisons={analysis.comparisons} people={people} />
      {/* The column's meaning, under the column rather than above the
          heading — and the same sentence the screen prints, so the two
          surfaces cannot describe the figure differently. */}
      <Text style={[styles.sectionDesc, { marginTop: 6 }]}>
        {householdValueCaption(formatPercent(analysis.assumptions.discountRate * 100, 2))}
      </Text>
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
      {floorNote && <Text style={styles.sectionDesc}>{floorNote}</Text>}
      <View style={styles.chartBox} wrap={false}>
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

      {/* Same function as the on-screen note (`SurvivorClaimNote`), in the
          same position relative to the cliff section: directly below it, not
          nested inside `cliff && (...)` above — self-gated on
          `analysis.survivorClaim` alone, exactly like the screen surface, so
          the two cannot disagree about when to render it. */}
      {claimNote && <Text style={styles.sectionDesc}>{claimNote}</Text>}

      {analysis.claimingGrid && gridTarget && (
        /* Heading, caption and board move as ONE block. Left to flow, the
           heading orphaned at the foot of the previous page while the grid
           it names started the next — `wrap={false}` on the box alone only
           keeps the box together, not the words introducing it. */
        <View wrap={false}>
          <Text style={styles.sectionTitle}>Claiming Age Grid</Text>
          <Text style={styles.sectionDesc}>
            Household value at every combination of whole claiming ages, rounded. Each
            square is the best either of them can do filing somewhere inside those two
            years.
            {gridTarget.on
              ? ` Outlined squares are within ${gridTarget.percent}% of the best — ${
                  cellsWithin(analysis.claimingGrid, gridTarget.percent).size
                } of ${analysis.claimingGrid.cells.length} combinations.`
              : ''}
          </Text>
          <View style={styles.chartBox}>
            <ClaimingGridPlot
              grid={analysis.claimingGrid}
              names={[
                personLabel(people[0].name, 0),
                personLabel(people[1].name, 1),
              ]}
              target={gridTarget}
            />
          </View>
        </View>
      )}

      {appendix}

      <PageFooter text={footerText} />
    </Page>
  );
}
