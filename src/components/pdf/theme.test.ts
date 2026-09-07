import { describe, expect, it } from 'vitest';
import { COL, CONTENT_W, styles } from './theme';

/**
 * Column widths, checked by arithmetic.
 *
 * A column that is too narrow does not fail: react-pdf prints the overflow on
 * top of the next column, which no assertion about the element tree can see —
 * the tree is correct, the page is not. The badge row ran "ALONE" into the
 * monthly figure for months on exactly that basis.
 *
 * So the widths are checked against the text they have to hold, using the
 * font's own metrics.
 */

/**
 * Helvetica-Bold advance widths, per 1000 units, for the characters the age
 * cell can contain. From the standard-14 AFM tables, which is what react-pdf
 * lays these out with.
 */
const HELVETICA_BOLD: Record<string, number> = {
  A: 722, E: 667, G: 778, H: 722, L: 611, N: 722, O: 778, P: 667,
  R: 722, S: 667, T: 611, U: 722, W: 944,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556,
  '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
};

function textWidth(text: string, fontSize: number): number {
  return (
    [...text].reduce((sum, char) => sum + (HELVETICA_BOLD[char] ?? 600), 0) / 1000
  ) * fontSize;
}

/** A badge's full footprint: its text, its padding, and the gap before it. */
function badgeWidth(label: string): number {
  const { fontSize, paddingHorizontal, marginLeft } = styles.badge as {
    fontSize: number;
    paddingHorizontal: number;
    marginLeft: number;
  };
  return textWidth(label, fontSize) + paddingHorizontal * 2 + marginLeft;
}

/** Every pair of badges that can land on one row. */
const PAIRS: [string, string][] = [
  ['TOGETHER', 'ALONE'],
  ['TOGETHER', 'SHOWN'],
  ['ALONE', 'SHOWN'],
  ['OPT', 'SHOWN'],
];

describe('person table columns', () => {
  it('sum to the content width, so no column is squeezed by the others', () => {
    const total = COL.age + COL.monthly + COL.pia + COL.life + COL.diff;
    expect(total).toBe(CONTENT_W);
  });

  it('give the age cell room for its widest badge pair', () => {
    // "70" is the widest age; a two-digit age plus two badges is the worst
    // real row. At 80pt this was 5pt short and printed ALONE over the
    // monthly figure in the next column.
    const age = textWidth('70', (styles.tdBold as { fontSize: number }).fontSize);
    for (const [first, second] of PAIRS) {
      const needed = age + badgeWidth(first) + badgeWidth(second);
      expect(needed, `"${first}" beside "${second}"`).toBeLessThanOrEqual(COL.age);
    }
  });

  it('keeps a visible gap between two badges', () => {
    // Butted together they read as one long tag, and "TOGETHER ALONE" is
    // exactly the pair this column is sized for.
    const { marginLeft } = styles.badge as { marginLeft: number };
    expect(marginLeft).toBeGreaterThanOrEqual(5);
  });

  it('leaves the widest figure room in every other column', () => {
    const fontSize = (styles.td as { fontSize: number }).fontSize;
    const widest: [keyof typeof COL, string][] = [
      ['monthly', '$2,480.00'],
      ['pia', '86.7%'],
      ['life', '$746,480'],
      ['diff', '-$190,680'],
    ];
    for (const [column, sample] of widest) {
      expect(textWidth(sample, fontSize), `${column} holding "${sample}"`).toBeLessThan(
        COL[column],
      );
    }
  });
});
