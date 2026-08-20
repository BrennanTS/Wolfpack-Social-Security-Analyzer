import { StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_REPORT_THEME_ID, reportTheme, type ReportTheme } from '../../lib/reportTheme';
import { mixHex } from '../../lib/chartData';

const DEFAULT_THEME = reportTheme(DEFAULT_REPORT_THEME_ID);

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The palette the document is currently being printed in.
 *
 * `let`, not `const`, so these are ESM live bindings: the six components that
 * import `GOLD`/`INK`/… read them at render time and therefore see whatever
 * `setActiveReportTheme` last installed. The alternative was threading a
 * theme prop (or a context) through every section, table and chart in the
 * report for a value that is constant across any single render.
 *
 * `SURFACE` is the one color that is not themeable: the report is printed on
 * paper, and paper is white. A theme that tinted the page would cost a client
 * an entire ink cartridge and still print grey on a monochrome laser.
 */
export let INK = DEFAULT_THEME.ink;
export let GOLD = DEFAULT_THEME.brand;
export let GOLD_DARK = DEFAULT_THEME.brandDark;
export const SURFACE = '#ffffff';
export let BORDER = DEFAULT_THEME.border;
export let MUTED = DEFAULT_THEME.muted;
export let SUBTLE = DEFAULT_THEME.subtle;
export let GREEN = DEFAULT_THEME.green;
export let RED = DEFAULT_THEME.red;
/** Heat ramp endpoints for this theme, read by `heatmapColorPdf`. */
export let HEAT_LO = DEFAULT_THEME.heatLo;
export let HEAT_HI = DEFAULT_THEME.heatHi;

/** Letter page content width: 612pt − left/right padding */
export const CONTENT_W = 516;
/**
 * Drawable width INSIDE a `chartBox` — the content width less that box's 1pt
 * border and 8pt padding on each side.
 *
 * An `<Svg width={CONTENT_W}>` in a `chartBox` overflows its own frame by
 * 18pt, which is how the combined-income chart came to be drawn on top of
 * the rounded rectangle that was meant to contain it. Named rather than
 * spelled `CONTENT_W - 18` at each call site so the two numbers cannot drift
 * apart from `chartBox` itself.
 */
export const CHART_INNER_W = CONTENT_W - 18;
export const PAD_H = 48;
export const PAD_TOP = 36;
export const PAD_BOTTOM = 40;

/**
 * Person benefit-table column widths (must sum to CONTENT_W).
 *
 * `age` carries the age AND its badges. At 44pt it fit one short badge; the
 * three-badge row ("62" + TOGETHER + ALONE) printed them overlapping the age
 * itself. Widened to hold the worst real case — TOGETHER beside ALONE, which
 * is what a person whose household and solo answers agree gets — with the
 * width taken from `diff`, the roomiest column. SHOWN never joins them: it
 * only renders when the shown age differs from the optimum, which is exactly
 * when TOGETHER is on some other row.
 */
export const COL = { age: 80, monthly: 108, pia: 56, life: 118, diff: 154 };

function buildStyles() {
  return StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: INK,
    backgroundColor: SURFACE,
    paddingTop: PAD_TOP,
    paddingBottom: PAD_BOTTOM,
    paddingHorizontal: PAD_H,
  },
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
  docHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: GOLD,
  },
  docTitle: { fontSize: 15, color: INK, fontFamily: 'Helvetica-Bold', letterSpacing: -0.2 },
  docBrand: {
    fontSize: 7.5,
    color: GOLD_DARK,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 3,
  },
  docDate: { fontSize: 8.5, color: MUTED },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: SURFACE,
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
  tableRowOptimal: {
    backgroundColor: SURFACE,
    borderLeftWidth: 2,
    borderLeftColor: GOLD,
  },
  /**
   * The row the report is actually built on, when that is NOT the optimum.
   * Marked with an ink rule rather than the gold one so the two are
   * distinguishable in a black-and-white print, where two identical rules
   * would say the same thing about two different rows.
   */
  tableRowSelected: {
    backgroundColor: SURFACE,
    borderLeftWidth: 2,
    borderLeftColor: INK,
  },
  th: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: MUTED,
    textTransform: 'uppercase',
  },
  td: { fontSize: 8.5, color: INK },
  tdBold: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: INK },
  /* No negative margin and no padding of its own: the first pulled the date
     up into the age's line box and the second indented it away from the age
     it belongs to, so "67" and "Dec 2045" printed on top of one another. */
  tdDate: { fontSize: 6.5, color: SUBTLE, marginTop: 1 },
  /* ─── Beta report ─── */
  thRight: { textAlign: 'right' },
  tdRight: { textAlign: 'right' },
  betaHero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    marginBottom: 6,
  },
  betaFacts: { flex: 1 },
  betaFactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  betaFactLabel: { fontSize: 9, color: MUTED },
  betaFactValue: { fontSize: 9, color: INK, fontFamily: 'Helvetica-Bold' },
  betaBig: { width: 190, alignItems: 'flex-end' },
  betaBigCap: { fontSize: 7, color: MUTED, textAlign: 'right', marginBottom: 3 },
  betaBigNum: { fontSize: 30, color: INK, fontFamily: 'Helvetica-Bold', letterSpacing: -0.5 },
  betaBigSub: { fontSize: 8, color: GREEN, textAlign: 'right', marginTop: 4 },
  betaBarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  betaBarLabel: { width: 150, fontSize: 8.5, color: INK },
  betaBarTrack: { flex: 1, height: 13, backgroundColor: '#f2efe8', borderRadius: 2 },
  betaBarFill: { height: 13, backgroundColor: GOLD, borderRadius: 2 },
  betaBarFillDim: { backgroundColor: '#d9d3c4' },
  betaBarValue: {
    width: 72,
    fontSize: 8.5,
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
    color: INK,
  },
  betaCallout: {
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
    paddingLeft: 10,
    paddingVertical: 6,
  },
  betaCalloutText: { fontSize: 9.5, color: INK, lineHeight: 1.45 },
  betaWinner: { fontFamily: 'Helvetica-Bold', color: GREEN },
  betaCheckbox: {
    width: 9,
    height: 9,
    borderWidth: 1,
    borderColor: SUBTLE,
    borderRadius: 1.5,
  },
  betaTerm: { marginBottom: 9 },
  betaTermName: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: INK, marginBottom: 2 },
  betaTermBody: { fontSize: 9, color: MUTED, lineHeight: 1.45 },
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
  badgeShown: {
    fontSize: 5.5,
    color: SURFACE,
    backgroundColor: INK,
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
    backgroundColor: SURFACE,
    padding: 4,
    borderRadius: 2,
    textAlign: 'center',
  },
  beVerdictEarlier: {
    fontSize: 7,
    color: RED,
    backgroundColor: SURFACE,
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
  /* Just a spacer now — the ramp itself is `PdfRampBar`, drawn as stepped
     rects because react-pdf gives a `View` no gradient. A flat
     `backgroundColor` here printed a one-color key. */
  pdfHeatmapLegendBar: {
    width: 100,
    height: 6,
    marginHorizontal: 8,
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
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 2,
    overflow: 'hidden',
  },
  pdfBarFill: { height: 10, backgroundColor: RED, borderRadius: 2 },
  pdfBarFillShown: { height: 10, backgroundColor: GREEN, borderRadius: 2, width: 4 },
  pdfBarValue: { width: 52, fontSize: 7, color: MUTED, textAlign: 'right' },
});
}

export let styles = buildStyles();

/**
 * A heat-map cell's fill, `ratio` from 0 (coldest) to 1 (the best combination).
 *
 * Reads the active theme's endpoints, so the claiming grid is printed in the
 * same palette as the rest of the report rather than in a fixed ramp that
 * would clash with three themes out of four.
 *
 * The old ramp detoured through grey on its way from cream to gold, which
 * bought range at the cost of hue — mid-value cells read as "no color"
 * rather than as "middling". A straight two-stop mix keeps every cell
 * recognizably on the same scale.
 */
export function heatColor(ratio: number): string {
  return mixHex(HEAT_LO, HEAT_HI, Math.max(0, Math.min(1, ratio)));
}

/**
 * Install the palette the next render will use.
 *
 * Call this before building a `<Document>`; `printReport` does, once per
 * export. Deliberately module-level rather than per-document: react-pdf
 * renders one document at a time, and the report has no notion of two themes
 * being live at once.
 */
export function setActiveReportTheme(theme: ReportTheme): void {
  INK = theme.ink;
  GOLD = theme.brand;
  GOLD_DARK = theme.brandDark;
  BORDER = theme.border;
  MUTED = theme.muted;
  SUBTLE = theme.subtle;
  GREEN = theme.green;
  RED = theme.red;
  HEAT_LO = theme.heatLo;
  HEAT_HI = theme.heatHi;
  // Rebuilt, not patched: the stylesheet baked these colors in when it was
  // created, so reassigning the bindings alone would leave every `styles.*`
  // entry printing the previous theme.
  styles = buildStyles();
}
