import { describe, expect, it } from 'vitest';
import {
  clampToBounds,
  COLA_BOUNDS,
  DISCOUNT_BOUNDS_PERCENT,
  isBenefitInRange,
  isDiscountRateInBounds,
  isInBounds,
  LIFE_EXPECTANCY_BOUNDS,
  MAX_BENEFIT,
  MIN_BENEFIT,
} from './formBounds';

describe('benefit range', () => {
  it('spans $0 to $5,000 for either person', () => {
    expect([MIN_BENEFIT, MAX_BENEFIT]).toEqual([0, 5000]);
  });

  it('accepts a zero benefit — a person with no work record of their own', () => {
    expect(isBenefitInRange(0)).toBe(true);
  });

  it('accepts a genuine low-earner PIA that the old $500 floor rejected', () => {
    expect(isBenefitInRange(250)).toBe(true);
  });

  it('rejects a negative benefit and one above the ceiling', () => {
    expect(isBenefitInRange(-1)).toBe(false);
    expect(isBenefitInRange(5001)).toBe(false);
  });

  it('accepts both endpoints', () => {
    expect(isBenefitInRange(0)).toBe(true);
    expect(isBenefitInRange(5000)).toBe(true);
  });
});

describe('assumption bounds match the sliders in AssumptionsPanel', () => {
  // These are asserted rather than merely exported so that changing a slider
  // without changing the shared bound (or vice versa) fails here instead of
  // silently letting a URL carry a value the slider cannot represent.
  it('pins life expectancy to 75-100', () => {
    expect(LIFE_EXPECTANCY_BOUNDS).toEqual({ min: 75, max: 100 });
  });

  it('pins COLA to 0-8 and the discount rate to 0-6 percent', () => {
    expect(COLA_BOUNDS.min).toBe(0);
    expect(COLA_BOUNDS.max).toBe(8);
    expect(DISCOUNT_BOUNDS_PERCENT.min).toBe(0);
    expect(DISCOUNT_BOUNDS_PERCENT.max).toBe(6);
  });
});

describe('isDiscountRateInBounds takes a fraction, not a percent', () => {
  it('accepts the default 0.025, which is 2.5%', () => {
    expect(isDiscountRateInBounds(0.025)).toBe(true);
  });

  it('accepts both endpoints as fractions', () => {
    expect(isDiscountRateInBounds(0)).toBe(true);
    expect(isDiscountRateInBounds(0.06)).toBe(true);
  });

  // The trap: 5 as a fraction is 500%. A bound compared against the raw
  // fraction would wave this through, because 5 sits inside 0-6.
  it('rejects a percent-shaped value passed as a fraction', () => {
    expect(isDiscountRateInBounds(5)).toBe(false);
    expect(isDiscountRateInBounds(2.5)).toBe(false);
  });
});

describe('clampToBounds', () => {
  it('leaves an in-range value alone', () => {
    expect(clampToBounds(2.5, COLA_BOUNDS)).toBe(2.5);
  });

  it('pins a value above the ceiling to the ceiling', () => {
    // The exact case that leaked into a share link: a typed 12 became
    // `cola=12`, which the recipient's parser rejected and replaced.
    expect(clampToBounds(12, COLA_BOUNDS)).toBe(8);
    expect(clampToBounds(15, COLA_BOUNDS)).toBe(8);
  });

  it('pins a value below the floor to the floor', () => {
    expect(clampToBounds(-3, COLA_BOUNDS)).toBe(0);
  });

  it('keeps both endpoints', () => {
    expect(clampToBounds(0, COLA_BOUNDS)).toBe(0);
    expect(clampToBounds(8, COLA_BOUNDS)).toBe(8);
  });

  it('pins non-finite input to the floor rather than propagating NaN', () => {
    // An empty or half-typed number field parses to NaN.
    expect(clampToBounds(Number.NaN, COLA_BOUNDS)).toBe(0);
    expect(clampToBounds(Number.POSITIVE_INFINITY, COLA_BOUNDS)).toBe(0);
  });

  // Clamping is right for a field the user is looking at; it is wrong for a
  // URL, where the substitution happens on a machine nobody is watching.
  // `shareLink.ts` drops out-of-range values instead. Asserted here so the two
  // policies stay deliberately different rather than drifting together.
  it('always yields a value that isInBounds accepts', () => {
    for (const v of [-100, -0.1, 0, 2.5, 8, 8.1, 12, 1e9]) {
      expect(isInBounds(clampToBounds(v, COLA_BOUNDS), COLA_BOUNDS)).toBe(true);
    }
  });
});

describe('isInBounds', () => {
  it('is inclusive at both ends', () => {
    expect(isInBounds(75, LIFE_EXPECTANCY_BOUNDS)).toBe(true);
    expect(isInBounds(100, LIFE_EXPECTANCY_BOUNDS)).toBe(true);
    expect(isInBounds(74, LIFE_EXPECTANCY_BOUNDS)).toBe(false);
    expect(isInBounds(101, LIFE_EXPECTANCY_BOUNDS)).toBe(false);
  });

  it('rejects NaN rather than treating it as in range', () => {
    expect(isInBounds(Number.NaN, LIFE_EXPECTANCY_BOUNDS)).toBe(false);
  });
});
