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
 * engine's `survivorBenefit`; the survivor's own retirement amount comes from
 * the engine's `benefitOnDate` or off the bands; nothing else produces a
 * dollar. This module supplies dates and a `max()`.
 *
 * Deliberate choices, each of which was wrong in an earlier design:
 *
 * - `baselineTotal` is summed from the BANDS, not re-derived from the engine's
 *   start-date rule. The bands are what the app puts on screen, and they have
 *   already been through `splitDualEntitlement`. Re-deriving the rule here
 *   would credit the claim-date change with the dual-entitlement
 *   re-composition a prior phase did, and flatter the result. This is why the
 *   `benefitOnDate` fallback below feeds `own` ONLY, never the baseline.
 * - `own` is NOT read off the bands alone. Whenever the engine's survivor
 *   start coincides with the survivor's own filing date it emits no personal
 *   band for them at all (`strategy-calc.ts:112-122` truncates the personal
 *   period out of existence) — and that is precisely the population this
 *   module fires on, so a band-only `own` would be zero in nearly every
 *   household it touches. That does not merely understate the gain; it moves
 *   the recommended claim month, because months in which the survivor's own
 *   benefit would beat an early reduced widow(er) benefit get valued at the
 *   reduced amount instead. See `ownRetirementBenefit` below.
 * - The search stops at the survivor's SURVIVOR-FRA
 *   (`recipient.survivorNormalRetirementDate()`, a different table from the
 *   retirement FRA), not at their own filing date. Survivor-FRA is where the
 *   71.5%-to-100% reduction reaches 100%; deferring past it never raises the
 *   amount (`benefit-calculator.ts:512-517`). Stopping at the own filing date
 *   would exclude survivor-FRA precisely when the survivor files earlier,
 *   which is where waiting is worth the most — the case
 *   `survivorClaim.test.ts`'s pinned optimum-beyond-own-filing test exists to
 *   hold.
 * - Every candidate is at least `death + 1`, so `survivorBenefit`'s
 *   "cannot file for survivor benefits before spouse died" throw
 *   (`benefit-calculator.ts:455`) is unreachable. Widening the range means
 *   re-checking that.
 */
import { benefitOnDate, survivorBenefit } from '$lib/benefit-calculator';
import { MonthDate, MonthDuration } from '$lib/month-time';
import type { Recipient } from '$lib/recipient';
import { roundCents } from './benefitMath';
import { monthDateAt, monthIndexOf, type BenefitBand, type SurvivorGap } from './benefitPeriods';
import { firstDeath } from './incomeCliff';
import type { Person } from './personAnalysis';
import { formatFilingAge } from './ssaTools';

export interface SurvivorClaimAlternative {
  /** Inclusive absolute month index of the best survivor claim month. */
  claimIndex: number;
  /** The survivor's age at that month, e.g. "60" or "67 years, 10 months" — via `formatFilingAge`. */
  claimAge: string;
  /** The survivor's display label. */
  survivorLabel: string;
  /** Lifetime total paid to the survivor after the first death, as the app shows it today. */
  baselineTotal: number;
  /** The same, under the best claim month. */
  bestTotal: number;
  /** `bestTotal - baselineTotal`. Strictly positive whenever this object is non-null. */
  gain: number;
  /**
   * Whether the baseline the app displays contains ANY survivor band for this
   * person. Stated as a fact about the DISPLAY, not about the engine, because
   * three different things produce a false:
   *
   * - the direction the engine declines to model at all
   *   (`strategy-calc.ts:103-111`), reached here when `detectSurvivorGap` also
   *   stayed silent — either because the deceased held no personal band at the
   *   death month (`benefitPeriods.ts:279`) or because their benefit did not
   *   exceed the survivor's own (`:284`);
   * - the engine modelling the direction and declining the step-up, because
   *   the survivor's own benefit already wins (`strategy-calc.ts:98-100`);
   * - `splitDualEntitlement` dropping a band whose top-up is not positive
   *   (`benefitPeriods.ts:200-201`) — rare, and a household the engine DID
   *   model.
   *
   * The money is real either way, so this is a discriminator rather than a
   * suppression: a caller must not describe a `false` case as claiming
   * "earlier than the plan assumes", because there is no survivor benefit on
   * screen for it to be earlier than. What it licenses is that phrasing
   * choice, not a claim about which of the three causes applies.
   */
  baselineHasSurvivorBand: boolean;
}

function ageDuration(years: number): MonthDuration {
  return MonthDuration.initFromYearsMonths({ years, months: 0 });
}

/**
 * Sum of the amounts of every supplied band covering `monthIndex`, or null
 * when no band covers it at all.
 *
 * Null rather than 0 because the two are different facts and the caller acts
 * on the difference: "the engine emitted no personal band for this month" is
 * what licenses the `benefitOnDate` fallback, while "it emitted a band paying
 * $0" (a zero-PIA recipient) must not.
 */
function bandAmountAt(bands: BenefitBand[], monthIndex: number): number | null {
  let total = 0;
  let covered = false;
  for (const band of bands) {
    if (band.startIndex <= monthIndex && monthIndex <= band.endIndex) {
      total += band.monthlyAmount;
      covered = true;
    }
  }
  return covered ? total : null;
}

/**
 * The survivor's own retirement benefit once filed, from the engine.
 *
 * This is `strategy-calc.ts:92-97`'s `dependentFinalPersonalBenefit` verbatim,
 * the same expression the engine itself uses to decide whether a survivor
 * benefit is worth switching to: `benefitOnDate` at the filing date, read a
 * year later so all late-filing credits are included. It is needed because the
 * engine deletes the survivor's personal band in exactly the households this
 * module targets, so the bands cannot answer "what would they be getting on
 * their own record" for those months.
 */
function ownRetirementBenefit(recipient: Recipient, filingDate: MonthDate): number {
  return benefitOnDate(
    recipient,
    filingDate,
    filingDate.addDuration(MonthDuration.OneYear()),
  ).value();
}

/**
 * The best month for the survivor to claim the widow(er) benefit, holding both
 * filing ages fixed, or null when there is nothing to show.
 *
 * Null for a single claimant, for a household whose survivor direction the
 * engine cannot model AND has already disclosed (`survivorGap` set — a
 * claim-month search over a disclosed gap would be answering a different
 * question twice), for an exact tie in the two plan-to months (`firstDeath`
 * returns null: neither person is established as the survivor), and for any
 * household where the best claim month is worth no more than what is already
 * on screen.
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

  const survivorBands = bands.filter((b) => b.personId === people[survivorIndex].id);
  const personalBands = survivorBands.filter((b) => b.type === 'personal');

  // What the survivor holds on their own record, month by month: the band
  // wherever the engine emitted one, and `ownFiled` ONLY in months it emitted
  // none.
  //
  // The band always wins where it exists, never a max() of the two. `ownFiled`
  // is read a year after filing, so it is always the post-January-bump amount,
  // while `PersonalBenefitPeriods` emits the filing year at the PRE-bump
  // amount (`recipient-personal-benefits.ts:102-113`). A max() therefore never
  // selects the band — it can only silently lift those ≤11 pre-bump months to
  // the post-bump figure, inventing money the app does not display. Measured
  // at up to $576 on a $77,796 gain before this was corrected.
  const survivorFilingDate = survivorRecipient.birthdate.dateAtSsaAge(filingAges[survivorIndex]);
  const survivorFilingIndex = monthIndexOf(survivorFilingDate);
  const ownFiled = ownRetirementBenefit(survivorRecipient, survivorFilingDate);

  const firstMonth = death.deathMonthIndex + 1;
  const own: number[] = [];
  let baselineTotal = 0;
  for (let m = firstMonth; m <= survivorFinalIndex; m++) {
    own.push(bandAmountAt(personalBands, m) ?? (m >= survivorFilingIndex ? ownFiled : 0));
    // Band-derived, and deliberately never touched by `ownFiled`: the baseline
    // must stay exactly what the app displays.
    baselineTotal += bandAmountAt(survivorBands, m) ?? 0;
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
    baselineHasSurvivorBand: survivorBands.some((b) => b.type === 'survivor'),
  };
}
