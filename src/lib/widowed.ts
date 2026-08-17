/**
 * The widow(er)'s two-date decision: when to claim the survivor benefit, and
 * when to file on their own record.
 *
 * SSA pays the LARGER of the two each month, never the sum — and deemed
 * filing does NOT apply to survivor benefits, so the two dates are genuinely
 * independent. That is what makes "claim the survivor benefit at 60, let your
 * own grow to 70, then switch" both legal and frequently optimal.
 *
 * For a MARRIED household this optimization is blocked: the vendored
 * `strats: [MonthDuration, MonthDuration]` carries one date per person and
 * threads through four read-only files. A widow(er) has no couple grid, so the
 * space is ~85 x ~97 and is searched exhaustively here.
 *
 * **No benefit rule is computed in this module.** `survivorBenefit` and
 * `benefitOnDate` produce every dollar; this supplies dates and a `max()`.
 */
import { benefitOnDate, survivorBenefit } from '$lib/benefit-calculator';
import { MonthDuration } from '$lib/month-time';
import { earliestFiling } from '$lib/strategy/calculations/strategy-calc';
import { roundCents } from './benefitMath';
import { monthDateAt, monthIndexOf, type BenefitBand } from './benefitPeriods';
import { deceasedContext, type Deceased, type YearMonth } from './deceased';
import type { Person } from './personAnalysis';
import { createPiaRecipient, formatFilingAge, monthDateFrom } from './ssaTools';

export interface AlreadyClaimed {
  survivorSince: YearMonth | null;
  ownSince: YearMonth | null;
}

export interface WidowedInput {
  survivor: Person;
  deceased: Deceased;
  alreadyClaimed: AlreadyClaimed;
  asOf: Date;
}

export interface WidowedOutcome {
  /** Inclusive absolute month index the survivor benefit starts. */
  survivorClaimIndex: number;
  /** Inclusive absolute month index the own retirement benefit starts. */
  ownFilingIndex: number;
  /** The survivor's age at `survivorClaimIndex`, e.g. "60" or "63 years, 2 months". */
  survivorClaimAge: string;
  /** The survivor's age at `ownFilingIndex`. */
  ownFilingAge: string;
  /**
   * Straight sum of dollars paid from the month after the death through the
   * survivor's plan-to age. Undiscounted, today's dollars — the same
   * convention as the income-cliff callout and 3A's gain figure.
   *
   * NOT mortality-weighted, and therefore not comparable with the married
   * path's `expectedNpv`. See the spec's "Known limitation".
   */
  lifetimeTotal: number;
}

const ageDuration = (years: number): MonthDuration =>
  MonthDuration.initFromYearsMonths({ years, months: 0 });

const indexOfYearMonth = (ym: YearMonth): number => ym.year * 12 + (ym.month - 1);

/** Everything derived from the input once, so the search loop re-derives nothing. */
function context(input: WidowedInput) {
  const { survivor, deceased, asOf } = input;
  const recipient = createPiaRecipient(
    survivor.birthYear,
    survivor.birthMonth,
    survivor.piaMonthly,
    survivor.gender,
  );
  const dec = deceasedContext(deceased);
  const deathIndex = monthIndexOf(dec.deathDate);
  const firstMonth = deathIndex + 1;
  const finalIndex = monthIndexOf(
    recipient.birthdate.dateAtSsaAge(ageDuration(survivor.lifeExpectancy)),
  );
  return { recipient, dec, deathIndex, firstMonth, finalIndex, asOf };
}

/**
 * Inclusive `[lo, hi]` for each date.
 *
 * The survivor range stops at SURVIVOR-FRA — a different table from the
 * retirement FRA — because that is where the 71.5%-to-100% reduction reaches
 * 100% and deferring further never raises the amount.
 *
 * The own range starts at `earliestFiling`, the engine's own answer, which
 * encodes the full-month-at-62 rule and the born-on-the-1st-or-2nd exception.
 * A hardcoded `{years: 62, months: 0}` here would repeat the defect that has
 * kept the `earliest` comparison row from ever rendering.
 *
 * An already-claimed benefit collapses its range to the single month it began,
 * which is why the already-claiming case needs no separate code path.
 */
export function widowedSearchRanges(input: WidowedInput): {
  survivor: [number, number];
  own: [number, number];
} {
  const { recipient, firstMonth, asOf } = context(input);
  const { survivorSince, ownSince } = input.alreadyClaimed;

  if (survivorSince && ownSince) {
    const s = indexOfYearMonth(survivorSince);
    const f = indexOfYearMonth(ownSince);
    return { survivor: [s, s], own: [f, f] };
  }

  const age60 = monthIndexOf(recipient.birthdate.dateAtSsaAge(ageDuration(60)));
  const survivorFra = monthIndexOf(recipient.survivorNormalRetirementDate());
  const survivorRange: [number, number] = survivorSince
    ? [indexOfYearMonth(survivorSince), indexOfYearMonth(survivorSince)]
    : [Math.max(firstMonth, age60), Math.max(firstMonth, survivorFra)];

  const ownFloor = monthIndexOf(
    recipient.birthdate.dateAtSsaAge(earliestFiling(recipient, monthDateFrom(asOf))),
  );
  const ownCeiling = monthIndexOf(recipient.birthdate.dateAtSsaAge(ageDuration(70)));
  const ownRange: [number, number] = ownSince
    ? [indexOfYearMonth(ownSince), indexOfYearMonth(ownSince)]
    : [ownFloor, Math.max(ownFloor, ownCeiling)];

  return { survivor: survivorRange, own: ownRange };
}

/**
 * The monthly amounts for one (S, F) pair, and their sum.
 *
 * Each amount is constant across the months it is paid — both are functions of
 * their own claim date, not of the month — so each engine call is made once,
 * outside the month loop.
 */
export function widowedOutcomeFor(
  input: WidowedInput,
  survivorClaimIndex: number,
  ownFilingIndex: number,
): WidowedOutcome {
  const { recipient, dec, firstMonth, finalIndex } = context(input);

  const ownAmount =
    ownFilingIndex > finalIndex
      ? 0
      : benefitOnDate(
          recipient,
          monthDateAt(ownFilingIndex),
          monthDateAt(ownFilingIndex).addDuration(MonthDuration.OneYear()),
        ).value();

  const survivorAmount =
    survivorClaimIndex > finalIndex
      ? 0
      : survivorBenefit(
          recipient,
          dec.recipient,
          dec.filingDate,
          dec.deathDate,
          monthDateAt(survivorClaimIndex),
        ).value();

  let total = 0;
  for (let m = firstMonth; m <= finalIndex; m++) {
    const own = m >= ownFilingIndex ? ownAmount : 0;
    const surv = m >= survivorClaimIndex ? survivorAmount : 0;
    total += Math.max(own, surv);
  }

  return {
    survivorClaimIndex,
    ownFilingIndex,
    survivorClaimAge: formatFilingAge(
      recipient.birthdate.ageAtSsaDate(monthDateAt(survivorClaimIndex)),
    ).label,
    ownFilingAge: formatFilingAge(recipient.birthdate.ageAtSsaDate(monthDateAt(ownFilingIndex)))
      .label,
    lifetimeTotal: roundCents(total),
  };
}

/** Exhaustive search over both ranges. Ties resolve to the earliest pair. */
export function bestWidowedOutcome(input: WidowedInput): WidowedOutcome {
  const { survivor, own } = widowedSearchRanges(input);
  let best: WidowedOutcome | null = null;
  for (let s = survivor[0]; s <= survivor[1]; s++) {
    for (let f = own[0]; f <= own[1]; f++) {
      const outcome = widowedOutcomeFor(input, s, f);
      if (best === null || outcome.lifetimeTotal > best.lifetimeTotal) best = outcome;
    }
  }
  // Both ranges are non-empty by construction, so this is unreachable; it is
  // an assertion rather than a fallback.
  if (best === null) throw new Error('widowed search produced no candidate');
  return best;
}

/**
 * The two bands a widowed household displays.
 *
 * Personal carries the survivor's own benefit from their filing month;
 * Survivor carries `max(0, survivorAmount - ownAmount)` from the claim month,
 * so the two STACK to exactly `max(own, survivor)` — the payment SSA actually
 * makes. Before the own filing month the personal amount is zero and the
 * survivor band carries the whole payment; once the own benefit is larger the
 * survivor band falls to zero and correctly disappears.
 *
 * This is the same decomposition Phase 2b-i adopted for married households
 * after the user's correction — the personal band continues underneath and the
 * survivor segment sits on top — so the chart, legend, `benefitSeriesLabel`
 * and the PDF all work on it unchanged.
 */
export function widowedBands(input: WidowedInput, outcome: WidowedOutcome): BenefitBand[] {
  const { recipient, dec, finalIndex } = context(input);
  const personId = input.survivor.id;
  const bands: BenefitBand[] = [];

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

  if (outcome.ownFilingIndex <= finalIndex && ownAmount > 0) {
    bands.push({
      personId,
      type: 'personal',
      startIndex: outcome.ownFilingIndex,
      endIndex: finalIndex,
      monthlyAmount: roundCents(ownAmount),
    });
  }

  if (outcome.survivorClaimIndex <= finalIndex && survivorAmount > 0) {
    // Split at the own filing month: before it the top-up is the whole
    // survivor amount, after it only the excess over the own benefit.
    const splitAt = Math.max(outcome.survivorClaimIndex, outcome.ownFilingIndex);
    if (outcome.survivorClaimIndex < splitAt) {
      bands.push({
        personId,
        type: 'survivor',
        startIndex: outcome.survivorClaimIndex,
        endIndex: Math.min(splitAt - 1, finalIndex),
        monthlyAmount: roundCents(survivorAmount),
      });
    }
    const topUp = survivorAmount - ownAmount;
    if (topUp > 0 && splitAt <= finalIndex) {
      bands.push({
        personId,
        type: 'survivor',
        startIndex: splitAt,
        endIndex: finalIndex,
        monthlyAmount: roundCents(topUp),
      });
    }
  }

  return bands;
}
