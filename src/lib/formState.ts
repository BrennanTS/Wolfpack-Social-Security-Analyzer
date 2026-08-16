import { CPI_DEFAULT_COLA } from './cpiHistory';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from './household';
import { getCurrentAge, type Gender, type Person } from './personAnalysis';
import { getSuggestedLifeExpectancy } from './lifeExpectancy';
import { DEFAULT_DISCOUNT_RATE } from './ssaTools';

export interface PersonFormFields {
  name: string;
  birthYear: number | '';
  birthMonth: number | '';
  gender: Gender | null;
  monthlyBenefit: number | '';
}

export interface AnalyzerFormState {
  personA: PersonFormFields;
  personB: PersonFormFields;
  hasSpouse: boolean | null;
  lifeExpectancy: number | null;
  annualCola: number;
  discountRate: number;
}

const BLANK_PERSON: PersonFormFields = {
  name: '',
  birthYear: '',
  birthMonth: '',
  gender: null,
  monthlyBenefit: '',
};

export const BLANK_FORM: AnalyzerFormState = {
  personA: BLANK_PERSON,
  personB: BLANK_PERSON,
  hasSpouse: null,
  lifeExpectancy: null,
  annualCola: CPI_DEFAULT_COLA,
  discountRate: DEFAULT_DISCOUNT_RATE,
};

/**
 * Benefit guardrails — the single source of truth for both the form UI's
 * `aria-invalid` state (`PersonFields`) and the submission gate below.
 *
 * They used to be two different rules: the field marked anything under $500
 * invalid while the gate only required `> 0`, so a $250 entry showed a red
 * field *and* produced a confident analysis. Declared validity and the gate
 * now agree, and the gate is the stricter of the two directions — the app is
 * client-facing, so it should not put a number it has itself flagged as
 * implausible in front of an adviser's client.
 *
 * The primary person needs a real work record; a spouse's own benefit
 * legitimately starts at $0 ("no work record of their own"). $5,000 sits
 * above the maximum PIA attainable at FRA, so anything higher is a typo.
 */
export const MAX_BENEFIT = 5000;
export const MIN_BENEFIT_BY_INDEX: Record<0 | 1, number> = { 0: 500, 1: 0 };

export function isBenefitInRange(benefit: number, index: 0 | 1): boolean {
  return benefit >= MIN_BENEFIT_BY_INDEX[index] && benefit <= MAX_BENEFIT;
}

/** A person is complete when identity is present and the benefit is in range. */
function isPersonComplete(p: PersonFormFields, index: 0 | 1): boolean {
  if (p.birthYear === '' || p.birthMonth === '' || p.gender === null) return false;
  if (p.monthlyBenefit === '') return false;
  return isBenefitInRange(p.monthlyBenefit, index);
}

export function isFormComplete(form: AnalyzerFormState): boolean {
  if (form.hasSpouse === null || form.lifeExpectancy === null) return false;
  if (!isPersonComplete(form.personA, 0)) return false;
  // Married analyses require real spouse data — never defaulted from person A.
  if (form.hasSpouse && !isPersonComplete(form.personB, 1)) return false;
  return true;
}

function toPerson(fields: PersonFormFields, id: 'a' | 'b', lifeExpectancy: number): Person {
  return {
    id,
    name: fields.name.trim() || undefined,
    birthYear: fields.birthYear as number,
    birthMonth: fields.birthMonth as number,
    gender: fields.gender as Gender,
    piaMonthly: fields.monthlyBenefit as number,
    lifeExpectancy,
  };
}

export function toHousehold(form: AnalyzerFormState): Household {
  const le = form.lifeExpectancy as number;
  const personA = toPerson(form.personA, 'a', le);

  if (!form.hasSpouse) return { status: 'single', people: [personA] };

  const spouseAge = getCurrentAge(
    form.personB.birthYear as number,
    form.personB.birthMonth as number,
  ).years;
  const spouseLe = getSuggestedLifeExpectancy(spouseAge, form.personB.gender as Gender);

  return { status: 'married', people: [personA, toPerson(form.personB, 'b', spouseLe)] };
}

export async function analyzeIfComplete(
  form: AnalyzerFormState,
  asOf?: Date,
): Promise<HouseholdAnalysis | null> {
  if (!isFormComplete(form)) return null;
  return analyzeHousehold(
    toHousehold(form),
    { annualCola: form.annualCola, discountRate: form.discountRate },
    asOf,
  );
}

export function suggestedLifeExpectancy(form: AnalyzerFormState): number | null {
  const { birthYear, birthMonth, gender } = form.personA;
  if (birthYear === '' || birthMonth === '' || gender === null) return null;
  return getSuggestedLifeExpectancy(getCurrentAge(birthYear, birthMonth).years, gender);
}
