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
  62: '#aeaeb2',
  63: '#c7c7cc',
  64: '#d1d1d6',
  65: '#8e8e93',
  66: '#5ac8fa',
  67: '#007aff',
  68: '#5856d6',
  69: '#af52de',
  70: '#ff9500',
};

const TOOLTIP_STYLE = {
  background: 'rgba(29, 29, 31, 0.92)',
  border: 'none',
  borderRadius: 10,
  color: '#f5f5f7',
  fontSize: 13,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)',
  backdropFilter: 'blur(20px)',
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
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <XAxis
            dataKey="age"
            tick={{ fill: '#86868b', fontSize: 12 }}
            axisLine={{ stroke: '#e8e8ed' }}
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
            stroke="#ff3b30"
            strokeDasharray="4 4"
            label={{ value: `Life exp. ${lifeExpectancy}`, fill: '#ff3b30', fontSize: 11 }}
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
  );
}
