import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeHousehold, type Household } from './household';
import {
  DEFAULT_SOLVENCY,
  TRUSTEES_ASSUMPTION,
  TRUSTEES_PROJECTION,
  solvencyInDollarsMode,
  solvencySensitivity,
  type SolvencyRow,
} from './solvency';
import { leadMargin, MATERIAL_MARGIN } from './materiality';

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
      // `householdValue`, which is what the strategy table prints — NOT the
      // engine's `expectedNpv`, which differs from it by the six-month seam
      // and had this page quoting totals a couple of hundred dollars above
      // the table it is a sensitivity on.
      expect(row.full).toBe(Math.round(byKey.get(row.key)!.householdValue));
    }
    // And the as-scheduled leader is still the plan the report recommends —
    // the cross-page agreement this test was always about. Ranking moved onto
    // the printed figure, so this is the assertion that keeps it honest.
    expect(bestFullKey).toBe(analysis.comparisons.find((c) => c.isOptimal)!.key);
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

/**
 * The verdict is allowed three answers, not two.
 *
 * It used to name a new winner under the reduction on any margin at all. For
 * this couple that meant flipping from "your plan holds up either way" to "if
 * benefits are cut, claiming early is better" on $3,046 of $627,000 — and the
 * reassuring answer it gave before was itself decided by $444. Neither is a
 * finding; both read as one.
 */
describe('a reduction that changes the leader by almost nothing', () => {
  it('flags the change as too close to call, without hiding that it happened', async () => {
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const result = solvencySensitivity(analysis, TRUSTEES_ASSUMPTION)!;

    // `sameWinner` stays strictly about the keys — the leaders really are
    // different, the marks in the table sit on different rows, and a caller
    // wanting the raw comparison still has it.
    expect(result.sameWinner).toBe(false);
    expect(result.bestFullKey).not.toBe(result.bestReducedKey);
    // It is only the one-sentence conclusion that holds back.
    expect(result.tooCloseToCall).toBe(true);

    // And the margin really is inside the threshold, measured between the two
    // plans the sentence names — the new leader and the old one. So this is
    // the case the flag is for, not a flag that is simply always on.
    const reducedOf = (key: string) => result.rows.find((r) => r.key === key)!.reduced;
    const named = leadMargin([reducedOf(result.bestReducedKey), reducedOf(result.bestFullKey)]);
    expect(named).toBeLessThan(MATERIAL_MARGIN);
    expect(named).toBeGreaterThan(0);
  });

  it('measures the pair it names, not the reduced column’s top two', () => {
    // A third plan can sit between the new leader and the old one. Measuring
    // top-against-runner-up would then clear the threshold on a pair the
    // sentence never mentions, and print "these two come within half a
    // percent of each other" about two figures 10% apart.
    //
    // Reached through `solvencyInDollarsMode`, which re-runs the same private
    // leader logic over the nominal figures — so this is the real rule, not a
    // reimplementation of it.
    const row = (key: string, reducedNominal: number, fullNominal: number): SolvencyRow => ({
      key,
      label: key,
      full: 0,
      reduced: 0,
      fullNominal,
      reducedNominal,
    });
    const staged = solvencyInDollarsMode(
      {
        assumption: TRUSTEES_ASSUMPTION,
        rows: [
          row('new-leader', 100, 10),
          row('in-between', 99.9, 20),
          row('old-leader', 90, 30),
        ],
        bestFullKey: '',
        bestReducedKey: '',
        sameWinner: false,
        tooCloseToCall: false,
      },
      'nominal',
    )!;
    expect(staged.bestFullKey).toBe('old-leader');
    expect(staged.bestReducedKey).toBe('new-leader');
    // Top two are 0.1% apart; the pair being named is 10% apart. The change
    // is real and must be reported as one.
    expect(leadMargin(staged.rows.map((r) => r.reduced))).toBeLessThan(MATERIAL_MARGIN);
    expect(staged.tooCloseToCall).toBe(false);
  });

  it('still calls a change a change when the gap is big enough to act on', async () => {
    // The positive control, and a real one rather than a synthetic table: the
    // SAME household restated in future dollars, where the reduced column's
    // top two are 0.63% apart instead of 0.49%. Without this the test above
    // would pass on a flag that was simply always set.
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const future = solvencyInDollarsMode(
      solvencySensitivity(analysis, TRUSTEES_ASSUMPTION)!,
      'nominal',
    )!;
    expect(future.sameWinner).toBe(false);
    expect(future.tooCloseToCall).toBe(false);
    expect(leadMargin(future.rows.map((r) => r.reduced))).toBeGreaterThan(MATERIAL_MARGIN);
  });

  it('says nothing about closeness when the leader does not change at all', async () => {
    // Beyond every payment, so nothing is reduced and the columns are equal.
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const unchanged = solvencySensitivity(analysis, {
      enabled: true,
      fromYear: 2200,
      payablePercent: 78,
    })!;
    expect(unchanged.sameWinner).toBe(true);
    expect(unchanged.tooCloseToCall).toBe(false);
  });
});
