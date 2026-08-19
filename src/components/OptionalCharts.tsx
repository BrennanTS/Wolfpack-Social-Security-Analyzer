import { useMemo, type CSSProperties } from 'react';
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
import type { ClaimingOption } from '../lib/benefitMath';
import { formatCurrency } from '../lib/format';
import {
  generateHeatmapData,
  generateOpportunityCostData,
  generateMonthlyRampData,
  getHeatmapValue,
  getLivingAgeTicks,
} from '../lib/chartData';
import {
  CHART_AXIS_LINE,
  CHART_GOLD as GOLD,
  CHART_INK as INK,
  CHART_MUTED as MUTED,
  CHART_RED,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_SEPARATOR,
  CHART_TOOLTIP_STYLE as TOOLTIP_STYLE,
} from '../lib/chartTheme';

interface MonthlyBenefitBarChartProps {
  options: ClaimingOption[];
  shownAge: number;
}

export function MonthlyBenefitBarChart({ options, shownAge }: MonthlyBenefitBarChartProps) {
  const data = useMemo(
    () =>
      options.map((o) => ({
        age: o.age,
        monthly: o.monthlyBenefit,
        isShown: o.age === shownAge,
      })),
    [options, shownAge],
  );

  return (
    <div className="chart-surface">
      <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <XAxis
          dataKey="age"
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={{ stroke: CHART_AXIS_LINE }}
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
          separator={CHART_TOOLTIP_SEPARATOR}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
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
              fill={entry.isShown ? GOLD : INK}
              fillOpacity={entry.isShown ? 1 : 0.75}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}

interface LifetimeBarChartProps {
  options: ClaimingOption[];
  shownAge: number;
}

export function LifetimeBarChart({ options, shownAge }: LifetimeBarChartProps) {
  const data = useMemo(
    () =>
      options.map((o) => ({
        age: o.age,
        lifetime: o.lifetimeBenefits,
        isShown: o.age === shownAge,
      })),
    [options, shownAge],
  );

  return (
    <div className="chart-surface">
      <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <XAxis
          dataKey="age"
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={{ stroke: CHART_AXIS_LINE }}
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
          separator={CHART_TOOLTIP_SEPARATOR}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
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
              fill={entry.isShown ? GOLD : INK}
              fillOpacity={entry.isShown ? 1 : 0.7}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
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
  const data = useMemo(() => {
    const rate = annualCola / 100;
    const rows: { year: number; age: number; monthly: number }[] = [];
    for (let age = claimAge; age <= lifeExpectancy; age++) {
      const year = age - claimAge;
      rows.push({
        year,
        age,
        monthly: Math.round(monthlyBenefit * Math.pow(1 + rate, year) * 100) / 100,
      });
    }
    return rows;
  }, [claimAge, monthlyBenefit, lifeExpectancy, annualCola]);

  return (
    <div className="chart-surface">
      <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <XAxis
          dataKey="age"
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={{ stroke: CHART_AXIS_LINE }}
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
          separator={CHART_TOOLTIP_SEPARATOR}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          formatter={(value) => {
            const num = typeof value === 'number' ? value : 0;
            return [formatCurrency(num), 'Monthly with COLA'];
          }}
          labelFormatter={(age) => `Age ${age}`}
        />
        <Bar dataKey="monthly" fill={INK} radius={[4, 4, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}

interface LifetimeHeatmapProps {
  options: ClaimingOption[];
  lifeExpectancy: number;
  shownAge: number;
  annualCola: number;
}

export function LifetimeHeatmapChart({
  options,
  lifeExpectancy,
  shownAge,
  annualCola,
}: LifetimeHeatmapProps) {
  const cells = useMemo(
    () => generateHeatmapData(options, lifeExpectancy, annualCola),
    [options, lifeExpectancy, annualCola],
  );
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
            className={`heatmap-y-label${claimAge === shownAge ? ' heatmap-y-label-shown' : ''}`}
          >
            {claimAge}
            {claimAge === shownAge ? ' ★' : ''}
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
                className={`heatmap-cell${claimAge === shownAge ? ' heatmap-cell-shown-row' : ''}`}
                // The ramp lives in CSS so light and dark can use different
                // endpoints. A single shared ramp meant a pale cell kept pale
                // in dark mode while the label flipped to white — unreadable.
                style={{ '--t': ratio } as CSSProperties}
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
        Rows = claiming age · Columns = living age · Color = total benefits received
        (illustrative flat {annualCola}% COLA)
      </p>
    </div>
  );
}

interface OpportunityCostChartProps {
  options: ClaimingOption[];
  shownAge: number;
}

export function OpportunityCostChart({ options, shownAge }: OpportunityCostChartProps) {
  const data = useMemo(
    () =>
      generateOpportunityCostData(options, shownAge).map((row) => ({
        ...row,
        label: row.age === shownAge ? `${row.age} (shown)` : String(row.age),
        shortfall: row.vsShown < 0 ? Math.abs(row.vsShown) : 0,
      })),
    [options, shownAge],
  );

  return (
    <div className="chart-surface">
      <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={CHART_AXIS_LINE} horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={{ stroke: CHART_AXIS_LINE }}
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
          separator={CHART_TOOLTIP_SEPARATOR}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          formatter={(value, _name, item) => {
            const row = item.payload as (typeof data)[number];
            // Both strings name the baseline as what it is — the age the
            // report is built on. They said "optimal", which is the shown
            // scenario only when the adviser has not chosen another one.
            if (row.isShown) return ['—', 'The age shown'];
            const num = typeof value === 'number' ? value : 0;
            return [formatCurrency(num), `Lifetime shortfall vs age ${shownAge}`];
          }}
        />
        <Bar dataKey="shortfall" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((entry) => (
            <Cell
              key={entry.age}
              fill={entry.isShown ? GOLD : CHART_RED}
              fillOpacity={entry.isShown ? 0.35 : 0.75}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}

interface MonthlyRampChartProps {
  options: ClaimingOption[];
  shownAge: number;
}

export function MonthlyRampChart({ options, shownAge }: MonthlyRampChartProps) {
  const data = useMemo(
    () => generateMonthlyRampData(options, shownAge),
    [options, shownAge],
  );
  const age62 = data.find((d) => d.age === 62)?.monthly ?? 1;

  return (
    <div className="chart-surface">
      <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={CHART_AXIS_LINE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="age"
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={{ stroke: CHART_AXIS_LINE }}
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
          separator={CHART_TOOLTIP_SEPARATOR}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
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
          x={shownAge}
          stroke={GOLD}
          strokeDasharray="4 4"
          label={{ value: 'Shown', fill: GOLD, fontSize: 10, position: 'top' }}
        />
        <Line
          type="monotone"
          dataKey="monthly"
          stroke={INK}
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
                r={row.isShown ? 6 : 4}
                fill={row.isShown ? GOLD : INK}
                stroke="white"
                strokeWidth={2}
              />
            );
          }}
          activeDot={{ r: 7 }}
        />
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
}
