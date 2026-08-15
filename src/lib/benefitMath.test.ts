import { describe, expect, it } from 'vitest';
import {
  breakEvenAge,
  computeBreakEvens,
  cumulativeBenefits,
  generateCumulativeChartData,
  MAX_CLAIM_AGE,
  MIN_CLAIM_AGE,
  type ClaimingOption,
} from './benefitMath';

const options: ClaimingOption[] = [62, 67, 70].map((age) => ({
  age,
  monthlyBenefit: age === 62 ? 1750 : age === 67 ? 2500 : 3100,
  percentOfPia: 0,
  lifetimeBenefits: 0,
  yearsOfPayments: 0,
  isEligible: true,
  monthsFromFra: 0,
}));

describe('claim age window', () => {
  it('spans 62 to 70', () => {
    expect([MIN_CLAIM_AGE, MAX_CLAIM_AGE]).toEqual([62, 70]);
  });
});

describe('cumulativeBenefits', () => {
  it('sums flat payments with no COLA', () => {
    expect(cumulativeBenefits(1000, 62, 62)).toBe(0);
    expect(cumulativeBenefits(1000, 62, 64)).toBe(24_000);
  });

  it('compounds annually when a COLA is supplied', () => {
    expect(cumulativeBenefits(1000, 62, 64, 10)).toBeCloseTo(25_200, 2);
  });

  it('never returns a negative total for an age before the claim age', () => {
    expect(cumulativeBenefits(1000, 67, 62)).toBe(0);
  });
});

describe('breakEvenAge', () => {
  it('returns null when the later benefit never overtakes without COLA', () => {
    expect(breakEvenAge(62, 2000, 70, 1500, 0)).toBeNull();
  });

  it('finds the crossover for a higher, later benefit', () => {
    const be = breakEvenAge(62, 1750, 70, 3100, 0);
    expect(be).toBeGreaterThan(79);
    expect(be).toBeLessThan(82);
  });
});

describe('computeBreakEvens', () => {
  it('produces an entry for each canonical pair', () => {
    const pairs = computeBreakEvens(options, 0).map((r) => `${r.earlierAge}-${r.laterAge}`);
    expect(pairs).toEqual(['62-67', '62-70', '67-70']);
  });

  it('is pure, so it is safe to recompute whenever COLA changes', () => {
    expect(computeBreakEvens(options, 2.5)).toEqual(computeBreakEvens(options, 2.5));
  });
});

describe('generateCumulativeChartData', () => {
  it('omits a series before its claim age and includes it after', () => {
    const data = generateCumulativeChartData(options, 70, 0);
    expect(data.find((d) => d.age === 62)!.age67).toBeUndefined();
    expect(data.find((d) => d.age === 70)!.age67).toBeGreaterThan(0);
  });
});
