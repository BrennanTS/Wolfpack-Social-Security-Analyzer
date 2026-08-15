import { MonthDuration } from '$lib/month-time';
import {
  computeBreakEvens,
  MAX_CLAIM_AGE,
  MIN_CLAIM_AGE,
  type BreakEvenPair,
  type ClaimingOption,
} from './benefitMath';
import { getSuggestedLifeExpectancy, type Gender } from './lifeExpectancy';
import {
  createPiaRecipient,
  fraFromBirthYear,
  isSsaClaimAgeEligible,
  lifetimeNpvToAge,
  ssaMonthlyBenefitAtAge,
  ssaMonthlyBenefitAtFilingAge,
  type FilingAgeDisplay,
} from './ssaTools';

// Single source of truth — `lifeExpectancy.ts` owns Gender because its life
// tables are keyed by it. Re-exported so consumers import person concepts
// from one place.
export type { Gender };

export interface Person {
  id: 'a' | 'b';
  name?: string;
  birthYear: number;
  birthMonth: number;
  gender: Gender;
  piaMonthly: number;
  lifeExpectancy: number;
}

export interface FraResult {
  years: number;
  months: number;
  totalMonths: number;
  fraDate: Date;
}

export interface PersonAnalysis {
  person: Person;
  fra: FraResult;
  currentAge: { years: number; months: number };
  claimingOptions: ClaimingOption[];
  recommendedFilingAge: FilingAgeDisplay;
  recommendedMonthly: number;
  breakEvens: BreakEvenPair[];
  ssaSuggestedLifeExpectancy: number;
}

export function getFullRetirementAge(birthYear: number): FraResult {
  const fra = fraFromBirthYear(birthYear);
  return { ...fra, fraDate: new Date(birthYear + fra.years, fra.months, 1) };
}

export function getCurrentAge(
  birthYear: number,
  birthMonth: number,
  asOf: Date = new Date(),
): { years: number; months: number } {
  // Total whole months from birth to `asOf`. Clamp the total, not the parts:
  // clamping years and months independently lets a not-yet-born person come
  // back as a plausible-looking non-zero age.
  const totalMonths = Math.max(
    0,
    (asOf.getFullYear() - birthYear) * 12 + (asOf.getMonth() + 1 - birthMonth),
  );
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12 };
}

export function ageToMonths(years: number, months = 0): number {
  return years * 12 + months;
}

export function analyzePerson(
  person: Person,
  recommendedFilingAge: FilingAgeDisplay,
  annualCola: number,
  asOf: Date = new Date(),
): PersonAnalysis {
  const recipient = createPiaRecipient(
    person.birthYear,
    person.birthMonth,
    person.piaMonthly,
    person.gender,
  );
  const currentAge = getCurrentAge(person.birthYear, person.birthMonth, asOf);

  const claimingOptions: ClaimingOption[] = [];
  for (let age = MIN_CLAIM_AGE; age <= MAX_CLAIM_AGE; age++) {
    const { benefit, percentOfPia, monthsFromFra } = ssaMonthlyBenefitAtAge(recipient, age);
    claimingOptions.push({
      age,
      monthlyBenefit: benefit,
      percentOfPia,
      lifetimeBenefits: lifetimeNpvToAge(
        recipient,
        MonthDuration.initFromYearsMonths({ years: age, months: 0 }),
        person.lifeExpectancy,
        0,
        asOf,
      ),
      yearsOfPayments: Math.max(0, person.lifeExpectancy - age),
      isEligible: isSsaClaimAgeEligible(recipient, age, asOf),
      monthsFromFra,
    });
  }

  return {
    person,
    fra: getFullRetirementAge(person.birthYear),
    currentAge,
    claimingOptions,
    recommendedFilingAge,
    recommendedMonthly: ssaMonthlyBenefitAtFilingAge(
      recipient,
      recommendedFilingAge.monthDuration,
    ).benefit,
    breakEvens: computeBreakEvens(claimingOptions, annualCola),
    ssaSuggestedLifeExpectancy: getSuggestedLifeExpectancy(currentAge.years, person.gender),
  };
}
