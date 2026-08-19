import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  longevityAges,
  longevitySensitivity,
  LONGEVITY_SPREAD_YEARS,
  MATERIAL_MARGIN,
} from './longevity';
import type { Household } from './household';

const asOf = new Date(2026, 7, 18);
const assumptions = { annualCola: 2.54, discountRate: 0.025 };

const married: Household = {
  status: 'married',
  people: [
    {
      id: 'a',
      name: 'Client',
      birthYear: 1978,
      birthMonth: 12,
      gender: 'male',
      piaMonthly: 3962,
      lifeExpectancy: 85,
    },
    {
      id: 'b',
      name: 'Spouse',
      birthYear: 1974,
      birthMonth: 2,
      gender: 'female',
      piaMonthly: 2000,
      lifeExpectancy: 88,
    },
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

describe('longevityAges', () => {
  it('brackets the planned ages by the spread, each person on their own age', () => {
    expect(longevityAges([85, 88])).toEqual([
      [85 - LONGEVITY_SPREAD_YEARS, 88 - LONGEVITY_SPREAD_YEARS],
      [85, 88],
      [85 + LONGEVITY_SPREAD_YEARS, 88 + LONGEVITY_SPREAD_YEARS],
    ]);
  });

  it('clamps rather than pricing a lifespan nobody has filed by', () => {
    // A plan-to age of 72 shifted down ten lands at 62, where neither person
    // has claimed and every strategy is worth nothing — a row of zeros that
    // says only that the floor was crossed.
    expect(longevityAges([72])[0]).toEqual([70]);
    expect(longevityAges([95])[2]).toEqual([100]);
  });
});

describe('longevitySensitivity', () => {
  it('prices every strategy at three lifespans, middle row as planned', async () => {
    const result = (await longevitySensitivity(married, assumptions, asOf))!;
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1].isPlanned).toBe(true);
    expect(result.rows[1].ages).toEqual([85, 88]);
    expect(result.strategies.length).toBeGreaterThan(1);
    // Every strategy priced in every row — a gap here would silently drop a
    // column from the printed table.
    for (const row of result.rows) {
      for (const strategy of result.strategies) {
        expect(typeof row.valueByKey[strategy.key]).toBe('number');
      }
    }
  });

  it('is worth more the longer they live', async () => {
    // A sanity check on the re-run itself: if the plan-to age were not
    // reaching the engine, all three rows would carry identical figures.
    const result = (await longevitySensitivity(married, assumptions, asOf))!;
    const total = (i: number) =>
      result.strategies.reduce((sum, s) => sum + result.rows[i].valueByKey[s.key], 0);
    expect(total(0)).toBeLessThan(total(1));
    expect(total(1)).toBeLessThan(total(2));
  });

  it('names the winner of each row, and reports one that wins them all', async () => {
    const result = (await longevitySensitivity(married, assumptions, asOf))!;
    for (const row of result.rows) {
      const best = Math.max(...result.strategies.map((s) => row.valueByKey[s.key]));
      expect(row.valueByKey[row.bestKey]).toBe(best);
    }
    // Either one key wins everywhere, or none is claimed to.
    if (result.winsEveryRow !== null) {
      expect(result.rows.every((r) => r.bestKey === result.winsEveryRow)).toBe(true);
    }
    // And the two verdicts are mutually exclusive — a page cannot both name
    // a winner and say the leaders are level.
    expect(result.winsEveryRow !== null && result.tiedEveryRow).toBe(false);
  });

  it('does not name a winner that leads by less than the margin', async () => {
    // A verdict naming a winner while two figures on the page print the same
    // number is the untruth this guards. Where a winner IS named, it leads
    // every row by at least the margin.
    const result = (await longevitySensitivity(married, assumptions, asOf))!;
    if (result.winsEveryRow === null) return;
    for (const row of result.rows) {
      const best = row.valueByKey[result.winsEveryRow];
      const others = result.strategies
        .filter((s) => s.key !== result.winsEveryRow)
        .map((s) => row.valueByKey[s.key]);
      expect((best - Math.max(...others)) / best).toBeGreaterThanOrEqual(MATERIAL_MARGIN);
    }
  });

  it('works for a single claimant too', async () => {
    const single: Household = { status: 'single', people: [married.people[0]] };
    const result = (await longevitySensitivity(single, assumptions, asOf))!;
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].ages).toEqual([75]);
  });
});
