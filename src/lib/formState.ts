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
  /**
   * Plan-to age. Null means "use the SSA suggestion for this person", which
   * is what person B received unconditionally before this field existed.
   */
  lifeExpectancy: number | null;
}

export interface AnalyzerFormState {
  personA: PersonFormFields;
  personB: PersonFormFields;
  hasSpouse: boolean | null;
  annualCola: number;
  discountRate: number;
}

const BLANK_PERSON: PersonFormFields = {
  name: '',
  birthYear: '',
  birthMonth: '',
  gender: null,
  monthlyBenefit: '',
  lifeExpectancy: null,
};

export const BLANK_FORM: AnalyzerFormState = {
  personA: BLANK_PERSON,
  personB: BLANK_PERSON,
  hasSpouse: null,
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
  if (form.hasSpouse === null || form.personA.lifeExpectancy === null) return false;
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

/** The SSA-suggested plan-to age for one person, or null if identity is incomplete. */
export function suggestedLifeExpectancyFor(fields: PersonFormFields): number | null {
  const { birthYear, birthMonth, gender } = fields;
  if (birthYear === '' || birthMonth === '' || gender === null) return null;
  return getSuggestedLifeExpectancy(getCurrentAge(birthYear, birthMonth).years, gender);
}

/**
 * Decides whether an edit to a person's fields should re-seed their
 * suggested life expectancy. Re-seeding must happen only when the identity
 * inputs (birth year, birth month, gender) actually changed — never on an
 * unrelated edit (name, benefit). Without this guard, correcting a benefit
 * amount silently snapped an adviser-set life expectancy back to the SSA
 * suggestion, moving every lifetime total with nothing on screen saying so.
 * Applies to both people identically.
 */
export function reseedLifeExpectancy(
  prev: PersonFormFields,
  next: PersonFormFields,
): PersonFormFields {
  const identityChanged =
    prev.birthYear !== next.birthYear ||
    prev.birthMonth !== next.birthMonth ||
    prev.gender !== next.gender;
  if (!identityChanged) return next;
  const suggested = suggestedLifeExpectancyFor(next);
  return suggested === null ? next : { ...next, lifeExpectancy: suggested };
}

function toPerson(fields: PersonFormFields, id: 'a' | 'b'): Person {
  return {
    id,
    name: fields.name.trim() || undefined,
    birthYear: fields.birthYear as number,
    birthMonth: fields.birthMonth as number,
    gender: fields.gender as Gender,
    piaMonthly: fields.monthlyBenefit as number,
    // Falling back to the SSA suggestion reproduces exactly what person B
    // received before this field existed, so no existing analysis moves.
    lifeExpectancy: fields.lifeExpectancy ?? (suggestedLifeExpectancyFor(fields) as number),
  };
}

export function toHousehold(form: AnalyzerFormState): Household {
  const personA = toPerson(form.personA, 'a');
  if (!form.hasSpouse) return { status: 'single', people: [personA] };
  return { status: 'married', people: [personA, toPerson(form.personB, 'b')] };
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
