import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { firstDeath, incomeCliff } from './incomeCliff';
import { analyzeHousehold, type HouseholdAnalysis } from './household';
import type { Person } from './personAnalysis';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

const asOf = new Date(2026, 0, 15);
const assumptions = { annualCola: 2.5, discountRate: 0.025 };

// Mirrors `household.test.ts` exactly rather than inventing new figures.
// Dan (b. Apr 1962, plan-to 85) dies in 2047; Sarah (b. Feb 1964, plan-to 88)
// outlives him into 2052. The married timeline for this pairing starts at
// Dan's earliest realistic filing year (well before 2047) and runs to 2052,
// so 2047 sits inside it with full years on both sides — 2046 and 2048 are
// both real timeline years, not the first or last.
const dan: Person = {
  id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
  gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
};
const sarah: Person = {
  id: 'b', name: 'Sarah', birthYear: 1964, birthMonth: 2,
  gender: 'female', piaMonthly: 2100, lifeExpectancy: 88,
};

describe('incomeCliff', () => {
  it('measures the drop across the first death', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    const cliff = incomeCliff(result)!;
    const firstDeath = Math.min(...Object.values(result.finalIndexByPersonId));
    expect(cliff.deathYear).toBe(Math.floor(firstDeath / 12));
    // Compared against full years on either side, so a partial death year
    // cannot masquerade as a drop in income.
    expect(cliff.before).toBe(
      result.combinedTimeline.find((p) => p.year === cliff.deathYear - 1)!.total,
    );
    expect(cliff.after).toBe(
      result.combinedTimeline.find((p) => p.year === cliff.deathYear + 1)!.total,
    );
    expect(cliff.dropPercent).toBeCloseTo(((cliff.before - cliff.after) / cliff.before) * 100, 2);
  });

  it('returns null for a single claimant', async () => {
    const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(incomeCliff(result)).toBeNull();
  });

  it('names the survivor — the person who does NOT die first', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    // Dan dies first (see the fixture comment above), so Sarah is the
    // survivor named in the callout.
    const firstDeathPersonId = Object.entries(result.finalIndexByPersonId).reduce((a, b) =>
      a[1] <= b[1] ? a : b,
    )[0];
    expect(firstDeathPersonId).toBe('a'); // Dan
    expect(incomeCliff(result)!.survivorLabel).toBe('Sarah');
  });

  // `incomeCliff` reads only `people`, `finalIndexByPersonId` and
  // `combinedTimeline` — hand-built fixtures below isolate the boundary
  // arithmetic from the optimizer, matching the pattern
  // `pdf/HouseholdSection.test.tsx` uses for the same reason.
  function analysisWith(
    finalIndexByPersonId: Record<string, number>,
    combinedTimeline: HouseholdAnalysis['combinedTimeline'],
  ): HouseholdAnalysis {
    return {
      status: 'married',
      people: [{ person: { id: 'a', name: 'Dan' } }, { person: { id: 'b', name: 'Sarah' } }],
      finalIndexByPersonId,
      combinedTimeline,
    } as unknown as HouseholdAnalysis;
  }

  it('returns null when the first death falls in the timeline’s first year', () => {
    // No year 2029 exists to be "the last full year before" 2030.
    const analysis = analysisWith(
      { a: 2030 * 12 + 3, b: 2050 * 12 + 3 },
      [
        { year: 2030, bySeries: {}, byPersonId: {}, total: 40000 },
        { year: 2031, bySeries: {}, byPersonId: {}, total: 20000 },
      ],
    );
    expect(incomeCliff(analysis)).toBeNull();
  });

  it('returns null when the first death falls in the timeline’s last year', () => {
    // No year 2032 exists to be "the first full year after" 2031.
    const analysis = analysisWith(
      { a: 2031 * 12 + 3, b: 2050 * 12 + 3 },
      [
        { year: 2030, bySeries: {}, byPersonId: {}, total: 40000 },
        { year: 2031, bySeries: {}, byPersonId: {}, total: 20000 },
      ],
    );
    expect(incomeCliff(analysis)).toBeNull();
  });

  it('reports zero drop, not a negative one, when the survivor step-up offsets the loss', () => {
    const analysis = analysisWith(
      { a: 2030 * 12 + 3, b: 2050 * 12 + 3 },
      [
        { year: 2029, bySeries: {}, byPersonId: {}, total: 30000 },
        { year: 2030, bySeries: {}, byPersonId: {}, total: 30000 },
        // The survivor's own benefit plus the step-up exceeds the prior
        // household total — reachable, and not a "negative drop".
        { year: 2031, bySeries: {}, byPersonId: {}, total: 32000 },
      ],
    );
    const cliff = incomeCliff(analysis)!;
    expect(cliff.before).toBe(30000);
    expect(cliff.after).toBe(32000);
    expect(cliff.dropPercent).toBe(0);
  });

  // Code-review finding: the closing clause of `incomeCliffSentence` used to
  // read "once {survivor} is the only one still collecting" — a claim that
  // is false the instant `after` is $0. This pins that `after: 0` really is
  // reachable through the REAL pipeline, not just a hand-built fixture, so
  // that claim was never a safe one to make: a much-younger survivor who has
  // neither filed on their own record nor reached the SSA age a widow(er)
  // benefit can start yields a full $0 year immediately after the death.
  // Same household `benefitPeriods.test.ts` and
  // `methodologyCopy.test.ts` already use for the under-60 survivor-gap
  // case.
  it('reports a $0 "after" for a real household with a much-younger, not-yet-eligible survivor', async () => {
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1956, birthMonth: 6,
      gender: 'female', piaMonthly: 1600, lifeExpectancy: 76,
    };
    const blake: Person = {
      id: 'b', name: 'Blake', birthYear: 1976, birthMonth: 6,
      gender: 'male', piaMonthly: 1650, lifeExpectancy: 88,
    };
    const result = await analyzeHousehold(
      { status: 'married', people: [avery, blake] },
      { annualCola: 0, discountRate: 0.025 },
      asOf,
    );
    const cliff = incomeCliff(result)!;
    expect(cliff.deathYear).toBe(2032); // Avery dies Jun 2032 (1956 + 76).
    expect(cliff.after).toBe(0);
    expect(cliff.dropPercent).toBe(100);
  });

  // An exact tie (simultaneous final month) means the concept of "who dies
  // first" does not apply to this household at all — there is no survivor to
  // name and no cliff to state. Order of entry must not be able to invent
  // one: whichever person happens to land in slot 0 is not evidence they die
  // first. `detectSurvivorGap` in `benefitPeriods.ts` already treats an exact
  // tie the same way, for the same reason.
  it('returns null on an exact tie in finalIndexByPersonId, rather than picking a survivor', () => {
    const analysis = analysisWith(
      { a: 2040 * 12 + 3, b: 2040 * 12 + 3 },
      [
        { year: 2039, bySeries: {}, byPersonId: {}, total: 40000 },
        { year: 2040, bySeries: {}, byPersonId: {}, total: 40000 },
        { year: 2041, bySeries: {}, byPersonId: {}, total: 20000 },
      ],
    );
    expect(incomeCliff(analysis)).toBeNull();
  });

  it('firstDeath itself returns null on an exact tie', () => {
    expect(firstDeath(['a', 'b'], { a: 500, b: 500 })).toBeNull();
  });

  it('firstDeath still resolves a genuine (non-tied) difference either way round', () => {
    expect(firstDeath(['a', 'b'], { a: 500, b: 600 })).toEqual({
      deathYear: Math.floor(500 / 12),
      survivorIndex: 1,
      deathMonthIndex: 500,
    });
    expect(firstDeath(['a', 'b'], { a: 600, b: 500 })).toEqual({
      deathYear: Math.floor(500 / 12),
      survivorIndex: 0,
      deathMonthIndex: 500,
    });
  });
});
