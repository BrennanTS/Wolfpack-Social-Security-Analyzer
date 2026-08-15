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
  monthDateFrom,
  nearestWholeClaimAge,
  rankedCoupleStrategies,
  rankedSingleStrategies,
  spousalTopUp,
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

describe('spousalTopUp', () => {
  const worker = createPiaRecipient(1960, 6, 2500, 'male');
  const fra = MonthDuration.initFromYearsMonths({ years: 67, months: 0 });

  it('tops a no-record spouse up to half the worker PIA at their FRA', () => {
    const spouse = createPiaRecipient(1962, 3, 0, 'female');
    expect(spousalTopUp(worker, spouse, fra)).toBeCloseTo(1250, 0);
  });

  it('pays nothing when the spouse own PIA already exceeds half the worker PIA', () => {
    const spouse = createPiaRecipient(1962, 3, 2000, 'female');
    expect(spousalTopUp(worker, spouse, fra)).toBe(0);
  });

  it('reduces the top-up when the spouse claims before their FRA', () => {
    const spouse = createPiaRecipient(1962, 3, 0, 'female');
    const atFra = spousalTopUp(worker, spouse, fra);
    const atSixtyTwo = spousalTopUp(
      worker,
      spouse,
      MonthDuration.initFromYearsMonths({ years: 62, months: 0 }),
    );
    expect(atSixtyTwo).toBeGreaterThan(0);
    expect(atSixtyTwo).toBeLessThan(atFra);
  });

  it('uses the spouse own birthdate, not the worker birthdate', () => {
    // The worker's own FRA is 67 (born 1960). A spouse who shares that
    // birthdate is a decoy: it can't distinguish "used the spouse's
    // birthdate" from "used the worker's birthdate" (both give FRA 67). Only
    // a spouse born before 1960 — with a genuinely different FRA (66) — can
    // tell the two apart, since post-1960 birth years all plateau at FRA 67.
    const sameAge = createPiaRecipient(1960, 6, 0, 'female');
    const olderCohort = createPiaRecipient(1950, 6, 0, 'female');
    const early = MonthDuration.initFromYearsMonths({ years: 62, months: 0 });
    // Different FRA schedules produce different early-claim reductions.
    expect(spousalTopUp(worker, sameAge, early)).not.toBe(
      spousalTopUp(worker, olderCohort, early),
    );
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

    const both70 = findStrategyByAges(ranked, [70, 70]);
    expect(both70).not.toBeNull();
    expect(both70!.filingAges[0].years).toBe(70);
    expect(both70!.filingAges[1].years).toBe(70);

    // 61 is below the SSA filing window, so no strategy uses it.
    expect(findStrategyByAges(ranked, [61, 61])).toBeNull();
  });
});
