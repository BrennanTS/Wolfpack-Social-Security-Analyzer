import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { DollarsMode } from '../lib/dollarsMode';
import { visibleBenefitSeries, type CombinedTimelinePoint } from '../lib/household';
import { firstDeath } from '../lib/incomeCliff';
import type { Person } from '../lib/personAnalysis';
import { formatCurrency, personLabel } from '../lib/format';
import { benefitSeriesLabel, combinedIncomeCaption, survivorGapNote } from './methodologyCopy';
import {
  CHART_AXIS_LINE,
  CHART_MUTED,
  CHART_RED,
  CHART_TOOLTIP_STYLE,
  seriesColor,
} from '../lib/chartTheme';

interface CombinedIncomeChartProps {
  /**
   * Already in the units the caller wants shown — `HouseholdPanel` is the
   * one place that calls `toNominal`, so the chart, the caption below it and
   * every other reader of this same timeline can never disagree about which
   * dollars they're looking at.
   */
  timeline: CombinedTimelinePoint[];
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
   * Decides only the caption's closing sentence — `timeline` above already
   * carries the actual real-or-nominal figures. Defaults to `'real'` so
   * every test written before the toggle existed keeps asserting the
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
 * Deliberately holds no React hooks: `pdf/HouseholdSection.test.tsx`
 * established the pattern this file's own tests reuse for the parts Recharts
 * never mounts in jsdom — call the component directly and walk the JSX tree
 * it returns — and that only works on a component that is safe to call
 * outside a render pass.
 */
export function CombinedIncomeChart({
  timeline,
  people,
  survivorGap,
  finalIndexByPersonId = {},
  dollarsMode = 'real',
  onDollarsModeChange,
}: CombinedIncomeChartProps) {
  const gap = survivorGap ?? null;
  const gapNote = survivorGapNote(gap);

  const series = visibleBenefitSeries(timeline, people).map((s) => ({
    ...s,
    name: benefitSeriesLabel(personLabel(people[s.personIndex]?.name, s.personIndex), s.type),
    color: seriesColor(s.personIndex, s.type),
  }));

  // The year each person first appears with a positive total — read off the
  // same `byPersonId` roll-up the tooltip uses, so "when the benefit was
  // claimed" is exactly the data already on screen, not a second computation
  // of a benefit rule.
  const filingYearByPersonId: Record<string, number> = {};
  for (const p of people) {
    const point = timeline.find((pt) => (pt.byPersonId[p.id] ?? 0) > 0);
    if (point) filingYearByPersonId[p.id] = point.year;
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
  const rawDeathYear =
    people.length > 1
      ? (firstDeath([people[0].id, people[1].id], finalIndexByPersonId)?.deathYear ?? null)
      : null;
  // `XAxis` below has no `type="number"`, so it's a category axis: a
  // `ReferenceLine` whose `x` isn't one of the chart's actual year
  // categories renders nothing at all, silently. Every filing-marker year is
  // guaranteed to be a real category (it's read directly off `timeline`), but
  // the death year is computed independently from `finalIndexByPersonId` and
  // can precede the timeline's first year — reachable for a person who dies
  // having never held a band. Checking membership here turns that into a
  // deliberate omission instead of a marker that was built but silently
  // never appeared.
  const deathYear =
    rawDeathYear !== null && timeline.some((p) => p.year === rawDeathYear) ? rawDeathYear : null;

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Combined Household Income</h3>
        <p>Annual Social Security income by year under the recommended filing strategy</p>
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
          <AreaChart data={timeline} margin={{ top: 8, right: 16, left: 8, bottom: 20 }}>
            <XAxis
              dataKey="year"
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
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value, name) => {
                const num = typeof value === 'number' ? value : 0;
                return [formatCurrency(num), name];
              }}
              labelFormatter={(year) => `Year ${year}`}
            />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={(point: CombinedTimelinePoint) => point.bySeries[s.key] ?? 0}
                name={s.name}
                stackId="household"
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.35}
              />
            ))}
            {people.map((p, i) => {
              const year = filingYearByPersonId[p.id];
              if (year === undefined) return null;
              return (
                <ReferenceLine
                  key={`filing-${p.id}`}
                  x={year}
                  stroke={CHART_MUTED}
                  strokeDasharray="4 4"
                  label={`${personLabel(p.name, i)} files`}
                />
              );
            })}
            {deathYear !== null && (
              <ReferenceLine x={deathYear} stroke={CHART_RED} strokeDasharray="3 3" label="First death" />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <span className="chart-axis-caption">Year</span>
    </div>
  );
}
