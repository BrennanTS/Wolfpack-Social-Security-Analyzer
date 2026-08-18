/**
 * Adapter for Gregable/social-security-tools (ssa.tools).
 * MIT License — https://github.com/Gregable/social-security-tools
 */
import { benefitAtAge } from '$lib/benefit-calculator';
import { Money } from '$lib/money';
import { Birthdate } from '$lib/birthday';
import { MonthDate, MonthDuration } from '$lib/month-time';
import { Recipient } from '$lib/recipient';
import {
  expectedNPVCoupleOptimized,
  expectedNPVSingle,
} from '$lib/strategy/calculations/expected-npv';
import { strategySumCentsSingle } from '$lib/strategy/calculations/strategy-calc';
import { yearsMonthsLabel } from './format';
import type { Gender } from './lifeExpectancy';

/** Default birth day when the UI only collects month/year (ssa.tools convention). */
export const DEFAULT_BIRTH_DAY = 15;

/** ssa.tools default — 20-year TIPS yield proxy. */
export const DEFAULT_DISCOUNT_RATE = 0.025;

/**
 * Converts a JS Date to the engine's month grid. Every "now" in this adapter
 * routes through here so callers can pin a reference date, which is what makes
 * fixtures deterministic and stops cohorts aging out of the optimizer.
 */
export function monthDateFrom(asOf: Date): MonthDate {
  return MonthDate.initFromYearsMonths({
    years: asOf.getFullYear(),
    months: asOf.getMonth(),
  });
}

export interface FilingAgeDisplay {
  years: number;
  months: number;
  label: string;
  decimalYears: number;
  monthDuration: MonthDuration;
}

export function createPiaRecipient(
  birthYear: number,
  birthMonth: number,
  piaMonthly: number,
  gender: Gender,
): Recipient {
  const recipient = new Recipient();
  recipient.birthdate = Birthdate.FromYMD(birthYear, birthMonth - 1, DEFAULT_BIRTH_DAY);
  recipient.setPia(Money.from(piaMonthly));
  recipient.gender = gender === 'male' ? 'male' : 'female';
  return recipient;
}

export function fraFromBirthYear(birthYear: number): { years: number; months: number } {
  const recipient = new Recipient();
  recipient.birthdate = Birthdate.FromYMD(birthYear, 5, DEFAULT_BIRTH_DAY);
  const fra = recipient.normalRetirementAge();
  return { years: fra.years(), months: fra.modMonths() };
}

export function formatFilingAge(age: MonthDuration): FilingAgeDisplay {
  const years = age.years();
  const months = age.modMonths();
  const label = months === 0 ? `${years}` : yearsMonthsLabel(years, months);
  return {
    years,
    months,
    label,
    decimalYears: Math.round((age.asMonths() / 12) * 100) / 100,
    monthDuration: age,
  };
}

export function ssaMonthlyBenefitAtAge(
  recipient: Recipient,
  claimAgeYears: number,
): { benefit: number; percentOfPia: number; monthsFromFra: number } {
  const filingAge = MonthDuration.initFromYearsMonths({ years: claimAgeYears, months: 0 });
  return ssaMonthlyBenefitAtFilingAge(recipient, filingAge);
}

export function ssaMonthlyBenefitAtFilingAge(
  recipient: Recipient,
  filingAge: MonthDuration,
): { benefit: number; percentOfPia: number; monthsFromFra: number } {
  const pia = recipient.pia().primaryInsuranceAmount().value();
  const benefit = benefitAtAge(recipient, filingAge).value();
  const fra = recipient.normalRetirementAge();
  const monthsFromFra = filingAge.asMonths() - fra.asMonths();

  return {
    benefit,
    percentOfPia: pia > 0 ? Math.round((benefit / pia) * 1000) / 10 : 0,
    monthsFromFra,
  };
}

export function isSsaClaimAgeEligible(
  recipient: Recipient,
  claimAgeYears: number,
  asOf: Date = new Date(),
): boolean {
  const currentAge = recipient.birthdate.ageAtSsaDate(monthDateFrom(asOf));
  const claimAgeMonths = MonthDuration.initFromYearsMonths({ years: claimAgeYears, months: 0 });
  return currentAge.greaterThanOrEqual(claimAgeMonths);
}

export function lifetimeNpvToAge(
  recipient: Recipient,
  filingAge: MonthDuration,
  lifeExpectancy: number,
  discountRate: number,
  asOf: Date = new Date(),
): number {
  const finalDate = recipient.birthdate.dateAtLayAge(
    MonthDuration.initFromYearsMonths({ years: lifeExpectancy, months: 0 }),
  );
  const cents = strategySumCentsSingle(
    recipient,
    finalDate,
    monthDateFrom(asOf),
    discountRate,
    filingAge,
  );
  return cents / 100;
}

/** One filing-age combination and its expected NPV, as returned by the engine's optimizer. */
export interface RankedStrategy {
  filingAges: FilingAgeDisplay[];
  expectedNpv: number;
}

/**
 * The mortality assumption the optimizer runs on: this person lives to their
 * plan-to age, and no longer.
 *
 * A single point of probability, NOT `getDeathProbabilityDistribution`'s SSA
 * period-table curve, which is what this app used until now. The tables do
 * not read the plan-to age at all, so moving the life-expectancy slider from
 * 70 to 100 returned a byte-identical recommendation — the same filing age
 * and the same present value to the cent — while the Lifetime column beside
 * it moved by hundreds of thousands of dollars. An adviser setting "plan to
 * 93" reasonably expects the recommendation to be the one for living to 93.
 *
 * The trade-off, recorded because it is real: a mortality-weighted expected
 * value is the more defensible actuarial figure and is the vendored engine's
 * own default. What this produces is a certainty-equivalent — "best if they
 * live exactly this long" — so it is systematically larger than the
 * mortality-weighted figure and must never be labelled an *expected* value.
 * Measured across 90 single claimants, 71 recommendations moved, by a mean of
 * 25 months.
 *
 * **The six-month seam.** `expectedNPVSingle` buckets a death age to
 * `{years: age, months: 6}` — a yearly distribution's representative month —
 * while every other horizon in this app (`lifetimeNpvToAge`,
 * `projectedFinalMonth`, the bands, the timeline) uses `{years: age, months:
 * 0}`. So the optimizer prices six months more than the Lifetime column
 * shows. That is under 1% of a thirty-year total and rarely changes which age
 * wins, and closing it would mean either editing the vendored engine or
 * moving every band in the app by half a year. Stated here rather than
 * papered over.
 */
function planToAgeDistribution(planToAge: number): { age: number; probability: number }[] {
  return [{ age: planToAge, probability: 1 }];
}

/**
 * Every filing age for a single recipient, sorted best-first by present value
 * at `planToAge`. `expectedNPVSingle` already computes and sorts the full set
 * (one entry per eligible filing month); this just shapes it for display.
 */
export function rankedSingleStrategies(
  recipient: Recipient,
  discountRate: number,
  planToAge: number,
  asOf: Date = new Date(),
): RankedStrategy[] {
  return expectedNPVSingle(
    recipient,
    monthDateFrom(asOf),
    discountRate,
    planToAgeDistribution(planToAge),
  ).map((r) => ({
    filingAges: [formatFilingAge(r.filingAge)],
    expectedNpv: r.expectedNPVCents / 100,
  }));
}

/**
 * Every filing-age combination for a couple, sorted best-first by expected
 * NPV. `expectedNPVCoupleOptimized` already computes and sorts the full
 * cross-product (~9,400 combinations for a typical couple); this just shapes
 * it for display.
 */
export function rankedCoupleStrategies(
  a: Recipient,
  b: Recipient,
  discountRate: number,
  planToAges: [number, number],
  asOf: Date = new Date(),
): RankedStrategy[] {
  // Each person on their OWN plan-to age — see `planToAgeDistribution`. The
  // two horizons differing is the whole point for a couple: which of them the
  // household's inputs say outlives the other decides whether a survivor
  // benefit is ever paid.
  return expectedNPVCoupleOptimized([a, b], monthDateFrom(asOf), discountRate, [
    planToAgeDistribution(planToAges[0]),
    planToAgeDistribution(planToAges[1]),
  ]).map((r) => ({
    filingAges: [formatFilingAge(r.filingAges[0]), formatFilingAge(r.filingAges[1])],
    expectedNpv: r.expectedNPVCents / 100,
  }));
}

/** Exact year-and-month match on every person's filing age; null when unavailable. */
export function findStrategyByAges(
  ranked: RankedStrategy[],
  ages: { years: number; months: number }[],
): RankedStrategy | null {
  return (
    ranked.find(
      (s) =>
        s.filingAges.length === ages.length &&
        s.filingAges.every((f, i) => f.years === ages[i].years && f.months === ages[i].months),
    ) ?? null
  );
}

export function nearestWholeClaimAge(decimalYears: number): number {
  return Math.min(70, Math.max(62, Math.round(decimalYears)));
}
