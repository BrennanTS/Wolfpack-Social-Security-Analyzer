import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { ClaimingOption } from '../lib/benefitMath';
import { generateCumulativeChartData } from '../lib/benefitMath';
import { formatCurrency } from '../lib/format';
import {
  CHART_AXIS_LINE,
  CHART_MUTED,
  CHART_RED,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_SEPARATOR,
  CHART_TOOLTIP_STYLE,
  CLAIM_AGE_COLORS,
} from '../lib/chartTheme';

interface BenefitChartProps {
  options: ClaimingOption[];
  lifeExpectancy: number;
  optimalAge: number;
  annualCola?: number;
}

/** The three canonical claiming ages we plot to keep the chart readable. */
const HIGHLIGHT_AGES = [62, 67, 70];

export function BenefitChart({
  options,
  lifeExpectancy,
  optimalAge,
  annualCola = 0,
}: BenefitChartProps) {
  const chartData = useMemo(
    () => generateCumulativeChartData(options, lifeExpectancy, annualCola),
    [options, lifeExpectancy, annualCola],
  );

  const displayOptions = options.filter((o) => HIGHLIGHT_AGES.includes(o.age));

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Cumulative Lifetime Benefits</h3>
        <p>Total benefits received by age, comparing key claiming strategies</p>
        <div className="chart-legend-row" aria-hidden="true">
          {displayOptions.map((opt) => (
            <span key={opt.age} className="chart-legend-item">
              <span
                className="chart-legend-swatch"
                style={{
                  background:
                    opt.age === optimalAge ? CLAIM_AGE_COLORS[70] : CLAIM_AGE_COLORS[opt.age],
                }}
              />
              Claim at {opt.age}
              {opt.age === optimalAge ? ' (optimal)' : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="chart-surface">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 16, left: 8, bottom: 20 }}
          >
            <XAxis
              dataKey="age"
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
              separator={CHART_TOOLTIP_SEPARATOR}
              itemStyle={CHART_TOOLTIP_ITEM_STYLE}
              labelStyle={CHART_TOOLTIP_LABEL_STYLE}
              formatter={(value, name) => {
                const num = typeof value === 'number' ? value : 0;
                const age = String(name).replace('age', '');
                return [formatCurrency(num), `Claim at ${age}`];
              }}
              labelFormatter={(age) => `Age ${age}`}
            />
            <ReferenceLine
              x={lifeExpectancy}
              stroke={CHART_RED}
              strokeDasharray="4 4"
              label={{
                value: `Life exp. ${lifeExpectancy}`,
                fill: CHART_RED,
                fontSize: 10,
                position: 'insideTopRight',
              }}
            />
            {displayOptions.map((opt) => (
              <Line
                key={opt.age}
                type="monotone"
                dataKey={`age${opt.age}`}
                name={`age${opt.age}`}
                stroke={opt.age === optimalAge ? CLAIM_AGE_COLORS[70] : CLAIM_AGE_COLORS[opt.age]}
                strokeWidth={opt.age === optimalAge ? 3 : 2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <span className="chart-axis-caption">Age</span>
    </div>
  );
}
