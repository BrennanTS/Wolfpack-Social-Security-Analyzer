import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import {
  createPiaRecipient,
  findStrategyByAges,
  fraFromBirthYear,
  isSsaClaimAgeEligible,
  lifetimeNpvToAge,
  monthDateFrom,
  nearestWholeClaimAge,
  rankedCoupleStrategies,
  rankedSingleStrategies,
  ssaMonthlyBenefitAtAge,
} from './ssaTools';

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

  it('returns single strategies sorted best-first', () => {
    const r = createPiaRecipient(1962, 6, 2500, 'female');
    const ranked = rankedSingleStrategies(r, 0.025, 85, asOf);
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked[0].filingAges).toHaveLength(1);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].expectedNpv).toBeGreaterThanOrEqual(ranked[i].expectedNpv);
    }
  });

  it('returns couple strategies with one filing age per person, sorted best-first', () => {
    const a = createPiaRecipient(1962, 6, 3200, 'male');
    const b = createPiaRecipient(1964, 2, 2100, 'female');
    const ranked = rankedCoupleStrategies(a, b, 0.025, [85, 88], asOf);
    expect(ranked[0].filingAges).toHaveLength(2);
    expect(ranked[0].expectedNpv).toBeGreaterThanOrEqual(ranked[1].expectedNpv);
  });

  it('finds an exact whole-year combination and returns null when absent', () => {
    const a = createPiaRecipient(1962, 6, 3200, 'male');
    const b = createPiaRecipient(1964, 2, 2100, 'female');
    const ranked = rankedCoupleStrategies(a, b, 0.025, [85, 88], asOf);

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

  /**
   * The mortality assumption is now the plan-to age, not an SSA survival
   * curve — see `planToAgeDistribution`. What replaced the old
   * `asOf`-determinism guards is the property their absence hid for the life
   * of the project: that the slider reaches the recommendation at all.
   *
   * Until this change `rankedSingleStrategies` weighted by
   * `getDeathProbabilityDistribution`, which never reads the plan-to age, so
   * a claimant planning to 70 and one planning to 100 got the same filing age
   * and the same present value to the cent.
   */
  describe('the plan-to age reaches the recommendation', () => {
    const r = () => createPiaRecipient(1978, 12, 3962, 'male');

    it('moves the recommended filing age', () => {
      const short = rankedSingleStrategies(r(), 0.025, 70, asOf)[0];
      const long = rankedSingleStrategies(r(), 0.025, 95, asOf)[0];
      expect(short.filingAges[0].label).not.toBe(long.filingAges[0].label);
      // And in the direction anyone would expect: a longer horizon rewards
      // delaying.
      expect(long.filingAges[0].decimalYears).toBeGreaterThan(short.filingAges[0].decimalYears);
    });

    it('moves the value, monotonically', () => {
      const values = [70, 80, 90, 100].map(
        (age) => rankedSingleStrategies(r(), 0.025, age, asOf)[0].expectedNpv,
      );
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
    });

    it('wires each spouse to their OWN horizon, slot by slot', () => {
      // One horizon at a time, holding the other fixed. Swapping the pair is
      // NOT a test of this: for a high-earner/low-earner couple the answer is
      // 70 / 62y1m whichever of them lives longer — he delays either way,
      // because delaying raises the survivor benefit she inherits, and she
      // claims early either way, because she inherits it. That looked like a
      // finding and was not.
      const a = () => createPiaRecipient(1962, 4, 2400, 'male');
      const b = () => createPiaRecipient(1964, 9, 1200, 'female');
      const ages = (planTo: [number, number]) =>
        rankedCoupleStrategies(a(), b(), 0.025, planTo, asOf)[0].filingAges.map((f) => f.label);

      // Slot 0's horizon reaches slot 0.
      expect(ages([70, 85])).not.toEqual(ages([95, 85]));
      // Slot 1's reaches slot 1.
      expect(ages([85, 70])).not.toEqual(ages([85, 95]));
    });

    it('prices to the plan-to age, verified against an independent sum', () => {
      // The strongest available check that the point mass means what it says,
      // and the one that made re-recording every golden fixture safe.
      //
      // At a 0% discount rate the optimizer's figure is a plain sum of
      // benefits, so it can be compared with `lifetimeNpvToAge` — which walks
      // the same stream by a different route. They differ by EXACTLY six
      // months of benefit at every filing age, which is the documented seam
      // (`planToAgeDistribution`): the engine buckets a death age to
      // `{years: N, months: 6}` and `lifetimeNpvToAge` stops at
      // `{years: N, months: 0}`. Anything other than exactly six months would
      // mean the horizon is not the one this app thinks it is.
      const r = createPiaRecipient(1965, 4, 3000, 'male');
      const ranked = rankedSingleStrategies(r, 0, 85, asOf);

      for (const age of [64, 67, 70]) {
        const filingAge = MonthDuration.initFromYearsMonths({ years: age, months: 0 });
        const row = ranked.find(
          (x) => x.filingAges[0].years === age && x.filingAges[0].months === 0,
        )!;
        const toEightyFive = lifetimeNpvToAge(r, filingAge, 85, 0, asOf);
        // Six months of benefit, derived independently as half the difference
        // one extra whole year makes.
        const oneMoreYear = lifetimeNpvToAge(r, filingAge, 86, 0, asOf) - toEightyFive;
        expect(row.expectedNpv - toEightyFive).toBeCloseTo(oneMoreYear / 2, 2);
      }
    });

    it('does not depend on the wall clock', () => {
      // The old guard's real subject: results must be a function of `asOf`.
      // The survival curve that used to leak `new Date()` is gone, so this
      // now just pins that nothing else does.
      const first = rankedSingleStrategies(r(), 0.025, 85, new Date(2024, 0, 15))[0];
      const second = rankedSingleStrategies(r(), 0.025, 85, new Date(2024, 0, 15))[0];
      expect(first).toEqual(second);
      const later = rankedSingleStrategies(r(), 0.025, 85, new Date(2027, 0, 15))[0];
      expect(later.expectedNpv).not.toBe(first.expectedNpv);
    });
  });
});
