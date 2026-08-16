import { CPI_DEFAULT_COLA } from './cpiHistory';
import { isBenefitInRange } from './formBounds';
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

export { isBenefitInRange, MAX_BENEFIT, MIN_BENEFIT } from './formBounds';

/** A person is complete when identity is present and the benefit is in range. */
function isPersonComplete(p: PersonFormFields): boolean {
  if (p.birthYear === '' || p.birthMonth === '' || p.gender === null) return false;
  if (p.monthlyBenefit === '') return false;
  return isBenefitInRange(p.monthlyBenefit);
}

export function isFormComplete(form: AnalyzerFormState): boolean {
  if (form.hasSpouse === null || form.lifeExpectancy === null) return false;
  if (!isPersonComplete(form.personA)) return false;
  // Married analyses require real spouse data — never defaulted from person A.
  if (form.hasSpouse && !isPersonComplete(form.personB)) return false;

  // A person with no work record of their own is legitimate — they may draw a
  // spousal benefit on their partner's record. A household where *nobody*
  // earns has nothing to analyze.
  const benefits = form.hasSpouse
    ? [form.personA.monthlyBenefit, form.personB.monthlyBenefit]
    : [form.personA.monthlyBenefit];
  return benefits.some((b) => b !== '' && b > 0);
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
