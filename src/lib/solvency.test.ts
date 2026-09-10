import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeHousehold, type Household } from './household';
import {
  DEFAULT_SOLVENCY,
  TRUSTEES_ASSUMPTION,
  TRUSTEES_PROJECTION,
  solvencySensitivity,
} from './solvency';

const asOf = new Date(2026, 0, 15);
const assumptions = { annualCola: 2.5, discountRate: 0.025 };

const married: Household = {
  status: 'married',
  people: [
    { id: 'a', name: 'John', birthYear: 1962, birthMonth: 4, birthDay: 15, gender: 'male', piaMonthly: 2400, lifeExpectancy: 85 },
    { id: 'b', name: 'Jane', birthYear: 1964, birthMonth: 2, birthDay: 15, gender: 'female', piaMonthly: 2100, lifeExpectancy: 88 },
  ],
};

beforeAll(() => {
  globalThis.fetch = (async (url: string) => {
    const contents = await readFile(
      path.join(process.cwd(), 'public', String(url).replace(/^\//, '')),
      'utf8',
    );
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  }) as typeof fetch;
});

describe('the trustees projection', () => {
  it('uses the OASI fund, which is the one that pays these benefits', () => {
    // Not the combined 2034/83% figure, which describes a fund that would
    // take an act of Congress to exist — the very thing this page declines
    // to predict.
    expect(TRUSTEES_PROJECTION.fromYear).toBe(2032);
    expect(TRUSTEES_PROJECTION.payablePercent).toBe(78);
    expect(DEFAULT_SOLVENCY.fromYear).toBe(TRUSTEES_PROJECTION.fromYear);
  });

  it('is switched off until an adviser asks for it', async () => {
    // A page pricing a benefit cut is a claim about a client's future that
    // nobody asked for. It must never reach a client because it happened to
    // be on, so the default carries the trustees' figures and does not use
    // them.
    expect(DEFAULT_SOLVENCY.enabled).toBe(false);
    expect(TRUSTEES_ASSUMPTION.enabled).toBe(true);
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    expect(solvencySensitivity(analysis)).toBeNull();
    expect(solvencySensitivity(analysis, DEFAULT_SOLVENCY)).toBeNull();
    expect(solvencySensitivity(analysis, TRUSTEES_ASSUMPTION)).not.toBeNull();
  });
});

describe('solvencySensitivity', () => {
  it('prices every strategy the comparison table shows', async () => {
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const result = solvencySensitivity(analysis, TRUSTEES_ASSUMPTION)!;
    expect(result).not.toBeNull();
    expect(result.rows.map((r) => r.key)).toEqual(analysis.comparisons.map((c) => c.key));
    for (const row of result.rows) expect(row.full).toBeGreaterThan(0);
  });

  it('scores each plan at the figure the rest of the report gives it', async () => {
    // Not a tidiness point. This page exists to say whether a reduction
    // changes the answer, and it cannot say that if its own as-scheduled
    // column ranks the plans differently from the page that gives the
    // answer. An earlier version summed the bands undiscounted and named
    // "Both wait until 70" while the report recommended a different plan.
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const { rows, bestFullKey } = solvencySensitivity(analysis, TRUSTEES_ASSUMPTION)!;
    const byKey = new Map(analysis.comparisons.map((c) => [c.key, c]));
    for (const row of rows) {
      const comparison = byKey.get(row.key)!;
      const scored = comparison.lifetimeTotal ?? comparison.expectedNpv;
      expect(row.full).toBe(Math.round(scored));
    }
    const best = analysis.comparisons.reduce((a, b) =>
      (b.lifetimeTotal ?? b.expectedNpv) > (a.lifetimeTotal ?? a.expectedNpv) ? b : a,
    );
    expect(bestFullKey).toBe(best.key);
  });

  it('reduces every strategy, and never by more than the reduction itself', async () => {
    // Benefits before the cut year are untouched, so no plan can lose the
    // full percentage — a row that did would mean the cut was applied to
    // dollars already paid.
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const { rows, assumption } = solvencySensitivity(analysis, TRUSTEES_ASSUMPTION)!;
    const cut = 1 - assumption.payablePercent / 100;
    for (const row of rows) {
      expect(row.reduced).toBeLessThan(row.full);
      expect((row.full - row.reduced) / row.full).toBeLessThanOrEqual(cut + 1e-9);
    }
  });

  it('takes the whole reduction when every dollar falls after the cut year', async () => {
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const { rows } = solvencySensitivity(analysis, { enabled: true, fromYear: 2000, payablePercent: 78 })!;
    for (const row of rows) {
      expect(row.reduced / row.full).toBeCloseTo(0.78, 4);
    }
  });

  it('changes nothing when the cut year is beyond every payment', async () => {
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const { rows } = solvencySensitivity(analysis, { enabled: true, fromYear: 2200, payablePercent: 78 })!;
    for (const row of rows) expect(row.reduced).toBe(row.full);
  });

  it('names the leader under each, so the page can say whether the answer moves', async () => {
    // The finding the page exists for. Delaying puts more money into later
    // years, which is where a cut falls, so the two need not agree.
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const result = solvencySensitivity(analysis, TRUSTEES_ASSUMPTION)!;
    const best = (pick: 'full' | 'reduced') =>
      result.rows.reduce((a, b) => (b[pick] > a[pick] ? b : a)).key;
    expect(result.bestFullKey).toBe(best('full'));
    expect(result.bestReducedKey).toBe(best('reduced'));
    expect(result.sameWinner).toBe(result.bestFullKey === result.bestReducedKey);
  });

  it('says nothing when there is no reduction to show', async () => {
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    expect(solvencySensitivity(analysis, { enabled: true, fromYear: 2032, payablePercent: 100 })).toBeNull();
  });

  it('prices a single claimant too', async () => {
    const single: Household = {
      status: 'single',
      people: [{ id: 'a', name: 'Priya', birthYear: 1965, birthMonth: 7, birthDay: 15, gender: 'female', piaMonthly: 3100, lifeExpectancy: 90 }],
    };
    const analysis = await analyzeHousehold(single, assumptions, asOf);
    const result = solvencySensitivity(analysis, TRUSTEES_ASSUMPTION)!;
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((r) => r.reduced < r.full)).toBe(true);
  });
});
