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
import { householdAt, swapped, widowedHouseholdAt } from './households';
import {
  analyze,
  canonicalize,
  firstDifference,
  stubLifeTableFetch,
  summarize,
  type Finding,
} from './harness';

const COUNT = Number(process.env.SWEEP_COUNT ?? 400);
const WIDOWED_COUNT = Number(process.env.SWEEP_WIDOWED_COUNT ?? Math.ceil(COUNT / 4));

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

/**
 * A widow(er) has one person, so there is no entry order to swap — `swapped`
 * returns the household untouched and the invariant above is vacuous for it.
 *
 * What IS worth asserting is the property that invariant is a special case of:
 * the analysis is a function of the household and nothing else. A widowed
 * analysis runs a bisection over engine calls to recover a PIA and an
 * exhaustive ~8,200-pair search, both of which have more room to pick up an
 * accidental dependence on iteration order than the couple optimizer does.
 */
describe('a widowed analysis is a function of its household', () => {
  it(`is identical when run twice across ${WIDOWED_COUNT} households`, async () => {
    const findings: Finding[] = [];

    for (let index = 0; index < WIDOWED_COUNT; index++) {
      const { household, label } = widowedHouseholdAt(index);
      const [first, second] = await Promise.all([analyze(household), analyze(household)]);
      const diff = firstDifference(canonicalize(first), canonicalize(second));
      if (diff) findings.push({ index, label, detail: diff });
    }

    console.log(summarize(`widowed determinism (${WIDOWED_COUNT} households)`, findings));
    expect(findings).toEqual([]);
  });

  it(`does not depend on a deep-cloned input across ${WIDOWED_COUNT} households`, async () => {
    // The other half: analyzing a structurally identical COPY must give the
    // same answer. This is what catches an analysis that mutates its input —
    // `analyzeWidowed` reads `household.deceased` in three places and one of
    // them recovers a PIA by bisection.
    const findings: Finding[] = [];

    for (let index = 0; index < WIDOWED_COUNT; index++) {
      const { household, label } = widowedHouseholdAt(index);
      const first = await analyze(household);
      const second = await analyze(structuredClone(household));
      const diff = firstDifference(canonicalize(first), canonicalize(second));
      if (diff) findings.push({ index, label, detail: diff });
      // And the household itself must come back unchanged.
      const { household: fresh } = widowedHouseholdAt(index);
      if (JSON.stringify(household) !== JSON.stringify(fresh)) {
        findings.push({ index, label, detail: 'the analysis mutated the household it was given' });
      }
    }

    console.log(summarize(`widowed input immutability (${WIDOWED_COUNT} households)`, findings));
    expect(findings).toEqual([]);
  });
});
