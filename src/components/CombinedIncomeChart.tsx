import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { CombinedTimelinePoint } from '../lib/household';
import type { Person } from '../lib/personAnalysis';
import { formatCurrency, personLabel } from '../lib/format';
import { survivorGapNote } from './methodologyCopy';
import {
  CHART_AXIS_LINE,
  CHART_GOLD,
  CHART_GREY_MID,
  CHART_INK,
  CHART_MUTED,
  CHART_TOOLTIP_STYLE,
} from '../lib/chartTheme';

interface CombinedIncomeChartProps {
  timeline: CombinedTimelinePoint[];
  people: Person[];
  /**
   * The one survivor direction the engine does not model. When set, the bands
   * understate the survivor's income after the first death, and the caption
   * below says so. Optional so the single-claimant call site need not pass it.
   */
  survivorGap?: SurvivorGap | null;
}

/**
 * Stacked-series palette, gold-forward like the rest of the app. A household
 * only ever has one or two people, but this stays a ramp rather than a fixed
 * pair so a third series would degrade gracefully instead of colliding.
 */
const PERSON_COLORS = [CHART_GOLD, CHART_INK, CHART_GREY_MID];

/**
 * The combined household income timeline: one stacked area per person,
 * summing to total annual Social Security income under the recommended
 * strategy. Mirrors `BenefitChart`'s Recharts conventions (same
 * `chartTheme` tokens, `ResponsiveContainer` wrapper, axis/tooltip styling)
 * so the household tab doesn't look like a different app.
 */
export function CombinedIncomeChart({ timeline, people, survivorGap }: CombinedIncomeChartProps) {
  const gapNote = survivorGapNote(survivorGap ?? null);
  const series = useMemo(
    () =>
      people.map((p, i) => ({
        id: p.id,
        name: personLabel(p.name, i),
        color: PERSON_COLORS[i % PERSON_COLORS.length],
      })),
    [people],
  );

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Combined Household Income</h3>
        <p>Annual Social Security income by year under the recommended filing strategy</p>
        {people.length > 1 && (
          <p className="chart-caveat" data-testid="combined-income-caveat">
            Each person&rsquo;s band is everything they are paid that year — their own
            benefit plus any spousal or survivor benefit — counting only the months
            actually paid, so a filing year or a final year is shorter than a full one.
            Amounts are in today&rsquo;s dollars, before any cost-of-living adjustment.
          </p>
        )}
        {gapNote && (
          <p className="chart-caveat" data-testid="survivor-gap-note">
            {gapNote}
          </p>
        )}
        <div className="chart-legend-row" aria-hidden="true">
          {series.map((s) => (
            <span key={s.id} className="chart-legend-item">
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
                key={s.id}
                type="monotone"
                dataKey={(point: CombinedTimelinePoint) => point.byPersonId[s.id] ?? 0}
                name={s.name}
                stackId="household"
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.35}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <span className="chart-axis-caption">Year</span>
    </div>
  );
}
