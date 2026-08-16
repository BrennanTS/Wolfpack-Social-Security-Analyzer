import { describe, expect, it } from 'vitest';
import {
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
