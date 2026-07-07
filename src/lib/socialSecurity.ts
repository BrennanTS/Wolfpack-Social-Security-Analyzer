import { CPI_DEFAULT_COLA } from './cpiHistory';
import type { Gender } from './lifeExpectancy';
import { getSuggestedLifeExpectancy } from './lifeExpectancy';

export type { Gender };

/** SSA-aligned Social Security benefit and claiming analysis. */

export interface UserInputs {
  birthYear: number;
  birthMonth: number;
  monthlyBenefitAtFra: number;
  lifeExpectancy: number;
  /** Annual COLA / inflation rate applied to lifetime projections (percent, e.g. 2.5). */
  annualCola: number;
  gender: Gender;
  hasSpouse: boolean;
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
  /** Maximum spousal benefit at spouse's FRA (50% of worker PIA). */
  spousalBenefitAtFra: number;
  /** Monthly survivor benefit = worker's benefit at each claiming age. */
  survivorByClaimAge: { age: number; survivorMonthly: number }[];
}

export interface AnalysisResult {
  fra: FraResult;
  currentAge: { years: number; months: number };
  pia: number;
  claimingOptions: ClaimingOption[];
  optimalAge: number;
  optimalMonthly: number;
  optimalLifetime: number;
  breakEvens: BreakEvenPair[];
  recommendation: string;
  recommendationDetail: string;
  ssaSuggestedLifeExpectancy: number;
  spousal?: SpousalAnalysis;
}

const MIN_CLAIM_AGE = 62;
const MAX_CLAIM_AGE = 70;

/** Full Retirement Age in months per SSA birth-year schedule. */
export function getFullRetirementAge(birthYear: number): FraResult {
  let years: number;
  let months = 0;

  if (birthYear <= 1937) {
    years = 65;
  } else if (birthYear <= 1942) {
    years = 65;
    months = (birthYear - 1937) * 2;
  } else if (birthYear <= 1954) {
    years = 66;
  } else if (birthYear <= 1959) {
    years = 66;
    months = (birthYear - 1954) * 2;
  } else {
    years = 67;
  }

  const totalMonths = years * 12 + months;
  return { years, months, totalMonths, fraDate: new Date(birthYear + years, months, 1) };
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

/** Monthly benefit at a given claiming age, based on PIA at FRA. */
export function calculateMonthlyBenefit(
  pia: number,
  claimAge: number,
  fraTotalMonths: number,
): { benefit: number; percentOfPia: number; monthsFromFra: number } {
  const claimMonths = claimAge * 12;
  const monthsFromFra = claimMonths - fraTotalMonths;

  if (monthsFromFra === 0) {
    return { benefit: pia, percentOfPia: 100, monthsFromFra: 0 };
  }

  if (monthsFromFra > 0) {
    const delayedMonths = Math.min(monthsFromFra, MAX_CLAIM_AGE * 12 - fraTotalMonths);
    const credit = delayedMonths * (2 / 3 / 100);
    const benefit = pia * (1 + credit);
    return {
      benefit: roundCents(benefit),
      percentOfPia: roundPercent((benefit / pia) * 100),
      monthsFromFra: delayedMonths,
    };
  }

  const monthsEarly = Math.abs(monthsFromFra);
  let reduction: number;

  if (monthsEarly <= 36) {
    reduction = monthsEarly * (5 / 9 / 100);
  } else {
    reduction = 36 * (5 / 9 / 100) + (monthsEarly - 36) * (5 / 12 / 100);
  }

  const benefit = pia * (1 - reduction);
  return {
    benefit: roundCents(benefit),
    percentOfPia: roundPercent((benefit / pia) * 100),
    monthsFromFra: -monthsEarly,
  };
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPercent(n: number): number {
  return Math.round(n * 10) / 10;
}

export function isClaimAgeEligible(
  claimAge: number,
  birthYear: number,
  birthMonth: number,
  asOf: Date = new Date(),
): boolean {
  const current = getCurrentAge(birthYear, birthMonth, asOf);
  const currentTotalMonths = ageToMonths(current.years, current.months);
  return claimAge * 12 <= currentTotalMonths + 12;
}

/** Lifetime benefits with optional annual COLA compounding on payments. */
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

/** Cumulative nominal benefits from claim age through a given end age. */
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

/** Age when cumulative benefits from later claiming exceed earlier claiming. */
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

export function analyzeClaiming(inputs: UserInputs): AnalysisResult {
  const {
    birthYear,
    birthMonth,
    monthlyBenefitAtFra,
    lifeExpectancy,
    annualCola,
    gender,
    hasSpouse,
  } = inputs;
  const fra = getFullRetirementAge(birthYear);
  const currentAge = getCurrentAge(birthYear, birthMonth);
  const pia = monthlyBenefitAtFra;
  const ssaSuggestedLifeExpectancy = getSuggestedLifeExpectancy(currentAge.years, gender);

  const claimingOptions: ClaimingOption[] = [];

  for (let age = MIN_CLAIM_AGE; age <= MAX_CLAIM_AGE; age++) {
    const { benefit, percentOfPia, monthsFromFra } = calculateMonthlyBenefit(
      pia,
      age,
      fra.totalMonths,
    );
    const eligible = isClaimAgeEligible(age, birthYear, birthMonth);
    const { lifetime, yearsOfPayments } = calculateLifetimeBenefits(
      benefit,
      age,
      lifeExpectancy,
      annualCola,
    );

    claimingOptions.push({
      age,
      monthlyBenefit: benefit,
      percentOfPia,
      lifetimeBenefits: lifetime,
      yearsOfPayments,
      isEligible: eligible,
      monthsFromFra,
    });
  }

  const eligibleOptions = claimingOptions.filter((o) => o.isEligible);
  const best =
    eligibleOptions.length > 0
      ? eligibleOptions.reduce((a, b) =>
          a.lifetimeBenefits >= b.lifetimeBenefits ? a : b,
        )
      : claimingOptions.reduce((a, b) =>
          a.lifetimeBenefits >= b.lifetimeBenefits ? a : b,
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

  const { recommendation, recommendationDetail } = buildRecommendation(
    best,
    fra,
    lifeExpectancy,
    annualCola,
    currentAge,
    claimingOptions,
    hasSpouse,
  );

  const spousal: SpousalAnalysis | undefined = hasSpouse
    ? {
        spousalBenefitAtFra: roundCents(pia * 0.5),
        survivorByClaimAge: claimingOptions.map((o) => ({
          age: o.age,
          survivorMonthly: o.monthlyBenefit,
        })),
      }
    : undefined;

  return {
    fra,
    currentAge,
    pia,
    claimingOptions,
    optimalAge: best.age,
    optimalMonthly: best.monthlyBenefit,
    optimalLifetime: best.lifetimeBenefits,
    breakEvens,
    recommendation,
    recommendationDetail,
    ssaSuggestedLifeExpectancy,
    spousal,
  };
}

function buildRecommendation(
  best: ClaimingOption,
  fra: FraResult,
  lifeExpectancy: number,
  annualCola: number,
  currentAge: { years: number; months: number },
  options: ClaimingOption[],
  hasSpouse: boolean,
): { recommendation: string; recommendationDetail: string } {
  const fraAge = fra.years + fra.months / 12;
  const fraOption = options.find((o) => Math.abs(o.age - Math.round(fraAge)) < 0.5)
    ?? options.find((o) => o.age === Math.ceil(fraAge))
    ?? options.find((o) => o.age === Math.floor(fraAge));

  const age62 = options.find((o) => o.age === 62)!;
  const age70 = options.find((o) => o.age === 70)!;
  const colaNote =
    annualCola > 0
      ? ` (includes ${annualCola}% annual COLA on lifetime projections)`
      : '';
  const spouseNote = hasSpouse
    ? ` As a married claimant, delaying increases your spouse's potential survivor benefit (up to ${formatCurrency(age70.monthlyBenefit)}/mo if you claim at 70 vs. ${formatCurrency(age62.monthlyBenefit)}/mo at 62).`
    : '';

  if (best.age === 70) {
    return {
      recommendation: `Wait until age 70`,
      recommendationDetail: `Based on a life expectancy of ${lifeExpectancy}${colaNote}, delaying to 70 maximizes lifetime benefits at ${formatCurrency(best.monthlyBenefit)}/month — ${formatCurrency(best.lifetimeBenefits)} total. You gain ${formatCurrency(best.lifetimeBenefits - age62.lifetimeBenefits)} vs. claiming at 62.${spouseNote}`,
    };
  }

  if (best.age === 62) {
    return {
      recommendation: `Claim as early as eligible (age 62)`,
      recommendationDetail: `With a life expectancy of ${lifeExpectancy}${colaNote}, starting at 62 provides the highest lifetime total of ${formatCurrency(best.lifetimeBenefits)}. The higher monthly checks from delaying don't offset the fewer years of payments.${spouseNote}`,
    };
  }

  if (fraOption && best.age === fraOption.age) {
    return {
      recommendation: `Claim at Full Retirement Age (${fraLabel(fra)})`,
      recommendationDetail: `At life expectancy ${lifeExpectancy}${colaNote}, FRA maximizes lifetime benefits at ${formatCurrency(best.monthlyBenefit)}/month. You receive 100% of your Primary Insurance Amount with no early reduction or need to wait for delayed credits.${spouseNote}`,
    };
  }

  const currentTotal = ageToMonths(currentAge.years, currentAge.months);

  if (best.age * 12 > currentTotal) {
    return {
      recommendation: `Claim at age ${best.age}`,
      recommendationDetail: `Based on life expectancy ${lifeExpectancy}${colaNote}, age ${best.age} optimizes lifetime benefits at ${formatCurrency(best.monthlyBenefit)}/month (${formatCurrency(best.lifetimeBenefits)} total). You're currently ${currentAge.years} — plan to claim in ${best.age - currentAge.years} year${best.age - currentAge.years !== 1 ? 's' : ''}.${spouseNote}`,
    };
  }

  return {
    recommendation: `Claim at age ${best.age}`,
    recommendationDetail: `At life expectancy ${lifeExpectancy}${colaNote}, age ${best.age} provides the highest lifetime benefit of ${formatCurrency(best.lifetimeBenefits)} (${formatCurrency(best.monthlyBenefit)}/month).${spouseNote}`,
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

/** Chart data: cumulative benefits by age for each claiming strategy. */
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
};
