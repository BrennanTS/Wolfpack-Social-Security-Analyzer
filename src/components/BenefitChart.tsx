import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import type { ClaimingOption } from '../lib/socialSecurity';
import {
  generateCumulativeChartData,
  formatCurrency,
} from '../lib/socialSecurity';
import {
  CHART_AXIS_LINE,
  CHART_MUTED,
  CHART_RED,
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
      </div>
      <div className="chart-surface">
        <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <XAxis
            dataKey="age"
            tick={{ fill: CHART_MUTED, fontSize: 12 }}
            axisLine={{ stroke: CHART_AXIS_LINE }}
            tickLine={false}
            label={{ value: 'Age', position: 'insideBottom', offset: -4, fill: CHART_MUTED }}
          />
          <YAxis
            tick={{ fill: CHART_MUTED, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
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
            label={{ value: `Life exp. ${lifeExpectancy}`, fill: CHART_RED, fontSize: 11 }}
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
          <Legend
            formatter={(value) => {
              const age = value.replace('age', '');
              const label = age === String(optimalAge) ? `${age} (optimal)` : age;
              return `Claim at ${label}`;
            }}
          />
        </LineChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
