import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, type CombinedTimelinePoint, type Household } from './household';
import { householdValueFromTimeline } from './lifetimeValue';

const point = (year: number, total: number): CombinedTimelinePoint => ({
  year,
  bySeries: { 'a:personal': total },
  byPersonId: { a: total },
  total,
});

const AS_OF_YEAR = 2026;
const base = { annualCola: 0, discountRate: 0, asOfYear: AS_OF_YEAR } as const;

describe('householdValueFromTimeline', () => {
  const stream = [point(2026, 1000), point(2027, 1000), point(2028, 1000)];

  it('is a plain sum of the stream in real dollars with no discount', () => {
    // The basis most competitor reports print, and what the comparison preset
    // selects. Nothing clever should happen to the numbers here.
    expect(householdValueFromTimeline(stream, { ...base, dollarsMode: 'real' })).toBe(3000);
  });

  it('treats the as-of year as exponent zero, not one', () => {
    // An off-by-one here would inflate (or discount) the first year, which is
    // the year a reader can check against the monthly figure on the page.
    const oneYear = [point(AS_OF_YEAR, 1000)];
    expect(
      householdValueFromTimeline(oneYear, { ...base, annualCola: 10, dollarsMode: 'nominal' }),
    ).toBe(1000);
    expect(householdValueFromTimeline(oneYear, { ...base, discountRate: 0.1, dollarsMode: 'real' })).toBe(
      1000,
    );
  });

  it('compounds COLA per year rather than scaling the total once', () => {
    // The distinction this module exists for: every year in a lifetime sum
    // carries a different factor, so a single multiplier on the total is
    // wrong. 1000 + 1000(1.1) + 1000(1.1^2) = 3310.
    expect(
      householdValueFromTimeline(stream, { ...base, annualCola: 10, dollarsMode: 'nominal' }),
    ).toBe(3310);
  });

  it('discounts with the same exponent it inflates with', () => {
    // 1000 + 1000/1.1 + 1000/1.1^2 = 2735.54
    expect(
      householdValueFromTimeline(stream, { ...base, discountRate: 0.1, dollarsMode: 'real' }),
    ).toBeCloseTo(2735.54, 2);
  });

  it('cancels exactly when the discount rate equals the COLA', () => {
    // The property that makes the two knobs safe to leave independent: a
    // nominal stream discounted at its own growth rate is the real
    // undiscounted total, to the cent, at any length.
    const value = householdValueFromTimeline(stream, {
      annualCola: 2.54,
      discountRate: 0.0254,
      asOfYear: AS_OF_YEAR,
      dollarsMode: 'nominal',
    });
    expect(value).toBeCloseTo(3000, 6);
  });

  it('is zero for an empty stream rather than NaN', () => {
    expect(householdValueFromTimeline([], { ...base, dollarsMode: 'real' })).toBe(0);
  });
});

/**
 * The regression this module was written for. Before it, the strategy table
 * printed the engine's `expectedNpv` while the stream underneath it summed to
 * something else — six months per person apart (`planToAgeDistribution`'s
 * documented seam). Once the report prints a per-year table and cumulative
 * charts off that same stream, the two are read together and must agree.
 */
describe('the printed household value and its own stream agree', () => {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
  beforeAll(() => {
    vi.stubGlobal('fetch', async (url: string) => {
      const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
      return { ok: true, json: async () => JSON.parse(contents) } as Response;
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  const couple: Household = {
    status: 'married',
    people: [
      { id: 'a', birthYear: 1961, birthMonth: 11, birthDay: 11, gender: 'female', piaMonthly: 3497, lifeExpectancy: 95 },
      { id: 'b', birthYear: 1963, birthMonth: 4, birthDay: 7, gender: 'male', piaMonthly: 3548, lifeExpectancy: 95 },
    ],
  };
  const single: Household = {
    status: 'single',
    people: [
      { id: 'a', birthYear: 1962, birthMonth: 4, birthDay: 15, gender: 'male', piaMonthly: 2400, lifeExpectancy: 90 },
    ],
  };
  const asOf = new Date('2026-09-21');

  for (const [name, household] of [
    ['couple', couple],
    ['single', single],
  ] as const) {
    for (const discountRate of [0, 0.025]) {
      it(`${name}, discount ${discountRate}: every row re-sums to what it prints`, async () => {
        const r = await analyzeHousehold(household, { annualCola: 2.54, discountRate }, asOf);
        expect(r.allComparisons.length).toBeGreaterThan(0);
        for (const row of r.allComparisons) {
          expect(row.timeline.length, `${row.label} must carry its own stream`).toBeGreaterThan(0);
          expect(
            householdValueFromTimeline(row.timeline, {
              annualCola: 2.54,
              discountRate,
              asOfYear: asOf.getFullYear(),
              dollarsMode: 'real',
            }),
            `${row.label}: the printed figure must equal the sum of its own stream`,
          ).toBeCloseTo(row.householdValue, 2);
        }
      });
    }
  }

  it('leaves the engine free to disagree, since it only ranks now', async () => {
    // Not a bug — the seam still exists inside the vendored engine and is
    // still documented there. This asserts the two are now DIFFERENT numbers
    // with different jobs, so nobody "fixes" the table back to expectedNpv.
    const r = await analyzeHousehold(couple, { annualCola: 2.54, discountRate: 0 }, asOf);
    expect(r.optimal.expectedNpv).toBeGreaterThan(r.optimal.householdValue);
  });
});
