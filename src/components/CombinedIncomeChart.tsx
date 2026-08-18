import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  type TooltipContentProps,
} from 'recharts';
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { DollarsMode } from '../lib/dollarsMode';
import {
  monthDateAt,
  visibleBenefitSeries,
  type MonthlyIncomePoint,
} from '../lib/household';
import { firstDeath } from '../lib/incomeCliff';
import type { Person } from '../lib/personAnalysis';
import { formatCurrencyPerYear, personLabel } from '../lib/format';
import {
  benefitSeriesLabel,
  COMBINED_INCOME_SUBTITLE,
  combinedIncomeCaption,
  survivorGapNote,
} from './methodologyCopy';
import {
  CHART_AXIS_LINE,
  CHART_MUTED,
  CHART_RED,
  CHART_TOOLTIP_STYLE,
  seriesColor,
} from '../lib/chartTheme';

interface CombinedIncomeChartProps {
  /**
   * One point per MONTH, not per year — `buildMonthlyIncomeSeries` in
   * `household.ts`, built from the raw engine bands (`analysis.periods`),
   * not from `analysis.combinedTimeline`. A calendar-year bucket can't
   * represent a mid-year handover without either prorating it (a ramp) or
   * crediting a whole year's rate to both the outgoing and incoming band
   * (a double-counted spike) — monthly resolution has neither problem,
   * since a given month has exactly the bands active that month. Already in
   * the units the caller wants shown — `HouseholdPanel` is the one place
   * that calls `toNominalMonthly`, so the chart, the caption below it and
   * every other reader of the household's dollars-mode choice can never
   * disagree about which dollars they're looking at.
   */
  monthlySeries: MonthlyIncomePoint[];
  people: Person[];
  /**
   * The one survivor direction the engine does not model. When set, the bands
   * understate the survivor's income after the first death, and the caption
   * below says so. Optional so the single-claimant call site need not pass it.
   */
  survivorGap?: SurvivorGap | null;
  /**
   * Each person's inclusive final month index, for the first-death marker —
   * read through `firstDeath`, the same function the income-cliff callout and
   * the survivor-income column use, so the marker cannot appear on a screen
   * where those two say there is no modeled first death. Optional so the
   * single-claimant call site need not pass it; the marker only ever appears
   * for a couple regardless, since one person alone has no "first" death.
   */
  finalIndexByPersonId?: Record<string, number>;
  /**
   * Decides only the caption's closing sentence — `monthlySeries` above
   * already carries the actual real-or-nominal figures. Defaults to `'real'`
   * so every test written before the toggle existed keeps asserting the
   * sentence that was already correct.
   */
  dollarsMode?: DollarsMode;
  /**
   * Renders the toggle in the chart header when provided. Omitted by every
   * existing test call site and by the PDF's analogue (`CombinedIncomeBars`,
   * which has no interactive control at all) — print can't toggle, and a
   * caller with nothing to do on change has nothing to pass here.
   */
  onDollarsModeChange?: (mode: DollarsMode) => void;
}

/**
 * The combined household income timeline: one stacked area per person PER
 * BENEFIT TYPE (own benefit, spousal, survivor), summing to total annual
 * Social Security income under the recommended strategy. Mirrors
 * `BenefitChart`'s Recharts conventions (same `chartTheme` tokens,
 * `ResponsiveContainer` wrapper, axis/tooltip styling) so the household tab
 * doesn't look like a different app.
 *
 * Plotted at MONTHLY resolution though the axis still reads in years (see
 * `monthlySeries` above and `buildMonthlyIncomeSeries` in `household.ts`) —
 * every band is flat at its own annual rate for exactly the months it pays,
 * so filing and death both render as a single clean step rather than a ramp
 * (an earlier, calendar-year-bucketed version) or a spike where two bands'
 * full rates landed in the same shared year (a calendar-year version that
 * tried to fix the ramp by crediting the whole year to any band that merely
 * touched it).
 *
 * Deliberately holds no React hooks: `pdf/HouseholdSection.test.tsx`
 * established the pattern this file's own tests reuse for the parts Recharts
 * never mounts in jsdom — call the component directly and walk the JSX tree
 * it returns — and that only works on a component that is safe to call
 * outside a render pass.
 */
/**
 * The chart's tooltip, rendered by hand rather than by Recharts' default.
 *
 * Two reasons. A band that has not started yet is present in the series at
 * $0 — the stack needs the point — but a row reading "$0/yr" is noise beside
 * the bands actually paying, and there can be three of them. Recharts offers
 * no way to drop an item from its own rendering, so the payload is filtered
 * here.
 *
 * The other reason is the unit. The label is a single month ("Feb 2042") but
 * every value is the band's ANNUAL rate at that month, never what was paid in
 * it — `buildMonthlyIncomeSeries` does not prorate. `formatCurrencyPerYear`
 * makes that explicit rather than leaving a reader to infer it from a label
 * that does not match.
 */
export function IncomeTooltip({
  active,
  payload,
  label,
}: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;

  const paying = payload.filter((item) => typeof item.value === 'number' && item.value > 0);
  if (paying.length === 0) return null;

  const monthIndex = typeof label === 'number' ? label : Number(label);
  const heading = Number.isFinite(monthIndex) ? monthDateAt(monthIndex).toString() : '';

  return (
    <div style={{ ...CHART_TOOLTIP_STYLE, padding: '8px 12px' }}>
      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{heading}</p>
      {paying.map((item) => (
        <p key={String(item.dataKey)} style={{ margin: '2px 0', color: item.color }}>
          {item.name}: {formatCurrencyPerYear(item.value as number)}
        </p>
      ))}
    </div>
  );
}

export function CombinedIncomeChart({
  monthlySeries,
  people,
  survivorGap,
  finalIndexByPersonId = {},
  dollarsMode = 'real',
  onDollarsModeChange,
}: CombinedIncomeChartProps) {
  const gap = survivorGap ?? null;
  const gapNote = survivorGapNote(gap);

  const series = visibleBenefitSeries(monthlySeries, people).map((s) => ({
    ...s,
    name: benefitSeriesLabel(personLabel(people[s.personIndex]?.name, s.personIndex), s.type),
    color: seriesColor(s.personIndex, s.type),
  }));

  // The first MONTH each person appears with a positive total — read off the
  // same `byPersonId` roll-up the tooltip uses, so "when the benefit was
  // claimed" is exactly the data already on screen, not a second computation
  // of a benefit rule.
  const filingMonthByPersonId: Record<string, number> = {};
  for (const p of people) {
    const point = monthlySeries.find((pt) => (pt.byPersonId[p.id] ?? 0) > 0);
    if (point) filingMonthByPersonId[p.id] = point.monthIndex;
  }

  // First death, for a couple only — via `firstDeath`, the one place that
  // arithmetic lives. This used to be an inline `Math.min` over the final
  // indexes, which disagreed with `firstDeath` on exactly one household: when
  // both people reach their plan-to age in the SAME month, `firstDeath`
  // returns null (two mortality draws landing on one month is not evidence
  // either outlives the other, and a tie-break would invent a survivor), so
  // the cliff callout was absent and the survivor column was all em dashes
  // while this chart still drew a "First death" marker on the same screen.
  // `incomeCliff.ts:37-41` warns against precisely this second derivation.
  //
  // `deathMonthIndex` is the DECEASED's own inclusive final month — still
  // paid, in full, that month. The household's shape actually changes the
  // month after, so the marker sits at `deathMonthIndex + 1`: the exact
  // month `buildMonthlyIncomeSeries` first stops including their band (and,
  // if the engine models it, first includes the survivor's step-up).
  const death =
    people.length > 1 ? firstDeath([people[0].id, people[1].id], finalIndexByPersonId) : null;
  const rawDeathStepMonth = death !== null ? death.deathMonthIndex + 1 : null;
  // `XAxis` below is a numeric month-index axis: a `ReferenceLine` whose `x`
  // falls outside the plotted range renders nothing at all, silently. Every
  // filing marker's month is guaranteed to be within range (it's read
  // directly off `monthlySeries`), but the death step month is computed
  // independently from `finalIndexByPersonId` and can precede the series'
  // first month — reachable for a person who dies having never held a band.
  // Checking range here turns that into a deliberate omission instead of a
  // marker that was built but silently never appeared.
  const seriesMonths = monthlySeries.map((p) => p.monthIndex);
  const minMonth = seriesMonths[0];
  const maxMonth = seriesMonths[seriesMonths.length - 1];
  const deathStepMonth =
    rawDeathStepMonth !== null &&
    minMonth !== undefined &&
    rawDeathStepMonth >= minMonth &&
    rawDeathStepMonth <= maxMonth
      ? rawDeathStepMonth
      : null;

  // One tick per calendar year, not per month — `monthlySeries` has ~12
  // points per year, far too dense to label individually. The first tick is
  // clamped to the series' own first month rather than that year's January,
  // since the household's timeline can start mid-year and a tick before the
  // plotted range wouldn't align with any point Recharts actually draws.
  const yearTicks: number[] = [];
  if (minMonth !== undefined && maxMonth !== undefined) {
    const minYear = Math.floor(minMonth / 12);
    const maxYear = Math.floor(maxMonth / 12);
    for (let year = minYear; year <= maxYear; year++) {
      yearTicks.push(Math.max(minMonth, year * 12));
    }
  }

  // The filing and first-death markers, laid out to avoid their labels
  // colliding when two events fall close together — reachable whenever two
  // filings (or a filing and the first death) land within a few years of
  // each other, which a fixed vertical position renders as overlapping text
  // rather than two readable labels. Markers are sorted by month and
  // greedily assigned to the first "row" (a vertical offset, stacked
  // downward) whose most recently placed marker is far enough away.
  //
  // `proximityMonths` is a FRACTION of the chart's own month span rather
  // than a fixed count: the same month-gap covers fewer pixels on a longer
  // household timeline (more months squeezed into the same chart width), so
  // a longer span needs a proportionally larger month-gap to guarantee the
  // same real separation. Floored at 24 months so a short timeline still
  // gets meaningful separation.
  interface Marker {
    key: string;
    monthIndex: number;
    text: string;
    stroke: string;
    dash: string;
  }
  const markers: Marker[] = [];
  for (const [i, p] of people.entries()) {
    const monthIndex = filingMonthByPersonId[p.id];
    if (monthIndex === undefined) continue;
    markers.push({
      key: `filing-${p.id}`,
      monthIndex,
      text: `${personLabel(p.name, i)} files`,
      stroke: CHART_MUTED,
      dash: '4 4',
    });
  }
  if (deathStepMonth !== null) {
    markers.push({
      key: 'death',
      monthIndex: deathStepMonth,
      text: 'First death',
      stroke: CHART_RED,
      dash: '3 3',
    });
  }
  markers.sort((a, b) => a.monthIndex - b.monthIndex);

  const span = minMonth !== undefined && maxMonth !== undefined ? maxMonth - minMonth : 0;
  const proximityMonths = Math.max(24, span * 0.06);
  const rowLastMonth: number[] = [];
  const markerRow = new Map<string, number>();
  for (const m of markers) {
    const row = rowLastMonth.findIndex((lastMonth) => m.monthIndex - lastMonth >= proximityMonths);
    if (row === -1) {
      markerRow.set(m.key, rowLastMonth.length);
      rowLastMonth.push(m.monthIndex);
    } else {
      markerRow.set(m.key, row);
      rowLastMonth[row] = m.monthIndex;
    }
  }

  // Custom label content rather than `label={{ position: 'insideTopLeft' }}`
  // — recharts' own top-left position pins every marker's label to the SAME
  // fixed height, which is exactly what let two close-together markers'
  // labels overlap. `viewBox` is the reference line's own rendered pixel
  // box; `row * MARKER_ROW_HEIGHT` pushes a colliding marker's label down
  // by one text-line's worth per row so it clears the one(s) above it.
  const MARKER_ROW_HEIGHT = 13;
  function markerLabel(text: string, row: number) {
    return (props: { viewBox?: { x?: number; y?: number } }) => (
      <text
        x={props.viewBox?.x ?? 0}
        y={(props.viewBox?.y ?? 0) + 12 + row * MARKER_ROW_HEIGHT}
        fill={CHART_MUTED}
        fontSize={11}
        textAnchor="start"
      >
        {text}
      </text>
    );
  }

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Combined Household Income</h3>
        <p>{COMBINED_INCOME_SUBTITLE}</p>
        {onDollarsModeChange && (
          <div
            className="segmented-control dollars-mode-control"
            role="group"
            aria-label="Dollars"
          >
            <button
              type="button"
              className={`segment-btn${dollarsMode === 'real' ? ' segment-btn-active' : ''}`}
              aria-pressed={dollarsMode === 'real'}
              onClick={() => onDollarsModeChange('real')}
            >
              Today’s dollars
            </button>
            <button
              type="button"
              className={`segment-btn${dollarsMode === 'nominal' ? ' segment-btn-active' : ''}`}
              aria-pressed={dollarsMode === 'nominal'}
              onClick={() => onDollarsModeChange('nominal')}
            >
              Future (nominal) dollars
            </button>
          </div>
        )}
        {people.length > 1 && (
          <p className="chart-caveat" data-testid="combined-income-caveat">
            {combinedIncomeCaption(gap, dollarsMode)}
          </p>
        )}
        {gapNote && (
          <p className="chart-caveat" data-testid="survivor-gap-note">
            {gapNote}
          </p>
        )}
        <div className="chart-legend-row" aria-hidden="true">
          {series.map((s) => (
            <span key={s.key} className="chart-legend-item">
              <span className="chart-legend-swatch" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <div className="chart-surface">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={monthlySeries} margin={{ top: 8, right: 16, left: 8, bottom: 20 }}>
            <XAxis
              dataKey="monthIndex"
              type="number"
              domain={minMonth !== undefined && maxMonth !== undefined ? [minMonth, maxMonth] : undefined}
              ticks={yearTicks}
              tickFormatter={(monthIndex: number) => String(Math.floor(monthIndex / 12))}
              tick={{ fill: CHART_MUTED, fontSize: 11 }}
              axisLine={{ stroke: CHART_AXIS_LINE }}
              tickLine={false}
              tickMargin={8}
              padding={{ left: 8, right: 8 }}
            />
            <YAxis
              tick={{ fill: CHART_MUTED, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={48}
            />
            <Tooltip content={<IncomeTooltip />} />
            {series.map((s) => (
              <Area
                key={s.key}
                // At one point per MONTH, a plain `linear` interpolation
                // between two adjacent points already reads as vertical: the
                // diagonal Recharts draws across a single month's width — 1
                // to 2 pixels wide in a typical ~240-point, multi-decade
                // chart — is imperceptible from a true step. `stepAfter` is
                // no longer needed to make the transition read as a step;
                // `linear` is the straight-line rendering the user actually
                // asked for, and every plateau in between is flat regardless
                // of interpolation, since adjacent months in the same band
                // carry the identical value.
                type="linear"
                dataKey={(point: MonthlyIncomePoint) => point.bySeries[s.key] ?? 0}
                name={s.name}
                stackId="household"
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.35}
              />
            ))}
            {/*
              `x` anchors each line to its month; text-anchor "start" grows
              the label RIGHTWARD off the line so it clears the y-axis rather
              than sitting on top of it. `markerLabel` (above) supplies the
              per-marker vertical offset that keeps two close-together
              markers' labels from overlapping each other.
            */}
            {markers.map((m) => (
              <ReferenceLine
                key={m.key}
                x={m.monthIndex}
                stroke={m.stroke}
                strokeDasharray={m.dash}
                label={markerLabel(m.text, markerRow.get(m.key) ?? 0)}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <span className="chart-axis-caption">Year</span>
    </div>
  );
}
