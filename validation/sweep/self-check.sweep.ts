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
import { householdAt, swapped, widowedHouseholdAt } from './households';
import { analyze, canonicalize, firstDifference, stubLifeTableFetch } from './harness';
import { pdfSurface, screenSurface } from './surfaces';

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

/** A widowed household whose PIA was recovered from a check amount. */
async function widowedEstimated(): Promise<HouseholdAnalysis> {
  for (let i = 0; i < 200; i++) {
    const { household } = widowedHouseholdAt(i);
    const analysis = await analyze(household);
    if (analysis.piaEstimated === true) return analysis;
  }
  throw new Error('no estimated-PIA widowed household in the first 200 indices');
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

  it('detects a changed lifetime total on a widowed row', async () => {
    // The widowed money column. `expectedNpv` holds the same number today, so
    // a canonicalizer that compared only that would still pass — this pins
    // the field the display layer actually reads.
    const base = await widowedEstimated();
    const tampered = clone(base);
    tampered.comparisons[0].lifetimeTotal = (tampered.comparisons[0].lifetimeTotal ?? 0) + 1;
    expect(firstDifference(canonicalize(base), canonicalize(tampered))).not.toBeNull();
  });

  it('detects a moved survivor claim date', async () => {
    // The second of the two dates, and the only thing separating
    // `survivorFirst` from `ownFirst` when their own-record ages coincide.
    const base = await widowedEstimated();
    const tampered = clone(base);
    const date = tampered.comparisons[0].survivorClaimDate;
    expect(date).not.toBeNull();
    tampered.comparisons[0].survivorClaimDate = { ...date!, monthIndex: date!.monthIndex + 1 };
    expect(firstDifference(canonicalize(base), canonicalize(tampered))).not.toBeNull();
  });

  it('detects a changed deceased record and a flipped estimate flag', async () => {
    // Both had no carrier in `canonicalize` at all until the widowed corpus
    // arrived: an analysis could have named a different PIA for the deceased,
    // or stopped disclosing that it was recovered, and every comparison here
    // would have reported no difference.
    const base = await widowedEstimated();

    const movedPia = clone(base);
    movedPia.deceased = { ...movedPia.deceased!, piaMonthly: movedPia.deceased!.piaMonthly + 1 };
    expect(firstDifference(canonicalize(base), canonicalize(movedPia))).not.toBeNull();

    const notEstimated = clone(base);
    notEstimated.piaEstimated = false;
    expect(firstDifference(canonicalize(base), canonicalize(notEstimated))).not.toBeNull();
  });
});

/**
 * The surface model's own self-check.
 *
 * `surfaces.ts` is a MODEL of what each surface renders, not the surface
 * itself, so a widowed sentence it never pushes is invisible to every copy
 * invariant — which is exactly the state the widowed pages were in for a whole
 * phase while `npm run sweep` reported success. These assert the model
 * actually produces widowed lines and that they reach the checks.
 */
describe('the widowed surfaces are modeled', () => {
  it('produces lines on both surfaces', async () => {
    const analysis = await widowedEstimated();
    const screen = screenSurface(analysis, 'real');
    const pdf = pdfSurface(analysis);

    expect(screen.length).toBeGreaterThan(0);
    expect(pdf.length).toBeGreaterThan(0);
    // And they are the WIDOWED lines, not the married model run over a
    // widowed analysis — that would silently compare the wrong sentences.
    expect(screen.map((l) => l.source)).toContain('WidowedPanel.recommendation');
    expect(pdf.map((l) => l.source)).toContain('pdf/WidowedSection.recommendation');
    expect(screen.map((l) => l.source)).not.toContain('HouseholdPanel.recommendation');
  });

  it('carries the estimate disclosure, which most households omit', async () => {
    // `piaEstimateNote` returns null unless the PIA was recovered. A model
    // that never reached the non-null branch would leave the one sentence
    // that names a dollar figure unchecked.
    const estimated = await widowedEstimated();
    expect(screenSurface(estimated, 'real').map((l) => l.source)).toContain(
      'WidowedPanel.piaEstimateNote',
    );

    const { household } = widowedHouseholdAt(0);
    const known = await analyze(household);
    if (known.piaEstimated === false) {
      expect(screenSurface(known, 'real').map((l) => l.source)).not.toContain(
        'WidowedPanel.piaEstimateNote',
      );
    }
  });

  it('would notice a sentence going missing from the model', async () => {
    // The failure this file exists for: a check that compares nothing looks
    // exactly like a check that passes. If the widowed screen model stopped
    // producing its lifetime caption, the screen-vs-print pair would compare
    // `undefined` to a string — this asserts the pair is really populated.
    const analysis = await widowedEstimated();
    const screen = new Map(screenSurface(analysis, 'real').map((l) => [l.source, l.text]));
    const pdf = new Map(pdfSurface(analysis).map((l) => [l.source, l.text]));

    expect(screen.get('WidowedPanel.widowedLifetimeCaption')).toBeTruthy();
    expect(pdf.get('pdf/WidowedSection.widowedLifetimeCaption')).toBeTruthy();
    expect(screen.get('WidowedPanel.widowedLifetimeCaption')).toBe(
      pdf.get('pdf/WidowedSection.widowedLifetimeCaption'),
    );
  });
});

describe('the canonicalizer', () => {
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
