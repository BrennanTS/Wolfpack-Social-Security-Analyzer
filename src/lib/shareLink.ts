import {
  COLA_BOUNDS,
  isBenefitInRange,
  isDiscountRateInBounds,
  isInBounds,
  LIFE_EXPECTANCY_BOUNDS,
} from './formBounds';
import { BLANK_FORM, type AnalyzerFormState, type PersonFormFields } from './formState';
import type { Gender } from './personAnalysis';

/**
 * Encodes the analyzer's form state into a shareable query string, and back.
 *
 * Two rules shape everything here.
 *
 * Names are never encoded. They are display-only — `personLabel` falls back to
 * "You" / "Spouse" — so excluding them costs nothing and keeps a link reading
 * as a scenario rather than a client record. A date of birth and a dollar
 * figure with no name attached is far weaker as identifying information, and
 * links leak: into history, chat logs, screenshots and Referer headers.
 *
 * Everything arriving from a URL is untrusted, and an invalid value is
 * DROPPED, not clamped. Clamping would silently substitute a plausible number
 * that the recipient never notices, in a tool whose output informs a financial
 * decision. A dropped field stays blank, so the form visibly asks for it.
 */

const CURRENT_YEAR = new Date().getFullYear();
// Mirrors the range `PersonFields` offers in its birth-year select:
// `Array.from({ length: 70 }, (_, i) => CURRENT_YEAR - 18 - i)` spans
// CURRENT_YEAR - 18 down to CURRENT_YEAR - 87.
const BIRTH_YEAR_BOUNDS = { min: CURRENT_YEAR - 87, max: CURRENT_YEAR - 18 };

function num(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function intInBounds(
  params: URLSearchParams,
  key: string,
  bounds: { min: number; max: number },
): number | '' {
  const value = num(params, key);
  if (value === null || !Number.isInteger(value) || !isInBounds(value, bounds)) return '';
  return value;
}

function readGender(params: URLSearchParams, key: string): Gender | null {
  const raw = params.get(key);
  if (raw === 'm') return 'male';
  if (raw === 'f') return 'female';
  return null;
}

function readBenefit(params: URLSearchParams, key: string): number | '' {
  const value = num(params, key);
  if (value === null || !isBenefitInRange(value)) return '';
  return value;
}

function readPerson(params: URLSearchParams, prefix: 'a' | 'b'): PersonFormFields {
  return {
    // Deliberately never decoded — see the module comment.
    name: '',
    birthYear: intInBounds(params, `${prefix}y`, BIRTH_YEAR_BOUNDS),
    birthMonth: intInBounds(params, `${prefix}m`, { min: 1, max: 12 }),
    gender: readGender(params, `${prefix}g`),
    monthlyBenefit: readBenefit(params, `${prefix}b`),
    // Per-person parsing arrives in a later task; for now every person reads
    // back with no explicit life expectancy of their own.
    lifeExpectancy: null,
  };
}

function writePerson(
  params: URLSearchParams,
  prefix: 'a' | 'b',
  person: PersonFormFields,
): void {
  if (person.birthYear !== '') params.set(`${prefix}y`, String(person.birthYear));
  if (person.birthMonth !== '') params.set(`${prefix}m`, String(person.birthMonth));
  if (person.gender !== null) params.set(`${prefix}g`, person.gender === 'male' ? 'm' : 'f');
  if (person.monthlyBenefit !== '') params.set(`${prefix}b`, String(person.monthlyBenefit));
}

export function toShareParams(form: AnalyzerFormState): URLSearchParams {
  const params = new URLSearchParams();
  writePerson(params, 'a', form.personA);
  if (form.hasSpouse !== null) params.set('m', form.hasSpouse ? '1' : '0');
  if (form.hasSpouse) writePerson(params, 'b', form.personB);
  if (form.personA.lifeExpectancy !== null) params.set('le', String(form.personA.lifeExpectancy));
  params.set('cola', String(form.annualCola));
  // `dr` travels as a PERCENT so the link is human-readable and matches the
  // slider; the form stores a fraction. Convert on both sides.
  params.set('dr', String(form.discountRate * 100));
  return params;
}

export function fromShareParams(params: URLSearchParams): AnalyzerFormState {
  const married = params.get('m');
  const hasSpouse = married === '1' ? true : married === '0' ? false : null;

  const le = num(params, 'le');
  const cola = num(params, 'cola');

  // `dr` travels as a percent; the form stores a fraction. Convert FIRST, then
  // validate the fraction — so the value that is checked is the exact value
  // that reaches state, rather than a percent that is checked and then
  // transformed into something else. That is what `isDiscountRateInBounds`
  // exists for; validating the pre-conversion percent instead left the
  // fraction path unguarded, and left a reader of `formBounds.ts` believing
  // otherwise.
  const dr = num(params, 'dr');
  const discountFraction = dr === null ? null : dr / 100;

  const personA = readPerson(params, 'a');
  personA.lifeExpectancy =
    le !== null && isInBounds(le, LIFE_EXPECTANCY_BOUNDS) ? le : null;

  return {
    personA,
    personB: hasSpouse ? readPerson(params, 'b') : BLANK_FORM.personB,
    hasSpouse,
    annualCola: cola !== null && isInBounds(cola, COLA_BOUNDS) ? cola : BLANK_FORM.annualCola,
    discountRate:
      discountFraction !== null && isDiscountRateInBounds(discountFraction)
        ? discountFraction
        : BLANK_FORM.discountRate,
  };
}

export function buildShareUrl(
  form: AnalyzerFormState,
  origin: string,
  pathname: string,
): string {
  return `${origin}${pathname}?${toShareParams(form).toString()}`;
}
