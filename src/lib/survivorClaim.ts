/**
 * What the survivor would be paid if the widow(er) benefit were claimed on its
 * own date, rather than on the date they file for their own retirement.
 *
 * SSA pays a widow(er) from age 60 regardless of when they file on their own
 * record, and pays the larger of the two benefits each month. The engine has
 * one date per person: it starts the survivor benefit at
 * `max(earnerDeath + 1, dependentFilingDate)` (`strategy-calc.ts:71-77`), so a
 * survivor who delays their own filing is shown receiving nothing for years in
 * which SSA would be paying them.
 *
 * This module does NOT model that. It holds the recommended filing ages fixed
 * — nothing about the recommendation moves — and varies exactly one thing: the
 * month the survivor claims. It reports the best such month and what it is
 * worth, so the alternative can be shown with a number attached.
 *
 * **No benefit rule is computed here.** Every survivor amount comes from the
 * engine's own `survivorBenefit`; every "own" amount is read off the bands the
 * app already displays. This module supplies dates and a `max()`.
 *
 * Deliberate choices, each of which was wrong in an earlier design:
 *
 * - `baselineTotal` is summed from the BANDS, not re-derived from the engine's
 *   start-date rule. The bands are what the app puts on screen, and they have
 *   already been through `splitDualEntitlement`. Re-deriving the rule here
 *   would credit the claim-date change with the dual-entitlement
 *   re-composition a prior phase did, and flatter the result.
 * - The search stops at the survivor's SURVIVOR-FRA
 *   (`recipient.survivorNormalRetirementDate()`, a different table from the
 *   retirement FRA), not at their own filing date. Survivor-FRA is where the
 *   71.5%-to-100% reduction reaches 100%; deferring past it never raises the
 *   amount (`benefit-calculator.ts:512-517`). Stopping at the own filing date
 *   would exclude survivor-FRA precisely when the survivor files earlier,
 *   which is where waiting is worth the most.
 * - Every candidate is at least `death + 1`, so `survivorBenefit`'s
 *   "cannot file for survivor benefits before spouse died" throw
 *   (`benefit-calculator.ts:455`) is unreachable. Widening the range means
 *   re-checking that.
 */
import { survivorBenefit } from '$lib/benefit-calculator';
import { MonthDate, MonthDuration } from '$lib/month-time';
import type { Recipient } from '$lib/recipient';
import { roundCents } from './benefitMath';
import type { BenefitBand, SurvivorGap } from './benefitPeriods';
import { firstDeath } from './incomeCliff';
import type { Person } from './personAnalysis';
import { formatFilingAge } from './ssaTools';

export interface SurvivorClaimAlternative {
  /** Inclusive absolute month index of the best survivor claim month. */
  claimIndex: number;
  /** The survivor's age at that month, e.g. "60 years, 0 months" — via `formatFilingAge`. */
  claimAge: string;
  /** The survivor's display label. */
  survivorLabel: string;
  /** Lifetime total paid to the survivor after the first death, as the app shows it today. */
  baselineTotal: number;
  /** The same, under the best claim month. */
  bestTotal: number;
  /** `bestTotal - baselineTotal`. Strictly positive whenever this object is non-null. */
  gain: number;
}

/** The band index convention, read off the engine's own accessors. */
function monthIndexOf(date: MonthDate): number {
  return date.year() * 12 + date.monthIndex();
}

/** The inverse: the engine's month date for a band index. */
function monthDateAt(index: number): MonthDate {
  return MonthDate.initFromYearsMonths({
    years: Math.floor(index / 12),
    months: index % 12,
  });
}

function ageDuration(years: number): MonthDuration {
  return MonthDuration.initFromYearsMonths({ years, months: 0 });
}

/** Sum of the amounts of every matching band covering `monthIndex`. */
function amountAt(bands: BenefitBand[], monthIndex: number): number {
  let total = 0;
  for (const band of bands) {
    if (band.startIndex <= monthIndex && monthIndex <= band.endIndex) total += band.monthlyAmount;
  }
  return total;
}

/**
 * The best month for the survivor to claim the widow(er) benefit, holding both
 * filing ages fixed, or null when there is nothing to show.
 *
 * Null for a single claimant, for a household whose survivor direction the
 * engine cannot model at all (`survivorGap` set — that gap is disclosed
 * separately and a claim-month search over it would be answering a different
 * question), for an exact tie in the two plan-to months (`firstDeath` returns
 * null: neither person is established as the survivor), and for any household
 * where the best claim month is worth no more than what is already on screen.
 *
 * `recipients`, `filingAges` and `labels` are parallel to `people`.
 */
export function survivorClaimAlternative(
  people: Person[],
  recipients: Recipient[],
  filingAges: MonthDuration[],
  bands: BenefitBand[],
  finalIndexByPersonId: Record<string, number>,
  survivorGap: SurvivorGap | null,
  labels: string[],
): SurvivorClaimAlternative | null {
  if (people.length !== 2) return null;
  if (survivorGap !== null) return null;

  const death = firstDeath([people[0].id, people[1].id], finalIndexByPersonId);
  if (death === null) return null;

  const survivorIndex = death.survivorIndex;
  const deceasedIndex = survivorIndex === 0 ? 1 : 0;
  const survivorRecipient = recipients[survivorIndex];
  const deceasedRecipient = recipients[deceasedIndex];
  const deceasedFilingDate = deceasedRecipient.birthdate.dateAtSsaAge(filingAges[deceasedIndex]);
  const deathDate = monthDateAt(death.deathMonthIndex);
  const survivorFinalIndex = finalIndexByPersonId[people[survivorIndex].id];

  // The two per-month series, read off the bands the app displays. `own` is
  // the survivor's personal entitlement — what they keep under dual
  // entitlement; `baseline` is everything they are shown receiving, personal
  // plus whatever survivor top-up the engine emitted.
  const survivorBands = bands.filter((b) => b.personId === people[survivorIndex].id);
  const personalBands = survivorBands.filter((b) => b.type === 'personal');

  const firstMonth = death.deathMonthIndex + 1;
  const own: number[] = [];
  let baselineTotal = 0;
  for (let m = firstMonth; m <= survivorFinalIndex; m++) {
    own.push(amountAt(personalBands, m));
    baselineTotal += amountAt(survivorBands, m);
  }

  // Inclusive candidate range: never before the month after the death and
  // never before SSA age 60, never after survivor-FRA. `lo <= hi` always,
  // since the age-60 date cannot follow the survivor-FRA date.
  const age60Index = monthIndexOf(survivorRecipient.birthdate.dateAtSsaAge(ageDuration(60)));
  const survivorFraIndex = monthIndexOf(survivorRecipient.survivorNormalRetirementDate());
  const lo = Math.max(firstMonth, age60Index);
  const hi = Math.max(firstMonth, survivorFraIndex);

  let bestIndex = lo;
  let bestTotal = -Infinity;
  for (let candidate = lo; candidate <= hi; candidate++) {
    // Constant across the months it is paid: the amount is a function of the
    // claim date, and the claim date does not change month to month.
    const amount = survivorBenefit(
      survivorRecipient,
      deceasedRecipient,
      deceasedFilingDate,
      deathDate,
      monthDateAt(candidate),
    ).value();

    let total = 0;
    for (let i = 0; i < own.length; i++) {
      const month = firstMonth + i;
      total += Math.max(own[i], month >= candidate ? amount : 0);
    }
    if (total > bestTotal) {
      bestTotal = total;
      bestIndex = candidate;
    }
  }

  const roundedBaseline = roundCents(baselineTotal);
  const roundedBest = roundCents(bestTotal);
  const gain = roundCents(roundedBest - roundedBaseline);
  if (gain <= 0) return null;

  return {
    claimIndex: bestIndex,
    claimAge: formatFilingAge(survivorRecipient.birthdate.ageAtSsaDate(monthDateAt(bestIndex)))
      .label,
    survivorLabel: labels[survivorIndex],
    baselineTotal: roundedBaseline,
    bestTotal: roundedBest,
    gain,
  };
}
