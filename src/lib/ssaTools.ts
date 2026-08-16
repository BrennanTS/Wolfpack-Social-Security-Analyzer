/**
 * Adapter for Gregable/social-security-tools (ssa.tools).
 * MIT License — https://github.com/Gregable/social-security-tools
 */
import { benefitAtAge, baseSpousalBenefit } from '$lib/benefit-calculator';
import { getDeathProbabilityDistribution } from '$lib/life-tables';
import { Money } from '$lib/money';
import { Birthdate } from '$lib/birthday';
import { MonthDate, MonthDuration } from '$lib/month-time';
import { Recipient } from '$lib/recipient';
import {
  expectedNPVCoupleOptimized,
  expectedNPVSingle,
} from '$lib/strategy/calculations/expected-npv';
import { strategySumCentsSingle } from '$lib/strategy/calculations/strategy-calc';
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
  const label = months === 0 ? `${years}` : `${years} years, ${months} months`;
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

export interface SpousalPayment {
  /** Monthly top-up once payable. 0 when there is no entitlement. */
  amount: number;
  /** The spouse's age when the benefit actually begins. */
  startsAtSpouseAge: FilingAgeDisplay;
}

/**
 * The unreduced spousal entitlement: half the worker's PIA, less the spouse's
 * own PIA, floored at zero. A reference figure — it has no filing dates in it
 * and is never what anyone is actually paid.
 */
export function spousalEntitlement(worker: Recipient, spouse: Recipient): number {
  return baseSpousalBenefit(worker, spouse).value();
}

/**
 * The spousal top-up the spouse actually receives, and when it starts.
 *
 * Two rules that the previous three-argument version could not express:
 *
 *  - A spousal benefit is payable only once the WORKER has filed. Filing on
 *    your own record earlier does not start it.
 *  - The reduction is measured from the age at which the spousal benefit
 *    itself begins, not from the spouse's own filing age. Those differ
 *    whenever the worker files later — which is exactly what the optimizer
 *    usually recommends.
 *
 * Delayed credits never apply, so beginning at or after FRA yields the
 * unreduced entitlement and no more. Beyond that, once the spouse files past
 * her own FRA the combined personal + spousal benefit is capped at half the
 * worker's PIA, which means netting against her DRC-inflated *benefit* rather
 * than her PIA.
 *
 * The vendored engine (src/vendor/ssa-tools/benefit-calculator.ts) has no
 * age-based spousal export: `baseSpousalBenefit` is unreduced and
 * `spousalBenefitOnDate` needs filing dates plus an "as of" month. So this
 * mirrors `spousalBenefitOnDate`'s branch structure (lines 297-377) against
 * ages instead of dates.
 */
export function spousalTopUp(
  worker: Recipient,
  spouse: Recipient,
  spouseFilingAge: MonthDuration,
  workerFilingAge: MonthDuration,
): SpousalPayment {
  const startDate = MonthDate.max(
    spouse.birthdate.dateAtSsaAge(spouseFilingAge),
    worker.birthdate.dateAtSsaAge(workerFilingAge),
  );
  const startsAtSpouseAge = formatFilingAge(spouse.birthdate.ageAtSsaDate(startDate));

  const base = spousalEntitlement(worker, spouse);
  if (base <= 0) return { amount: 0, startsAtSpouseAge };

  const fraMonths = spouse.normalRetirementAge().asMonths();
  const monthsEarly = fraMonths - startsAtSpouseAge.monthDuration.asMonths();

  if (monthsEarly <= 0) {
    // No delayed credits apply to spousal benefits.
    if (spouseFilingAge.asMonths() <= fraMonths) return { amount: base, startsAtSpouseAge };
    // The spouse filed past her own FRA, so her personal benefit carries
    // delayed credits. Combined personal + spousal is capped at half the
    // worker's PIA (POMS RS 00615.694), so net against the actual benefit
    // rather than the PIA — matching benefit-calculator.ts:343-356.
    const ownBenefit = benefitAtAge(spouse, spouseFilingAge).value();
    const halfWorkerPia = worker.pia().primaryInsuranceAmount().value() / 2;
    return {
      amount: Math.max(0, Math.round((halfWorkerPia - ownBenefit) * 100) / 100),
      startsAtSpouseAge,
    };
  }

  // SSA spousal reduction: 25/36 of 1% per month for the first 36 months
  // early, then 5/12 of 1% per month beyond that.
  const first = Math.min(monthsEarly, 36);
  const rest = Math.max(0, monthsEarly - 36);
  const reduction = first * (25 / 36 / 100) + rest * (5 / 12 / 100);
  return {
    amount: Math.round(base * (1 - reduction) * 100) / 100,
    startsAtSpouseAge,
  };
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
 * Every filing age for a single recipient, sorted best-first by expected NPV.
 * `expectedNPVSingle` already computes and sorts the full set (one entry per
 * eligible filing month); this just shapes it for display.
 */
export async function rankedSingleStrategies(
  recipient: Recipient,
  discountRate: number,
  asOf: Date = new Date(),
): Promise<RankedStrategy[]> {
  // The survival curve must be conditioned on the same reference date the
  // optimizer runs from. `getDeathProbabilityDistribution` defaults its
  // `currentYear` to the wall clock, which would weight every NPV by a
  // cohort's survival as of *today* while `monthDateFrom(asOf)` below runs the
  // optimizer from `asOf` — silently making results depend on when they were
  // computed rather than on `asOf`.
  const deathDist = await getDeathProbabilityDistribution(recipient, asOf.getFullYear());
  return expectedNPVSingle(recipient, monthDateFrom(asOf), discountRate, deathDist).map((r) => ({
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
export async function rankedCoupleStrategies(
  a: Recipient,
  b: Recipient,
  discountRate: number,
  asOf: Date = new Date(),
): Promise<RankedStrategy[]> {
  // Conditioned on `asOf`, not the wall clock — see `rankedSingleStrategies`.
  const [distA, distB] = await Promise.all([
    getDeathProbabilityDistribution(a, asOf.getFullYear()),
    getDeathProbabilityDistribution(b, asOf.getFullYear()),
  ]);
  return expectedNPVCoupleOptimized([a, b], monthDateFrom(asOf), discountRate, [
    distA,
    distB,
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
