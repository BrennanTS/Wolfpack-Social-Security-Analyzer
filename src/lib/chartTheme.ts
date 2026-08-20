/**
 * Shared visual tokens for all Recharts-based charts.
 *
 * Kept in one place so every chart matches the app's quiet-luxury palette
 * (ink + gold on cream) and so the tooltip styling stays consistent.
 */
import type { BandType } from './benefitPeriods';

/**
 * Gold accent — the highlighted series.
 *
 * Concrete hex, not a custom property: `seriesColor` below is shared with the
 * PDF, which cannot resolve `var()`. That forces one value onto two canvases,
 * so it is picked to clear 3:1 on both rather than to be ideal on either —
 * 3.4:1 on white, 5.1:1 on the dark canvas. The old #b8965a scored 2.78:1 on
 * white, under the threshold for a graphical mark.
 */
export const CHART_GOLD = '#a8863f';
/**
 * Chrome tokens — axis ticks, gridlines, unhighlighted bars.
 *
 * These are web-only (no PDF import reaches them), so unlike the series
 * colors they can be theme-aware, and they have to be: `CHART_INK` scored
 * 1.53:1 on the dark canvas, which is why dark-mode bar charts read as empty
 * boxes. Values live in index.css beside the rest of the theme.
 */
export const CHART_INK = 'var(--chart-ink)';
/** Muted gray for axis ticks and secondary text. */
export const CHART_MUTED = 'var(--chart-muted)';
/** Mid gray for non-highlighted comparison series. */
export const CHART_GRAY_MID = 'var(--chart-gray-mid)';
/** Hairline color for axes and grid lines. */
export const CHART_AXIS_LINE = 'var(--chart-axis)';
/** Muted red used to flag shortfalls / life-expectancy markers. */
export const CHART_RED = 'var(--chart-red)';
/** Sage — a spousal band drawn on the OTHER spouse's record. */
export const CHART_SAGE = '#7d9b76';
/** Slate — a survivor band, drawn once the earner they depended on has died. */
export const CHART_SLATE = '#6f8ba3';
/**
 * Plum — the SECOND person's own record.
 *
 * Chosen against two surfaces at once, which is what the previous value got
 * wrong. `CHART_INK` (#3a3a3a) reads well on the cream chart — 10.7:1 — but
 * the shared tooltip is near-black, where it scored 1.6:1 and the spouse's
 * own-benefit line was effectively unreadable; dark mode had the same
 * problem on the canvas itself. Anything light enough for the tooltip drops
 * below 3:1 on cream, so the usable band is narrow: this sits at 5.0:1 on
 * the tooltip, 4.8:1 on the dark canvas and 3.4:1 on cream.
 *
 * Hue is picked for separation, not taste — clear of gold (36°), sage (108°)
 * and slate (205°) so no two series read alike, and clear of `CHART_RED`,
 * which marks life expectancy.
 */
export const CHART_PLUM = '#9d78b0';

/** A person's own record, indexed by their position in the household. */
const OWN_BENEFIT_COLORS = [CHART_GOLD, CHART_PLUM, CHART_GRAY_MID];

/**
 * A person's own record keeps their identity color; benefits drawn on the
 * OTHER person's record get their own. Only the dependent ever holds a
 * spousal or survivor band, so at most four series exist and none collide.
 */
export function seriesColor(personIndex: number, type: BandType): string {
  switch (type) {
    case 'spousal':
      return CHART_SAGE;
    case 'survivor':
      return CHART_SLATE;
    case 'personal':
    default:
      return OWN_BENEFIT_COLORS[personIndex % OWN_BENEFIT_COLORS.length];
  }
}

/**
 * Recharts joins a tooltip row's name and value with " : " by default — a
 * space before the colon, which reads as a typo. Every chart passes this so
 * the six of them cannot drift apart.
 */
export const CHART_TOOLTIP_SEPARATOR = ': ';

/**
 * Recharts paints each tooltip row in its SERIES color. On this app's
 * near-black tooltip that made most rows unreadable: `CHART_INK` scores
 * 1.6:1 against it, `CHART_RED` 3.0:1, and the claim-age ramp falls to 2.0:1
 * by age 69 — the figure the reader opened the tooltip for.
 *
 * Every Recharts tooltip therefore paints its own text instead. Nothing is
 * lost: those charts name the series in the row ("Claim at 67"), so the
 * color was decoration. `CombinedIncomeChart` is the exception and keeps
 * its colors — it stacks four series where the color IS the key, and all
 * four clear 4.9:1 against this background.
 */
export const CHART_TOOLTIP_ITEM_STYLE = { color: '#f7f4ee' } as const;

/** The tooltip's heading — the hovered category. Same reasoning. */
export const CHART_TOOLTIP_LABEL_STYLE = {
  color: '#f7f4ee',
  fontWeight: 600,
  marginBottom: 4,
} as const;

/** Dark, rounded tooltip shared by every chart. */
export const CHART_TOOLTIP_STYLE = {
  background: 'rgba(20, 20, 20, 0.94)',
  border: 'none',
  borderRadius: 4,
  color: '#f7f4ee',
  fontSize: 13,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
} as const;

/**
 * Gray-to-gold ramp keyed by claiming age (62–70). Later ages read as darker,
 * with age 70 rendered in gold to signal the maximum-delay strategy.
 *
 * Reversed for dark mode — a ramp that darkens toward 70 would send the most
 * important bar closest to the background. Per-theme values in index.css.
 */
export const CLAIM_AGE_COLORS: Record<number, string> = {
  62: 'var(--claim-age-62)',
  63: 'var(--claim-age-63)',
  64: 'var(--claim-age-64)',
  65: 'var(--claim-age-65)',
  66: 'var(--claim-age-66)',
  67: 'var(--claim-age-67)',
  68: 'var(--claim-age-68)',
  69: 'var(--claim-age-69)',
  70: 'var(--claim-age-70)',
};
