import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from './household';
import { percentOfBest } from './claimingGrid';
import {
  comparisonsInDollarsMode,
  gridInDollarsMode,
  outrankedByDisplay,
  recommendationDetailInDollarsMode,
} from './displayDollars';
import { formatCurrency } from './format';
import { DEFAULT_SCENARIO_ROWS } from './scenario';
import { longevityInDollarsMode, longevitySensitivity } from './longevity';
import { TRUSTEES_ASSUMPTION, solvencyInDollarsMode, solvencySensitivity } from './solvency';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

const COUPLE: Household = {
  status: 'married',
  people: [
    { id: 'a', name: 'Vernetta', birthYear: 1961, birthMonth: 11, birthDay: 11, gender: 'female', piaMonthly: 3497, lifeExpectancy: 95 },
    { id: 'b', name: 'Terrell', birthYear: 1963, birthMonth: 4, birthDay: 7, gender: 'male', piaMonthly: 3548, lifeExpectancy: 95 },
  ],
};
const COLA = 2.54;
const AS_OF = new Date('2026-09-21');

/**
 * The grid and the strategy table print the same quantity — household value at
 * a pair of filing ages — so the best square and the Best row must agree, in
 * whichever dollars the reader has asked for.
 *
 * They did not. `analyzeHousehold` valued every square with `dollarsMode`
 * hardcoded to real, while the table beside it was restated on the way to the
 * page, so Comparison view printed $2,629,235 on the grid against $4,261,225
 * in the table: two blocks of the adviser preset, on facing pages, 62% apart
 * under the same column heading.
 */
describe('the claiming grid follows the report’s dollars', () => {
  const bases = [
    { label: 'default (real, discounted)', discountRate: 0.025, dollarsMode: 'real' as const },
    { label: 'comparison (nominal, undiscounted)', discountRate: 0, dollarsMode: 'nominal' as const },
  ];

  for (const basis of bases) {
    describe(basis.label, () => {
      let analysis: HouseholdAnalysis;
      beforeAll(async () => {
        analysis = await analyzeHousehold(
          COUPLE,
          { annualCola: COLA, discountRate: basis.discountRate },
          AS_OF,
        );
      });

      it('puts the same figure on the best square as the Best row', () => {
        const opts = {
          dollarsMode: basis.dollarsMode,
          annualCola: COLA,
          discountRate: basis.discountRate,
          asOfYear: AS_OF.getFullYear(),
        };
        const shown = comparisonsInDollarsMode(
          analysis.comparisons,
          analysis.people,
          analysis.finalIndexByPersonId,
          opts,
        );
        const grid = gridInDollarsMode(analysis.claimingGrid, basis.dollarsMode);
        const best = shown.find((c) => c.isOptimal);
        expect(best, 'the household must have an optimal strategy').toBeDefined();
        expect(grid, 'a couple must have a grid').not.toBeNull();
        // To the dollar. Both are summed from the same stream at the same
        // filing ages, so anything else is a basis disagreeing, not rounding.
        expect(Math.round(grid!.max)).toBe(Math.round(best!.householdValue));
      });

      it('rescales the board with it, so no square can read over 100%', () => {
        // `percentOfBest`, `gridRatio` and `cellsWithin` all measure against
        // `max`. Swapping the printed values while leaving the maximum behind
        // would shade and label every square against the wrong yardstick.
        const grid = gridInDollarsMode(analysis.claimingGrid, basis.dollarsMode)!;
        for (const cell of grid.cells) {
          expect(cell.value).toBeLessThanOrEqual(grid.max);
          expect(cell.value).toBeGreaterThanOrEqual(grid.min);
          expect(percentOfBest(grid, cell.value)).toBeLessThanOrEqual(100);
        }
        expect(percentOfBest(grid, grid.max)).toBe(100);
      });
    });
  }

  it('leaves the grid object alone in real dollars', async () => {
    // Identity, not a copy: `ClaimingGridPanel` memoizes on it, and the
    // default path must not hand back a new object every render.
    const analysis = await analyzeHousehold(COUPLE, { annualCola: COLA, discountRate: 0.025 }, AS_OF);
    expect(gridInDollarsMode(analysis.claimingGrid, 'real')).toBe(analysis.claimingGrid);
    expect(gridInDollarsMode(null, 'nominal')).toBeNull();
  });

  it('actually moves the board — the two bases are different figures', async () => {
    // A positive control. Both assertions above would pass on a grid that
    // ignored `dollarsMode` entirely if the table did too.
    const analysis = await analyzeHousehold(COUPLE, { annualCola: COLA, discountRate: 0 }, AS_OF);
    const real = gridInDollarsMode(analysis.claimingGrid, 'real')!;
    const nominal = gridInDollarsMode(analysis.claimingGrid, 'nominal')!;
    expect(nominal.max).toBeGreaterThan(real.max * 1.3);
  });
});

/**
 * A household whose optimum is NOT the latest filing pair, which is what makes
 * it useful here: discounting is the only reason the recommendation beats
 * waiting longer, so every basis question this file asks has a visible answer.
 */
const SPLIT: Household = {
  status: 'married',
  people: [
    { id: 'a', name: 'John', birthYear: 1962, birthMonth: 4, birthDay: 15, gender: 'male', piaMonthly: 2400, lifeExpectancy: 85 },
    { id: 'b', name: 'Jane', birthYear: 1964, birthMonth: 2, birthDay: 15, gender: 'female', piaMonthly: 2100, lifeExpectancy: 88 },
  ],
};

describe('the sensitivity blocks follow the report’s dollars', () => {
  let analysis: HouseholdAnalysis;
  beforeAll(async () => {
    analysis = await analyzeHousehold(SPLIT, { annualCola: COLA, discountRate: 0.025 }, AS_OF);
  });

  it('prices longevity at the figure the strategy table prints', async () => {
    // It used to price `expectedNpv`, a third basis: the same strategies at
    // the same ages, a few pages apart, differing by the six-month seam.
    const sensitivity = (await longevitySensitivity(
      SPLIT,
      { annualCola: COLA, discountRate: 0.025 },
      AS_OF,
    ))!;
    const planned = sensitivity.rows.find((r) => r.isPlanned)!;
    for (const strategy of sensitivity.strategies) {
      const comparison = analysis.comparisons.find((c) => c.key === strategy.key)!;
      expect(planned.valueByKey[strategy.key], strategy.label).toBeCloseTo(
        comparison.householdValue,
        2,
      );
    }
  });

  it('restates longevity, and re-decides the winner on the restated figures', async () => {
    const real = (await longevitySensitivity(
      SPLIT,
      { annualCola: COLA, discountRate: 0.025 },
      AS_OF,
    ))!;
    const nominal = longevityInDollarsMode(real, 'nominal')!;
    expect(longevityInDollarsMode(real, 'real')).toBe(real);

    for (const row of nominal.rows) {
      const twin = real.rows.find((r) => r.label === row.label)!;
      for (const s of nominal.strategies) {
        expect(row.valueByKey[s.key]).toBeGreaterThan(twin.valueByKey[s.key]);
      }
      // The bold figure is the biggest one in its own row, in either basis.
      // Recomputing is the point: nominal weights later years more, so a row
      // can change hands between the two.
      const best = Math.max(...nominal.strategies.map((s) => row.valueByKey[s.key]));
      expect(row.valueByKey[row.bestKey]).toBe(best);
    }
  });

  it('restates solvency, and keeps each column’s mark on its own largest figure', () => {
    const real = solvencySensitivity(analysis, TRUSTEES_ASSUMPTION)!;
    const nominal = solvencyInDollarsMode(real, 'nominal')!;
    expect(solvencyInDollarsMode(real, 'real')).toBe(real);

    for (const table of [real, nominal]) {
      const top = (pick: 'full' | 'reduced') =>
        table.rows.reduce((a, b) => (b[pick] > a[pick] ? b : a)).key;
      expect(table.bestFullKey).toBe(top('full'));
      expect(table.bestReducedKey).toBe(top('reduced'));
      expect(table.sameWinner).toBe(table.bestFullKey === table.bestReducedKey);
    }
    for (const row of nominal.rows) {
      expect(row.full).toBeGreaterThan(real.rows.find((r) => r.key === row.key)!.full);
    }
  });
});

/**
 * The one disagreement a basis switch cannot convert away.
 *
 * Undiscounted, a plan that waits longer collects more dollars than the
 * recommendation does, and the table says so in its own "vs. best" column by
 * printing a POSITIVE delta on a row that is not marked best. Both figures are
 * right; the page has to account for the pair.
 */
describe('a recommendation that is not the largest figure on the page', () => {
  const opts = (dollarsMode: 'real' | 'nominal', discountRate: number) => ({
    dollarsMode,
    annualCola: COLA,
    discountRate,
    asOfYear: AS_OF.getFullYear(),
  });

  it('says nothing in the basis the recommendation is made in', async () => {
    const analysis = await analyzeHousehold(SPLIT, { annualCola: COLA, discountRate: 0.025 }, AS_OF);
    const shown = comparisonsInDollarsMode(
      analysis.comparisons,
      analysis.people,
      analysis.finalIndexByPersonId,
      opts('real', 0.025),
    );
    expect(outrankedByDisplay(shown)).toBeNull();
  });

  it('names the outranking plan once the discount is taken away', async () => {
    const analysis = await analyzeHousehold(SPLIT, { annualCola: COLA, discountRate: 0 }, AS_OF);
    const shown = comparisonsInDollarsMode(
      analysis.comparisons,
      analysis.people,
      analysis.finalIndexByPersonId,
      opts('nominal', 0),
    );
    const outranked = outrankedByDisplay(shown);
    expect(outranked, 'this household must show the disagreement').not.toBeNull();
    expect(outranked!.isOptimal).toBe(false);
    // And it really is ahead of the recommendation, by a delta the table
    // itself prints as positive.
    const best = shown.find((c) => c.isOptimal)!;
    expect(outranked!.householdValue).toBeGreaterThan(best.householdValue);
    expect(outranked!.deltaVsOptimal).toBeGreaterThan(0);
  });

  it('is quiet for a household whose recommendation wins in every basis', async () => {
    // Vernetta and Terrell both file at 70, so nothing can outrank them.
    const analysis = await analyzeHousehold(COUPLE, { annualCola: COLA, discountRate: 0 }, AS_OF);
    const shown = comparisonsInDollarsMode(
      analysis.comparisons,
      analysis.people,
      analysis.finalIndexByPersonId,
      opts('nominal', 0),
    );
    expect(outrankedByDisplay(shown)).toBeNull();
  });
});

/**
 * The sentence under the recommendation quotes a dollar figure, and that
 * figure has to be the one the Best row beside it prints. It was built once,
 * in today's dollars, and printed unchanged in future dollars: on this couple
 * the card said "$867,416 … more than any other pair" over a Best row of
 * $1,892,838 and a Delay-to-70 row of $1,920,856.
 */
describe('the recommendation sentence follows the report’s dollars', () => {
  const PROBE: Household = {
    status: 'married',
    people: [
      { id: 'a', name: 'John', birthYear: 1962, birthMonth: 6, birthDay: 15, gender: 'male', piaMonthly: 3000, lifeExpectancy: 85 },
      { id: 'b', name: 'Jane', birthYear: 1964, birthMonth: 6, birthDay: 15, gender: 'female', piaMonthly: 1500, lifeExpectancy: 90 },
    ],
  };
  const SINGLE: Household = {
    status: 'single',
    people: [
      { id: 'a', name: 'John', birthYear: 1962, birthMonth: 6, birthDay: 15, gender: 'male', piaMonthly: 3000, lifeExpectancy: 85 },
    ],
  };
  const assumptions = { annualCola: COLA, discountRate: 0.025 };
  const nominal = (a: HouseholdAnalysis) => ({
    dollarsMode: 'nominal' as const,
    annualCola: COLA,
    discountRate: a.assumptions.discountRate,
    asOfYear: AS_OF.getFullYear(),
  });
  const shownRows = (a: HouseholdAnalysis) =>
    comparisonsInDollarsMode(a.allComparisons, a.people, a.finalIndexByPersonId, nominal(a));

  it('is the analysis’s own sentence in today’s dollars', async () => {
    const a = await analyzeHousehold(PROBE, assumptions, AS_OF);
    const opts = { ...nominal(a), dollarsMode: 'real' as const };
    expect(recommendationDetailInDollarsMode(a, a.allComparisons, opts)).toBe(a.recommendationDetail);
  });

  it('quotes the Best row’s future-dollar figure, and scopes the ranking claim', async () => {
    const a = await analyzeHousehold(PROBE, assumptions, AS_OF);
    const rows = shownRows(a);
    const best = rows.find((r) => r.isOptimal)!;
    // Guard: the two bases really do print different figures for this row.
    expect(best.householdValue).not.toBeCloseTo(a.optimal.householdValue, 0);

    const text = recommendationDetailInDollarsMode(a, rows, nominal(a));
    expect(text).toContain(formatCurrency(best.householdValue));
    expect(text).not.toContain(formatCurrency(a.optimal.householdValue));
    expect(text).toContain('in future dollars');
    // In future dollars another pair can print more; the claim is only true
    // in the dollars the recommendation is ranked in, and must say so.
    expect(outrankedByDisplay(rows)).not.toBeNull();
    expect(text).not.toContain('more than any other pair');
    expect(text).toContain('Counted in today’s dollars, no other pair of ages is worth more.');
  });

  it('prices a chosen scenario in future dollars, and its cost in today’s', async () => {
    const a = await analyzeHousehold(PROBE, assumptions, AS_OF, {
      rows: [...DEFAULT_SCENARIO_ROWS],
      selectedId: 'earliest',
    });
    expect(a.scenarioIsBest).toBe(false);
    const rows = shownRows(a);
    const selected = rows.find((r) => r.isSelected)!;
    const best = rows.find((r) => r.isOptimal)!;
    const realShortfall = a.optimal.householdValue - a.selected.householdValue;
    expect(realShortfall).toBeGreaterThan(0);

    const text = recommendationDetailInDollarsMode(a, rows, nominal(a));
    expect(text).toContain(formatCurrency(selected.householdValue));
    expect(text).toContain(formatCurrency(best.householdValue));
    expect(text).toContain(`${formatCurrency(realShortfall)} less`);
    expect(text).not.toContain(formatCurrency(a.selected.householdValue));
  });

  it('does the same for one person', async () => {
    const a = await analyzeHousehold(SINGLE, assumptions, AS_OF);
    const rows = shownRows(a);
    const best = rows.find((r) => r.isOptimal)!;
    const text = recommendationDetailInDollarsMode(a, rows, nominal(a));
    expect(text).toContain(formatCurrency(best.householdValue));
    expect(text).toContain('in future dollars');
    expect(text).not.toContain('more than any other age');
    expect(text).toContain('Counted in today’s dollars, no other age is worth more.');
    // The monthly figure is not restated, so it has to say which dollars it is in.
    expect(text).toMatch(/a month in today’s dollars/);
  });
});
