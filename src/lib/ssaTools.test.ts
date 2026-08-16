import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeathProbabilityDistribution } from '$lib/life-tables';
import {
  createPiaRecipient,
  findStrategyByAges,
  fraFromBirthYear,
  isSsaClaimAgeEligible,
  monthDateFrom,
  nearestWholeClaimAge,
  rankedCoupleStrategies,
  rankedSingleStrategies,
  ssaMonthlyBenefitAtAge,
} from './ssaTools';

// Spy on the vendored mortality entry point while still executing the real
// life tables, so the determinism tests below can assert which reference year
// the survival curve is conditioned on. Behaviour is unchanged for every other
// test in this file — the spy just delegates.
vi.mock('$lib/life-tables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/life-tables')>();
  return { ...actual, getDeathProbabilityDistribution: vi.fn(actual.getDeathProbabilityDistribution) };
});

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

describe('fraFromBirthYear (SSA full retirement age schedule)', () => {
  it('returns 66y for 1954 and earlier', () => {
    expect(fraFromBirthYear(1954)).toMatchObject({ years: 66, months: 0 });
  });

  it('adds two months per year for 1955–1959', () => {
    expect(fraFromBirthYear(1955)).toMatchObject({ years: 66, months: 2 });
    expect(fraFromBirthYear(1957)).toMatchObject({ years: 66, months: 6 });
    expect(fraFromBirthYear(1959)).toMatchObject({ years: 66, months: 10 });
  });

  it('returns 67y for 1960 and later', () => {
    expect(fraFromBirthYear(1960)).toMatchObject({ years: 67, months: 0 });
    expect(fraFromBirthYear(1975)).toMatchObject({ years: 67, months: 0 });
  });
});

describe('ssaMonthlyBenefitAtAge (reduction / delayed credits)', () => {
  // PIA of $2,500 with FRA 67 (born 1960) gives clean reference percentages.
  const recipient = createPiaRecipient(1960, 6, 2500, 'female');

  it('pays 100% of PIA at full retirement age', () => {
    const { benefit, percentOfPia } = ssaMonthlyBenefitAtAge(recipient, 67);
    expect(percentOfPia).toBeCloseTo(100, 1);
    expect(benefit).toBeCloseTo(2500, 0);
  });

  it('reduces to 70% of PIA at age 62 (5 years early)', () => {
    const { benefit, percentOfPia } = ssaMonthlyBenefitAtAge(recipient, 62);
    expect(percentOfPia).toBeCloseTo(70, 1);
    expect(benefit).toBeCloseTo(1750, 0);
  });

  it('grows to 124% of PIA at age 70 (3 years of delayed credits)', () => {
    const { benefit, percentOfPia } = ssaMonthlyBenefitAtAge(recipient, 70);
    expect(percentOfPia).toBeCloseTo(124, 1);
    expect(benefit).toBeCloseTo(3100, 0);
  });

  it('is monotonically increasing from 62 to 70', () => {
    const benefits = [62, 63, 64, 65, 66, 67, 68, 69, 70].map(
      (age) => ssaMonthlyBenefitAtAge(recipient, age).benefit,
    );
    for (let i = 1; i < benefits.length; i++) {
      expect(benefits[i]).toBeGreaterThan(benefits[i - 1]);
    }
  });
});

describe('the 1959/1960 FRA cohort boundary reaches the benefit', () => {
  // Rewritten from the deleted `spousalTopUp` suite's FRA-schedule regression
  // guard. That test's real subject was never the spousal arithmetic: it
  // paired a 1959-cohort claimant against a 1960-cohort one, filing at the
  // same age, and asserted their reductions did NOT collapse — because the
  // two cohorts have different FRAs (66y10m vs 67y0m) and reading the wrong
  // person's FRA would make them identical. The spousal computation now lives
  // in the engine, but that boundary is still load-bearing for every reduced
  // benefit this app shows, so the guard is kept against the personal benefit,
  // where the same collapse would be just as invisible.
  //
  // PIA $2,500, claiming at 62:
  //   born Jun 1959, FRA 66y10m: 58 months early
  //     = 36 × 5/9% + 22 × 5/12% = 29.1667% → 2500 × 0.708333 = 1770.83
  //   born Jun 1960, FRA 67y0m: 60 months early
  //     = 36 × 5/9% + 24 × 5/12% = 30% → 2500 × 0.70 = 1750.00
  // The engine floors to whole dollars, so 1770 and 1750.
  const cohort1959 = createPiaRecipient(1959, 6, 2500, 'female');
  const cohort1960 = createPiaRecipient(1960, 6, 2500, 'female');

  it('gives the two cohorts different FRAs', () => {
    expect(fraFromBirthYear(1959)).toMatchObject({ years: 66, months: 10 });
    expect(fraFromBirthYear(1960)).toMatchObject({ years: 67, months: 0 });
  });

  it('reduces each cohort against its own FRA, not a shared one', () => {
    const a = ssaMonthlyBenefitAtAge(cohort1959, 62).benefit;
    const b = ssaMonthlyBenefitAtAge(cohort1960, 62).benefit;
    expect(a).toBeCloseTo(1770, 0);
    expect(b).toBeCloseTo(1750, 0);
    // The point of the guard: these must not collapse into one another.
    expect(a).not.toBe(b);
  });
});

describe('nearestWholeClaimAge (clamps to the 62–70 filing window)', () => {
  it('rounds to the nearest whole year', () => {
    expect(nearestWholeClaimAge(68.58)).toBe(69);
    expect(nearestWholeClaimAge(67.2)).toBe(67);
  });

  it('clamps below 62 and above 70', () => {
    expect(nearestWholeClaimAge(59)).toBe(62);
    expect(nearestWholeClaimAge(73)).toBe(70);
  });
});

describe('monthDateFrom', () => {
  it('converts a JS date to the engine month grid', () => {
    // MonthDate months are 0-indexed, matching Date.getMonth().
    const md = monthDateFrom(new Date(2026, 7, 15)); // Aug 2026
    expect(md.year()).toBe(2026);
    expect(md.monthIndex()).toBe(7);
  });
});

describe('isSsaClaimAgeEligible with an injected date', () => {
  it('treats a claim age as reached only once the reference date passes it', () => {
    const r = createPiaRecipient(1960, 6, 2500, 'female'); // born Jun 1960
    expect(isSsaClaimAgeEligible(r, 65, new Date(2024, 5, 1))).toBe(false);
    expect(isSsaClaimAgeEligible(r, 65, new Date(2026, 5, 1))).toBe(true);
  });
});

describe('ranked strategies', () => {
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

  const asOf = new Date(2026, 0, 15);

  it('returns single strategies sorted best-first', async () => {
    const r = createPiaRecipient(1962, 6, 2500, 'female');
    const ranked = await rankedSingleStrategies(r, 0.025, asOf);
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked[0].filingAges).toHaveLength(1);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].expectedNpv).toBeGreaterThanOrEqual(ranked[i].expectedNpv);
    }
  });

  it('returns couple strategies with one filing age per person, sorted best-first', async () => {
    const a = createPiaRecipient(1962, 6, 3200, 'male');
    const b = createPiaRecipient(1964, 2, 2100, 'female');
    const ranked = await rankedCoupleStrategies(a, b, 0.025, asOf);
    expect(ranked[0].filingAges).toHaveLength(2);
    expect(ranked[0].expectedNpv).toBeGreaterThanOrEqual(ranked[1].expectedNpv);
  });

  it('finds an exact whole-year combination and returns null when absent', async () => {
    const a = createPiaRecipient(1962, 6, 3200, 'male');
    const b = createPiaRecipient(1964, 2, 2100, 'female');
    const ranked = await rankedCoupleStrategies(a, b, 0.025, asOf);

    const both70 = findStrategyByAges(ranked, [
      { years: 70, months: 0 },
      { years: 70, months: 0 },
    ]);
    expect(both70).not.toBeNull();
    expect(both70!.filingAges[0].years).toBe(70);
    expect(both70!.filingAges[1].years).toBe(70);

    // 61 is below the SSA filing window, so no strategy uses it.
    expect(
      findStrategyByAges(ranked, [
        { years: 61, months: 0 },
        { years: 61, months: 0 },
      ]),
    ).toBeNull();
  });

  // Regression: the mortality distribution used to be requested with no
  // reference year, so `getDeathProbabilityDistribution` fell back to its
  // `new Date().getFullYear()` default. Every expected NPV was then weighted
  // by a survival curve conditioned on the wall clock while the optimizer ran
  // from `asOf` — meaning results silently changed every 1 January and the
  // one fixture pinned to a past year was never actually evaluated in it.
  describe('asOf determinism', () => {
    const distSpy = vi.mocked(getDeathProbabilityDistribution);

    beforeEach(() => {
      distSpy.mockClear();
    });

    it('conditions the single survival curve on asOf, not the wall clock', async () => {
      const r = createPiaRecipient(1962, 6, 2500, 'female');
      await rankedSingleStrategies(r, 0.025, new Date(2024, 0, 15));
      expect(distSpy).toHaveBeenCalledWith(r, 2024);
    });

    it('conditions both couple survival curves on asOf', async () => {
      const a = createPiaRecipient(1962, 6, 3200, 'male');
      const b = createPiaRecipient(1964, 2, 2100, 'female');
      await rankedCoupleStrategies(a, b, 0.025, new Date(2024, 0, 15));
      expect(distSpy).toHaveBeenCalledWith(a, 2024);
      expect(distSpy).toHaveBeenCalledWith(b, 2024);
    });

    it('produces identical rankings for a fixed asOf no matter what year it is run in', async () => {
      const build = () => createPiaRecipient(1962, 6, 2500, 'female');
      const pinned = new Date(2026, 0, 15);

      const baseline = await rankedSingleStrategies(build(), 0.025, pinned);

      // Fake only Date, so the async life-table fetch still resolves.
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date(2031, 5, 1));
        const later = await rankedSingleStrategies(build(), 0.025, pinned);
        expect(later.map((s) => s.expectedNpv)).toEqual(baseline.map((s) => s.expectedNpv));
        expect(later[0].filingAges[0].label).toBe(baseline[0].filingAges[0].label);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
