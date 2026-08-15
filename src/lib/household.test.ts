import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, type Household } from './household';
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

const dan: Person = {
  id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
  gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
};

describe('analyzeHousehold — single', () => {
  const household: Household = { status: 'single', people: [dan] };

  it('analyzes exactly one person', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.status).toBe('single');
    expect(result.people).toHaveLength(1);
    expect(result.people[0].person.name).toBe('Dan');
  });

  it('marks exactly one comparison row as optimal, with zero delta', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    const optimal = comparisons.filter((c) => c.isOptimal);
    expect(optimal).toHaveLength(1);
    expect(optimal[0].deltaVsOptimal).toBe(0);
  });

  it('never scores a comparison above the optimal', async () => {
    const { comparisons, optimal } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.expectedNpv).toBeLessThanOrEqual(optimal.expectedNpv);
      expect(c.deltaVsOptimal).toBeLessThanOrEqual(0);
    }
  });

  it('gives every comparison one filing age and a single-person label', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.filingAges).toHaveLength(1);
    }
    expect(comparisons.map((c) => c.label)).toContain('Claim at 70');
  });

  it('omits spousal data for a single claimant', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.spousalTopUp).toBeUndefined();
  });

  it('echoes the reference date and assumptions', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.asOf).toEqual(asOf);
    expect(result.assumptions).toEqual(assumptions);
  });

  it('folds a named row into optimal instead of duplicating it when their ages collide', async () => {
    // At a 0% discount rate, deferred credits dominate and the optimum for
    // this fixture lands exactly on the `latest` (70) row. That row must be
    // folded into `optimal`, not duplicated alongside it.
    const { comparisons } = await analyzeHousehold(
      household,
      { annualCola: 2.5, discountRate: 0 },
      asOf,
    );

    const seen = new Set<string>();
    for (const c of comparisons) {
      const ageKey = c.filingAges.map((f) => `${f.years}y${f.months}m`).join('|');
      expect(seen.has(ageKey)).toBe(false);
      seen.add(ageKey);
    }

    const optimalRows = comparisons.filter((c) => c.isOptimal);
    expect(optimalRows).toHaveLength(1);
    expect(optimalRows[0].key).toBe('optimal');

    const latestRows = comparisons.filter((c) => c.key === 'latest');
    expect(latestRows).toHaveLength(0);
  });
});
