import { describe, expect, it } from 'vitest';
import * as methodologyCopy from '../components/methodologyCopy';
import * as widowedCopy from '../components/widowedCopy';
import { DEFAULT_DISCLOSURE, REPORT_THEMES } from './reportTheme';
import { unprintableInPdf } from './pdfSafeText';

/** Every string a module can produce, functions called with plausible samples. */
function stringsOf(mod: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const value of Object.values(mod)) {
    if (typeof value === 'string') out.push(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') out.push(item);
        if (item !== null && typeof item === 'object') {
          for (const v of Object.values(item as Record<string, unknown>)) {
            if (typeof v === 'string') out.push(v);
          }
        }
      }
    }
  }
  return out.filter((s) => s.length > 0);
}

describe('what the printed report is allowed to contain', () => {
  it('rejects a character the standard-14 fonts cannot print', () => {
    // The defect this exists for: the arrow printed as a stray apostrophe
    // and ate the space after it, on every person page, for months.
    expect(unprintableInPdf('Age 62 → Age 67')).toEqual(['→']);
    expect(unprintableInPdf('✓ done')).toEqual(['✓']);
    expect(unprintableInPdf('café — naïve')).toEqual([]);
  });

  it('reports each offender once, in the order found', () => {
    // A list, not a boolean: the message has to name what to replace.
    expect(unprintableInPdf('→ a ✓ b →')).toEqual(['→', '✓']);
  });

  it('allows the typography this copy actually uses', () => {
    // Latin-1 wholesale, plus the short list of typographic characters the
    // report genuinely carries. An allowlist rather than a WinAnsi table, so
    // adding one is a deliberate act.
    expect(unprintableInPdf('‘ ’ “ ” – — … •')).toEqual([]);
  });

  it('passes plain text and the empty string', () => {
    expect(unprintableInPdf('')).toEqual([]);
    expect(unprintableInPdf('Social Security')).toEqual([]);
  });
});

/**
 * The guard applied to every other module whose strings reach a page.
 *
 * `reportCopy` has its own version of this beside its other copy rules; these
 * are the modules that feed the same document from elsewhere — the
 * methodology appendix, the widowed sections, and the firm disclosures that
 * ship with each theme.
 */
describe('every module that prints into the report', () => {
  it.each([
    ['methodologyCopy', stringsOf(methodologyCopy as unknown as Record<string, unknown>)],
    ['widowedCopy', stringsOf(widowedCopy as unknown as Record<string, unknown>)],
    ['the default disclosure', [DEFAULT_DISCLOSURE]],
    ['the shipped themes', REPORT_THEMES.flatMap((t) => [t.firm, t.adviser ?? '', t.disclosure])],
  ])('prints cleanly: %s', (_name, lines) => {
    for (const line of lines) {
      expect(unprintableInPdf(line), JSON.stringify(line.slice(0, 120))).toEqual([]);
    }
  });
});
