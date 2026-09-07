import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISCLOSURE,
  DEFAULT_REPORT_THEME_ID,
  MAX_DISCLOSURE_CHARS,
  MAX_LOGO_CHARS,
  disclosureHasPlaceholder,
  REPORT_THEMES,
  THEME_COLORS,
  parseTheme,
  parseThemeFile,
  reportTheme,
  serializeTheme,
  themeColorWarning,
} from './reportTheme';
import { BRAND_NAME } from './brand';

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


describe('branding', () => {
  it('gives every preset the house firm to start from', () => {
    // A theme is a whole identity now, so a preset with no firm would print a
    // cover that says "Prepared by" and then nothing.
    for (const theme of REPORT_THEMES) expect(theme.firm).toBe(BRAND_NAME);
  });

  it('names every color the editor offers, and offers every color a theme has', () => {
    // A color added to the theme and forgotten in `THEME_COLORS` would be
    // uneditable; one listed but absent would render an empty well.
    const house = reportTheme(DEFAULT_REPORT_THEME_ID) as unknown as Record<string, unknown>;
    for (const field of THEME_COLORS) expect(typeof house[field.key]).toBe('string');
    const listed = new Set(THEME_COLORS.map((f) => f.key));
    const colorish = Object.entries(house)
      .filter(([, v]) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v as string))
      .map(([k]) => k);
    for (const key of colorish) expect(listed).toContain(key);
  });
});

describe('contrast warnings', () => {
  const field = (key: string) => THEME_COLORS.find((f) => f.key === key)!;

  it('says nothing about a preset color', () => {
    const house = reportTheme(DEFAULT_REPORT_THEME_ID);
    for (const f of THEME_COLORS) {
      expect(themeColorWarning(f, house[f.key])).toBeNull();
    }
  });

  it('warns about text that will print faint, with the ratio in it', () => {
    const warning = themeColorWarning(field('muted'), '#cccccc');
    expect(warning).toMatch(/1\.6:1/);
    expect(warning).toMatch(/4\.5:1/);
  });

  it('says nothing about a border or a heat ramp, which are meant to be pale', () => {
    // Holding these to a text floor would warn about the two colors that are
    // correct, which teaches an adviser to ignore the warnings.
    expect(themeColorWarning(field('border'), '#f4f4f4')).toBeNull();
    expect(themeColorWarning(field('heatLo'), '#fafafa')).toBeNull();
  });
});

describe('parseTheme repairs rather than trusts', () => {
  const house = reportTheme(DEFAULT_REPORT_THEME_ID);

  it('survives export and import unchanged', () => {
    expect(parseThemeFile(serializeTheme(house))).toEqual(house);
  });

  it('returns null for things that are not themes at all', () => {
    for (const junk of [null, undefined, 42, 'theme', {}, [], { items: [] }]) {
      expect(parseTheme(junk)).toBeNull();
    }
  });

  it('falls back to the house color for one that is missing or malformed', () => {
    const theme = parseTheme({ name: 'Half written', ink: 'rebeccapurple', brand: '#1f4e79' });
    expect(theme?.ink).toBe(house.ink);
    expect(theme?.brand).toBe('#1f4e79');
  });

  it('expands a three-digit hex, so everything downstream sees one shape', () => {
    expect(parseTheme({ name: 'Short', ink: '#ABC' })?.ink).toBe('#aabbcc');
  });

  it('supplies the house firm when a file carries none', () => {
    expect(parseTheme({ name: 'No firm', ink: '#111111' })?.firm).toBe(BRAND_NAME);
  });

  it('drops an empty adviser line rather than printing a blank one', () => {
    expect(parseTheme({ name: 'x', ink: '#111111', adviser: '   ' })?.adviser).toBeUndefined();
  });

  it('accepts an embedded logo and refuses a linked one', () => {
    // A remote URL would make the cover depend on someone else's server while
    // a client watches, and `javascript:` has no business in an image source.
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    expect(parseTheme({ name: 'x', ink: '#111111', logo: data })?.logo).toBe(data);
    for (const bad of [
      'https://example.com/logo.png',
      'javascript:alert(1)',
      'data:text/html;base64,PHN2Zz4=',
      42,
    ]) {
      expect(parseTheme({ name: 'x', ink: '#111111', logo: bad })?.logo).toBeUndefined();
    }
  });

  it('refuses a logo too large to store', () => {
    // Every theme is written to storage on every change and carried in an
    // exported file; one unbounded logo would take the layouts with it.
    const huge = `data:image/png;base64,${'A'.repeat(MAX_LOGO_CHARS)}`;
    expect(parseTheme({ name: 'x', ink: '#111111', logo: huge })?.logo).toBeUndefined();
  });

  it('caps a pathological name rather than letting it into the picker', () => {
    expect(parseTheme({ name: 'x'.repeat(500), ink: '#111111' })?.name.length).toBeLessThanOrEqual(60);
  });

  it('does not throw on malformed json', () => {
    expect(parseThemeFile('{not json')).toBeNull();
    expect(parseThemeFile('')).toBeNull();
  });
});


describe('disclosures', () => {
  it('start every preset from the standard wording', () => {
    for (const theme of REPORT_THEMES) expect(theme.disclosure).toBe(DEFAULT_DISCLOSURE);
  });

  it('say the things a compliance review asks a claiming analysis to say', () => {
    // Each of these is one paragraph of the default. A firm may rewrite
    // them; the default must not quietly lose one.
    const text = DEFAULT_DISCLOSURE;
    expect(text).toMatch(/not a recommendation to buy or sell/i);
    expect(text).toMatch(/not legal, tax, or accounting advice/i);
    expect(text).toMatch(/determined by the Social Security Administration when you apply/i);
    expect(text).toMatch(/not affiliated with, endorsed by, or approved by the Social Security Administration/i);
    expect(text).toMatch(/set by law and can change/i);
    expect(text).toMatch(/prepared for the people named on the cover/i);
  });

  it('carry a bracketed placeholder for the firm’s regulatory line, and know it', () => {
    // The one sentence the app cannot write is the one that names the firm's
    // registration. It is left in brackets on purpose, and the editor warns
    // while the brackets remain.
    expect(disclosureHasPlaceholder(DEFAULT_DISCLOSURE)).toBe(true);
    expect(disclosureHasPlaceholder('Advisory services are offered through Northgate, an RIA.')).toBe(false);
  });

  it('use no em dash, which is the one mark a reader reads as machine-written', () => {
    expect(DEFAULT_DISCLOSURE).not.toContain('—');
  });

  it('survive export and import, and fall back to the standard wording when absent', () => {
    const house = reportTheme(DEFAULT_REPORT_THEME_ID);
    const custom = { ...house, disclosure: 'Our own wording.' };
    expect(parseThemeFile(serializeTheme(custom))?.disclosure).toBe('Our own wording.');
    expect(parseTheme({ name: 'x', ink: '#111111' })?.disclosure).toBe(DEFAULT_DISCLOSURE);
  });

  it('cap a disclosure at a page’s worth rather than letting a file fill storage', () => {
    const parsed = parseTheme({ name: 'x', ink: '#111111', disclosure: 'x'.repeat(50_000) });
    expect(parsed?.disclosure.length).toBeLessThanOrEqual(MAX_DISCLOSURE_CHARS);
  });
});
