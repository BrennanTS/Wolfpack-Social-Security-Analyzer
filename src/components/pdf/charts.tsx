import { Text, View, Svg, Line, Path, Rect } from '@react-pdf/renderer';
import type { ClaimingOption } from '../../lib/benefitMath';
import { generateCumulativeChartData } from '../../lib/benefitMath';
import { formatCurrency, formatThousandsTick } from '../../lib/format';
import {
  generateHeatmapData,
  generateOpportunityCostData,
  generateMonthlyRampData,
  getHeatmapValue,
  getLivingAgeTicks,
  heatmapColorPdf,
} from '../../lib/chartData';
import { styles, BORDER, CHART_INNER_W, GOLD, INK, MUTED, RED, SUBTLE } from './theme';

/**
 * Axis labels in this file go through `formatThousandsTick`, which returns
 * ONE string. Never build one as
 * `${'$'}{expr}k` across three JSX children. react-pdf lays out each child of
 * an SVG `Text` at the element's own x, so a multi-child label prints its
 * parts stacked on one point — which is how every y-axis tick here rendered
 * as an unreadable overlap.
 */

const TICK = { fontSize: 5.5, fill: MUTED };

export function PdfChart({
  options,
  lifeExpectancy,
  optimalAge,
  annualCola,
}: {
  options: ClaimingOption[];
  lifeExpectancy: number;
  optimalAge: number;
  annualCola: number;
}) {
  const data = generateCumulativeChartData(options, lifeExpectancy, annualCola);
  const lineAges = [62, 67, 70].filter((a) => options.some((o) => o.age === a));
  const labelAges = Array.from({ length: 9 }, (_, i) => 62 + i);
  const W = CHART_INNER_W;
  const H = 110;
  const padL = 36;
  const padR = 10;
  const padT = 12;
  const plotW = W - padL - padR;
  const plotH = H - padT - 18;

  let maxVal = 0;
  for (const row of data) {
    for (const age of lineAges) {
      const v = row[`age${age}`];
      if (typeof v === 'number' && v > maxVal) maxVal = v;
    }
  }
  maxVal *= 1.05;

  const xScale = (age: number) => padL + ((age - 62) / (lifeExpectancy - 62)) * plotW;
  const yScale = (val: number) => padT + plotH - (val / maxVal) * plotH;
  const colors: Record<number, string> = { 62: '#8a8a8a', 67: '#5c5c5c', 70: GOLD };

  function linePath(age: number): string {
    const parts: string[] = [];
    let started = false;
    for (const row of data) {
      const v = row[`age${age}`];
      if (typeof v !== 'number') continue;
      parts.push(`${started ? 'L' : 'M'}${xScale(row.age).toFixed(1)},${yScale(v).toFixed(1)}`);
      started = true;
    }
    return parts.join(' ');
  }

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <Line key={t} x1={padL} y1={yScale(maxVal * t)} x2={W - padR} y2={yScale(maxVal * t)} stroke={BORDER} strokeWidth={0.5} />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <Text key={`y-${t}`} x={padL - 4} y={yScale(maxVal * t) + 2} style={TICK} textAnchor="end">
            {formatThousandsTick(maxVal * t)}
          </Text>
        ))}
        {labelAges.map((age) => (
          <Line key={`tick-${age}`} x1={xScale(age)} y1={padT + plotH} x2={xScale(age)} y2={padT + plotH + 3} stroke={SUBTLE} strokeWidth={0.5} />
        ))}
        {labelAges.map((age) => (
          <Text key={`lbl-${age}`} x={xScale(age)} y={H - 4} style={{ fontSize: 6, fill: MUTED }} textAnchor="middle">
            {age}
          </Text>
        ))}
        {lifeExpectancy > 70 && (
          <Text x={xScale(lifeExpectancy)} y={H - 4} style={{ fontSize: 6, fill: RED }} textAnchor="middle">
            {lifeExpectancy}
          </Text>
        )}
        <Line x1={xScale(lifeExpectancy)} y1={padT} x2={xScale(lifeExpectancy)} y2={padT + plotH} stroke={RED} strokeWidth={1} strokeDasharray="3 2" />
        {lineAges.map((age) => (
          <Path key={age} d={linePath(age)} stroke={age === optimalAge ? GOLD : colors[age]} strokeWidth={age === optimalAge ? 2 : 1.2} fill="none" />
        ))}
      </Svg>
      <View style={styles.chartLegend}>
        {lineAges.map((age) => (
          <View key={age} style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: age === optimalAge ? GOLD : colors[age] }]} />
            <Text style={styles.legendText}>
              Claim {age}
              {age === optimalAge ? ' (shown)' : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function PdfHeatmap({
  options,
  lifeExpectancy,
  optimalAge,
  annualCola,
}: {
  options: ClaimingOption[];
  lifeExpectancy: number;
  optimalAge: number;
  annualCola: number;
}) {
  const cells = generateHeatmapData(options, lifeExpectancy, annualCola);
  const claimAges = options.map((o) => o.age);
  const livingAges = getLivingAgeTicks(62, lifeExpectancy);
  const values = cells.map((c) => c.cumulative);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  const labelW = 22;
  // Also drawn inside a `chartBox` — see CHART_INNER_W.
  const W = CHART_INNER_W;
  const plotW = W - labelW - 4;
  const colW = plotW / livingAges.length;
  const rowH = 9;
  const headerH = 11;
  const H = headerH + claimAges.length * rowH + 2;

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Text x={labelW - 2} y={8} style={TICK} textAnchor="end">
          Claim
        </Text>
        {livingAges.map((age, i) => (
          <Text key={`hx-${age}`} x={labelW + i * colW + colW / 2} y={9} style={TICK} textAnchor="middle">
            {age}
          </Text>
        ))}
        {claimAges.map((claimAge, ri) => (
          <Text
            key={`hy-${claimAge}`}
            x={labelW - 3}
            y={headerH + ri * rowH + rowH * 0.65}
            style={{
              fontSize: 6,
              fill: claimAge === optimalAge ? GOLD : MUTED,
              fontFamily: claimAge === optimalAge ? 'Helvetica-Bold' : 'Helvetica',
            }}
            textAnchor="end"
          >
            {claimAge}
          </Text>
        ))}
        {claimAges.map((claimAge, ri) =>
          livingAges.map((livingAge, ci) => {
            if (livingAge < claimAge) return null;
            const value = getHeatmapValue(cells, claimAge, livingAge)!;
            const ratio = maxVal === minVal ? 0.5 : (value - minVal) / (maxVal - minVal);
            return (
              <Rect
                key={`${claimAge}-${livingAge}`}
                x={labelW + ci * colW + 0.5}
                y={headerH + ri * rowH + 0.5}
                width={colW - 1}
                height={rowH - 1}
                fill={heatmapColorPdf(ratio)}
                rx={1}
              />
            );
          }),
        )}
      </Svg>
      <View style={styles.pdfHeatmapLegend}>
        <Text style={styles.pdfHeatmapLegendText}>Lower total</Text>
        <View style={styles.pdfHeatmapLegendBar} />
        <Text style={styles.pdfHeatmapLegendText}>Higher total</Text>
      </View>
    </View>
  );
}

export function PdfOpportunityCost({ options, optimalAge }: { options: ClaimingOption[]; optimalAge: number }) {
  const data = generateOpportunityCostData(options, optimalAge);
  const maxShortfall = Math.max(...data.map((d) => (d.vsOptimal < 0 ? Math.abs(d.vsOptimal) : 0)), 1);

  return (
    <View>
      {data.map((row) => {
        const shortfall = row.vsOptimal < 0 ? Math.abs(row.vsOptimal) : 0;
        const pct = row.isOptimal ? 0 : (shortfall / maxShortfall) * 100;
        return (
          <View key={row.age} style={styles.pdfBarRow}>
            <Text style={styles.pdfBarLabel}>
              {row.age}
              {row.isOptimal ? ' *' : ''}
            </Text>
            <View style={styles.pdfBarTrack}>
              {row.isOptimal ? (
                <View style={styles.pdfBarFillOptimal} />
              ) : (
                <View style={[styles.pdfBarFill, { width: `${pct}%` }]} />
              )}
            </View>
            <Text style={styles.pdfBarValue}>{row.isOptimal ? 'Shown' : formatCurrency(shortfall)}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function PdfMonthlyRamp({ options, optimalAge }: { options: ClaimingOption[]; optimalAge: number }) {
  const data = generateMonthlyRampData(options, optimalAge);
  const W = CHART_INNER_W;
  const H = 88;
  const padL = 32;
  const padR = 8;
  const padT = 10;
  const plotW = W - padL - padR;
  const plotH = H - padT - 16;

  const minM = data[0].monthly;
  const maxM = data[data.length - 1].monthly;
  const range = maxM - minM || 1;

  const xScale = (age: number) => padL + ((age - 62) / 8) * plotW;
  const yScale = (val: number) => padT + plotH - ((val - minM) / range) * plotH;
  const path = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(d.age).toFixed(1)},${yScale(d.monthly).toFixed(1)}`)
    .join(' ');

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={BORDER} strokeWidth={0.5} />
        {[62, 64, 66, 68, 70].map((age) => (
          <Text key={age} x={xScale(age)} y={H - 3} style={{ fontSize: 6, fill: MUTED }} textAnchor="middle">
            {age}
          </Text>
        ))}
        {/* Whole dollars, NOT `formatThousandsTick`. These two ticks are the
            endpoints of a MONTHLY check, and this chart's whole span is a
            couple of thousand dollars wide — rounding to thousands printed
            "$3k" and "$5k" for $2,773 and $4,912, so the axis said the ramp
            covered a range it does not, at both ends. Thousands are the
            right unit for a lifetime total; they are the wrong unit here. */}
        <Text x={padL - 3} y={yScale(maxM) + 2} style={TICK} textAnchor="end">
          {formatCurrency(maxM)}
        </Text>
        <Text x={padL - 3} y={yScale(minM) + 2} style={TICK} textAnchor="end">
          {formatCurrency(minM)}
        </Text>
        <Path d={path} stroke={INK} strokeWidth={1.5} fill="none" />
        {data.map((d) => (
          <Rect
            key={d.age}
            x={xScale(d.age) - (d.isOptimal ? 2.5 : 1.5)}
            y={yScale(d.monthly) - (d.isOptimal ? 2.5 : 1.5)}
            width={d.isOptimal ? 5 : 3}
            height={d.isOptimal ? 5 : 3}
            fill={d.isOptimal ? GOLD : INK}
            rx={d.isOptimal ? 2.5 : 1.5}
          />
        ))}
        <Line x1={xScale(optimalAge)} y1={padT} x2={xScale(optimalAge)} y2={padT + plotH} stroke={GOLD} strokeWidth={0.8} strokeDasharray="2 2" />
      </Svg>
    </View>
  );
}
