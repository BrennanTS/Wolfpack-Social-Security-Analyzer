import { CPI_DEFAULT_COLA } from './cpiHistory';
import type { DollarsMode } from './dollarsMode';
import { isBenefitInRange } from './formBounds';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from './household';
import { getCurrentAge, type Gender, type Person } from './personAnalysis';
import { getSuggestedLifeExpectancy } from './lifeExpectancy';
import { DEFAULT_DISCOUNT_RATE } from './ssaTools';
import {
  BLANK_ALREADY_CLAIMED,
  BLANK_DECEASED,
  isWidowedComplete,
  toAlreadyClaimed,
  toDeceased,
  widowedErrors,
  type AlreadyClaimedFormFields,
  type DeceasedFormFields,
} from './widowedForm';

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
  /**
   * Null means "not yet chosen", which is what gates the analysis. Replaces the
   * former boolean `hasSpouse`: a widowed household is neither single nor
   * married, and a third boolean would have made every read site guess.
   */
  maritalStatus: 'single' | 'married' | 'widowed' | null;
  /** Only meaningful when `maritalStatus === 'widowed'`. */
  deceased: DeceasedFormFields;
  /** Only meaningful when `maritalStatus === 'widowed'`. */
  alreadyClaimed: AlreadyClaimedFormFields;
  annualCola: number;
  discountRate: number;
  /**
   * Real is the engine's own output, untouched — `combinedTimeline` carries
   * no COLA. Nominal is a display transform (`lib/dollarsMode.ts`) applied
   * on top, never sent to the engine, which is why this field plays no part
   * in `toHousehold`/`analyzeIfComplete` below. Defaults to real: a chart
   * that inflates benefits forward shows a rising line for flat purchasing
   * power, so the flattering view is the one the reader has to ask for.
   */
  dollarsMode: DollarsMode;
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
  maritalStatus: null,
  deceased: BLANK_DECEASED,
  alreadyClaimed: BLANK_ALREADY_CLAIMED,
  annualCola: CPI_DEFAULT_COLA,
  discountRate: DEFAULT_DISCOUNT_RATE,
  dollarsMode: 'real',
};

export { isBenefitInRange, MAX_BENEFIT, MIN_BENEFIT } from './formBounds';

/** A person is complete when identity is present and the benefit is in range. */
function isPersonComplete(p: PersonFormFields): boolean {
  if (p.birthYear === '' || p.birthMonth === '' || p.gender === null) return false;
  if (p.monthlyBenefit === '') return false;
  return isBenefitInRange(p.monthlyBenefit);
}

export function isFormComplete(form: AnalyzerFormState): boolean {
  if (form.maritalStatus === null || form.personA.lifeExpectancy === null) return false;
  if (!isPersonComplete(form.personA)) return false;
  // Married analyses require real spouse data — never defaulted from person A.
  if (form.maritalStatus === 'married' && !isPersonComplete(form.personB)) return false;

  if (form.maritalStatus === 'widowed') {
    if (!isWidowedComplete(form.deceased)) return false;
    // An impossible combination must not reach the engine — several of these
    // produce a throw rather than a wrong answer.
    const { birthYear, birthMonth } = form.personA;
    if (birthYear === '' || birthMonth === '') return false;
    const errors = widowedErrors(
      form.deceased,
      form.alreadyClaimed,
      { year: birthYear, month: birthMonth },
      new Date(),
    );
    if (Object.keys(errors).length > 0) return false;
  }

  // A person with no work record of their own is legitimate — they may draw a
  // spousal benefit on their partner's record. A household where *nobody*
  // earns has nothing to analyze. A widow always has the deceased's record.
  if (form.maritalStatus === 'widowed') return true;
  const benefits =
    form.maritalStatus === 'married'
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
  if (form.maritalStatus === 'widowed') {
    return {
      status: 'widowed',
      people: [personA],
      deceased: toDeceased(form.deceased),
      alreadyClaimed: toAlreadyClaimed(form.alreadyClaimed),
    };
  }
  if (form.maritalStatus !== 'married') return { status: 'single', people: [personA] };
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
