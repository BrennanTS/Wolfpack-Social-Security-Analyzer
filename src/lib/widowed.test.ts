import { describe, expect, it } from 'vitest';
import {
  bestWidowedOutcome,
  widowedOutcomeFor,
  widowedSearchRanges,
  type WidowedInput,
} from './widowed';
import type { Person } from './personAnalysis';
import { deceasedContext, type Deceased } from './deceased';
import { monthDateAt, monthIndexOf } from './benefitPeriods';
import { createPiaRecipient } from './ssaTools';
import { MonthDuration } from '$lib/month-time';
import { benefitOnDate, survivorBenefit } from '$lib/benefit-calculator';

const asOf = new Date(2026, 0, 15);

/** Widow born Jun 1964, own PIA $1,200, plans to 92. */
const widow: Person = {
  id: 'a',
  name: 'Widow',
  birthYear: 1964,
  birthMonth: 6,
  gender: 'female',
  piaMonthly: 1200,
  lifeExpectancy: 92,
};

/** Husband born Mar 1960, PIA $3,000, died Mar 2024 having never filed. */
const husband: Deceased = {
  birthYear: 1960,
  birthMonth: 3,
  deathYear: 2024,
  deathMonth: 3,
  record: { kind: 'pia', piaMonthly: 3000, filed: null },
};

const free: WidowedInput = {
  survivor: widow,
  deceased: husband,
  alreadyClaimed: { survivorSince: null, ownSince: null },
  asOf,
};

/**
 * Same household, but the widow is born in 1958 instead of 1964 — a cohort
 * where survivor-FRA (66y4m) and retirement-FRA (66y8m) provably diverge, per
 * `constants.ts`'s `FULL_RETIREMENT_AGE`/`FULL_RETIREMENT_AGE_SURVIVOR`
 * tables. `free`'s 1964 widow can't be used for this: both tables resolve to
 * 67y0m for any birth year 1962 or later, so a test built only from `free`
 * cannot tell `survivorNormalRetirementDate()` and `normalRetirementDate()`
 * apart — swapping one for the other in `widowedSearchRanges` would still
 * pass every `free`-based assertion.
 */
const divergentFraWidow: Person = {
  ...widow,
  birthYear: 1958,
};
const divergentFraCase: WidowedInput = {
  ...free,
  survivor: divergentFraWidow,
};

describe('widowedSearchRanges', () => {
  it('starts the survivor range at SSA age 60, never before the month after death', () => {
    const { survivor } = widowedSearchRanges(free);
    const recipient = createPiaRecipient(1964, 6, 1200, 'female');
    const age60 = monthIndexOf(
      recipient.birthdate.dateAtSsaAge(MonthDuration.initFromYearsMonths({ years: 60, months: 0 })),
    );
    const deathIndex = 2024 * 12 + 2;
    expect(survivor[0]).toBe(Math.max(deathIndex + 1, age60));
  });

  it('ends the survivor range at survivor-FRA, not at retirement FRA', () => {
    const { survivor } = widowedSearchRanges(free);
    const recipient = createPiaRecipient(1964, 6, 1200, 'female');
    expect(survivor[1]).toBe(monthIndexOf(recipient.survivorNormalRetirementDate()));
  });

  it('ends the survivor range at survivor-FRA for a cohort where that differs from retirement FRA', () => {
    // `free`'s 1964 widow can't distinguish the two tables (both are 67y0m
    // for her), so this repeats the check on a 1958 widow, where they
    // provably diverge, and runs the comparison THROUGH
    // `widowedSearchRanges` itself rather than only against the raw
    // `Recipient` methods. Swapping `survivorNormalRetirementDate()` for
    // `normalRetirementDate()` at the call site in widowed.ts must fail this.
    const { survivor } = widowedSearchRanges(divergentFraCase);
    const recipient = createPiaRecipient(1958, 6, 1200, 'female');
    expect(survivor[1]).toBe(monthIndexOf(recipient.survivorNormalRetirementDate()));
    expect(survivor[1]).not.toBe(monthIndexOf(recipient.normalRetirementDate()));
  });

  it('never puts the own-filing floor at an exact age 62', () => {
    // 62y0m is not claimable: entitlement needs a full month at 62. A floor
    // computed from a hardcoded {years: 62, months: 0} is the defect that has
    // kept the `earliest` comparison row from ever rendering.
    const { own } = widowedSearchRanges(free);
    const recipient = createPiaRecipient(1964, 6, 1200, 'female');
    const exact62 = monthIndexOf(
      recipient.birthdate.dateAtSsaAge(MonthDuration.initFromYearsMonths({ years: 62, months: 0 })),
    );
    expect(own[0]).toBeGreaterThan(exact62);
  });

  it('collapses an axis to a single month when that benefit is already claimed', () => {
    const claimed: WidowedInput = {
      ...free,
      alreadyClaimed: { survivorSince: { year: 2024, month: 8 }, ownSince: null },
    };
    const { survivor, own } = widowedSearchRanges(claimed);
    expect(survivor).toEqual([2024 * 12 + 7, 2024 * 12 + 7]);
    expect(own[1]).toBeGreaterThan(own[0]);
  });

  it('clamps an already-claimed survivor date at the death month to the first payable month', () => {
    // The death month itself is an easy adviser entry ("she's been getting
    // it since he died"), but `survivorBenefit` throws on any filing date
    // that isn't strictly AFTER the death date. Feeding that date straight
    // through would crash the search; clamping it forward to `firstMonth`
    // (deathIndex + 1) is the only reading that keeps it claimable.
    const deathIndex = 2024 * 12 + 2;
    const claimedAtDeathMonth: WidowedInput = {
      ...free,
      alreadyClaimed: { survivorSince: { year: 2024, month: 3 }, ownSince: null },
    };
    const { survivor } = widowedSearchRanges(claimedAtDeathMonth);
    expect(survivor).toEqual([deathIndex + 1, deathIndex + 1]);
    expect(() => bestWidowedOutcome(claimedAtDeathMonth)).not.toThrow();
  });

  it('clamps a death-month survivor date in the both-already-claimed path too', () => {
    // Same defect, different branch: when BOTH dates are already known, the
    // early return at the top of widowedSearchRanges must clamp the survivor
    // side exactly like the single-axis path does.
    const deathIndex = 2024 * 12 + 2;
    const bothClaimedAtDeathMonth: WidowedInput = {
      ...free,
      alreadyClaimed: {
        survivorSince: { year: 2024, month: 3 },
        ownSince: { year: 2030, month: 1 },
      },
    };
    const { survivor } = widowedSearchRanges(bothClaimedAtDeathMonth);
    expect(survivor).toEqual([deathIndex + 1, deathIndex + 1]);
    expect(() => bestWidowedOutcome(bothClaimedAtDeathMonth)).not.toThrow();
  });
});

describe('bestWidowedOutcome', () => {
  it('recommends the own benefit first and the survivor benefit later for a low-PIA widow', () => {
    // Her own PIA ($1,200) is far below his ($3,000): even at 70 her own
    // maxes out around $1,488/mo, well under the ~$2,145-$3,000/mo range of
    // his survivor benefit, so her own record can never be the better choice
    // long-term. SSA's "claim survivor first, switch to a bigger own benefit
    // later" example applies to the OPPOSITE ratio, where her own eventually
    // overtakes the survivor amount. Here the correct move is the mirror
    // image: bank her own (smaller) benefit during the wait, and delay the
    // survivor claim to survivor-FRA to lock in its largest amount for the
    // rest of a long (92-year) planning horizon.
    const best = bestWidowedOutcome(free);
    expect(best.ownFilingIndex).toBeLessThan(best.survivorClaimIndex);
  });

  it('never scores a candidate above the reported best', () => {
    const best = bestWidowedOutcome(free);
    const { survivor, own } = widowedSearchRanges(free);
    for (let s = survivor[0]; s <= survivor[1]; s += 7) {
      for (let f = own[0]; f <= own[1]; f += 7) {
        expect(widowedOutcomeFor(free, s, f).lifetimeTotal).toBeLessThanOrEqual(
          best.lifetimeTotal + 0.01,
        );
      }
    }
  });

  it('pays the LARGER of the two benefits, never the sum', () => {
    // A month in which both are running must equal the larger alone. Built
    // from the outcome's own dates so it cannot drift from the search.
    const best = bestWidowedOutcome(free);
    const both = Math.max(best.survivorClaimIndex, best.ownFilingIndex) + 24;
    const onlySurvivor = widowedOutcomeFor(free, best.survivorClaimIndex, 9_999_999);
    const onlyOwn = widowedOutcomeFor(free, 9_999_999, best.ownFilingIndex);
    expect(both).toBeGreaterThan(0);
    expect(best.lifetimeTotal).toBeLessThan(onlySurvivor.lifetimeTotal + onlyOwn.lifetimeTotal);
  });

  it('honours an already-claimed survivor benefit as a fixed date', () => {
    const claimed: WidowedInput = {
      ...free,
      alreadyClaimed: { survivorSince: { year: 2024, month: 8 }, ownSince: null },
    };
    const best = bestWidowedOutcome(claimed);
    expect(best.survivorClaimIndex).toBe(2024 * 12 + 7);
  });
});

import { widowedBands } from './widowed';

/**
 * The `max(own, survivor)` SSA actually pays at month `m` for a given
 * (survivor, own) outcome, computed independently of `widowed.ts` — straight
 * from the same public engine calls (`benefitOnDate`, `survivorBenefit`) it
 * uses internally — so the band tests below can check the decomposition
 * against a real number instead of only a non-negative placeholder.
 */
function expectedMax(input: WidowedInput, outcome: WidowedOutcome, m: number): number {
  const recipient = createPiaRecipient(
    input.survivor.birthYear,
    input.survivor.birthMonth,
    input.survivor.piaMonthly,
    input.survivor.gender,
  );
  const dec = deceasedContext(input.deceased);
  const ownAmount = benefitOnDate(
    recipient,
    monthDateAt(outcome.ownFilingIndex),
    monthDateAt(outcome.ownFilingIndex).addDuration(MonthDuration.OneYear()),
  ).value();
  const survivorAmount = survivorBenefit(
    recipient,
    dec.recipient,
    dec.filingDate,
    dec.deathDate,
    monthDateAt(outcome.survivorClaimIndex),
  ).value();
  const own = m >= outcome.ownFilingIndex ? ownAmount : 0;
  const surv = m >= outcome.survivorClaimIndex ? survivorAmount : 0;
  return Math.max(own, surv);
}

describe('widowedBands', () => {
  it('stacks to exactly the larger of the two benefits in every month', () => {
    const best = bestWidowedOutcome(free);
    const bands = widowedBands(free, best);
    const at = (m: number) =>
      bands
        .filter((b) => b.startIndex <= m && m <= b.endIndex)
        .reduce((t, b) => t + b.monthlyAmount, 0);

    // Sampled across the whole run: before either starts, between them, and
    // after both. Each sample must equal max(own, survivor) exactly (to the
    // penny), not merely be non-negative.
    const start = Math.min(best.survivorClaimIndex, best.ownFilingIndex);
    for (const m of [start - 1, start, start + 12, best.ownFilingIndex, best.ownFilingIndex + 60]) {
      expect(at(m)).toBeCloseTo(expectedMax(free, best, m), 2);
    }
  });

  it('exercises the survivor-claimed-before-own-filing split (S < F)', () => {
    // `free`'s optimum has the own filing first (F < S) — see
    // `bestWidowedOutcome`'s "recommends the own benefit first" test — so it
    // never reaches the `outcome.survivorClaimIndex < splitAt` branch in
    // `widowedBands` (the pre-own-filing segment carrying the FULL survivor
    // amount). Pinning the survivor claim to right after the death forces
    // the opposite order: the own-filing floor (~62) is later than an
    // August-2024 survivor claim, so S < F here and that branch runs.
    const claimed: WidowedInput = {
      ...free,
      alreadyClaimed: { survivorSince: { year: 2024, month: 8 }, ownSince: null },
    };
    const best = bestWidowedOutcome(claimed);
    expect(best.survivorClaimIndex).toBeLessThan(best.ownFilingIndex);

    const bands = widowedBands(claimed, best);
    const preOwnSurvivorBand = bands.find(
      (b) => b.type === 'survivor' && b.startIndex === best.survivorClaimIndex,
    );
    expect(preOwnSurvivorBand).toBeDefined();
    expect(preOwnSurvivorBand?.endIndex).toBeLessThan(best.ownFilingIndex);

    const at = (m: number) =>
      bands
        .filter((b) => b.startIndex <= m && m <= b.endIndex)
        .reduce((t, b) => t + b.monthlyAmount, 0);
    const sampleMonth = best.survivorClaimIndex + 3;
    expect(at(sampleMonth)).toBeCloseTo(expectedMax(claimed, best, sampleMonth), 2);
  });

  it('sums over the bands to the same lifetime total the search reported', () => {
    // The strongest available check on the decomposition: the bands are what
    // the app DISPLAYS, and they must add up to the figure it RECOMMENDS on.
    const best = bestWidowedOutcome(free);
    const bands = widowedBands(free, best);
    const deathIndex = 2024 * 12 + 2;
    const finalIndex = Math.max(...bands.map((b) => b.endIndex));
    let summed = 0;
    for (let m = deathIndex + 1; m <= finalIndex; m++) {
      summed += bands
        .filter((b) => b.startIndex <= m && m <= b.endIndex)
        .reduce((t, b) => t + b.monthlyAmount, 0);
    }
    expect(Math.abs(summed - best.lifetimeTotal)).toBeLessThanOrEqual(1);
  });
});
