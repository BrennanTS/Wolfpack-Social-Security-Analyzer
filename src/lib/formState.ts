import type { AnalysisResult, Gender, UserInputs } from './socialSecurity';
import { analyzeClaiming, getCurrentAge } from './socialSecurity';
import { getSuggestedLifeExpectancy } from './lifeExpectancy';
import { CPI_DEFAULT_COLA } from './cpiHistory';
import { DEFAULT_DISCOUNT_RATE } from './ssaTools';

export type FormGender = Gender | null;
export type FormMarital = boolean | null;

export interface AnalyzerFormState {
  birthYear: number | '';
  birthMonth: number | '';
  monthlyBenefit: number | '';
  lifeExpectancy: number | null;
  annualCola: number;
  discountRate: number;
  gender: FormGender;
  hasSpouse: FormMarital;
  spouseBirthYear: number | '';
  spouseBirthMonth: number | '';
  spouseMonthlyBenefit: number | '';
}

export const BLANK_FORM: AnalyzerFormState = {
  birthYear: '',
  birthMonth: '',
  monthlyBenefit: '',
  lifeExpectancy: null,
  annualCola: CPI_DEFAULT_COLA,
  discountRate: DEFAULT_DISCOUNT_RATE,
  gender: null,
  hasSpouse: null,
  spouseBirthYear: '',
  spouseBirthMonth: '',
  spouseMonthlyBenefit: '',
};

export function isFormComplete(form: AnalyzerFormState): form is AnalyzerFormState & {
  birthYear: number;
  birthMonth: number;
  monthlyBenefit: number;
  lifeExpectancy: number;
  gender: Gender;
  hasSpouse: boolean;
} {
  return (
    form.birthYear !== '' &&
    form.birthMonth !== '' &&
    form.monthlyBenefit !== '' &&
    form.monthlyBenefit > 0 &&
    form.lifeExpectancy !== null &&
    form.gender !== null &&
    form.hasSpouse !== null
  );
}

export function toUserInputs(
  form: AnalyzerFormState & {
    birthYear: number;
    birthMonth: number;
    monthlyBenefit: number;
    lifeExpectancy: number;
    gender: Gender;
    hasSpouse: boolean;
  },
): UserInputs {
  return {
    birthYear: form.birthYear,
    birthMonth: form.birthMonth,
    monthlyBenefitAtFra: form.monthlyBenefit,
    lifeExpectancy: form.lifeExpectancy,
    annualCola: form.annualCola,
    gender: form.gender,
    hasSpouse: form.hasSpouse,
    discountRate: form.discountRate,
    spouseBirthYear: form.spouseBirthYear === '' ? form.birthYear : form.spouseBirthYear,
    spouseBirthMonth: form.spouseBirthMonth === '' ? form.birthMonth : form.spouseBirthMonth,
    spouseMonthlyBenefitAtFra:
      form.spouseMonthlyBenefit === '' ? 0 : form.spouseMonthlyBenefit,
  };
}

export async function analyzeIfComplete(
  form: AnalyzerFormState,
): Promise<AnalysisResult | null> {
  if (!isFormComplete(form)) return null;
  return analyzeClaiming(toUserInputs(form));
}

export function suggestedLifeExpectancy(form: AnalyzerFormState): number | null {
  if (form.birthYear === '' || form.birthMonth === '' || form.gender === null) return null;
  const age = getCurrentAge(form.birthYear, form.birthMonth).years;
  return getSuggestedLifeExpectancy(age, form.gender);
}
