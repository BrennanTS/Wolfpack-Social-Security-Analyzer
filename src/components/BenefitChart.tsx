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

interface BenefitChartProps {
  options: ClaimingOption[];
  lifeExpectancy: number;
  optimalAge: number;
  annualCola?: number;
}

const COLORS: Record<number, string> = {
  62: '#d4d4d4',
  63: '#c4c4c4',
  64: '#b4b4b4',
  65: '#9a9a9a',
  66: '#8a8a8a',
  67: '#6b6b6b',
  68: '#5c5c5c',
  69: '#4a4a4a',
  70: '#b8965a',
};

const TOOLTIP_STYLE = {
  background: 'rgba(20, 20, 20, 0.94)',
  border: 'none',
  borderRadius: 4,
  color: '#f7f5f0',
  fontSize: 13,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
};

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
            tick={{ fill: '#8a8a8a', fontSize: 12 }}
            axisLine={{ stroke: '#e4e1da' }}
            tickLine={false}
            label={{ value: 'Age', position: 'insideBottom', offset: -4, fill: '#86868b' }}
          />
          <YAxis
            tick={{ fill: '#86868b', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => {
              const num = typeof value === 'number' ? value : 0;
              const age = String(name).replace('age', '');
              return [formatCurrency(num), `Claim at ${age}`];
            }}
            labelFormatter={(age) => `Age ${age}`}
          />
          <ReferenceLine
            x={lifeExpectancy}
            stroke="#9a4a44"
            strokeDasharray="4 4"
            label={{ value: `Life exp. ${lifeExpectancy}`, fill: '#9a4a44', fontSize: 11 }}
          />
          {displayOptions.map((opt) => (
            <Line
              key={opt.age}
              type="monotone"
              dataKey={`age${opt.age}`}
              name={`age${opt.age}`}
              stroke={opt.age === optimalAge ? COLORS[70] : COLORS[opt.age]}
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
