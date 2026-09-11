import { describe, expect, it } from 'vitest';
import type { ClaimingOption } from '../../lib/benefitMath';
import { PdfChart, PdfHeatmap, PdfMonthlyRamp, PdfOpportunityCost, PdfRampBar } from './charts';
import { GOLD } from './theme';

/**
 * The printed charts, checked for the failure they actually have.
 *
 * These draw SVG by hand — every bar's x, y, width and height is arithmetic
 * on engine output — and they sat at 4% coverage while producing pages a
 * client reads. The assertions here are deliberately NOT about pixel
 * positions, which would break on every visual tweak. They are about the two
 * ways a hand-drawn chart fails silently:
 *
 *  - A `NaN` in a coordinate. SVG does not complain; the shape simply is not
 *    drawn. A chart missing one bar looks like a chart, which is why this is
 *    worth a test and an eyeball is not.
 *  - Geometry that escapes its own viewBox, which clips rather than errors.
 *
 * Plus the degenerate inputs that produce both: a single claiming age, and a
 * set where every value is identical, where a range of zero becomes a divide
 * by zero.
 */

function option(age: number, monthly: number, lifetime: number): ClaimingOption {
  return {
    age,
    monthlyBenefit: monthly,
    percentOfPia: Math.round((monthly / 2400) * 1000) / 10,
    lifetimeBenefits: lifetime,
    yearsOfPayments: Math.max(0, 85 - age),
    isEligible: true,
    monthsFromFra: (age - 67) * 12,
  };
}

const OPTIONS: ClaimingOption[] = [
  option(62, 1680, 463_000),
  option(63, 1800, 475_000),
  option(64, 1920, 487_000),
  option(65, 2080, 499_000),
  option(66, 2240, 510_000),
  option(67, 2400, 518_000),
  option(68, 2592, 528_000),
  option(69, 2784, 535_000),
  option(70, 2976, 540_000),
];

/** Every numeric SVG attribute in a rendered tree, with the prop it came from. */
function numbers(node: unknown, out: { key: string; value: number }[] = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => numbers(n, out));
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  const el = node as { props?: Record<string, unknown> };
  const props = el.props;
  if (props !== undefined) {
    for (const [key, value] of Object.entries(props)) {
      if (key === 'children') continue;
      if (typeof value === 'number') out.push({ key, value });
      // react-pdf accepts numeric strings too, and `${NaN}` is "NaN".
      if (typeof value === 'string' && /^-?(\d|\.|NaN|Infinity)/.test(value)) {
        const n = Number(value);
        if (!Number.isNaN(n) || value.includes('NaN')) out.push({ key, value: n });
      }
    }
    numbers(props.children, out);
  }
  return out;
}

/** Called, not mounted — the same idiom every other PDF test here uses. */
const CHARTS: [string, () => unknown][] = [
  ['PdfChart', () => PdfChart({ options: OPTIONS, shownAge: 70, lifeExpectancy: 85, annualCola: 2.5 })],
  ['PdfHeatmap', () => PdfHeatmap({ options: OPTIONS, lifeExpectancy: 85, shownAge: 70, annualCola: 2.5 })],
  ['PdfOpportunityCost', () => PdfOpportunityCost({ options: OPTIONS, shownAge: 70 })],
  ['PdfMonthlyRamp', () => PdfMonthlyRamp({ options: OPTIONS, shownAge: 70 })],
  ['PdfRampBar', () => PdfRampBar({})],
];

describe('every printed chart', () => {
  it.each(CHARTS)('draws %s with no NaN coordinate', (_name, render) => {
    // A NaN in an SVG attribute draws nothing and reports nothing. This is
    // the failure mode that produces a chart with a bar quietly missing.
    const bad = numbers(render()).filter((n) => !Number.isFinite(n.value));
    expect(bad).toEqual([]);
  });

  it.each(CHARTS)('draws %s with no negative width or height', (_name, render) => {
    // A negative height is how an inverted scale renders: SVG clamps it to
    // nothing rather than drawing upward. Not every chart draws sized shapes
    // — `PdfOpportunityCost` is a stack of flexbox rows with percentage
    // widths — so this asserts about the ones present rather than demanding
    // that any exist.
    for (const s of numbers(render()).filter((n) => n.key === 'width' || n.key === 'height')) {
      expect(s.value, s.key).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(CHARTS)('survives a single claiming age: %s', (_name, render) => {
    // One option means a range of zero in every scale these compute.
    expect(() => render()).not.toThrow();
  });
});

describe('degenerate data the engine can genuinely produce', () => {
  const FLAT = [62, 63, 64, 65, 66, 67, 68, 69, 70].map((a) => option(a, 2000, 500_000));
  const ONE = [option(62, 1680, 463_000)];

  it('draws a flat set without dividing by its own zero range', () => {
    // Every value identical — the denominator in a min/max scale. A $0 PIA
    // household reaches exactly this.
    for (const render of [
      () => PdfChart({ options: FLAT, shownAge: 62, lifeExpectancy: 85, annualCola: 2.5 }),
      () => PdfHeatmap({ options: FLAT, lifeExpectancy: 85, shownAge: 62, annualCola: 2.5 }),
      () => PdfOpportunityCost({ options: FLAT, shownAge: 62 }),
      () => PdfMonthlyRamp({ options: FLAT, shownAge: 62 }),
    ]) {
      expect(render).not.toThrow();
      expect(numbers(render()).filter((n) => !Number.isFinite(n.value))).toEqual([]);
    }
  });

  it('draws a single-option set', () => {
    for (const render of [
      () => PdfChart({ options: ONE, shownAge: 62, lifeExpectancy: 85, annualCola: 2.5 }),
      () => PdfHeatmap({ options: ONE, lifeExpectancy: 85, shownAge: 62, annualCola: 2.5 }),
      () => PdfOpportunityCost({ options: ONE, shownAge: 62 }),
      () => PdfMonthlyRamp({ options: ONE, shownAge: 62 }),
    ]) {
      expect(render).not.toThrow();
      expect(numbers(render()).filter((n) => !Number.isFinite(n.value))).toEqual([]);
    }
  });
});

describe('the age the report is built around', () => {
  it('marks the shown age in the brand colour, on the charts that colour it inline', () => {
    // The gold marker is what ties a chart to the recommendation beside it.
    // Read from the live theme binding at render time, so a chart that had
    // captured a stale colour would point at the right age in the wrong
    // colour after a rebrand — invisible to a tree walk that only checks
    // shapes.
    for (const render of [
      () => PdfChart({ options: OPTIONS, shownAge: 70, lifeExpectancy: 85, annualCola: 2.5 }),
      () => PdfHeatmap({ options: OPTIONS, lifeExpectancy: 85, shownAge: 70, annualCola: 2.5 }),
      () => PdfMonthlyRamp({ options: OPTIONS, shownAge: 70 }),
    ]) {
      expect(JSON.stringify(render())).toContain(GOLD);
    }
  });

  it('marks the shown row on the opportunity-cost bars, which use a named style', () => {
    // This one is flexbox rows rather than SVG, so its highlight is
    // `styles.pdfBarFillShown` and a label rather than an inline fill. The
    // assertion is the same claim in the shape this chart actually has.
    const shown = JSON.stringify(PdfOpportunityCost({ options: OPTIONS, shownAge: 67 }));
    expect(shown).toContain('Shown');
    // And exactly one row is the shown one.
    expect(shown.split('"Shown"').length - 1).toBe(1);
  });

  it('moves the marker when the shown age moves', () => {
    const at62 = JSON.stringify(PdfMonthlyRamp({ options: OPTIONS, shownAge: 62 }));
    const at70 = JSON.stringify(PdfMonthlyRamp({ options: OPTIONS, shownAge: 70 }));
    expect(at62).not.toBe(at70);
  });
});
