import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';
import type { ClaimingOption } from '../lib/socialSecurity';
import { formatCurrency } from '../lib/socialSecurity';
import {
  generateHeatmapData,
  generateOpportunityCostData,
  generateMonthlyRampData,
  getHeatmapValue,
  getLivingAgeTicks,
  heatmapColorWeb,
} from '../lib/chartData';

const BLUE = '#007aff';
const ORANGE = '#ff9500';
const MUTED = '#86868b';
const PURPLE = '#5856d6';
const GREEN = '#34c759';

const TOOLTIP_STYLE = {
  background: 'rgba(29, 29, 31, 0.92)',
  border: 'none',
  borderRadius: 10,
  color: '#f5f5f7',
  fontSize: 13,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)',
};

interface MonthlyBenefitBarChartProps {
  options: ClaimingOption[];
  optimalAge: number;
}

export function MonthlyBenefitBarChart({ options, optimalAge }: MonthlyBenefitBarChartProps) {
  const data = options.map((o) => ({
    age: o.age,
    monthly: o.monthlyBenefit,
    isOptimal: o.age === optimalAge,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <XAxis
          dataKey="age"
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={{ stroke: '#e8e8ed' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) => {
            const num = typeof value === 'number' ? value : 0;
            return [formatCurrency(num), 'Monthly benefit'];
          }}
          labelFormatter={(age) => `Claim at age ${age}`}
        />
        <Bar dataKey="monthly" radius={[4, 4, 0, 0]} maxBarSize={36}>
          {data.map((entry) => (
            <Cell
              key={entry.age}
              fill={entry.isOptimal ? ORANGE : BLUE}
              fillOpacity={entry.isOptimal ? 1 : 0.75}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface LifetimeBarChartProps {
  options: ClaimingOption[];
  optimalAge: number;
}

export function LifetimeBarChart({ options, optimalAge }: LifetimeBarChartProps) {
  const data = options.map((o) => ({
    age: o.age,
    lifetime: o.lifetimeBenefits,
    isOptimal: o.age === optimalAge,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <XAxis
          dataKey="age"
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={{ stroke: '#e8e8ed' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) => {
            const num = typeof value === 'number' ? value : 0;
            return [formatCurrency(num), 'Lifetime total'];
          }}
          labelFormatter={(age) => `Claim at age ${age}`}
        />
        <Bar dataKey="lifetime" radius={[4, 4, 0, 0]} maxBarSize={36}>
          {data.map((entry) => (
            <Cell
              key={entry.age}
              fill={entry.isOptimal ? ORANGE : BLUE}
              fillOpacity={entry.isOptimal ? 1 : 0.7}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface ColaProjectionChartProps {
  claimAge: number;
  monthlyBenefit: number;
  lifeExpectancy: number;
  annualCola: number;
}

export function ColaProjectionChart({
  claimAge,
  monthlyBenefit,
  lifeExpectancy,
  annualCola,
}: ColaProjectionChartProps) {
  const rate = annualCola / 100;
  const data: { year: number; age: number; monthly: number }[] = [];
  for (let age = claimAge; age <= lifeExpectancy; age++) {
    const year = age - claimAge;
    data.push({
      year,
      age,
      monthly: Math.round(monthlyBenefit * Math.pow(1 + rate, year) * 100) / 100,
    });
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <XAxis
          dataKey="age"
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={{ stroke: '#e8e8ed' }}
          tickLine={false}
          interval={Math.max(0, Math.floor(data.length / 8) - 1)}
        />
        <YAxis
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) => {
            const num = typeof value === 'number' ? value : 0;
            return [formatCurrency(num), 'Monthly with COLA'];
          }}
          labelFormatter={(age) => `Age ${age}`}
        />
        <Bar dataKey="monthly" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface SpousalSurvivorChartProps {
  options: ClaimingOption[];
  spousalAtFra: number;
  optimalAge: number;
}

export function SpousalSurvivorChart({
  options,
  spousalAtFra,
  optimalAge,
}: SpousalSurvivorChartProps) {
  const data = options.map((o) => ({
    age: o.age,
    survivor: o.monthlyBenefit,
    spousal: spousalAtFra,
    isOptimal: o.age === optimalAge,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <XAxis
          dataKey="age"
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={{ stroke: '#e8e8ed' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name) => {
            const num = typeof value === 'number' ? value : 0;
            return [
              formatCurrency(num),
              String(name) === 'survivor' ? 'Survivor benefit' : 'Spousal at FRA (50% PIA)',
            ];
          }}
          labelFormatter={(age) => `You claim at ${age}`}
        />
        <ReferenceLine
          y={spousalAtFra}
          stroke={MUTED}
          strokeDasharray="4 4"
          label={{ value: 'Spousal at FRA', fill: MUTED, fontSize: 10 }}
        />
        <Bar dataKey="survivor" name="survivor" radius={[4, 4, 0, 0]} maxBarSize={32}>
          {data.map((entry) => (
            <Cell
              key={entry.age}
              fill={entry.isOptimal ? ORANGE : PURPLE}
              fillOpacity={entry.isOptimal ? 1 : 0.8}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface LifetimeHeatmapProps {
  options: ClaimingOption[];
  lifeExpectancy: number;
  optimalAge: number;
  annualCola: number;
}

export function LifetimeHeatmapChart({
  options,
  lifeExpectancy,
  optimalAge,
  annualCola,
}: LifetimeHeatmapProps) {
  const cells = generateHeatmapData(options, lifeExpectancy, annualCola);
  const claimAges = options.map((o) => o.age);
  const livingAges = getLivingAgeTicks(62, lifeExpectancy);
  const values = cells.map((c) => c.cumulative);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  return (
    <div className="heatmap-wrap">
      <div
        className="heatmap-grid"
        style={{ gridTemplateColumns: `72px repeat(${livingAges.length}, 1fr)` }}
      >
        <div className="heatmap-corner" />
        {livingAges.map((age) => (
          <div key={`x-${age}`} className="heatmap-x-label">
            {age}
          </div>
        ))}
        {claimAges.flatMap((claimAge) => [
          <div
            key={`y-${claimAge}`}
            className={`heatmap-y-label${claimAge === optimalAge ? ' heatmap-y-label-optimal' : ''}`}
          >
            {claimAge}
            {claimAge === optimalAge ? ' ★' : ''}
          </div>,
          ...livingAges.map((livingAge) => {
            if (livingAge < claimAge) {
              return (
                <div
                  key={`${claimAge}-${livingAge}`}
                  className="heatmap-cell heatmap-cell-empty"
                />
              );
            }
            const value = getHeatmapValue(cells, claimAge, livingAge)!;
            const ratio = maxVal === minVal ? 0.5 : (value - minVal) / (maxVal - minVal);
            return (
              <div
                key={`${claimAge}-${livingAge}`}
                className={`heatmap-cell${claimAge === optimalAge ? ' heatmap-cell-optimal-row' : ''}`}
                style={{ backgroundColor: heatmapColorWeb(ratio) }}
                title={`Claim ${claimAge}, live to ${livingAge}: ${formatCurrency(value)} cumulative`}
              >
                <span className="heatmap-cell-value">
                  {value >= 1_000_000
                    ? `$${(value / 1_000_000).toFixed(1)}M`
                    : `$${Math.round(value / 1000)}k`}
                </span>
              </div>
            );
          }),
        ])}
      </div>
      <div className="heatmap-legend">
        <span>Lower cumulative</span>
        <div className="heatmap-legend-bar" />
        <span>Higher cumulative</span>
      </div>
      <p className="heatmap-caption">
        Rows = claiming age · Columns = living age · Color = total benefits received (with COLA)
      </p>
    </div>
  );
}

interface OpportunityCostChartProps {
  options: ClaimingOption[];
  optimalAge: number;
}

export function OpportunityCostChart({ options, optimalAge }: OpportunityCostChartProps) {
  const data = generateOpportunityCostData(options, optimalAge).map((row) => ({
    ...row,
    label: row.age === optimalAge ? `${row.age} (optimal)` : String(row.age),
    shortfall: row.vsOptimal < 0 ? Math.abs(row.vsOptimal) : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="#e8e8ed" horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={{ stroke: '#e8e8ed' }}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={72}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, _name, item) => {
            const row = item.payload as (typeof data)[number];
            if (row.isOptimal) return ['—', 'Optimal strategy'];
            const num = typeof value === 'number' ? value : 0;
            return [formatCurrency(num), 'Lifetime shortfall vs optimal'];
          }}
        />
        <Bar dataKey="shortfall" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((entry) => (
            <Cell
              key={entry.age}
              fill={entry.isOptimal ? GREEN : '#ff3b30'}
              fillOpacity={entry.isOptimal ? 0.35 : 0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface MonthlyRampChartProps {
  options: ClaimingOption[];
  optimalAge: number;
}

export function MonthlyRampChart({ options, optimalAge }: MonthlyRampChartProps) {
  const data = generateMonthlyRampData(options, optimalAge);
  const age62 = data.find((d) => d.age === 62)?.monthly ?? 1;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="#e8e8ed" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="age"
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={{ stroke: '#e8e8ed' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
          domain={['auto', 'auto']}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, _name, item) => {
            const row = item.payload as (typeof data)[number];
            const num = typeof value === 'number' ? value : 0;
            const boost = ((num / age62 - 1) * 100).toFixed(1);
            return [
              `${formatCurrency(num)} (${row.percentOfPia}% PIA, +${boost}% vs 62)`,
              'Monthly benefit',
            ];
          }}
          labelFormatter={(age) => `Claim at age ${age}`}
        />
        <ReferenceLine
          x={optimalAge}
          stroke={ORANGE}
          strokeDasharray="4 4"
          label={{ value: 'Optimal', fill: ORANGE, fontSize: 10, position: 'top' }}
        />
        <Line
          type="monotone"
          dataKey="monthly"
          stroke={BLUE}
          strokeWidth={2.5}
          dot={(props) => {
            const { cx, cy, payload } = props;
            const row = payload as (typeof data)[number];
            if (cx == null || cy == null) return null;
            return (
              <circle
                key={row.age}
                cx={cx}
                cy={cy}
                r={row.isOptimal ? 6 : 4}
                fill={row.isOptimal ? ORANGE : BLUE}
                stroke="white"
                strokeWidth={2}
              />
            );
          }}
          activeDot={{ r: 7 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
