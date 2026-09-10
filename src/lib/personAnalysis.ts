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
  ssaBirthMonth,
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
  /** 1-12, not JS's 0-11. */
  birthMonth: number;
  /**
   * Day of the month, 1-31.
   *
   * It matters for one reason, and only for people born on the 1st: SSA
   * follows the common-law rule that you attain an age the day BEFORE your
   * birthday, so someone born on the 1st attains their age in the previous
   * month. Every other day of the month behaves identically — measured
   * across days 2, 3, 15 and 28, the engine returns the same normal
   * retirement date to the month.
   *
   * The consequence is not cosmetic. Born 1 January 1960, SSA reads December
   * 1959, which is a different full-retirement-age bracket: 66 years 10
   * months rather than 67. The app said 67 until this field existed.
   *
   * Required, deliberately. An optional day defaults to "not the 1st", which
   * is the wrong answer for exactly the people this field exists to serve,
   * and silence is how they would keep getting it.
   */
  birthDay: number;
  gender: Gender;
  piaMonthly: number;
  lifeExpectancy: number;
}

export interface FraResult {
  years: number;
  months: number;
}

export interface PersonAnalysis {
  person: Person;
  fra: FraResult;
  currentAge: { years: number; months: number };
  claimingOptions: ClaimingOption[];
  /**
   * The filing age this person's analysis is built on — the household's
   * SELECTED scenario, which is the optimizer's pick only while the scenario
   * is `best`. Named for what it is rather than `recommendedFilingAge`, which
   * it was called until scenarios existed: a field called "recommended"
   * holding an age the adviser typed in is precisely how a true number ends
   * up under an untrue label.
   */
  filingAge: FilingAgeDisplay;
  /** The monthly benefit at `filingAge`. */
  monthlyAtFilingAge: number;
  /**
   * The age this person would file at if they were the ONLY claimant —
   * everything else held constant: the same discount rate, the same plan-to
   * age, the same reference date.
   *
   * Null for a single claimant, where it would equal `filingAge` by
   * construction and a second badge saying so would be noise, and for a
   * widow(er), whose decision is two dates rather than a filing age.
   *
   * Non-null for a married person, where it frequently DISAGREES with the
   * household's answer and the disagreement is the point. Measured: a
   * lower-earning spouse with the longer horizon has a solo answer of 70 and
   * a household answer of 66 — she inherits the higher earner's survivor
   * benefit, so delaying her own record past 66 buys her nothing the
   * household does not already get. Showing only the household figure hides
   * that; showing only hers would recommend against her own household.
   */
  soloFilingAge: FilingAgeDisplay | null;
  /**
   * The age the OPTIMIZER chose for this person — the household's own best
   * answer, whatever scenario is currently being shown.
   *
   * Distinct from `filingAge`, and equal to it only while the shown scenario
   * IS the optimum. Conflating the two put "Best together" on age 62 for a
   * household whose optimum was 70, on the same screen as a comparison table
   * badging 70 as best and pricing 62 at $171,728 less — and made
   * `soloVsHouseholdNote` say "the optimizer chooses age 62 years, 1 month"
   * about an age the optimizer had rejected.
   *
   * Three ages now exist per person and each answers a different question:
   * `householdBestFilingAge` (best for the household), `soloFilingAge` (best
   * for them alone), and `filingAge` (what the figures on the page are
   * actually built from). Any label naming one of them must not be attached
   * to another.
   */
  householdBestFilingAge: FilingAgeDisplay;
  breakEvens: BreakEvenPair[];
  ssaSuggestedLifeExpectancy: number;
}

/**
 * The full retirement age for a birthday.
 *
 * Looked up from the SSA birth YEAR, which is not always the calendar one.
 * Someone born 1 January 1960 attains their ages a day earlier, in December
 * 1959, and the FRA schedule reads them as a 1959 birth: 66 years 10 months,
 * not 67. Passing only the year gets that person wrong by two months, and
 * every date built on their FRA with them.
 *
 * `birthMonth` and `birthDay` are optional only because the form asks for
 * them one at a time and this drives a live hint beside the fields. Without
 * them the calendar year is used, which is right for every day but the 1st —
 * so the hint can be provisional for one keystroke, and is settled the
 * moment the day is chosen.
 */
export function getFullRetirementAge(
  birthYear: number,
  birthMonth?: number,
  birthDay?: number,
): FraResult {
  const year =
    birthMonth === undefined || birthDay === undefined
      ? birthYear
      : ssaBirthMonth(birthYear, birthMonth, birthDay).year;
  const { years, months } = fraFromBirthYear(year);
  return { years, months };
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

export function analyzePerson(
  person: Person,
  filingAge: FilingAgeDisplay,
  annualCola: number,
  asOf: Date = new Date(),
  soloFilingAge: FilingAgeDisplay | null = null,
  /** Defaults to `filingAge` — true whenever no scenario has been chosen. */
  householdBestFilingAge: FilingAgeDisplay = filingAge,
): PersonAnalysis {
  const recipient = createPiaRecipient(
    person.birthYear,
    person.birthMonth,
    person.birthDay,
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
    fra: getFullRetirementAge(person.birthYear, person.birthMonth, person.birthDay),
    currentAge,
    claimingOptions,
    filingAge,
    monthlyAtFilingAge: ssaMonthlyBenefitAtFilingAge(
      recipient,
      filingAge.monthDuration,
    ).benefit,
    soloFilingAge,
    householdBestFilingAge,
    breakEvens: computeBreakEvens(claimingOptions, annualCola),
    ssaSuggestedLifeExpectancy: getSuggestedLifeExpectancy(currentAge.years, person.gender),
  };
}
