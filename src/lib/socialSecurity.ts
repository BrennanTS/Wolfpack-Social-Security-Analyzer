import type { Recipient } from '$lib/recipient';
import { MonthDuration } from '$lib/month-time';
import { getSuggestedLifeExpectancy } from './lifeExpectancy';
import {
  computeOptimalFilingCouple,
  computeOptimalFilingSingle,
  createPiaRecipient,
  isSsaClaimAgeEligible,
  lifetimeNpvToAge,
  nearestWholeClaimAge,
  spousalTopUp,
  ssaMonthlyBenefitAtAge,
  ssaMonthlyBenefitAtFilingAge,
  type FilingAgeDisplay,
} from './ssaTools';
import { formatCurrency, fraLabel } from './format';
import {
  computeBreakEvens,
  MAX_CLAIM_AGE,
  MIN_CLAIM_AGE,
  roundCents,
  type BreakEvenPair,
  type ClaimingOption,
} from './benefitMath';
import {
  ageToMonths,
  getCurrentAge,
  getFullRetirementAge,
  type FraResult,
  type Gender,
} from './personAnalysis';

/**
 * Deprecated compatibility module.
 *
 * Most of what used to live here now lives in format.ts, benefitMath.ts,
 * personAnalysis.ts and household.ts — re-exported below so components that
 * have not migrated yet keep compiling.
 *
 * `analyzeClaiming` and its `AnalysisResult` / `UserInputs` / `SpousalAnalysis`
 * shape are NOT a re-export: they are the legacy single-person pipeline, still
 * genuinely used by components that haven't migrated to `HouseholdAnalysis`
 * (Task 19) and by the golden-fixture suite (Task 21). It cannot be reduced to
 * a pure barrel until those callers move off it. Task 20 deletes this file
 * once the last importer is gone.
 */

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

export {
  ageToMonths,
  getCurrentAge,
  getFullRetirementAge,
  type FraResult,
  type Gender,
} from './personAnalysis';

export type { FilingAgeDisplay };

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

export interface SpousalAnalysis {
  /**
   * The unreduced spousal top-up: half the worker's PIA minus the spouse's
   * own PIA, evaluated at the spouse's own full retirement age. No early
   * reduction applies at FRA and delayed retirement credits never apply to
   * spousal benefits, so this is exactly `max(0, workerPIA/2 - spousePIA)` —
   * independently derivable without the engine.
   */
  spousalBenefitAtFra: number;
  /**
   * The top-up the spouse actually receives given the mortality-weighted
   * couple optimizer's chosen spouse filing age, which is frequently before
   * the spouse's own FRA. Reduced by the SSA early-filing schedule (25/36%
   * per month for the first 36 months early, then 5/12% per month beyond
   * that) relative to `spousalBenefitAtFra`. Depends on the optimizer, so —
   * unlike `spousalBenefitAtFra` — it cannot be derived independently of the
   * engine; it can only be sanity-checked against it.
   */
  spousalTopUpAtFilingAge: number;
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
  let spouse: Recipient | undefined;
  let spouseFilingAge: FilingAgeDisplay | undefined;

  if (hasSpouse) {
    spouse = createPiaRecipient(
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

  const spousal: SpousalAnalysis | undefined =
    hasSpouse && spouse && spouseFilingAge
      ? {
          spousalBenefitAtFra: roundCents(
            spousalTopUp(recipient, spouse, spouse.normalRetirementAge()),
          ),
          spousalTopUpAtFilingAge: roundCents(
            spousalTopUp(recipient, spouse, spouseFilingAge.monthDuration),
          ),
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
