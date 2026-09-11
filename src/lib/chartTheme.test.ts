import { describe, expect, it } from 'vitest';
import {
  CHART_GOLD,
  CHART_PLUM,
  CHART_SAGE,
  CHART_SLATE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_SEPARATOR,
  CHART_TOOLTIP_STYLE,
  seriesColor,
} from './chartTheme';

/** The two grounds a series color is drawn on. */
const CREAM = '#f7f4ee'; // --bg, light
const DARK = '#0d0d0d'; // --bg, dark
/** The tooltip is near-black in BOTH themes — it does not flip. */
const TOOLTIP = '#141414';

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * This module states exact contrast ratios in its own comments — "3.4:1 on
 * white, 5.1:1 on the dark canvas", "the old #b8965a scored 2.78:1" — and
 * nothing enforced them. This repo has shipped invisible chart marks three
 * times by pairing a token with a ground it does not flip against, so those
 * claims are checked here rather than trusted.
 *
 * Only the CONCRETE hexes can be checked: the chrome tokens are `var()`
 * references resolved by the browser, and the e2e suite measures those in a
 * real page. These are the ones shared with the PDF, which cannot resolve a
 * custom property and therefore gets one value on two very different grounds.
 */
describe('chart series colors', () => {
  const SERIES = {
    CHART_GOLD,
    CHART_PLUM,
    CHART_SAGE,
    CHART_SLATE,
  };

  it('clears 3:1 against both the light and the dark canvas', () => {
    // 3:1 is the threshold for a graphical mark, and it has to hold on BOTH
    // because the same hex is drawn on the cream report page and the dark
    // app background — that is the whole reason these are not `var()`.
    //
    // CHART_SAGE failed this when the test was written — #7d9b76 scored
    // 2.80:1 on cream while reading perfectly well on the dark canvas, which
    // is exactly how a print-only contrast miss survives. It was darkened to
    // #76936f rather than excused.
    for (const [name, color] of Object.entries(SERIES)) {
      expect(contrast(color, CREAM), `${name} on the light canvas`).toBeGreaterThanOrEqual(3);
      expect(contrast(color, DARK), `${name} on the dark canvas`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the sage above the value it was darkened from', () => {
    // The old #7d9b76 is pinned as a failing reference, so a revert to it
    // fails here rather than passing quietly.
    expect(contrast(CHART_SAGE, CREAM)).toBeGreaterThanOrEqual(3);
    expect(contrast('#7d9b76', CREAM)).toBeLessThan(3);
  });

  it('keeps the gold above the threshold the old value failed', () => {
    // #b8965a scored 2.78:1 on white and was replaced for it. A change that
    // drifted back under would be invisible to every other test here.
    expect(contrast(CHART_GOLD, CREAM)).toBeGreaterThan(3);
    expect(contrast('#b8965a', CREAM)).toBeLessThan(3);
  });

  it('gives every series a distinguishable color', () => {
    // At most four series are ever drawn at once, and two that matched would
    // merge a spouse's band into a survivor's without anything looking broken.
    const values = Object.values(SERIES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('assigns a band its own color, per person', () => {
    expect(seriesColor(0, 'spousal')).toBe(CHART_SAGE);
    expect(seriesColor(1, 'spousal')).toBe(CHART_SAGE);
    expect(seriesColor(0, 'survivor')).toBe(CHART_SLATE);
    // Each person's OWN record keeps their identity color, and the two
    // people must not share one.
    expect(seriesColor(0, 'personal')).not.toBe(seriesColor(1, 'personal'));
  });

  it('wraps rather than returning undefined for a third person', () => {
    // There is no third claimant today, but an index past the end would
    // return undefined and Recharts would draw the series in black.
    expect(typeof seriesColor(2, 'personal')).toBe('string');
    expect(seriesColor(2, 'personal')).not.toBe('');
  });

  it('gives the PDF a resolvable colour for the two people it can have', () => {
    // `seriesColor` is shared with the PDF, which cannot resolve `var()` —
    // that is the stated reason these are concrete hexes. The third slot is
    // `CHART_GRAY_MID`, which IS a custom property, so a third claimant
    // would reach the PDF as the literal string "var(--chart-gray-mid)".
    // Unreachable today (the app models at most two people) and pinned here
    // so that adding a third is a deliberate act with this in view.
    for (const index of [0, 1]) {
      expect(seriesColor(index, 'personal')).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(seriesColor(2, 'personal')).toMatch(/^var\(/);
  });
});

describe('the shared tooltip', () => {
  it('keeps its text readable on its own near-black ground', () => {
    // The tooltip does not flip with the theme, so its text is checked
    // against one ground — at the 4.5:1 body-text threshold, not 3:1.
    expect(contrast(CHART_TOOLTIP_ITEM_STYLE.color, TOOLTIP)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(CHART_TOOLTIP_LABEL_STYLE.color, TOOLTIP)).toBeGreaterThanOrEqual(4.5);
  });

  it('shows every series color legibly inside the tooltip too', () => {
    // A series color is repeated as the tooltip row's marker. `CHART_PLUM`
    // was chosen after a previous value scored 1.6:1 here while reading
    // perfectly well on the chart itself.
    for (const [name, color] of Object.entries({ CHART_GOLD, CHART_PLUM, CHART_SAGE, CHART_SLATE })) {
      expect(contrast(color, TOOLTIP), `${name} inside the tooltip`).toBeGreaterThanOrEqual(3);
    }
  });

  it('joins a row without the space Recharts puts before the colon', () => {
    expect(CHART_TOOLTIP_SEPARATOR).toBe(': ');
    expect(CHART_TOOLTIP_SEPARATOR).not.toMatch(/^\s/);
  });

  it('is opaque enough to read a chart through', () => {
    expect(CHART_TOOLTIP_STYLE.background).toMatch(/0\.9/);
  });
});
