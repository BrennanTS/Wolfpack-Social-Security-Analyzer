import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthDuration } from '$lib/month-time';
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
  spousalEntitlement,
  spousalTopUp,
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

describe('spousalEntitlement', () => {
  it('tops a no-record spouse up to half the worker PIA', () => {
    const worker = createPiaRecipient(1960, 6, 2500, 'male');
    const spouse = createPiaRecipient(1962, 3, 0, 'female');
    expect(spousalEntitlement(worker, spouse)).toBeCloseTo(1250, 0);
  });

  it('is zero when the spouse own PIA already exceeds half the worker PIA', () => {
    const worker = createPiaRecipient(1960, 6, 2500, 'male');
    const spouse = createPiaRecipient(1962, 3, 2000, 'female');
    expect(spousalEntitlement(worker, spouse)).toBe(0);
  });
});

describe('spousalTopUp — start date', () => {
  const age = (years: number, months = 0) =>
    MonthDuration.initFromYearsMonths({ years, months });

  // Worker born Jun 1960 (FRA 67), spouse born Mar 1962 (FRA 67), spouse has
  // no record of her own. This is the strategy the optimizer usually picks.
  const worker = () => createPiaRecipient(1960, 6, 2500, 'male');
  const spouse = () => createPiaRecipient(1962, 3, 0, 'female');

  it('cannot begin before the worker files', () => {
    // Worker files at 70 (Jun 2030). Spouse filed at 62 (Mar 2024) on her own
    // record, but the spousal benefit waits for him.
    const result = spousalTopUp(worker(), spouse(), age(62), age(70));
    // Jun 2030 − Mar 1962 = 68 years, 3 months.
    expect(result.startsAtSpouseAge.years).toBe(68);
    expect(result.startsAtSpouseAge.months).toBe(3);
  });

  it('is unreduced when it begins at or after the spouse own FRA', () => {
    // Beginning at 68y3m is past her FRA of 67, so no reduction applies.
    const result = spousalTopUp(worker(), spouse(), age(62), age(70));
    expect(result.amount).toBeCloseTo(1250, 0);
  });

  it('begins at the spouse filing age when the worker filed first', () => {
    // Worker files at 62 (Jun 2022); spouse files at 65 (Mar 2027).
    const result = spousalTopUp(worker(), spouse(), age(65), age(62));
    expect(result.startsAtSpouseAge.years).toBe(65);
    expect(result.startsAtSpouseAge.months).toBe(0);
  });

  it('reduces by the months between the actual start and the spouse FRA', () => {
    // Starts at 65y0m, 24 months before her FRA of 67, all within the first
    // 36-month band: 24 × 25/36 of 1% = 16.6667%. 1250 × 0.833333 = 1041.67.
    const result = spousalTopUp(worker(), spouse(), age(65), age(62));
    expect(result.amount).toBeCloseTo(1041.67, 1);
  });

  it('does not reduce by the spouse own filing age when the start is later', () => {
    // Filing on her own record at 62 while the benefit starts at 65 must give
    // the 65 reduction (1041.67), NOT the 62 reduction (812.50).
    //
    // She is 1y9m younger than him, so his filing age has to be 66y9m for the
    // benefit to start on her 65th birthday: Jun 1960 + 66y9m = Mar 2027, and
    // Mar 2027 − Mar 1962 = exactly 65y0m. (The brief's `age(65)` here would
    // put her at 63y3m — see the report.)
    const startsAt65 = spousalTopUp(worker(), spouse(), age(62), age(66, 9));
    expect(startsAt65.startsAtSpouseAge.years).toBe(65);
    expect(startsAt65.startsAtSpouseAge.months).toBe(0);
    expect(startsAt65.amount).toBeCloseTo(1041.67, 1);
  });

  it('grants no delayed credits for beginning after FRA', () => {
    const atFra = spousalTopUp(worker(), spouse(), age(67), age(62));
    const wellAfter = spousalTopUp(worker(), spouse(), age(70), age(62));
    expect(atFra.amount).toBeCloseTo(1250, 0);
    expect(wellAfter.amount).toBeCloseTo(1250, 0);
  });

  it('pays nothing when there is no entitlement, whatever the dates', () => {
    const earner = createPiaRecipient(1962, 3, 2000, 'female');
    const result = spousalTopUp(worker(), earner, age(62), age(70));
    expect(result.amount).toBe(0);
  });

  it('uses the spouse own FRA schedule, not the worker FRA', () => {
    // Regression guard, carried over from the previous three-argument suite.
    // Both spouses below start their spousal benefit at exactly age 62y0m, so
    // the only thing that can separate their reductions is whose FRA schedule
    // was used. The worker (born Jun 1959) has FRA 66y10m; the 1960 spouse has
    // FRA 67. Reading the worker's FRA for the 1960 spouse would collapse the
    // two results.
    //
    // Worker Jun 1959 files at 62 → Jun 2021, before both spouses' own filings,
    // so each benefit starts on that spouse's own 62nd birthday.
    //   spouse born Jun 1959, FRA 66y10m: 58 months early
    //     = 25% + 22 × 5/12% = 34.1667% → 1250 × 0.658333 = 822.92
    //   spouse born Jun 1960, FRA 67y0m: 60 months early
    //     = 25% + 24 × 5/12% = 35% → 1250 × 0.65 = 812.50
    const olderWorker = createPiaRecipient(1959, 6, 2500, 'male');
    const cohort1959 = createPiaRecipient(1959, 6, 0, 'female');
    const cohort1960 = createPiaRecipient(1960, 6, 0, 'female');

    const a = spousalTopUp(olderWorker, cohort1959, age(62), age(62));
    const b = spousalTopUp(olderWorker, cohort1960, age(62), age(62));
    expect(a.startsAtSpouseAge.years).toBe(62);
    expect(b.startsAtSpouseAge.years).toBe(62);
    expect(a.amount).toBeCloseTo(822.92, 1);
    expect(b.amount).toBeCloseTo(812.5, 1);
  });

  it('caps the combined benefit at half the worker PIA when the spouse files past her FRA', () => {
    // Additional finding — see the report's 50%-cap verdict. The engine
    // (benefit-calculator.ts:343-356) subtracts the spouse's DRC-inflated
    // *actual* benefit, not her PIA, once she files after her own NRA.
    //   worker PIA 3000 → half is 1500. Spouse PIA 1000, FRA 67, files at 70:
    //   own benefit = 1000 × (1 + 36 × 2/3%) = 1240.
    //   spousal = 1500 − 1240 = 260, so combined = 1500 = half the worker PIA.
    // Without the cap the top-up would be the unreduced 1500 − 1000 = 500 and
    // the combined benefit 1740, i.e. 58% of the worker's PIA.
    const w = createPiaRecipient(1960, 6, 3000, 'male');
    const s = createPiaRecipient(1962, 3, 1000, 'female');
    expect(spousalTopUp(w, s, age(70), age(62)).amount).toBeCloseTo(260, 0);
    // Filing at exactly her FRA is not "past" it — no cap branch, unreduced.
    expect(spousalTopUp(w, s, age(67), age(62)).amount).toBeCloseTo(500, 0);
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
