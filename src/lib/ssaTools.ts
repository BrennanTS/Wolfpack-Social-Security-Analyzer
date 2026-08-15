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

export function fraFromBirthYear(birthYear: number): {
  years: number;
  months: number;
  totalMonths: number;
} {
  const recipient = new Recipient();
  recipient.birthdate = Birthdate.FromYMD(birthYear, 5, DEFAULT_BIRTH_DAY);
  const fra = recipient.normalRetirementAge();
  return {
    years: fra.years(),
    months: fra.modMonths(),
    totalMonths: fra.asMonths(),
  };
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

/**
 * The spousal top-up the dependent spouse actually receives if they start
 * spousal benefits at `spouseFilingAge`: the amount by which half of the
 * worker's PIA exceeds the spouse's own PIA, reduced if the spouse claims
 * before their own full retirement age. Delayed retirement credits never
 * apply to spousal benefits, so filing at or after FRA gives the full
 * (unreduced) amount.
 *
 * Replaces the previous FRA-only helper, which fabricated the spouse from the
 * worker's birthdate and therefore ignored both the spouse's real age and the
 * reduction for claiming early.
 *
 * The vendored engine (src/vendor/ssa-tools/benefit-calculator.ts) has no
 * age-based spousal export: `baseSpousalBenefit` returns only the unreduced
 * amount, and `spousalBenefitOnDate` is date-based and requires filing dates
 * for both members that this function's signature doesn't carry. So this
 * composes `baseSpousalBenefit` with the SSA early-filing reduction schedule
 * directly (same formula `spousalBenefitOnDate` uses internally).
 */
export function spousalTopUp(
  worker: Recipient,
  spouse: Recipient,
  spouseFilingAge: MonthDuration,
): number {
  const base = baseSpousalBenefit(worker, spouse).value();
  if (base <= 0) return 0;

  const fra = spouse.normalRetirementAge();
  const monthsEarly = fra.asMonths() - spouseFilingAge.asMonths();
  if (monthsEarly <= 0) return base; // No delayed credits apply to spousal benefits.

  // SSA spousal reduction: 25/36 of 1% per month for the first 36 months
  // early, then 5/12 of 1% per month beyond that.
  const first = Math.min(monthsEarly, 36);
  const rest = Math.max(0, monthsEarly - 36);
  const reduction = first * (25 / 36 / 100) + rest * (5 / 12 / 100);
  return Math.round(base * (1 - reduction) * 100) / 100;
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
  const deathDist = await getDeathProbabilityDistribution(recipient);
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
  const [distA, distB] = await Promise.all([
    getDeathProbabilityDistribution(a),
    getDeathProbabilityDistribution(b),
  ]);
  return expectedNPVCoupleOptimized([a, b], monthDateFrom(asOf), discountRate, [
    distA,
    distB,
  ]).map((r) => ({
    filingAges: [formatFilingAge(r.filingAges[0]), formatFilingAge(r.filingAges[1])],
    expectedNpv: r.expectedNPVCents / 100,
  }));
}

/** Exact whole-year match on every person's filing age; null when unavailable. */
export function findStrategyByAges(
  ranked: RankedStrategy[],
  ages: number[],
): RankedStrategy | null {
  return (
    ranked.find(
      (s) =>
        s.filingAges.length === ages.length &&
        s.filingAges.every((f, i) => f.years === ages[i] && f.months === 0),
    ) ?? null
  );
}

export async function computeOptimalFilingSingle(
  recipient: Recipient,
  discountRate: number,
  asOf: Date = new Date(),
): Promise<{ filingAge: FilingAgeDisplay; expectedNpv: number }> {
  const ranked = await rankedSingleStrategies(recipient, discountRate, asOf);
  if (ranked.length === 0) {
    throw new Error('No eligible filing ages for this recipient');
  }
  const best = ranked[0];
  return {
    filingAge: best.filingAges[0],
    expectedNpv: best.expectedNpv,
  };
}

export async function computeOptimalFilingCouple(
  worker: Recipient,
  spouse: Recipient,
  discountRate: number,
  asOf: Date = new Date(),
): Promise<{
  workerFilingAge: FilingAgeDisplay;
  spouseFilingAge: FilingAgeDisplay;
  expectedNpv: number;
}> {
  const ranked = await rankedCoupleStrategies(worker, spouse, discountRate, asOf);
  if (ranked.length === 0) {
    throw new Error('No eligible couple filing strategies');
  }
  const best = ranked[0];
  return {
    workerFilingAge: best.filingAges[0],
    spouseFilingAge: best.filingAges[1],
    expectedNpv: best.expectedNpv,
  };
}

export function nearestWholeClaimAge(decimalYears: number): number {
  return Math.min(70, Math.max(62, Math.round(decimalYears)));
}
