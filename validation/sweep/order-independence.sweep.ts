/**
 * Invariant 1 — entry order must not change the analysis.
 *
 * The user's requirement, stated during Phase 2b-ii: *"Order of entry of
 * people should not matter for the app. I would like not to have to put the
 * older or younger person first or the higher or lower earning person in any
 * kind of order."*
 *
 * That took three attempts to fix, and the reason each earlier attempt looked
 * correct is the reason this sweep exists: the tests asserted the one field
 * being changed. `canonicalize` compares the entire analysis instead.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { householdAt, swapped } from './households';
import {
  analyze,
  canonicalize,
  firstDifference,
  stubLifeTableFetch,
  summarize,
  type Finding,
} from './harness';

const COUNT = Number(process.env.SWEEP_COUNT ?? 400);

beforeAll(() => vi.stubGlobal('fetch', stubLifeTableFetch()));
afterAll(() => vi.unstubAllGlobals());

describe('entry order does not change the analysis', () => {
  it(`holds across ${COUNT} generated households`, async () => {
    const findings: Finding[] = [];
    let married = 0;

    for (let index = 0; index < COUNT; index++) {
      const { household, label } = householdAt(index);
      if (household.status !== 'married') continue;
      married++;

      const [forward, reverse] = await Promise.all([
        analyze(household),
        analyze(swapped(household)),
      ]);

      const diff = firstDifference(canonicalize(forward), canonicalize(reverse));
      if (diff) findings.push({ index, label, detail: diff });
    }

    console.log(summarize(`order independence (${married} married households)`, findings));
    expect(findings).toEqual([]);
  });
});
