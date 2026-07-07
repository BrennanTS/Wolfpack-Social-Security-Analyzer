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

export type { Gender, FilingAgeDisplay };

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

export interface ClaimingOption {
  age: number;
  monthlyBenefit: number;
  percentOfPia: number;
  lifetimeBenefits: number;
  yearsOfPayments: number;
  isEligible: boolean;
  monthsFromFra: number;
}

export interface BreakEvenPair {
  earlierAge: number;
  laterAge: number;
  breakEvenAge: number;
  breakEvenYears: number;
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

const MIN_CLAIM_AGE = 62;
const MAX_CLAIM_AGE = 70;

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

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sum of nominal monthly benefits from `claimAge` through `throughAge`,
 * optionally grown by a flat `annualCola`. Used only for the illustrative
 * cumulative charts and break-even math — not for the ssa.tools totals.
 */
export function cumulativeBenefits(
  monthlyBenefit: number,
  claimAge: number,
  throughAge: number,
  annualCola = 0,
): number {
  const years = Math.max(0, throughAge - claimAge);
  if (years === 0) return 0;

  if (annualCola === 0) {
    return roundCents(monthlyBenefit * years * 12);
  }

  const rate = annualCola / 100;
  let total = 0;
  for (let y = 0; y < years; y++) {
    total += monthlyBenefit * 12 * Math.pow(1 + rate, y);
  }
  return roundCents(total);
}

export function breakEvenAge(
  earlierAge: number,
  earlierMonthly: number,
  laterAge: number,
  laterMonthly: number,
  annualCola = 0,
): number | null {
  if (laterMonthly <= earlierMonthly && annualCola === 0) return null;

  for (let t = laterAge * 10; t <= 1200; t++) {
    const age = t / 10;
    const cumEarlier = cumulativeBenefits(earlierMonthly, earlierAge, age, annualCola);
    const cumLater = cumulativeBenefits(laterMonthly, laterAge, age, annualCola);
    if (cumLater >= cumEarlier) {
      return Math.round(age * 10) / 10;
    }
  }
  return null;
}

/** Claiming ages compared pairwise for break-even analysis (early / FRA-ish / max). */
const BREAK_EVEN_AGES = [62, 67, 70];

/**
 * Break-even ages for the canonical claiming-age pairs. This is illustrative and
 * driven by the flat `annualCola` slider, so it is computed on the client and
 * recomputed instantly when COLA changes — no need to re-run the ssa.tools engine.
 */
export function computeBreakEvens(
  claimingOptions: ClaimingOption[],
  annualCola = 0,
): BreakEvenPair[] {
  const breakEvens: BreakEvenPair[] = [];
  const ages = BREAK_EVEN_AGES.filter((a) => a >= MIN_CLAIM_AGE && a <= MAX_CLAIM_AGE);

  for (let i = 0; i < ages.length; i++) {
    for (let j = i + 1; j < ages.length; j++) {
      const earlier = claimingOptions.find((o) => o.age === ages[i]);
      const later = claimingOptions.find((o) => o.age === ages[j]);
      if (!earlier || !later) continue;

      const be = breakEvenAge(
        earlier.age,
        earlier.monthlyBenefit,
        later.age,
        later.monthlyBenefit,
        annualCola,
      );
      if (be !== null) {
        breakEvens.push({
          earlierAge: earlier.age,
          laterAge: later.age,
          breakEvenAge: be,
          breakEvenYears: Math.round((be - later.age) * 10) / 10,
        });
      }
    }
  }

  return breakEvens;
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

export function fraLabel(fra: FraResult): string {
  if (fra.months === 0) return `${fra.years}`;
  return `${fra.years} years, ${fra.months} months`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCurrencyPrecise(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function generateCumulativeChartData(
  options: ClaimingOption[],
  maxAge: number,
  annualCola = 0,
): { age: number; [key: string]: number }[] {
  const data: { age: number; [key: string]: number }[] = [];

  for (let age = MIN_CLAIM_AGE; age <= maxAge; age++) {
    const point: { age: number; [key: string]: number } = { age };
    for (const opt of options) {
      if (age >= opt.age) {
        point[`age${opt.age}`] = cumulativeBenefits(
          opt.monthlyBenefit,
          opt.age,
          age,
          annualCola,
        );
      }
    }
    data.push(point);
  }

  return data;
}
