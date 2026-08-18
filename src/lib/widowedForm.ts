/**
 * The widowed household's form fields, their validation, and their conversion
 * into the shapes `analyzeHousehold` consumes.
 *
 * Kept out of `formState.ts`, which is already the app's busiest module, and
 * pure so every rule is testable without a DOM.
 *
 * The validation posture matches the rest of this project: block only what is
 * impossible or would produce a meaningless answer, and leave everything else
 * to the adviser's judgment. An unusual-looking PIA is not blocked — SSA's
 * maximum rises every year, and a hard ceiling would eventually reject a
 * legitimate high earner.
 */
import { deceasedPia, type Deceased, type DeceasedRecord, type YearMonth } from './deceased';
import type { AlreadyClaimed } from './widowed';

export interface DeceasedFormFields {
  birthYear: number | '';
  /** 1-12. */
  birthMonth: number | '';
  deathYear: number | '';
  /** 1-12. */
  deathMonth: number | '';
  /** Which route the adviser took: a known PIA, or the check they were receiving. */
  recordKind: 'pia' | 'checkAmount';
  /** PIA route. */
  piaMonthly: number | '';
  /**
   * PIA route only. `false` means they died without ever filing — a case the
   * engine treats specially. Null means unanswered, which blocks completeness:
   * defaulting it would silently pick one of two materially different
   * survivor-benefit bases.
   */
  hadFiled: boolean | null;
  /** Check-amount route. */
  checkAmount: number | '';
  /** The month they filed. Required on the check-amount route; used on the PIA route when `hadFiled`. */
  filedYear: number | '';
  /** 1-12. */
  filedMonth: number | '';
}

export interface AlreadyClaimedFormFields {
  survivorSinceYear: number | '';
  /** 1-12. */
  survivorSinceMonth: number | '';
  ownSinceYear: number | '';
  /** 1-12. */
  ownSinceMonth: number | '';
}

export const BLANK_DECEASED: DeceasedFormFields = {
  birthYear: '',
  birthMonth: '',
  deathYear: '',
  deathMonth: '',
  recordKind: 'pia',
  piaMonthly: '',
  hadFiled: null,
  checkAmount: '',
  filedYear: '',
  filedMonth: '',
};

export const BLANK_ALREADY_CLAIMED: AlreadyClaimedFormFields = {
  survivorSinceYear: '',
  survivorSinceMonth: '',
  ownSinceYear: '',
  ownSinceMonth: '',
};

export type WidowedFieldError =
  | 'deathBeforeBirth'
  | 'deathInFuture'
  | 'claimBeforeDeath'
  | 'claimBeforeBirth'
  /**
   * An own-record filing before age 62. The engine's `benefitAtAge` throws
   * outright ("Filing age must be at least 62"), so without this the household
   * reached the analysis and came back as the generic "Analysis failed"
   * banner — a real constraint, reported as an unknown fault.
   */
  | 'claimBeforeSixtyTwo'
  /**
   * A survivor benefit before age 60. This one is worse than a crash: the
   * engine accepts it and returns figures, so the app printed
   * "Claim the survivor benefit at age 59 years, 11 months" and a lifetime
   * total to match — an answer that is simply not available.
   *
   * SSA does pay a survivor benefit earlier in two cases this app does not
   * model: a disabled widow(er) from 50, and one caring for the deceased's
   * child under 16 at any age. The message says so rather than asserting 60
   * as universal.
   */
  | 'claimBeforeSixty'
  /**
   * The DECEASED filed before their own age 62. Same crash as
   * `claimBeforeSixtyTwo`, on the other person's record, and the filed date
   * had no error slot beside it at all until now.
   */
  | 'filedBeforeSixtyTwo'
  | 'checkAmountUnreachable';

/**
 * Field errors keyed by the field they render beside.
 *
 * Exported so `DeceasedFields` imports it rather than restating the key
 * union — it had its own copy, and the copy silently stopped matching the
 * moment `filed` was added here.
 */
export type WidowedErrors = Partial<
  Record<'death' | 'survivorSince' | 'ownSince' | 'checkAmount' | 'filed', WidowedFieldError>
>;

/** Whole months from a birth to a later year/month. */
const monthsBetween = (birth: YearMonth, at: YearMonth): number =>
  idx(at.year, at.month) - idx(birth.year, birth.month);

/** SSA's floors, in whole months, for the two dates a widow(er) chooses. */
const OWN_RETIREMENT_FLOOR_MONTHS = 62 * 12;
const SURVIVOR_FLOOR_MONTHS = 60 * 12;

/** Absolute month index, matching `benefitPeriods.ts`'s convention. */
const idx = (year: number, month: number): number => year * 12 + (month - 1);

/** A year/month pair, or null when either half is blank. Never a partial date. */
function pair(year: number | '', month: number | ''): YearMonth | null {
  if (year === '' || month === '') return null;
  return { year, month };
}

export function isWidowedComplete(d: DeceasedFormFields): boolean {
  if (d.birthYear === '' || d.birthMonth === '') return false;
  if (d.deathYear === '' || d.deathMonth === '') return false;

  if (d.recordKind === 'checkAmount') {
    return d.checkAmount !== '' && d.filedYear !== '' && d.filedMonth !== '';
  }

  if (d.piaMonthly === '' || d.hadFiled === null) return false;
  // "They had filed" is only meaningful with a date to go with it.
  return d.hadFiled ? d.filedYear !== '' && d.filedMonth !== '' : true;
}

/**
 * Field errors, keyed by the field they belong beside. An empty object means
 * nothing is blocking.
 *
 * Incomplete input is NOT an error — a half-typed date is a form in progress,
 * and `isWidowedComplete` is what gates the analysis. This reports only
 * combinations that are complete and impossible.
 */
export function widowedErrors(
  d: DeceasedFormFields,
  a: AlreadyClaimedFormFields,
  survivorBirth: YearMonth,
  asOf: Date,
): WidowedErrors {
  const errors: WidowedErrors = {};

  const birth = pair(d.birthYear, d.birthMonth);
  const death = pair(d.deathYear, d.deathMonth);
  const asOfIndex = idx(asOf.getFullYear(), asOf.getMonth() + 1);

  if (death) {
    if (birth && idx(death.year, death.month) < idx(birth.year, birth.month)) {
      errors.death = 'deathBeforeBirth';
    } else if (idx(death.year, death.month) > asOfIndex) {
      // Strictly after: a death in the current month has happened.
      errors.death = 'deathInFuture';
    }
  }

  const survivorBirthIndex = idx(survivorBirth.year, survivorBirth.month);
  const claims: [keyof typeof errors, YearMonth | null][] = [
    ['survivorSince', pair(a.survivorSinceYear, a.survivorSinceMonth)],
    ['ownSince', pair(a.ownSinceYear, a.ownSinceMonth)],
  ];
  for (const [field, claim] of claims) {
    if (!claim) continue;
    const claimIndex = idx(claim.year, claim.month);
    if (claimIndex < survivorBirthIndex) {
      // Applies to BOTH dates: no benefit of any kind can start before the
      // person it is paid to was born.
      errors[field] = 'claimBeforeBirth';
    } else if (field === 'survivorSince' && death && claimIndex <= idx(death.year, death.month)) {
      // SURVIVOR AXIS ONLY. A benefit that depends on the death cannot precede
      // it, and SSA pays from the month AFTER — `survivorBenefit` throws on the
      // equal case, which is what this blocks.
      //
      // Her OWN retirement benefit has nothing to do with the death date: a
      // widow who filed on her own record at 62 while her husband was alive is
      // the most common widowed profile there is, and 3B-i handles her
      // correctly. `widowed.ts`'s `widowedSearchRanges` leaves `ownSince`
      // deliberately unclamped for exactly that reason, and clamping it here
      // rejected the household outright — no analysis at all, under a reason
      // that named the survivor benefit she had not claimed.
      errors[field] = 'claimBeforeDeath';
    } else if (
      field === 'ownSince' &&
      monthsBetween(survivorBirth, claim) < OWN_RETIREMENT_FLOOR_MONTHS
    ) {
      // OWN AXIS ONLY, and checked after the two above so the more specific
      // reason wins. Verified against the engine rather than assumed: an
      // own-filing at exactly 62 years 0 months is accepted, 61 years 11
      // months throws.
      errors[field] = 'claimBeforeSixtyTwo';
    } else if (
      field === 'survivorSince' &&
      monthsBetween(survivorBirth, claim) < SURVIVOR_FLOOR_MONTHS
    ) {
      // SURVIVOR AXIS ONLY. Unlike every other error here this one guards a
      // WRONG ANSWER rather than a crash — the engine happily prices a
      // survivor benefit at 59, and the app printed it.
      errors[field] = 'claimBeforeSixty';
    }
    // Deliberately no "in the past" check: an already-claimed date is a FACT,
    // and clamping or flagging it would contradict the model, which searches
    // around it rather than over it.
  }

  // The deceased's own filing date. Their record is the source of the survivor
  // benefit, so a filing age the engine rejects fails the whole analysis just
  // as surely as one of the survivor's own dates.
  const filed = pair(d.filedYear, d.filedMonth);
  if (filed && birth && monthsBetween(birth, filed) < OWN_RETIREMENT_FLOOR_MONTHS) {
    errors.filed = 'filedBeforeSixtyTwo';
  }

  if (d.recordKind === 'checkAmount' && isWidowedComplete(d)) {
    try {
      deceasedPia(toDeceased(d));
    } catch {
      // `deceasedPia` throws when no PIA in its bracket could pay this amount —
      // a data-entry error, surfaced here rather than escaping as a crash.
      errors.checkAmount = 'checkAmountUnreachable';
    }
  }

  return errors;
}

function toRecord(d: DeceasedFormFields): DeceasedRecord {
  if (d.recordKind === 'checkAmount') {
    return {
      kind: 'checkAmount',
      monthlyAmount: d.checkAmount as number,
      filed: pair(d.filedYear, d.filedMonth) as YearMonth,
    };
  }
  return {
    kind: 'pia',
    piaMonthly: d.piaMonthly as number,
    filed: d.hadFiled ? pair(d.filedYear, d.filedMonth) : null,
  };
}

/** Only meaningful once `isWidowedComplete` is true. */
export function toDeceased(d: DeceasedFormFields): Deceased {
  return {
    birthYear: d.birthYear as number,
    birthMonth: d.birthMonth as number,
    deathYear: d.deathYear as number,
    deathMonth: d.deathMonth as number,
    record: toRecord(d),
  };
}

export function toAlreadyClaimed(a: AlreadyClaimedFormFields): AlreadyClaimed {
  return {
    survivorSince: pair(a.survivorSinceYear, a.survivorSinceMonth),
    ownSince: pair(a.ownSinceYear, a.ownSinceMonth),
  };
}
