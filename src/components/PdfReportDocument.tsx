import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Svg,
  Line,
  Path,
  Rect,
} from '@react-pdf/renderer';
import type { AnalysisResult, ClaimingOption, UserInputs } from '../lib/socialSecurity';
import {
  formatCurrency,
  formatCurrencyPrecise,
  fraLabel,
  generateCumulativeChartData,
} from '../lib/socialSecurity';
import {
  generateHeatmapData,
  generateOpportunityCostData,
  generateMonthlyRampData,
  getHeatmapValue,
  getLivingAgeTicks,
  heatmapColorPdf,
} from '../lib/chartData';
import { BRAND_NAME } from '../lib/brand';
import { BLS_CPI_URL, formatPercent, getCpiLast30Years } from '../lib/cpiHistory';
import { genderLabel, SSA_LIFE_TABLE_URL } from '../lib/lifeExpectancy';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const INK = '#141414';
const GOLD = '#b8965a';
const GOLD_DARK = '#8a7144';
const GOLD_SOFT = '#f5f0e8';
const CREAM = '#f7f5f0';
const SURFACE = '#ffffff';
const FILL = '#f0eeea';
const BORDER = '#e4e1da';
const MUTED = '#5c5c5c';
const SUBTLE = '#8a8a8a';
const GREEN = '#5a7a5e';
const GREEN_SOFT = '#eef3ef';
const RED = '#9a4a44';
const RED_SOFT = '#f8efee';

/** Letter page content width: 612pt − left/right padding */
const CONTENT_W = 516;
const PAD_H = 48;
const PAD_TOP = 36;
const PAD_BOTTOM = 40;

/** Table column widths (must sum to CONTENT_W) */
const COL = { age: 44, monthly: 108, pia: 56, life: 118, diff: 190 };

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: INK,
    backgroundColor: CREAM,
    paddingTop: PAD_TOP,
    paddingBottom: PAD_BOTTOM,
    paddingHorizontal: PAD_H,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  brandBlock: { flexDirection: 'row', alignItems: 'flex-start' },
  monogram: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  monogramText: {
    fontSize: 10,
    color: GOLD,
    fontFamily: 'Helvetica-Bold',
  },
  org: {
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 1.2,
    color: GOLD_DARK,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  title: { fontSize: 16, color: INK, fontFamily: 'Helvetica-Bold', letterSpacing: -0.2 },
  meta: { textAlign: 'right', marginLeft: 16 },
  metaDate: { fontSize: 8.5, color: MUTED },
  metaId: {
    fontSize: 7,
    color: SUBTLE,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 3,
  },
  accentBar: { width: 48, height: 2, backgroundColor: GOLD, marginBottom: 14, opacity: 0.9 },
  sectionTitle: {
    fontSize: 10.5,
    color: INK,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
    marginTop: 10,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  sectionTitleFirst: { marginTop: 0 },
  sectionDesc: { fontSize: 8, color: MUTED, marginBottom: 8, lineHeight: 1.45 },
  profileGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  profileItem: { width: '33.33%', marginBottom: 8, paddingRight: 8 },
  profileLabel: {
    fontSize: 6.5,
    color: SUBTLE,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  profileValue: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: INK },
  recBox: {
    backgroundColor: SURFACE,
    borderRadius: 6,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopWidth: 2,
    borderTopColor: GOLD,
  },
  recEyebrow: {
    fontSize: 7,
    color: GOLD_DARK,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  recHeadline: {
    fontSize: 13,
    color: INK,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
    letterSpacing: -0.2,
  },
  recBody: { fontSize: 8.5, color: MUTED, lineHeight: 1.45, marginBottom: 10 },
  recMetrics: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 8 },
  recMetricBlock: { marginRight: 32 },
  recMetricValue: { fontSize: 12, color: INK, fontFamily: 'Helvetica-Bold' },
  recMetricLabel: {
    fontSize: 6.5,
    color: SUBTLE,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  kcRow: { flexDirection: 'row', marginBottom: 4 },
  kcCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    padding: 8,
    alignItems: 'center',
    marginRight: 8,
    backgroundColor: SURFACE,
  },
  kcCardLast: { marginRight: 0 },
  kcHighlight: { borderColor: GOLD, backgroundColor: GOLD_SOFT },
  kcLabel: {
    fontSize: 6.5,
    color: MUTED,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  kcValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: INK },
  kcSub: { fontSize: 7, color: SUBTLE, marginTop: 2 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: FILL,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: 4,
    paddingHorizontal: 4,
    alignItems: 'center',
    backgroundColor: SURFACE,
  },
  tableRowOptimal: { backgroundColor: GOLD_SOFT },
  th: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: MUTED,
    textTransform: 'uppercase',
  },
  td: { fontSize: 8.5, color: INK },
  tdBold: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: INK },
  tdAge: { flexDirection: 'row', alignItems: 'center' },
  negative: { color: RED },
  badge: {
    fontSize: 5.5,
    color: SURFACE,
    backgroundColor: GOLD,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    marginLeft: 4,
  },
  chartSection: { marginTop: 4, marginBottom: 12 },
  chartBox: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    padding: 8,
    backgroundColor: SURFACE,
  },
  chartLegend: {
    flexDirection: 'row',
    marginTop: 6,
    justifyContent: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 10 },
  legendLine: { width: 16, height: 2, marginRight: 4 },
  legendText: { fontSize: 7, color: MUTED },
  beSection: { marginBottom: 12 },
  beRow: { flexDirection: 'row' },
  beCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    padding: 8,
    alignItems: 'center',
    marginRight: 8,
    backgroundColor: SURFACE,
  },
  beCardLast: { marginRight: 0 },
  bePair: { fontSize: 8, color: MUTED, marginBottom: 3 },
  beAge: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: INK },
  beLabel: {
    fontSize: 6.5,
    color: SUBTLE,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  beVerdictLater: {
    fontSize: 7,
    color: GREEN,
    backgroundColor: GREEN_SOFT,
    padding: 4,
    borderRadius: 2,
    textAlign: 'center',
  },
  beVerdictEarlier: {
    fontSize: 7,
    color: RED,
    backgroundColor: RED_SOFT,
    padding: 4,
    borderRadius: 2,
    textAlign: 'center',
  },
  methodRow: { flexDirection: 'row', marginBottom: 8 },
  methodBlock: { flex: 1, marginRight: 12 },
  methodBlockLast: { marginRight: 0 },
  methodTitle: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: INK, marginBottom: 3 },
  methodText: { fontSize: 8, color: MUTED, lineHeight: 1.4 },
  disclaimer: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
    backgroundColor: SURFACE,
  },
  disclaimerTitle: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  disclaimerText: { fontSize: 7.5, color: MUTED, lineHeight: 1.4 },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: PAD_H,
    right: PAD_H,
    fontSize: 7,
    color: SUBTLE,
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 6,
  },
  pdfHeatmapLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  pdfHeatmapLegendBar: {
    width: 100,
    height: 6,
    marginHorizontal: 8,
    backgroundColor: GOLD,
  },
  pdfHeatmapLegendText: { fontSize: 6.5, color: MUTED },
  pdfBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  pdfBarLabel: { width: 52, fontSize: 7.5, color: MUTED },
  pdfBarTrack: {
    flex: 1,
    height: 10,
    backgroundColor: FILL,
    borderRadius: 2,
    overflow: 'hidden',
  },
  pdfBarFill: { height: 10, backgroundColor: RED, borderRadius: 2 },
  pdfBarFillOptimal: { height: 10, backgroundColor: GREEN, borderRadius: 2, width: 4 },
  pdfBarValue: { width: 52, fontSize: 7, color: MUTED, textAlign: 'right' },
});

function formatReportDate(): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function BrandMonogram() {
  return (
    <View style={styles.monogram}>
      <Text style={styles.monogramText}>W</Text>
    </View>
  );
}

function PdfChart({
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
  const W = CONTENT_W - 16;
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
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = yScale(maxVal * t);
          return (
            <Line
              key={t}
              x1={padL}
              y1={y}
              x2={W - padR}
              y2={y}
              stroke={BORDER}
              strokeWidth={0.5}
            />
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const val = maxVal * t;
          return (
            <Text
              key={`y-${t}`}
              x={padL - 4}
              y={yScale(val) + 2}
              style={{ fontSize: 5.5, fill: MUTED }}
              textAnchor="end"
            >
              ${Math.round(val / 1000)}k
            </Text>
          );
        })}
        {labelAges.map((age) => (
          <Line
            key={`tick-${age}`}
            x1={xScale(age)}
            y1={padT + plotH}
            x2={xScale(age)}
            y2={padT + plotH + 3}
            stroke={SUBTLE}
            strokeWidth={0.5}
          />
        ))}
        {labelAges.map((age) => (
          <Text
            key={`lbl-${age}`}
            x={xScale(age)}
            y={H - 4}
            style={{ fontSize: 6, fill: MUTED }}
            textAnchor="middle"
          >
            {age}
          </Text>
        ))}
        {lifeExpectancy > 70 && (
          <Text
            x={xScale(lifeExpectancy)}
            y={H - 4}
            style={{ fontSize: 6, fill: RED }}
            textAnchor="middle"
          >
            {lifeExpectancy}
          </Text>
        )}
        <Line
          x1={xScale(lifeExpectancy)}
          y1={padT}
          x2={xScale(lifeExpectancy)}
          y2={padT + plotH}
          stroke={RED}
          strokeWidth={1}
          strokeDasharray="3 2"
        />
        {lineAges.map((age) => (
          <Path
            key={age}
            d={linePath(age)}
            stroke={age === optimalAge ? GOLD : colors[age]}
            strokeWidth={age === optimalAge ? 2 : 1.2}
            fill="none"
          />
        ))}
      </Svg>
      <View style={styles.chartLegend}>
        {lineAges.map((age) => (
          <View key={age} style={styles.legendItem}>
            <View
              style={[
                styles.legendLine,
                { backgroundColor: age === optimalAge ? GOLD : colors[age] },
              ]}
            />
            <Text style={styles.legendText}>
              Claim {age}
              {age === optimalAge ? ' (optimal)' : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PdfHeatmap({
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
  const W = CONTENT_W;
  const plotW = W - labelW - 4;
  const colW = plotW / livingAges.length;
  const rowH = 9;
  const headerH = 11;
  const H = headerH + claimAges.length * rowH + 2;

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Text x={labelW - 2} y={8} style={{ fontSize: 5.5, fill: MUTED }} textAnchor="end">
          Claim
        </Text>
        {livingAges.map((age, i) => (
          <Text
            key={`hx-${age}`}
            x={labelW + i * colW + colW / 2}
            y={9}
            style={{ fontSize: 5.5, fill: MUTED }}
            textAnchor="middle"
          >
            {age}
          </Text>
        ))}
        {claimAges.map((claimAge, ri) => {
          const y0 = headerH + ri * rowH;
          return (
            <Text
              key={`hy-${claimAge}`}
              x={labelW - 3}
              y={y0 + rowH * 0.65}
              style={{
                fontSize: 6,
                fill: claimAge === optimalAge ? GOLD : MUTED,
                fontFamily: claimAge === optimalAge ? 'Helvetica-Bold' : 'Helvetica',
              }}
              textAnchor="end"
            >
              {claimAge}
            </Text>
          );
        })}
        {claimAges.map((claimAge, ri) =>
          livingAges.map((livingAge, ci) => {
            if (livingAge < claimAge) return null;
            const value = getHeatmapValue(cells, claimAge, livingAge)!;
            const ratio = maxVal === minVal ? 0.5 : (value - minVal) / (maxVal - minVal);
            const x = labelW + ci * colW + 0.5;
            const y = headerH + ri * rowH + 0.5;
            return (
              <Rect
                key={`${claimAge}-${livingAge}`}
                x={x}
                y={y}
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

function PdfOpportunityCost({
  options,
  optimalAge,
}: {
  options: ClaimingOption[];
  optimalAge: number;
}) {
  const data = generateOpportunityCostData(options, optimalAge);
  const maxShortfall = Math.max(
    ...data.map((d) => (d.vsOptimal < 0 ? Math.abs(d.vsOptimal) : 0)),
    1,
  );

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
            <Text style={styles.pdfBarValue}>
              {row.isOptimal ? 'Optimal' : formatCurrency(shortfall)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function PdfMonthlyRamp({
  options,
  optimalAge,
}: {
  options: ClaimingOption[];
  optimalAge: number;
}) {
  const data = generateMonthlyRampData(options, optimalAge);
  const W = CONTENT_W - 16;
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
        <Line
          x1={padL}
          y1={padT + plotH}
          x2={W - padR}
          y2={padT + plotH}
          stroke={BORDER}
          strokeWidth={0.5}
        />
        {[62, 64, 66, 68, 70].map((age) => (
          <Text
            key={age}
            x={xScale(age)}
            y={H - 3}
            style={{ fontSize: 6, fill: MUTED }}
            textAnchor="middle"
          >
            {age}
          </Text>
        ))}
        <Text x={padL - 3} y={yScale(maxM) + 2} style={{ fontSize: 5.5, fill: MUTED }} textAnchor="end">
          ${Math.round(maxM / 1000)}k
        </Text>
        <Text x={padL - 3} y={yScale(minM) + 2} style={{ fontSize: 5.5, fill: MUTED }} textAnchor="end">
          ${Math.round(minM / 1000)}k
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
        <Line
          x1={xScale(optimalAge)}
          y1={padT}
          x2={xScale(optimalAge)}
          y2={padT + plotH}
          stroke={GOLD}
          strokeWidth={0.8}
          strokeDasharray="2 2"
        />
      </Svg>
    </View>
  );
}

function BenefitTable({
  claimingOptions,
  optimal,
  optimalAge,
}: {
  claimingOptions: ClaimingOption[];
  optimal: ClaimingOption;
  optimalAge: number;
}) {
  return (
    <View>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: COL.age }]}>Age</Text>
        <Text style={[styles.th, { width: COL.monthly }]}>Monthly</Text>
        <Text style={[styles.th, { width: COL.pia }]}>% PIA</Text>
        <Text style={[styles.th, { width: COL.life }]}>Lifetime</Text>
        <Text style={[styles.th, { width: COL.diff }]}>vs. Optimal</Text>
      </View>
      {claimingOptions.map((opt) => {
        const diff = opt.lifetimeBenefits - optimal.lifetimeBenefits;
        const isOptimal = opt.age === optimalAge;
        return (
          <View
            key={opt.age}
            style={[styles.tableRow, isOptimal ? styles.tableRowOptimal : {}]}
          >
            <View style={[styles.tdAge, { width: COL.age }]}>
              <Text style={styles.tdBold}>{opt.age}</Text>
              {isOptimal && <Text style={styles.badge}>OPT</Text>}
            </View>
            <Text style={[styles.td, { width: COL.monthly }]}>
              {formatCurrencyPrecise(opt.monthlyBenefit)}
            </Text>
            <Text style={[styles.td, { width: COL.pia }]}>{opt.percentOfPia}%</Text>
            <Text style={[styles.td, { width: COL.life }]}>
              {formatCurrency(opt.lifetimeBenefits)}
            </Text>
            <Text style={[styles.td, { width: COL.diff }, diff < 0 ? styles.negative : {}]}>
              {diff === 0 ? '—' : formatCurrency(diff)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function PageFooter({ text }: { text: string }) {
  return (
    <Text style={styles.footer} fixed>
      {text}
    </Text>
  );
}

function MethodPair({
  left,
  right,
}: {
  left: { title: string; body: string };
  right?: { title: string; body: string };
}) {
  if (!left.title && !right?.title) return null;
  return (
    <View style={styles.methodRow}>
      <View style={styles.methodBlock}>
        {left.title ? (
          <>
            <Text style={styles.methodTitle}>{left.title}</Text>
            <Text style={styles.methodText}>{left.body}</Text>
          </>
        ) : null}
      </View>
      {right?.title ? (
        <View style={[styles.methodBlock, styles.methodBlockLast]}>
          <Text style={styles.methodTitle}>{right.title}</Text>
          <Text style={styles.methodText}>{right.body}</Text>
        </View>
      ) : (
        <View style={[styles.methodBlock, styles.methodBlockLast]} />
      )}
    </View>
  );
}

export interface PdfReportDocumentProps {
  inputs: UserInputs;
  result: AnalysisResult;
}

export function PdfReportDocument({ inputs, result }: PdfReportDocumentProps) {
  const { birthYear, birthMonth, lifeExpectancy, annualCola, gender, hasSpouse } = inputs;
  const {
    fra,
    currentAge,
    claimingOptions,
    optimalAge,
    optimalFilingAge,
    optimalMonthly,
    expectedPresentValue,
    discountRate,
    recommendation,
    recommendationDetail,
    breakEvens,
    pia,
  } = result;

  const optimal = claimingOptions.find((o) => o.age === optimalAge)!;
  const age62 = claimingOptions.find((o) => o.age === 62)!;
  const age70 = claimingOptions.find((o) => o.age === 70)!;
  const dob = `${MONTHS[birthMonth - 1]} ${birthYear}`;
  const footerText = `${BRAND_NAME} · Confidential · ${formatReportDate()}`;
  const cpi = getCpiLast30Years();
  const ssaSuggested = result.ssaSuggestedLifeExpectancy;

  const methodPairs: [{ title: string; body: string }, { title: string; body: string }][] = [
    [
      {
        title: 'Full Retirement Age (FRA)',
        body: `Birth year ${birthYear} → FRA ${fraLabel(fra)} per SSA schedule.`,
      },
      {
        title: 'Early Claiming Reduction',
        body: `5/9 of 1% per month (first 36 mo), then 5/12 of 1% thereafter. Age 62 = ${age62.percentOfPia}% of PIA.`,
      },
    ],
    [
      {
        title: 'Delayed Retirement Credits',
        body: `2/3 of 1% per month past FRA to age 70. Age 70 = ${age70.percentOfPia}% of PIA.`,
      },
      {
        title: 'Lifetime Benefit Projection',
        body: `Benefits compounded at ${formatPercent(annualCola, 2)} COLA through age ${lifeExpectancy}. Optimal claim age: ${optimalAge}.`,
      },
    ],
    [
      {
        title: 'Inflation / COLA',
        body: `${formatPercent(annualCola, 2)} annual COLA. BLS CPI-U ${cpi.startYear}–${cpi.endYear} avg ${formatPercent(cpi.arithmeticMean, 2)}.`,
      },
      {
        title: 'Life Expectancy',
        body: `Plan-to age ${lifeExpectancy}. SSA period life table suggests age ${ssaSuggested} for ${genderLabel(gender).toLowerCase()} at ${currentAge.years}.`,
      },
    ],
    [
      {
        title: 'Spousal & Survivor',
        body: hasSpouse
          ? `Spousal at FRA: 50% of PIA (${formatCurrencyPrecise(pia * 0.5)}/mo). Survivor receives worker's full monthly benefit.`
          : 'Single claimant — spousal/survivor benefits not modeled.',
      },
      {
        title: 'Break-Even',
        body: 'Age when later strategy cumulative benefits exceed earlier, with COLA applied.',
      },
    ],
    [
      {
        title: 'Data Sources',
        body: `COLA: ${BLS_CPI_URL}. Life tables: ${SSA_LIFE_TABLE_URL}.`,
      },
      { title: '', body: '' },
    ],
  ];

  return (
    <Document
      title="Social Security Claiming Analysis"
      author={BRAND_NAME}
      subject="Social Security Claiming Analysis"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.brandBlock}>
            <BrandMonogram />
            <View>
              <Text style={styles.org}>{BRAND_NAME}</Text>
              <Text style={styles.title}>Social Security Claiming Analysis</Text>
            </View>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaDate}>{formatReportDate()}</Text>
            <Text style={styles.metaId}>Confidential Planning Report</Text>
          </View>
        </View>

        <View style={styles.accentBar} />

        <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>Client Profile</Text>
        <View style={styles.profileGrid}>
          {[
            ['Date of Birth', dob],
            ['Gender', genderLabel(gender)],
            ['Marital Status', hasSpouse ? 'Married' : 'Single'],
            ['Current Age', `${currentAge.years} years, ${currentAge.months} months`],
            ['Full Retirement Age', fraLabel(fra)],
            ['PIA (Benefit at FRA)', `${formatCurrencyPrecise(pia)}/mo`],
            ['Life Expectancy', `Age ${lifeExpectancy}`],
            ['SSA Suggested Age', `Age ${result.ssaSuggestedLifeExpectancy}`],
            ['Discount Rate', formatPercent(discountRate * 100, 2)],
            ['Chart COLA', formatPercent(annualCola, 2)],
          ].map(([label, value]) => (
            <View key={label} style={styles.profileItem}>
              <Text style={styles.profileLabel}>{label}</Text>
              <Text style={styles.profileValue}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.recBox}>
          <Text style={styles.recEyebrow}>Recommended Strategy (ssa.tools)</Text>
          <Text style={styles.recHeadline}>{recommendation}</Text>
          <Text style={styles.recBody}>{recommendationDetail}</Text>
          <View style={styles.recMetrics}>
            <View style={styles.recMetricBlock}>
              <Text style={styles.recMetricValue}>{formatCurrency(optimalMonthly)}</Text>
              <Text style={styles.recMetricLabel}>Monthly at age {optimalFilingAge.label}</Text>
            </View>
            <View style={styles.recMetricBlock}>
              <Text style={styles.recMetricValue}>{formatCurrency(expectedPresentValue)}</Text>
              <Text style={styles.recMetricLabel}>Expected present value</Text>
            </View>
            <View style={styles.recMetricBlock}>
              <Text style={styles.recMetricValue}>{optimal.percentOfPia}%</Text>
              <Text style={styles.recMetricLabel}>Of PIA</Text>
            </View>
          </View>
        </View>

        <View style={styles.kcRow}>
          <View style={styles.kcCard}>
            <Text style={styles.kcLabel}>Earliest (Age 62)</Text>
            <Text style={styles.kcValue}>{formatCurrency(age62.monthlyBenefit)}/mo</Text>
            <Text style={styles.kcSub}>{age62.percentOfPia}% of PIA</Text>
          </View>
          <View style={[styles.kcCard, styles.kcHighlight]}>
            <Text style={styles.kcLabel}>Optimal (Age {optimalAge})</Text>
            <Text style={styles.kcValue}>{formatCurrency(optimal.monthlyBenefit)}/mo</Text>
            <Text style={styles.kcSub}>{formatCurrency(optimal.lifetimeBenefits)} lifetime</Text>
          </View>
          <View style={[styles.kcCard, styles.kcCardLast]}>
            <Text style={styles.kcLabel}>Maximum (Age 70)</Text>
            <Text style={styles.kcValue}>{formatCurrency(age70.monthlyBenefit)}/mo</Text>
            <Text style={styles.kcSub}>{age70.percentOfPia}% of PIA</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Benefit Comparison by Claiming Age</Text>
        <Text style={styles.sectionDesc}>
          Monthly benefit and lifetime total through age {lifeExpectancy} with{' '}
          {formatPercent(annualCola, 2)} annual COLA
        </Text>
        <BenefitTable
          claimingOptions={claimingOptions}
          optimal={optimal}
          optimalAge={optimalAge}
        />

        <PageFooter text={`${footerText} · Page 1 of 3`} />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>
          Cumulative Lifetime Benefits
        </Text>
        <Text style={styles.sectionDesc}>
          Comparing claim-at-62, 67, and 70. Red dashed line = life expectancy (age{' '}
          {lifeExpectancy}).
        </Text>
        <View style={styles.chartSection}>
          <View style={styles.chartBox}>
            <PdfChart
              options={claimingOptions}
              lifeExpectancy={lifeExpectancy}
              optimalAge={optimalAge}
              annualCola={annualCola}
            />
          </View>
        </View>

        {breakEvens.length > 0 && (
          <View style={styles.beSection}>
            <Text style={styles.sectionTitle}>Break-Even Analysis</Text>
            <Text style={styles.sectionDesc}>
              Age when a later claiming strategy surpasses an earlier one in total benefits
            </Text>
            <View style={styles.beRow}>
              {breakEvens.map((be, i) => {
                const favorsLater = lifeExpectancy >= be.breakEvenAge;
                const isLast = i === breakEvens.length - 1;
                return (
                  <View
                    key={`${be.earlierAge}-${be.laterAge}`}
                    style={[styles.beCard, isLast ? styles.beCardLast : {}]}
                  >
                    <Text style={styles.bePair}>
                      Age {be.earlierAge} → Age {be.laterAge}
                    </Text>
                    <Text style={styles.beAge}>{be.breakEvenAge}</Text>
                    <Text style={styles.beLabel}>Break-even age</Text>
                    <Text style={favorsLater ? styles.beVerdictLater : styles.beVerdictEarlier}>
                      {favorsLater
                        ? `Delaying to ${be.laterAge} is favorable`
                        : `Claiming at ${be.earlierAge} is favorable`}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>Methodology & Assumptions</Text>
        {methodPairs.map((pair, i) => (
          <MethodPair key={i} left={pair[0]} right={pair[1]} />
        ))}

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTitle}>Important Disclosures</Text>
          <Text style={styles.disclaimerText}>
            Prepared by {BRAND_NAME} using the open-source ssa.tools engine for educational planning only. Not affiliated with
            the SSA. Projections include stated COLA ({formatPercent(annualCola, 2)}) but exclude
            taxation, spousal/survivor benefits, earnings limits, and rule changes. Data:{' '}
            {BLS_CPI_URL}. Verify at ssa.gov before claiming.
          </Text>
        </View>

        <PageFooter text={`${footerText} · Page 2 of 3`} />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>
          Lifetime Benefit Heatmap
        </Text>
        <Text style={styles.sectionDesc}>
          Cumulative benefits by claiming age (rows) and living age (columns) through age{' '}
          {lifeExpectancy} with {formatPercent(annualCola, 2)} COLA. Star row = optimal age{' '}
          {optimalAge}.
        </Text>
        <View style={styles.chartBox}>
          <PdfHeatmap
            options={claimingOptions}
            lifeExpectancy={lifeExpectancy}
            optimalAge={optimalAge}
            annualCola={annualCola}
          />
        </View>

        <Text style={styles.sectionTitle}>Opportunity Cost vs. Optimal</Text>
        <Text style={styles.sectionDesc}>
          Lifetime income shortfall compared to claiming at age {optimalAge} (your recommended
          strategy).
        </Text>
        <View style={styles.chartBox}>
          <PdfOpportunityCost options={claimingOptions} optimalAge={optimalAge} />
        </View>

        <Text style={styles.sectionTitle}>Monthly Benefit Ramp (Ages 62–70)</Text>
        <Text style={styles.sectionDesc}>
          Monthly check at each claiming age. Gold marker = optimal age {optimalAge}. Age 62 ={' '}
          {age62.percentOfPia}% PIA; age 70 = {age70.percentOfPia}% PIA.
        </Text>
        <View style={styles.chartBox}>
          <PdfMonthlyRamp options={claimingOptions} optimalAge={optimalAge} />
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTitle}>Visualization Notes</Text>
          <Text style={styles.disclaimerText}>
            Heatmap colors reflect relative cumulative totals — not monthly cash flow. Opportunity
            cost bars show lifetime difference only through your plan-to age of {lifeExpectancy}.
            All figures are pre-tax estimates for discussion with your advisor.
          </Text>
        </View>

        <PageFooter text={`${footerText} · Page 3 of 3`} />
      </Page>
    </Document>
  );
}
