import type { DollarsMode } from './dollarsMode';
import {
  COLA_BOUNDS,
  isBenefitInRange,
  isDiscountRateInBounds,
  isInBounds,
  LIFE_EXPECTANCY_BOUNDS,
} from './formBounds';
import { BLANK_FORM, type AnalyzerFormState, type PersonFormFields } from './formState';
import type { Gender } from './personAnalysis';
import {
  BLANK_ALREADY_CLAIMED,
  BLANK_DECEASED,
  type AlreadyClaimedFormFields,
  type DeceasedFormFields,
} from './widowedForm';

/**
 * Encodes the analyzer's form state into a shareable query string, and back.
 *
 * Two rules shape everything here.
 *
 * Names are never encoded. They are display-only — `personLabel` falls back to
 * "Client" / "Spouse" — so excluding them costs nothing and keeps a link reading
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

function readLifeExpectancy(params: URLSearchParams, key: string): number | null {
  const value = num(params, key);
  if (value === null || !isInBounds(value, LIFE_EXPECTANCY_BOUNDS)) return null;
  return value;
}

/**
 * `dollars=nominal` is the only value that changes anything; everything
 * else — absent, `real`, or garbage — leaves the default. Unlike the
 * numeric fields above, there is no bounds check to fail: this is dropped
 * rather than clamped by recognizing exactly one non-default spelling
 * instead of rejecting a range.
 */
function readDollarsMode(params: URLSearchParams): DollarsMode {
  return params.get('dollars') === 'nominal' ? 'nominal' : BLANK_FORM.dollarsMode;
}

function readPerson(params: URLSearchParams, prefix: 'a' | 'b'): PersonFormFields {
  return {
    // Deliberately never decoded — see the module comment.
    name: '',
    birthYear: intInBounds(params, `${prefix}y`, BIRTH_YEAR_BOUNDS),
    birthMonth: intInBounds(params, `${prefix}m`, { min: 1, max: 12 }),
    gender: readGender(params, `${prefix}g`),
    monthlyBenefit: readBenefit(params, `${prefix}b`),
    lifeExpectancy: readLifeExpectancy(params, `${prefix}le`),
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
  if (person.lifeExpectancy !== null) params.set(`${prefix}le`, String(person.lifeExpectancy));
}

/**
 * Widowed parameters. Prefixed `d` for the deceased and `c` for what the
 * survivor has already claimed, so none can collide with the `a`/`b` person
 * prefixes already in use.
 */
function writeWidowed(params: URLSearchParams, form: AnalyzerFormState): void {
  const d = form.deceased;
  if (d.birthYear !== '') params.set('dy', String(d.birthYear));
  if (d.birthMonth !== '') params.set('dm', String(d.birthMonth));
  if (d.deathYear !== '') params.set('ddy', String(d.deathYear));
  if (d.deathMonth !== '') params.set('ddm', String(d.deathMonth));
  params.set('dk', d.recordKind === 'checkAmount' ? 'c' : 'p');
  if (d.piaMonthly !== '') params.set('dp', String(d.piaMonthly));
  if (d.checkAmount !== '') params.set('dc', String(d.checkAmount));
  if (d.hadFiled !== null) params.set('df', d.hadFiled ? '1' : '0');
  if (d.filedYear !== '') params.set('dfy', String(d.filedYear));
  if (d.filedMonth !== '') params.set('dfm', String(d.filedMonth));

  const a = form.alreadyClaimed;
  if (a.survivorSinceYear !== '') params.set('csy', String(a.survivorSinceYear));
  if (a.survivorSinceMonth !== '') params.set('csm', String(a.survivorSinceMonth));
  if (a.ownSinceYear !== '') params.set('coy', String(a.ownSinceYear));
  if (a.ownSinceMonth !== '') params.set('com', String(a.ownSinceMonth));
}

function readWidowed(params: URLSearchParams): {
  deceased: DeceasedFormFields;
  alreadyClaimed: AlreadyClaimedFormFields;
} {
  const hadFiled = params.get('df');
  const MONTH_BOUNDS = { min: 1, max: 12 };
  return {
    deceased: {
      birthYear: num(params, 'dy') ?? '',
      birthMonth: intInBounds(params, 'dm', MONTH_BOUNDS),
      deathYear: num(params, 'ddy') ?? '',
      deathMonth: intInBounds(params, 'ddm', MONTH_BOUNDS),
      recordKind: params.get('dk') === 'c' ? 'checkAmount' : 'pia',
      piaMonthly: num(params, 'dp') ?? '',
      hadFiled: hadFiled === '1' ? true : hadFiled === '0' ? false : null,
      checkAmount: num(params, 'dc') ?? '',
      filedYear: num(params, 'dfy') ?? '',
      filedMonth: intInBounds(params, 'dfm', MONTH_BOUNDS),
    },
    alreadyClaimed: {
      survivorSinceYear: num(params, 'csy') ?? '',
      survivorSinceMonth: intInBounds(params, 'csm', MONTH_BOUNDS),
      ownSinceYear: num(params, 'coy') ?? '',
      ownSinceMonth: intInBounds(params, 'com', MONTH_BOUNDS),
    },
  };
}

export function toShareParams(form: AnalyzerFormState): URLSearchParams {
  const params = new URLSearchParams();
  writePerson(params, 'a', form.personA);
  if (form.maritalStatus !== null) {
    params.set(
      'm',
      form.maritalStatus === 'married' ? '1' : form.maritalStatus === 'widowed' ? 'w' : '0',
    );
  }
  if (form.maritalStatus === 'married') writePerson(params, 'b', form.personB);
  if (form.maritalStatus === 'widowed') writeWidowed(params, form);
  params.set('cola', String(form.annualCola));
  // `dr` travels as a PERCENT so the link is human-readable and matches the
  // slider; the form stores a fraction. Convert on both sides.
  params.set('dr', String(form.discountRate * 100));
  params.set('dollars', form.dollarsMode);
  return params;
}

export function fromShareParams(params: URLSearchParams): AnalyzerFormState {
  // `m=1` and `m=0` predate the widowed status and MUST keep their meaning:
  // links already in circulation carry them, and their recipient cannot see
  // that a parameter changed meaning. `w` is a third value on the same key
  // rather than a new key, for exactly that reason.
  const statusParam = params.get('m');
  const maritalStatus: AnalyzerFormState['maritalStatus'] =
    statusParam === '1'
      ? 'married'
      : statusParam === '0'
        ? 'single'
        : statusParam === 'w'
          ? 'widowed'
          : null;

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

  // `le` predates the per-person split, where it meant person A's value. Honour
  // it so links already in circulation reproduce the same analysis rather than
  // silently losing a parameter the recipient cannot see is missing. `ale` wins
  // when both are present — it is the newer, more specific key.
  //
  // This fallback cannot distinguish "ale absent" from "ale present but out of
  // bounds" — both leave personA.lifeExpectancy null here, so an invalid `ale`
  // silently falls through to a valid `le`, e.g. `?ale=200&le=88` yields 88
  // rather than dropping to null. That is a quiet exception to this module's
  // "dropped, not clamped, independently per person" rule. It is tolerated
  // because new links never write `le`, so the combination is near-unreachable
  // in practice, and distinguishing the two cases would add real complexity to
  // a fallback that exists only for old links.
  const personA = readPerson(params, 'a');
  if (personA.lifeExpectancy === null) {
    personA.lifeExpectancy = readLifeExpectancy(params, 'le');
  }

  return {
    personA,
    personB: maritalStatus === 'married' ? readPerson(params, 'b') : BLANK_FORM.personB,
    maritalStatus,
    ...(maritalStatus === 'widowed'
      ? readWidowed(params)
      : { deceased: BLANK_DECEASED, alreadyClaimed: BLANK_ALREADY_CLAIMED }),
    annualCola: cola !== null && isInBounds(cola, COLA_BOUNDS) ? cola : BLANK_FORM.annualCola,
    discountRate:
      discountFraction !== null && isDiscountRateInBounds(discountFraction)
        ? discountFraction
        : BLANK_FORM.discountRate,
    dollarsMode: readDollarsMode(params),
  };
}

export function buildShareUrl(
  form: AnalyzerFormState,
  origin: string,
  pathname: string,
): string {
  return `${origin}${pathname}?${toShareParams(form).toString()}`;
}
