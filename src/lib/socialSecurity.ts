import type { Gender } from './lifeExpectancy';
import { getSuggestedLifeExpectancy } from './lifeExpectancy';
import {
  computeOptimalFilingCouple,
  computeOptimalFilingSingle,
  createPiaRecipient,
  fraFromBirthYear,
  isSsaClaimAgeEligible,
  lifetimeNpvToAge,
  nearestWholeClaimAge,
  spousalBenefitAtFra,
  ssaMonthlyBenefitAtAge,
  ssaMonthlyBenefitAtFilingAge,
  type FilingAgeDisplay,
} from './ssaTools';
import { MonthDuration } from '$lib/month-time';
import { formatCurrency, fraLabel } from './format';
import {
  computeBreakEvens,
  MAX_CLAIM_AGE,
  MIN_CLAIM_AGE,
  roundCents,
  type BreakEvenPair,
  type ClaimingOption,
} from './benefitMath';

export type { Gender, FilingAgeDisplay };

export { formatAgeDisplay, formatCurrency, formatCurrencyPrecise, fraLabel } from './format';

export {
  breakEvenAge,
  computeBreakEvens,
  cumulativeBenefits,
  generateCumulativeChartData,
  MAX_CLAIM_AGE,
  MIN_CLAIM_AGE,
  type BreakEvenPair,
  type ClaimingOption,
} from './benefitMath';

/**
 * SSA-aligned Social Security benefit and claiming analysis.
 *
 * All benefit amounts, the full-retirement-age calculation, spousal/survivor
 * rules, and the mortality-weighted optimal filing age come from the vendored
 * ssa.tools engine (see `ssaTools.ts`). This module orchestrates those calls,
 * builds the per-age comparison table, derives break-even ages, and writes the
 * plain-language recommendation shown in the UI.
 *
 * COLA note: the `annualCola` input drives ONLY the illustrative cumulative
 * charts and break-even lines. Every dollar figure sourced from ssa.tools
 * already reflects SSA's historical/scheduled cost-of-living adjustments.
 */

export interface UserInputs {
  birthYear: number;
  birthMonth: number;
  monthlyBenefitAtFra: number;
  lifeExpectancy: number;
  /** Used for illustrative chart projections only; benefit math uses SSA COLA tables. */
  annualCola: number;
  gender: Gender;
  hasSpouse: boolean;
  discountRate: number;
  spouseBirthYear?: number;
  spouseBirthMonth?: number;
  spouseMonthlyBenefitAtFra?: number;
}

export interface FraResult {
  years: number;
  months: number;
  totalMonths: number;
  fraDate: Date;
}

export interface SpousalAnalysis {
  spousalBenefitAtFra: number;
  survivorByClaimAge: { age: number; survivorMonthly: number }[];
  spouseFilingAge?: FilingAgeDisplay;
}

export interface AnalysisResult {
  fra: FraResult;
  currentAge: { years: number; months: number };
  pia: number;
  claimingOptions: ClaimingOption[];
  optimalAge: number;
  optimalFilingAge: FilingAgeDisplay;
  optimalMonthly: number;
  optimalLifetime: number;
  expectedPresentValue: number;
  discountRate: number;
  breakEvens: BreakEvenPair[];
  recommendation: string;
  recommendationDetail: string;
  ssaSuggestedLifeExpectancy: number;
  spousal?: SpousalAnalysis;
}

export function getFullRetirementAge(birthYear: number): FraResult {
  const fra = fraFromBirthYear(birthYear);
  return {
    years: fra.years,
    months: fra.months,
    totalMonths: fra.totalMonths,
    fraDate: new Date(birthYear + fra.years, fra.months, 1),
  };
}

export function getCurrentAge(
  birthYear: number,
  birthMonth: number,
  asOf: Date = new Date(),
): { years: number; months: number } {
  let years = asOf.getFullYear() - birthYear;
  let months = asOf.getMonth() + 1 - birthMonth;

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return { years: Math.max(0, years), months: Math.max(0, months) };
}

export function ageToMonths(years: number, months = 0): number {
  return years * 12 + months;
}

export async function analyzeClaiming(inputs: UserInputs): Promise<AnalysisResult> {
  const {
    birthYear,
    birthMonth,
    monthlyBenefitAtFra,
    lifeExpectancy,
    annualCola,
    gender,
    hasSpouse,
    discountRate,
    spouseBirthYear,
    spouseBirthMonth,
    spouseMonthlyBenefitAtFra = 0,
  } = inputs;

  const fra = getFullRetirementAge(birthYear);
  const currentAge = getCurrentAge(birthYear, birthMonth);
  const pia = monthlyBenefitAtFra;
  const recipient = createPiaRecipient(birthYear, birthMonth, pia, gender);
  const ssaSuggestedLifeExpectancy = getSuggestedLifeExpectancy(currentAge.years, gender);

  let optimalFilingAge: FilingAgeDisplay;
  let expectedPresentValue: number;
  let spouseFilingAge: FilingAgeDisplay | undefined;

  if (hasSpouse) {
    const spouse = createPiaRecipient(
      spouseBirthYear ?? birthYear,
      spouseBirthMonth ?? birthMonth,
      spouseMonthlyBenefitAtFra,
      gender === 'male' ? 'female' : 'male',
    );
    const couple = await computeOptimalFilingCouple(recipient, spouse, discountRate);
    optimalFilingAge = couple.workerFilingAge;
    spouseFilingAge = couple.spouseFilingAge;
    expectedPresentValue = couple.expectedNpv;
  } else {
    const single = await computeOptimalFilingSingle(recipient, discountRate);
    optimalFilingAge = single.filingAge;
    expectedPresentValue = single.expectedNpv;
  }

  const optimalAge = nearestWholeClaimAge(optimalFilingAge.decimalYears);
  const optimalBenefit = ssaMonthlyBenefitAtFilingAge(
    recipient,
    optimalFilingAge.monthDuration,
  );

  const claimingOptions: ClaimingOption[] = [];

  for (let age = MIN_CLAIM_AGE; age <= MAX_CLAIM_AGE; age++) {
    const { benefit, percentOfPia, monthsFromFra } = ssaMonthlyBenefitAtAge(recipient, age);
    const eligible = isSsaClaimAgeEligible(recipient, age);
    const lifetimeAtAge = lifetimeNpvToAge(
      recipient,
      MonthDuration.initFromYearsMonths({ years: age, months: 0 }),
      lifeExpectancy,
      0,
    );

    claimingOptions.push({
      age,
      monthlyBenefit: benefit,
      percentOfPia,
      lifetimeBenefits: lifetimeAtAge,
      yearsOfPayments: Math.max(0, lifeExpectancy - age),
      isEligible: eligible,
      monthsFromFra,
    });
  }

  const optimalLifetime = lifetimeNpvToAge(
    recipient,
    optimalFilingAge.monthDuration,
    lifeExpectancy,
    0,
  );

  const breakEvens = computeBreakEvens(claimingOptions, annualCola);

  const { recommendation, recommendationDetail } = buildRecommendation({
    optimalFilingAge,
    optimalMonthly: optimalBenefit.benefit,
    optimalLifetime,
    expectedPresentValue,
    discountRate,
    fra,
    lifeExpectancy,
    currentAge,
    claimingOptions,
    hasSpouse,
    spouseFilingAge,
  });

  const spousal: SpousalAnalysis | undefined = hasSpouse
    ? {
        spousalBenefitAtFra: roundCents(spousalBenefitAtFra(recipient, spouseMonthlyBenefitAtFra)),
        // A surviving spouse inherits the deceased worker's own benefit, so the
        // survivor amount at each claiming age is that age's worker benefit.
        survivorByClaimAge: claimingOptions.map((o) => ({
          age: o.age,
          survivorMonthly: o.monthlyBenefit,
        })),
        spouseFilingAge,
      }
    : undefined;

  return {
    fra,
    currentAge,
    pia,
    claimingOptions,
    optimalAge,
    optimalFilingAge,
    optimalMonthly: optimalBenefit.benefit,
    optimalLifetime,
    expectedPresentValue,
    discountRate,
    breakEvens,
    recommendation,
    recommendationDetail,
    ssaSuggestedLifeExpectancy,
    spousal,
  };
}

function buildRecommendation(ctx: {
  optimalFilingAge: FilingAgeDisplay;
  optimalMonthly: number;
  optimalLifetime: number;
  expectedPresentValue: number;
  discountRate: number;
  fra: FraResult;
  lifeExpectancy: number;
  currentAge: { years: number; months: number };
  claimingOptions: ClaimingOption[];
  hasSpouse: boolean;
  spouseFilingAge?: FilingAgeDisplay;
}): { recommendation: string; recommendationDetail: string } {
  const {
    optimalFilingAge,
    optimalMonthly,
    optimalLifetime,
    expectedPresentValue,
    discountRate,
    fra,
    lifeExpectancy,
    currentAge,
    claimingOptions,
    hasSpouse,
    spouseFilingAge,
  } = ctx;

  const age62 = claimingOptions.find((o) => o.age === 62)!;
  const age70 = claimingOptions.find((o) => o.age === 70)!;
  const fraAge = fra.years + fra.months / 12;
  const discountPct = (discountRate * 100).toFixed(1);

  const spouseNote = hasSpouse
    ? spouseFilingAge
      ? ` Spouse optimal filing: age ${spouseFilingAge.label}.`
      : ` As a married claimant, delaying increases survivor benefits (up to ${formatCurrency(age70.monthlyBenefit)}/mo at 70 vs. ${formatCurrency(age62.monthlyBenefit)}/mo at 62).`
    : '';

  const ageLabel = optimalFilingAge.label;

  if (optimalFilingAge.years === 70 && optimalFilingAge.months === 0) {
    return {
      recommendation: 'Wait until age 70',
      recommendationDetail: `ssa.tools mortality-weighted analysis (${discountPct}% discount rate) recommends filing at age ${ageLabel} — ${formatCurrency(optimalMonthly)}/month. Expected present value: ${formatCurrency(expectedPresentValue)}. Lifetime to age ${lifeExpectancy}: ${formatCurrency(optimalLifetime)}.${spouseNote}`,
    };
  }

  if (optimalFilingAge.years === 62 && optimalFilingAge.months === 0) {
    return {
      recommendation: 'Claim as early as eligible (age 62)',
      recommendationDetail: `ssa.tools mortality-weighted analysis (${discountPct}% discount rate) favors filing at age ${ageLabel} with expected present value ${formatCurrency(expectedPresentValue)}. Lifetime to age ${lifeExpectancy}: ${formatCurrency(optimalLifetime)}.${spouseNote}`,
    };
  }

  if (Math.abs(optimalFilingAge.decimalYears - fraAge) < 0.5) {
    return {
      recommendation: `Claim at Full Retirement Age (${fraLabel(fra)})`,
      recommendationDetail: `ssa.tools recommends filing at age ${ageLabel} (${formatCurrency(optimalMonthly)}/month). Expected present value: ${formatCurrency(expectedPresentValue)} at a ${discountPct}% discount rate.${spouseNote}`,
    };
  }

  if (optimalFilingAge.decimalYears * 12 > ageToMonths(currentAge.years, currentAge.months)) {
    const yearsUntil = Math.ceil(optimalFilingAge.decimalYears - currentAge.years);
    return {
      recommendation: `Claim at age ${ageLabel}`,
      recommendationDetail: `ssa.tools mortality-weighted analysis recommends age ${ageLabel} (${formatCurrency(optimalMonthly)}/month, PV ${formatCurrency(expectedPresentValue)}). You're ${currentAge.years} — plan to claim in about ${yearsUntil} year${yearsUntil !== 1 ? 's' : ''}.${spouseNote}`,
    };
  }

  return {
    recommendation: `Claim at age ${ageLabel}`,
    recommendationDetail: `ssa.tools recommends filing at age ${ageLabel} for the highest expected present value (${formatCurrency(expectedPresentValue)}) at a ${discountPct}% discount rate. Lifetime to age ${lifeExpectancy}: ${formatCurrency(optimalLifetime)}.${spouseNote}`,
  };
}
