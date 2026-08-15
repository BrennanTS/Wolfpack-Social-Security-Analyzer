import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeClaiming, type UserInputs } from './socialSecurity';

/**
 * `socialSecurity.ts` is a compatibility module now: everything it merely
 * re-exports (format helpers, benefitMath, personAnalysis) is covered by
 * format.test.ts, benefitMath.test.ts and personAnalysis.test.ts. This file
 * only covers what's still genuinely implemented here — the legacy
 * `analyzeClaiming` single-person pipeline, which has no equivalent test
 * elsewhere (household.test.ts exercises the different `analyzeHousehold`
 * pipeline, not this one). As of Task 20 the only other importer of
 * `analyzeClaiming` is `validation/engine/golden.test.ts`; delete this file
 * alongside the module once Task 21 migrates that suite off it.
 */

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public',
);

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
    // Unreduced top-up at the spouse's own FRA: 2500/2 - 0 = $1,250.
    expect(result.spousal!.spousalBenefitAtFra).toBeCloseTo(1250, 0);
    // The mortality-weighted couple optimizer files this spouse (born Mar
    // 1962, FRA 67y0m, $0 own PIA) at 64y5m — 31 months before their own
    // FRA, not at FRA. Reduced by 31 * 25/36% = 21.5278% for the early
    // spousal claim: 1250 * (1 - 775/3600) = $980.90. See the matching
    // golden fixture "married-1960-spouse-no-record" in
    // validation/fixtures/scenarios.json for the full derivation.
    expect(result.spousal!.spousalTopUpAtFilingAge).toBeCloseTo(980.9, 1);
    expect(result.spousal!.spouseFilingAge).toBeDefined();
  });
});
