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

const sarah: Person = {
  id: 'b', name: 'Sarah', birthYear: 1964, birthMonth: 2,
  gender: 'female', piaMonthly: 2100, lifeExpectancy: 88,
};

describe('analyzeHousehold — married', () => {
  const household: Household = { status: 'married', people: [dan, sarah] };

  it('analyzes both people and keeps input order', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.people.map((p) => p.person.name)).toEqual(['Dan', 'Sarah']);
  });

  it('gives each comparison one filing age per person', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.filingAges).toHaveLength(2);
    }
  });

  it('uses married labels', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    expect(comparisons.map((c) => c.label)).toContain('Both delay to 70');
  });

  it('assigns each person the filing age from the joint optimum', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.people[0].recommendedFilingAge).toEqual(result.optimal.filingAges[0]);
    expect(result.people[1].recommendedFilingAge).toEqual(result.optimal.filingAges[1]);
  });

  it('reports a spousal top-up for a spouse with no record', async () => {
    const noRecord: Person = { ...sarah, piaMonthly: 0 };
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, noRecord] },
      assumptions,
      asOf,
    );
    expect(result.spousalTopUp!.atFra).toBeCloseTo(1200, 0); // half of Dan's 2400
    expect(result.spousalTopUp!.atRecommendedFilingAge).toBeGreaterThanOrEqual(0);
  });

  it('reports no top-up when both have substantial records', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.spousalTopUp!.atFra).toBe(0);
  });

  it('uses each person own gender for mortality, not an assumed opposite', async () => {
    const bothMale: Household = {
      status: 'married',
      people: [dan, { ...sarah, gender: 'male' }],
    };
    const mixed = await analyzeHousehold(household, assumptions, asOf);
    const same = await analyzeHousehold(bothMale, assumptions, asOf);
    // Different mortality tables must produce a different joint expected NPV.
    expect(same.optimal.expectedNpv).not.toBe(mixed.optimal.expectedNpv);
  });
});

describe('combinedTimeline', () => {
  it('starts no earlier than the first benefit year and rises when the second person files', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    const t = result.combinedTimeline;
    expect(t.length).toBeGreaterThan(0);

    // Totals equal the sum of the per-person amounts in every year.
    for (const point of t) {
      const summed = Object.values(point.byPersonId).reduce((a, b) => a + b, 0);
      expect(point.total).toBeCloseTo(summed, 2);
    }

    // Years increase by one with no gaps.
    for (let i = 1; i < t.length; i++) {
      expect(t[i].year).toBe(t[i - 1].year + 1);
    }

    // The household total rises once the second person starts filing: the
    // peak (both filed, both alive) must exceed the very first year (only
    // the earlier filer contributing). The tail can fall below the peak once
    // someone outlives their life expectancy, so we deliberately don't assert
    // the last year against the first.
    const peak = Math.max(...t.map((p) => p.total));
    expect(peak).toBeGreaterThan(t[0].total);
  });

  it('keys amounts by person id', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    expect(Object.keys(result.combinedTimeline[0].byPersonId).sort()).toEqual(['a', 'b']);
  });

  it('produces a single-keyed timeline for a single claimant', async () => {
    const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(Object.keys(result.combinedTimeline[0].byPersonId)).toEqual(['a']);
  });
});
