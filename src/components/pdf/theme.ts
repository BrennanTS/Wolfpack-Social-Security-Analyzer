import { StyleSheet } from '@react-pdf/renderer';

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const INK = '#141414';
export const GOLD = '#b8965a';
export const GOLD_DARK = '#8a7144';
export const SURFACE = '#ffffff';
export const BORDER = '#e4e1da';
export const MUTED = '#5c5c5c';
export const SUBTLE = '#8a8a8a';
export const GREEN = '#5a7a5e';
export const RED = '#9a4a44';

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

export const styles = StyleSheet.create({
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
