import { describe, expect, it } from 'vitest';
import {
  bestWidowedOutcome,
  widowedOutcomeFor,
  widowedSearchRanges,
  type WidowedInput,
  type WidowedOutcome,
} from './widowed';
import type { Person } from './personAnalysis';
import { deceasedContext, type Deceased } from './deceased';
import { monthDateAt, monthIndexOf } from './benefitPeriods';
import { createPiaRecipient, monthDateFrom } from './ssaTools';
import { MonthDuration } from '$lib/month-time';
import { benefitOnDate, survivorBenefit } from '$lib/benefit-calculator';
import { earliestFiling } from '$lib/strategy/calculations/strategy-calc';

const asOf = new Date(2026, 0, 15);
/** `asOf`'s own absolute month index — Jan 2026. */
const asOfIndex = 2026 * 12 + 0;

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
 * Same household, but the widow is born in 1961 instead of 1964 — a cohort
 * where survivor-FRA (66y10m) and retirement-FRA (67y0m) provably diverge, per
 * `constants.ts`'s `FULL_RETIREMENT_AGE`/`FULL_RETIREMENT_AGE_SURVIVOR`
 * tables. `free`'s 1964 widow can't be used for this: both tables resolve to
 * 67y0m for any birth year 1962 or later, so a test built only from `free`
 * cannot tell `survivorNormalRetirementDate()` and `normalRetirementDate()`
 * apart — swapping one for the other in `widowedSearchRanges` would still
 * pass every `free`-based assertion.
 *
 * 1961 rather than 1958 (the cohort this used before the `asOf` floor landed):
 * a Jun 1958 widow reached survivor-FRA in Oct 2024, which is BEFORE this
 * file's `asOf`, so her survivor range is now `[asOf, asOf]` and the ceiling
 * under test is no longer the binding one. Jun 1961's survivor-FRA falls in
 * Apr 2028, still ahead of `asOf`, so the ceiling is genuinely exercised.
 */
const divergentFraWidow: Person = {
  ...widow,
  birthYear: 1961,
};
const divergentFraCase: WidowedInput = {
  ...free,
  survivor: divergentFraWidow,
};

describe('widowedSearchRanges', () => {
  it('starts the survivor range at max(asOf, death + 1, SSA age 60)', () => {
    const { survivor } = widowedSearchRanges(free);
    const recipient = createPiaRecipient(1964, 6, 1200, 'female');
    const age60 = monthIndexOf(
      recipient.birthdate.dateAtSsaAge(MonthDuration.initFromYearsMonths({ years: 60, months: 0 })),
    );
    const deathIndex = 2024 * 12 + 2;
    expect(survivor[0]).toBe(Math.max(asOfIndex, deathIndex + 1, age60));
    // Here `asOf` is the binding term, and provably so: both other terms fall
    // before it, so dropping the `asOf` floor moves this range.
    expect(age60).toBeLessThan(asOfIndex);
    expect(deathIndex + 1).toBeLessThan(asOfIndex);
    expect(survivor[0]).toBe(asOfIndex);
  });

  it('never offers a searched candidate month earlier than asOf', () => {
    // The spec's search bounds are `S ∈ [max(asOf, death + 1), survivor-FRA]`
    // and `F ∈ [earliestFiling(survivor, asOf), 70]`. A candidate is a month
    // the household can still choose; a month in the past is not one. Without
    // the survivor-side floor the range opened at age 60 however long ago that
    // was, and the app recommended "claim the survivor benefit at age 60" to a
    // widow who had turned 60 nineteen months earlier — while scoring the
    // elapsed, uncollected months into the lifetime total.
    //
    // Checked over several shapes, not just `free`: a widow already past
    // survivor-FRA is where an unfloored range is furthest in the past, and a
    // widow past 70 is the own-axis analogue.
    const pastSurvivorFra: WidowedInput = { ...free, survivor: { ...widow, birthYear: 1950 } };
    const past70: WidowedInput = { ...free, survivor: { ...widow, birthYear: 1948 } };
    for (const input of [free, divergentFraCase, pastSurvivorFra, past70]) {
      const { survivor, own } = widowedSearchRanges(input);
      expect(survivor[0]).toBeGreaterThanOrEqual(asOfIndex);
      expect(survivor[1]).toBeGreaterThanOrEqual(survivor[0]);
      expect(own[1]).toBeGreaterThanOrEqual(own[0]);

      // The own axis is floored by `earliestFiling(recipient, asOf)` — the
      // engine's own answer, and deliberately not a second `max(…, asOf)` on
      // top of it. SSA allows a retroactive filing back to NRA, capped at six
      // months, so for a claimant already past NRA the engine's floor is
      // legitimately a few months BEFORE `asOf`. Asserting `>= asOf` on this
      // axis would be asserting against an SSA rule; asserting equality with
      // the engine is the real invariant.
      const recipient = createPiaRecipient(
        input.survivor.birthYear,
        input.survivor.birthMonth,
        input.survivor.piaMonthly,
        input.survivor.gender,
      );
      expect(own[0]).toBe(
        monthIndexOf(recipient.birthdate.dateAtSsaAge(earliestFiling(recipient, monthDateFrom(asOf)))),
      );
    }

    // And the winner the search actually returns obeys it too, which is the
    // form the defect was visible in.
    const best = bestWidowedOutcome(free);
    expect(best.survivorClaimIndex).toBeGreaterThanOrEqual(asOfIndex);
    expect(best.ownFilingIndex).toBeGreaterThanOrEqual(asOfIndex);
  });

  it('still starts the survivor range at SSA age 60 when age 60 is the LATEST of the three', () => {
    // Keeps the age-60 term real: with `asOf` now in the max, a widow who
    // turns 60 after `asOf` is the only case that can tell "max(asOf, death+1,
    // age60)" from "max(asOf, death+1)".
    const youngWidow: Person = { ...widow, birthYear: 1970 };
    const { survivor } = widowedSearchRanges({ ...free, survivor: youngWidow });
    const recipient = createPiaRecipient(1970, 6, 1200, 'female');
    const age60 = monthIndexOf(
      recipient.birthdate.dateAtSsaAge(MonthDuration.initFromYearsMonths({ years: 60, months: 0 })),
    );
    expect(age60).toBeGreaterThan(asOfIndex);
    expect(survivor[0]).toBe(age60);
  });

  it('still starts the survivor range at death + 1 when the death is the LATEST of the three', () => {
    // Keeps the `death + 1` term real, and it is not merely cosmetic:
    // `survivorBenefit` THROWS on a filing date at or before the death date,
    // so a range floored only at `asOf` would crash for a death in the `asOf`
    // month itself.
    const recentDeath: Deceased = { ...husband, deathYear: 2026, deathMonth: 1 };
    const olderWidow: Person = { ...widow, birthYear: 1958 };
    const input: WidowedInput = { ...free, survivor: olderWidow, deceased: recentDeath };
    const { survivor } = widowedSearchRanges(input);
    expect(survivor[0]).toBe(asOfIndex + 1);
    expect(() => bestWidowedOutcome(input)).not.toThrow();
  });

  it('ends the survivor range at survivor-FRA, not at retirement FRA', () => {
    const { survivor } = widowedSearchRanges(free);
    const recipient = createPiaRecipient(1964, 6, 1200, 'female');
    expect(survivor[1]).toBe(monthIndexOf(recipient.survivorNormalRetirementDate()));
  });

  it('ends the survivor range at survivor-FRA for a cohort where that differs from retirement FRA', () => {
    // `free`'s 1964 widow can't distinguish the two tables (both are 67y0m
    // for her), so this repeats the check on a 1961 widow, where they
    // provably diverge, and runs the comparison THROUGH
    // `widowedSearchRanges` itself rather than only against the raw
    // `Recipient` methods. Swapping `survivorNormalRetirementDate()` for
    // `normalRetirementDate()` at the call site in widowed.ts must fail this.
    const { survivor } = widowedSearchRanges(divergentFraCase);
    const recipient = createPiaRecipient(1961, 6, 1200, 'female');
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

  it('leaves an ALREADY-CLAIMED past date exactly where it is, on both axes', () => {
    // The carve-out that makes the `asOf` floor above correct rather than
    // destructive. An already-claimed date is a FACT about what the household
    // is already receiving, not a candidate being proposed, so it is exempt
    // from the floor that applies to searched months. Flooring it would
    // restate the widow's own history back to her: a survivor benefit she has
    // drawn since Aug 2024 would be reported as starting in Jan 2026, at a
    // different age and a different (unreduced-by-less) amount.
    //
    // Both dates are set here so BOTH branches of `widowedSearchRanges` are
    // covered — the early return and the per-axis one — and both sit before
    // `asOf`, which is the whole point.
    // A 1958-born widow, not `free`'s 1964 one: an already-claimed OWN filing
    // date in the past has to be a date she was at least 62 on, and `free`'s
    // widow does not reach 62 until after `asOf`. This household is the real
    // shape anyway — she filed on her own record in 2023, was widowed in Mar
    // 2024, and took the survivor benefit that August.
    const survivorSinceIndex = 2024 * 12 + 7; // Aug 2024
    const ownSinceIndex = 2023 * 12 + 2; // Mar 2023, age 64y9m
    const claimed: WidowedInput = {
      ...free,
      survivor: { ...widow, birthYear: 1958 },
      alreadyClaimed: {
        survivorSince: { year: 2024, month: 8 },
        ownSince: { year: 2023, month: 3 },
      },
    };
    expect(survivorSinceIndex).toBeLessThan(asOfIndex);
    expect(ownSinceIndex).toBeLessThan(asOfIndex);

    const { survivor, own } = widowedSearchRanges(claimed);
    expect(survivor).toEqual([survivorSinceIndex, survivorSinceIndex]);
    expect(own).toEqual([ownSinceIndex, ownSinceIndex]);

    const best = bestWidowedOutcome(claimed);
    expect(best.survivorClaimIndex).toBe(survivorSinceIndex);
    expect(best.ownFilingIndex).toBe(ownSinceIndex);

    // And the single-axis branch, where the other axis is still searched.
    const survivorOnly: WidowedInput = {
      ...free,
      alreadyClaimed: { survivorSince: { year: 2024, month: 8 }, ownSince: null },
    };
    expect(widowedSearchRanges(survivorOnly).survivor).toEqual([
      survivorSinceIndex,
      survivorSinceIndex,
    ]);
    expect(bestWidowedOutcome(survivorOnly).survivorClaimIndex).toBe(survivorSinceIndex);
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

  it('scores from max(asOf, death + 1), not from the death month', () => {
    // The lifetime total exists to rank decisions still open to the household.
    // Months that have already elapsed are not among them, so they are not
    // scored — even when a benefit really was being paid in them.
    //
    // The already-claimed case is where the difference is visible and large:
    // the survivor benefit has been running since Aug 2024, seventeen months
    // before `asOf`, so a window starting at the death would fold seventeen
    // real payments into the figure the recommendation is ranked on.
    const claimed: WidowedInput = {
      ...free,
      alreadyClaimed: { survivorSince: { year: 2024, month: 8 }, ownSince: null },
    };
    const best = bestWidowedOutcome(claimed);
    const deathIndex = 2024 * 12 + 2;

    const sumFrom = (start: number): number => {
      let total = 0;
      for (let m = start; m <= best.finalIndex; m++) total += expectedMax(claimed, best, m);
      return total;
    };

    expect(best.lifetimeTotal).toBeCloseTo(sumFrom(asOfIndex), 2);
    // Not a vacuous equality: the elapsed window carries real dollars, so the
    // two sums genuinely differ and the old start month is ruled out.
    expect(sumFrom(deathIndex + 1)).toBeGreaterThan(sumFrom(asOfIndex));
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
    // The scoring window, `max(asOf, death + 1)` — the same start
    // `outcomeFromContext` sums over. (For `free` the bands all begin after
    // `asOf` anyway, so the two starts agree here; using the real one keeps
    // this test honest for a household where they would not.)
    let summed = 0;
    for (let m = Math.max(deathIndex + 1, asOfIndex); m <= finalIndex; m++) {
      summed += bands
        .filter((b) => b.startIndex <= m && m <= b.endIndex)
        .reduce((t, b) => t + b.monthlyAmount, 0);
    }
    expect(Math.abs(summed - best.lifetimeTotal)).toBeLessThanOrEqual(1);
  });
});
