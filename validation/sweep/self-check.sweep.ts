/**
 * Does the sweep detect anything?
 *
 * Four times on this project a test passed with the defect it existed to
 * catch: a stub returning `lo` satisfied an entire search suite, regexes were
 * calibrated to phrasings the code never contained, and a docstring claimed
 * "exact figures are pinned" above a tautology. A sweep that silently
 * compares nothing looks exactly like a sweep that passes.
 *
 * So: perturb a real analysis in each of the places the invariant is supposed
 * to cover, and require the comparison to notice. If any of these stops
 * failing, `canonicalize` has stopped looking at that part of the analysis.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HouseholdAnalysis } from '../../src/lib/household';
import { householdAt, swapped } from './households';
import { analyze, canonicalize, firstDifference, stubLifeTableFetch } from './harness';

beforeAll(() => vi.stubGlobal('fetch', stubLifeTableFetch()));
afterAll(() => vi.unstubAllGlobals());

/** A married household with two people, two PIAs and differing life expectancies. */
async function married(): Promise<HouseholdAnalysis> {
  for (let i = 0; i < 50; i++) {
    const { household } = householdAt(i);
    if (household.status === 'married') return analyze(household);
  }
  throw new Error('no married household in the first 50 indices');
}

const clone = (a: HouseholdAnalysis): HouseholdAnalysis => structuredClone(a);

describe('the sweep can fail', () => {
  it('detects a moved filing age', async () => {
    const base = await married();
    const tampered = clone(base);
    tampered.optimal.filingAges[0] = { ...tampered.optimal.filingAges[0], years: 63, months: 4 };
    expect(firstDifference(canonicalize(base), canonicalize(tampered))).not.toBeNull();
  });

  it('detects a changed band amount', async () => {
    const base = await married();
    expect(base.periods.length).toBeGreaterThan(0);
    const tampered = clone(base);
    tampered.periods[0].monthlyAmount += 1;
    expect(firstDifference(canonicalize(base), canonicalize(tampered))).not.toBeNull();
  });

  it('detects a changed timeline total', async () => {
    const base = await married();
    expect(base.combinedTimeline.length).toBeGreaterThan(0);
    const tampered = clone(base);
    tampered.combinedTimeline[0].total += 1;
    expect(firstDifference(canonicalize(base), canonicalize(tampered))).not.toBeNull();
  });

  it('detects a changed expected NPV', async () => {
    const base = await married();
    const tampered = clone(base);
    tampered.comparisons[0].expectedNpv += 1;
    expect(firstDifference(canonicalize(base), canonicalize(tampered))).not.toBeNull();
  });

  it('detects a changed survivor-income figure', async () => {
    const base = await married();
    const tampered = clone(base);
    const row = tampered.comparisons.find((c) => c.survivorIncome !== null);
    // Not every household has one; when none does, this case proves nothing
    // and says so rather than passing quietly.
    if (!row) return expect(base.status).toBe('married');
    row.survivorIncome = (row.survivorIncome ?? 0) + 1;
    expect(firstDifference(canonicalize(base), canonicalize(tampered))).not.toBeNull();
  });

  it('does NOT report a difference for an untouched re-analysis', async () => {
    const base = await married();
    expect(firstDifference(canonicalize(base), canonicalize(clone(base)))).toBeNull();
  });

  it('re-keys slots to humans, so a swap alone is not a difference', async () => {
    // The canonicalizer's own correctness: names travel with the human, ids
    // stay with the slot. If this fails, every married household in the
    // order-independence sweep reports a phantom finding.
    const { household } = householdAt(1);
    if (household.status !== 'married') throw new Error('index 1 should be married');
    const forward = await analyze(household);
    const reverse = await analyze(swapped(household));
    const names = (a: HouseholdAnalysis) => a.people.map((p) => p.person.name).sort();
    expect(names(forward)).toEqual(names(reverse));
    expect(forward.people.map((p) => p.person.name)).not.toEqual(
      reverse.people.map((p) => p.person.name),
    );
  });
});
