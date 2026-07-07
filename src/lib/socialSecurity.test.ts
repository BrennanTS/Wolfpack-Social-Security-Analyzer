import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  analyzeClaiming,
  breakEvenAge,
  computeBreakEvens,
  cumulativeBenefits,
  formatCurrency,
  formatCurrencyPrecise,
  getCurrentAge,
  getFullRetirementAge,
  type ClaimingOption,
  type UserInputs,
} from './socialSecurity';

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public',
);

describe('getFullRetirementAge', () => {
  it('matches the SSA schedule', () => {
    expect(getFullRetirementAge(1954)).toMatchObject({ years: 66, months: 0 });
    expect(getFullRetirementAge(1957)).toMatchObject({ years: 66, months: 6 });
    expect(getFullRetirementAge(1960)).toMatchObject({ years: 67, months: 0 });
  });
});

describe('getCurrentAge', () => {
  it('computes whole years and months as of a fixed date', () => {
    const asOf = new Date(2026, 5, 15); // Jun 2026 (month is 0-indexed)
    expect(getCurrentAge(1960, 6, asOf)).toEqual({ years: 66, months: 0 });
    expect(getCurrentAge(1960, 1, asOf)).toEqual({ years: 66, months: 5 });
  });

  it('never returns negative values for future-dated births', () => {
    const asOf = new Date(2026, 0, 1);
    expect(getCurrentAge(2030, 1, asOf)).toEqual({ years: 0, months: 0 });
  });
});

describe('cumulativeBenefits', () => {
  it('sums flat payments with no COLA', () => {
    expect(cumulativeBenefits(1000, 62, 62)).toBe(0);
    expect(cumulativeBenefits(1000, 62, 63)).toBe(12_000);
    expect(cumulativeBenefits(1000, 62, 64)).toBe(24_000);
  });

  it('compounds annually when a COLA is supplied', () => {
    // Year 0: 12,000; Year 1: 12,000 * 1.10 = 13,200 → 25,200 total.
    expect(cumulativeBenefits(1000, 62, 64, 10)).toBeCloseTo(25_200, 2);
  });
});

describe('breakEvenAge', () => {
  it('returns null when the later benefit never overtakes and there is no COLA', () => {
    expect(breakEvenAge(62, 2000, 70, 1500, 0)).toBeNull();
  });

  it('finds the crossover age for a higher, later benefit', () => {
    // 62@1750 vs 70@3100 (no COLA) crosses near age 80.4.
    const be = breakEvenAge(62, 1750, 70, 3100, 0);
    expect(be).not.toBeNull();
    expect(be!).toBeGreaterThan(79);
    expect(be!).toBeLessThan(82);
  });
});

describe('computeBreakEvens', () => {
  const options: ClaimingOption[] = [62, 67, 70].map((age) => ({
    age,
    monthlyBenefit: age === 62 ? 1750 : age === 67 ? 2500 : 3100,
    percentOfPia: 0,
    lifetimeBenefits: 0,
    yearsOfPayments: 0,
    isEligible: true,
    monthsFromFra: 0,
  }));

  it('produces a break-even entry for each canonical pair', () => {
    const results = computeBreakEvens(options, 0);
    const pairs = results.map((r) => `${r.earlierAge}-${r.laterAge}`);
    expect(pairs).toEqual(['62-67', '62-70', '67-70']);
    results.forEach((r) => expect(r.breakEvenAge).toBeGreaterThan(r.laterAge));
  });

  it('is a pure function of its inputs (safe to recompute on COLA change)', () => {
    expect(computeBreakEvens(options, 2.5)).toEqual(computeBreakEvens(options, 2.5));
  });
});

describe('formatting helpers', () => {
  it('formats whole-dollar and precise currency', () => {
    expect(formatCurrency(2816.4)).toBe('$2,816');
    expect(formatCurrency(1750)).toBe('$1,750');
    expect(formatCurrencyPrecise(1750.5)).toBe('$1,750.50');
  });
});

describe('analyzeClaiming (full ssa.tools pipeline)', () => {
  // Serve the real life-table JSON from public/ so the async mortality path runs
  // exactly as it does in the browser after the on-demand fetch change.
  beforeAll(() => {
    vi.stubGlobal('fetch', async (url: string) => {
      const relative = String(url).replace(/^\//, '');
      const file = path.join(publicDir, relative);
      const contents = await readFile(file, 'utf8');
      return {
        ok: true,
        json: async () => JSON.parse(contents),
      } as Response;
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const baseInputs: UserInputs = {
    birthYear: 1960,
    birthMonth: 6,
    monthlyBenefitAtFra: 2500,
    lifeExpectancy: 85,
    annualCola: 2.5,
    gender: 'female',
    hasSpouse: false,
    discountRate: 0.025,
  };

  it('returns populated, sane results for a single claimant', async () => {
    const result = await analyzeClaiming(baseInputs);

    expect(result.fra).toMatchObject({ years: 67, months: 0 });
    expect(result.claimingOptions).toHaveLength(9); // ages 62–70
    expect(result.optimalAge).toBeGreaterThanOrEqual(62);
    expect(result.optimalAge).toBeLessThanOrEqual(70);
    expect(result.optimalMonthly).toBeGreaterThan(0);
    expect(result.expectedPresentValue).toBeGreaterThan(0);

    const age62 = result.claimingOptions.find((o) => o.age === 62)!;
    const age70 = result.claimingOptions.find((o) => o.age === 70)!;
    expect(age62.monthlyBenefit).toBeCloseTo(1750, 0);
    expect(age70.monthlyBenefit).toBeCloseTo(3100, 0);
    expect(age70.monthlyBenefit).toBeGreaterThan(age62.monthlyBenefit);
  });

  it('models spousal benefits when married', async () => {
    const result = await analyzeClaiming({
      ...baseInputs,
      hasSpouse: true,
      spouseBirthYear: 1962,
      spouseBirthMonth: 3,
      spouseMonthlyBenefitAtFra: 0,
    });

    expect(result.spousal).toBeDefined();
    expect(result.spousal!.spousalBenefitAtFra).toBeCloseTo(1250, 0);
    expect(result.spousal!.spouseFilingAge).toBeDefined();
  });
});
