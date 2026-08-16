/**
 * Shared visual tokens for all Recharts-based charts.
 *
 * Kept in one place so every chart matches the app's quiet-luxury palette
 * (ink + gold on cream) and so the tooltip styling stays consistent.
 */
import type { BandType } from './benefitPeriods';

/** Gold accent — used for the optimal / highlighted series. */
export const CHART_GOLD = '#b8965a';
/** Primary ink tone for bars and lines. */
export const CHART_INK = '#3a3a3a';
/** Muted grey for axis ticks and secondary text. */
export const CHART_MUTED = '#8a8a8a';
/** Mid grey for non-highlighted comparison series. */
export const CHART_GREY_MID = '#b0b0b0';
/** Hairline color for axes and grid lines. */
export const CHART_AXIS_LINE = '#e8e8ed';
/** Muted red used to flag shortfalls / life-expectancy markers. */
export const CHART_RED = '#9a4a44';
/** Sage — a spousal band drawn on the OTHER spouse's record. */
export const CHART_SAGE = '#7d9b76';
/** Slate — a survivor band, drawn once the earner they depended on has died. */
export const CHART_SLATE = '#6f8ba3';

/** A person's own record, indexed by their position in the household. */
const OWN_BENEFIT_COLORS = [CHART_GOLD, CHART_INK, CHART_GREY_MID];

/**
 * A person's own record keeps their identity colour; benefits drawn on the
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

/** Dark, rounded tooltip shared by every chart. */
export const CHART_TOOLTIP_STYLE = {
  background: 'rgba(20, 20, 20, 0.94)',
  border: 'none',
  borderRadius: 4,
  color: '#f7f5f0',
  fontSize: 13,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
} as const;

/**
 * Grey-to-gold ramp keyed by claiming age (62–70). Later ages read as darker,
 * with age 70 rendered in gold to signal the maximum-delay strategy.
 */
export const CLAIM_AGE_COLORS: Record<number, string> = {
  62: '#d4d4d4',
  63: '#c4c4c4',
  64: '#b4b4b4',
  65: '#9a9a9a',
  66: '#8a8a8a',
  67: '#6b6b6b',
  68: '#5c5c5c',
  69: '#4a4a4a',
  70: CHART_GOLD,
};
