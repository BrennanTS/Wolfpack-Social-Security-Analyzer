import { CPI_DEFAULT_COLA } from './cpiHistory';
import type { Gender } from './lifeExpectancy';
import { getSuggestedLifeExpectancy } from './lifeExpectancy';
import {
  computeOptimalFilingCouple,
  computeOptimalFilingSingle,
  createPiaRecipient,
  DEFAULT_DISCOUNT_RATE,
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

/** SSA-aligned Social Security benefit and claiming analysis (powered by ssa.tools). */

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

export function calculateMonthlyBenefit(
  pia: number,
  claimAge: number,
  _fraTotalMonths: number,
  birthYear?: number,
  birthMonth?: number,
  gender: Gender = 'female',
): { benefit: number; percentOfPia: number; monthsFromFra: number } {
  const recipient = createPiaRecipient(birthYear ?? 1960, birthMonth ?? 1, pia, gender);
  return ssaMonthlyBenefitAtAge(recipient, claimAge);
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isClaimAgeEligible(
  claimAge: number,
  birthYear: number,
  birthMonth: number,
  asOf: Date = new Date(),
): boolean {
  const recipient = createPiaRecipient(birthYear, birthMonth, 0, 'female');
  return isSsaClaimAgeEligible(recipient, claimAge, asOf);
}

export function calculateLifetimeBenefits(
  monthlyBenefit: number,
  claimAge: number,
  lifeExpectancy: number,
  annualCola = 0,
): { lifetime: number; yearsOfPayments: number } {
  const yearsOfPayments = Math.max(0, lifeExpectancy - claimAge);
  const lifetime = cumulativeBenefits(monthlyBenefit, claimAge, lifeExpectancy, annualCola);
  return { lifetime, yearsOfPayments };
}

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

function pickTableOption(
  claimingOptions: ClaimingOption[],
  eligibleOptions: ClaimingOption[],
  optimalAge: number,
): ClaimingOption {
  const pool = eligibleOptions.length > 0 ? eligibleOptions : claimingOptions;
  const exact = pool.find((o) => o.age === optimalAge);
  if (exact) return exact;
  return pool.reduce((closest, option) =>
    Math.abs(option.age - optimalAge) < Math.abs(closest.age - optimalAge) ? option : closest,
  );
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

  const eligibleOptions = claimingOptions.filter((o) => o.isEligible);
  const bestTableOption = pickTableOption(claimingOptions, eligibleOptions, optimalAge);

  const optimalLifetime = lifetimeNpvToAge(
    recipient,
    optimalFilingAge.monthDuration,
    lifeExpectancy,
    0,
  );

  const breakEvens: BreakEvenPair[] = [];
  const ages = [62, 67, 70].filter((a) => a >= MIN_CLAIM_AGE && a <= MAX_CLAIM_AGE);

  for (let i = 0; i < ages.length; i++) {
    for (let j = i + 1; j < ages.length; j++) {
      const earlier = claimingOptions.find((o) => o.age === ages[i])!;
      const later = claimingOptions.find((o) => o.age === ages[j])!;
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
    bestTableAge: bestTableOption.age,
  });

  const spousal: SpousalAnalysis | undefined = hasSpouse
    ? {
        spousalBenefitAtFra: roundCents(spousalBenefitAtFra(recipient, spouseMonthlyBenefitAtFra)),
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
  bestTableAge: number;
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

export const DEFAULT_INPUTS: UserInputs = {
  birthYear: 1960,
  birthMonth: 6,
  monthlyBenefitAtFra: 2500,
  lifeExpectancy: getSuggestedLifeExpectancy(66, 'female'),
  annualCola: CPI_DEFAULT_COLA,
  gender: 'female',
  hasSpouse: false,
  discountRate: DEFAULT_DISCOUNT_RATE,
};
