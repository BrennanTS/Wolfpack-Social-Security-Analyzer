import { describe, expect, it } from 'vitest';
import { DEFAULT_REPORT_THEME_ID, REPORT_THEMES, reportTheme } from './reportTheme';

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const channels = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The report is printed on white. Every ratio below is measured against it. */
const PAPER = '#ffffff';

describe('report themes', () => {
  it('offers a stable set with a default that exists', () => {
    expect(REPORT_THEMES.length).toBeGreaterThanOrEqual(3);
    expect(REPORT_THEMES.map((t) => t.id)).toContain(DEFAULT_REPORT_THEME_ID);
    expect(new Set(REPORT_THEMES.map((t) => t.id)).size).toBe(REPORT_THEMES.length);
  });

  it('falls back to the house palette rather than rendering an undefined theme', () => {
    // The id arrives from localStorage and from a share link, so it is
    // attacker-adjacent input as far as this function is concerned: it can be
    // anything at all, and a `undefined.ink` would take the export down.
    expect(reportTheme('no-such-theme').id).toBe(DEFAULT_REPORT_THEME_ID);
    expect(reportTheme(null).id).toBe(DEFAULT_REPORT_THEME_ID);
    expect(reportTheme(undefined).id).toBe(DEFAULT_REPORT_THEME_ID);
  });

  for (const theme of REPORT_THEMES) {
    describe(theme.name, () => {
      it('prints body and heading text at 4.5:1 or better on paper', () => {
        // The whole point of a theme picker is that someone will pick one. A
        // preset that reads well in the picker and fails on the page is worse
        // than no picker at all, so this is checked for every preset rather
        // than for the one that happens to be default.
        expect(contrast(theme.ink, PAPER)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.muted, PAPER)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.brand, PAPER)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.brandDark, PAPER)).toBeGreaterThanOrEqual(4.5);
      });

      it('prints gain and loss figures at 4.5:1 or better', () => {
        // These carry the "$53,620 more than…" line, which is a number the
        // client is meant to read, not a decorative tint.
        expect(contrast(theme.green, PAPER)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.red, PAPER)).toBeGreaterThanOrEqual(4.5);
      });

      it('keeps tertiary text and hairlines legible without shouting', () => {
        // 3:1 rather than 4.5: column headers are short, all-caps and
        // redundant with the data beneath them.
        expect(contrast(theme.subtle, PAPER)).toBeGreaterThanOrEqual(3);
        // A border that clears 4.5:1 is a rule, not a hairline — the report
        // would read as a spreadsheet.
        expect(contrast(theme.border, PAPER)).toBeLessThan(2);
      });

      it('has a heat ramp that separates its ends and takes dark text', () => {
        const lo = contrast(theme.heatLo, PAPER);
        const hi = contrast(theme.heatHi, PAPER);
        // Ordered, and far enough apart that a mid cell is visibly mid.
        expect(hi).toBeGreaterThan(lo);
        expect(hi / lo).toBeGreaterThanOrEqual(1.5);
        // Every cell prints its own figure in ink, including the hottest.
        expect(contrast(theme.ink, theme.heatHi)).toBeGreaterThanOrEqual(4.5);
      });

      it('names itself for the picker', () => {
        expect(theme.name.length).toBeGreaterThan(0);
        expect(theme.blurb.length).toBeGreaterThan(0);
      });
    });
  }
});
