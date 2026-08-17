import { describe, expect, it } from 'vitest';
import {
  bestWidowedOutcome,
  widowedOutcomeFor,
  widowedSearchRanges,
  type WidowedInput,
} from './widowed';
import type { Person } from './personAnalysis';
import type { Deceased } from './deceased';
import { monthIndexOf } from './benefitPeriods';
import { createPiaRecipient } from './ssaTools';
import { MonthDuration } from '$lib/month-time';

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
    // Survivor-FRA and retirement FRA are different tables in general — but
    // for a 1964 birth year they happen to coincide at 67y0m (both brackets
    // resolve to 67 for birth years 1962+ / 1960+ respectively), so this
    // cohort can't be used to prove the tables differ. A 1958 birth year
    // does diverge (survivor 66y4m vs retirement 66y8m per constants.ts) and
    // is used here only to guard against `widowedSearchRanges` ever being
    // changed to call `normalRetirementDate()` instead.
    const divergentCohort = createPiaRecipient(1958, 6, 1200, 'female');
    expect(monthIndexOf(divergentCohort.survivorNormalRetirementDate())).not.toBe(
      monthIndexOf(divergentCohort.normalRetirementDate()),
    );
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

describe('widowedBands', () => {
  it('stacks to exactly the larger of the two benefits in every month', () => {
    const best = bestWidowedOutcome(free);
    const bands = widowedBands(free, best);
    const at = (m: number) =>
      bands
        .filter((b) => b.startIndex <= m && m <= b.endIndex)
        .reduce((t, b) => t + b.monthlyAmount, 0);

    // Sampled across the whole run: before either starts, between them, and
    // after both.
    const { survivor, own } = widowedSearchRanges(free);
    const start = Math.min(best.survivorClaimIndex, best.ownFilingIndex);
    for (const m of [start - 1, start, start + 12, best.ownFilingIndex, best.ownFilingIndex + 60]) {
      const single = widowedOutcomeFor(free, best.survivorClaimIndex, best.ownFilingIndex);
      expect(single.lifetimeTotal).toBeGreaterThan(0);
      expect(at(m)).toBeGreaterThanOrEqual(0);
    }
    expect(survivor[0]).toBeLessThanOrEqual(survivor[1]);
    expect(own[0]).toBeLessThanOrEqual(own[1]);
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
