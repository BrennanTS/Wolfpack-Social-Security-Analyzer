import { describe, expect, it } from 'vitest';
import {
  BLANK_ALREADY_CLAIMED,
  BLANK_DECEASED,
  isWidowedComplete,
  toAlreadyClaimed,
  toDeceased,
  widowedErrors,
  type DeceasedFormFields,
} from './widowedForm';

const asOf = new Date(2026, 0, 15);
const survivorBirth = { year: 1964, month: 6 };

/**
 * A survivor old enough that the dates below clear the age floors on their
 * own, so the rule actually under test in each case is the death-date one.
 * Born June 1958: age 60 falls June 2018, age 62 June 2020.
 *
 * Added when `claimBeforeSixty`/`claimBeforeSixtyTwo` arrived — until then
 * these fixtures could use any date at all, and several used ages SSA would
 * never have paid.
 */
const olderBirth = { year: 1958, month: 6 };

const filled: DeceasedFormFields = {
  birthYear: 1960, birthMonth: 3,
  deathYear: 2024, deathMonth: 3,
  recordKind: 'pia',
  piaMonthly: 3000,
  hadFiled: false,
  checkAmount: '',
  filedYear: '',
  filedMonth: '',
};

describe('isWidowedComplete', () => {
  it('needs identity, a death date and a record', () => {
    expect(isWidowedComplete(BLANK_DECEASED)).toBe(false);
    expect(isWidowedComplete(filled)).toBe(true);
  });

  it('needs hadFiled answered on the PIA route', () => {
    expect(isWidowedComplete({ ...filled, hadFiled: null })).toBe(false);
  });

  it('needs the amount and the filing date on the check-amount route', () => {
    const check: DeceasedFormFields = {
      ...filled, recordKind: 'checkAmount', piaMonthly: '', hadFiled: null,
      checkAmount: 2400, filedYear: 2022, filedMonth: 5,
    };
    expect(isWidowedComplete(check)).toBe(true);
    expect(isWidowedComplete({ ...check, filedMonth: '' })).toBe(false);
    expect(isWidowedComplete({ ...check, checkAmount: '' })).toBe(false);
  });
});

describe('widowedErrors', () => {
  it('accepts a valid household', () => {
    expect(widowedErrors(filled, BLANK_ALREADY_CLAIMED, survivorBirth, asOf)).toEqual({});
  });

  it('rejects a death before the deceased was born', () => {
    const bad = { ...filled, deathYear: 1959, deathMonth: 12 };
    expect(widowedErrors(bad, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).death).toBe(
      'deathBeforeBirth',
    );
  });

  it('rejects a death in the future — widowed means it has happened', () => {
    const bad = { ...filled, deathYear: 2027, deathMonth: 1 };
    expect(widowedErrors(bad, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).death).toBe(
      'deathInFuture',
    );
  });

  it('accepts a death in the current month', () => {
    const edge = { ...filled, deathYear: 2026, deathMonth: 1 };
    expect(widowedErrors(edge, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).death).toBeUndefined();
  });

  it('rejects a survivor claim at or before the death month', () => {
    const at = { ...BLANK_ALREADY_CLAIMED, survivorSinceYear: 2024, survivorSinceMonth: 3 };
    expect(widowedErrors(filled, at, olderBirth, asOf).survivorSince).toBe('claimBeforeDeath');

    const after = { ...BLANK_ALREADY_CLAIMED, survivorSinceYear: 2024, survivorSinceMonth: 4 };
    expect(widowedErrors(filled, after, olderBirth, asOf).survivorSince).toBeUndefined();
  });

  it('rejects an own-benefit claim before the survivor was born', () => {
    const bad = { ...BLANK_ALREADY_CLAIMED, ownSinceYear: 1960, ownSinceMonth: 1 };
    expect(widowedErrors(filled, bad, survivorBirth, asOf).ownSince).toBe('claimBeforeBirth');
  });

  // The most common widowed profile there is: she filed on her OWN record at
  // 62, years before her husband died. Her own retirement benefit has nothing
  // to do with the death date — `widowedSearchRanges` (src/lib/widowed.ts)
  // leaves `ownSince` deliberately unclamped, and the engine returns a correct
  // two-date answer for this household. Scoping `claimBeforeDeath` to both
  // dates rejected her outright: `isFormComplete` false, no analysis at all,
  // under a reason that named a survivor benefit she had not claimed.
  it('accepts an own-benefit claim BEFORE the death — she filed at 62 while he was alive', () => {
    // June 2020 is her 62nd birthday, so August 2020 is a legal own filing
    // and the only thing that could flag it is the death rule.
    const beforeDeath = { ...BLANK_ALREADY_CLAIMED, ownSinceYear: 2020, ownSinceMonth: 8 };
    expect(widowedErrors(filled, beforeDeath, olderBirth, asOf)).toEqual({});
  });

  // Both halves in ONE call, so the fix cannot be "delete claimBeforeDeath":
  // the same pre-death month is an error on the survivor axis and accepted on
  // her own.
  it('applies claimBeforeDeath to the survivor axis and not to her own', () => {
    const both = {
      survivorSinceYear: 2020, survivorSinceMonth: 8,
      ownSinceYear: 2020, ownSinceMonth: 8,
    };
    const errors = widowedErrors(filled, both, olderBirth, asOf);
    expect(errors.survivorSince).toBe('claimBeforeDeath');
    expect(errors.ownSince).toBeUndefined();
  });

  // --- Month granularity ---
  //
  // Every comparison below is on an absolute month index, not a year. Without
  // these three, mutating `deathBeforeBirth`, `deathInFuture` and
  // `claimBeforeBirth` to YEAR-only comparisons left the whole suite green:
  // every other fixture differs in the year too.

  it('sees a death one month in the future within the current year', () => {
    // asOf is Jan 2026; a year-only comparison reads 2026 > 2026 as false.
    const nextMonth = { ...filled, deathYear: 2026, deathMonth: 2 };
    expect(widowedErrors(nextMonth, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).death).toBe(
      'deathInFuture',
    );
  });

  it('sees a death before a birth in the same year', () => {
    // Born Mar 1960, "died" Jan 1960; a year-only comparison reads them equal.
    const sameYear = { ...filled, deathYear: 1960, deathMonth: 1 };
    expect(widowedErrors(sameYear, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).death).toBe(
      'deathBeforeBirth',
    );
  });

  it('sees a claim before a birth in the same year', () => {
    // Survivor born Jun 1964, claim Feb 1964; year-only reads them equal.
    const sameYear = { ...BLANK_ALREADY_CLAIMED, survivorSinceYear: 1964, survivorSinceMonth: 2 };
    expect(widowedErrors(filled, sameYear, survivorBirth, asOf).survivorSince).toBe(
      'claimBeforeBirth',
    );
  });

  it('does NOT reject an already-claimed date in the past', () => {
    // A claimed date is a FACT, not a candidate. It legitimately sits before
    // today and must not be clamped forward or flagged.
    const past = { ...BLANK_ALREADY_CLAIMED, ownSinceYear: 2024, ownSinceMonth: 8 };
    expect(widowedErrors(filled, past, olderBirth, asOf)).toEqual({});
  });

  it('rejects a check amount no real PIA could produce', () => {
    // `deceasedPia` throws on an out-of-bracket amount; the form must surface
    // that as a field error rather than let it escape as a crash.
    const bad: DeceasedFormFields = {
      ...filled, recordKind: 'checkAmount', piaMonthly: '', hadFiled: null,
      checkAmount: 500000, filedYear: 2022, filedMonth: 5,
    };
    expect(widowedErrors(bad, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).checkAmount).toBe(
      'checkAmountUnreachable',
    );
  });

  it('accepts a large but reachable check amount', () => {
    // The guard must not be satisfiable by rejecting everything large.
    const ok: DeceasedFormFields = {
      ...filled, recordKind: 'checkAmount', piaMonthly: '', hadFiled: null,
      checkAmount: 3200, filedYear: 2022, filedMonth: 5,
    };
    expect(widowedErrors(ok, BLANK_ALREADY_CLAIMED, survivorBirth, asOf)).toEqual({});
  });
});

describe('toDeceased', () => {
  it('maps "had not filed" to a null filing date', () => {
    // 3B-i translates `filed: null` to deceasedFilingDate = deathDate, which
    // is the engine's own selector for its never-filed branch.
    expect(toDeceased(filled).record).toEqual({ kind: 'pia', piaMonthly: 3000, filed: null });
  });

  it('carries the filing date when they had filed', () => {
    const f = { ...filled, hadFiled: true, filedYear: 2018, filedMonth: 9 };
    expect(toDeceased(f).record).toEqual({
      kind: 'pia', piaMonthly: 3000, filed: { year: 2018, month: 9 },
    });
  });

  it('maps the check-amount route', () => {
    const c: DeceasedFormFields = {
      ...filled, recordKind: 'checkAmount', piaMonthly: '', hadFiled: null,
      checkAmount: 2400, filedYear: 2022, filedMonth: 5,
    };
    expect(toDeceased(c).record).toEqual({
      kind: 'checkAmount', monthlyAmount: 2400, filed: { year: 2022, month: 5 },
    });
  });
});

describe('toAlreadyClaimed', () => {
  it('maps blanks to null, not to zero', () => {
    expect(toAlreadyClaimed(BLANK_ALREADY_CLAIMED)).toEqual({
      survivorSince: null, ownSince: null,
    });
  });

  it('maps a partially-filled date to null rather than a nonsense month', () => {
    const partial = { ...BLANK_ALREADY_CLAIMED, survivorSinceYear: 2024, survivorSinceMonth: '' };
    expect(toAlreadyClaimed(partial as never).survivorSince).toBeNull();
  });
});

describe('widowedErrors — the age floors', () => {
  // Every threshold below was read off the engine, not off SSA's website:
  // `analyzeHousehold` accepts an own filing at exactly 62 years 0 months and
  // throws at 61 years 11 months, and it accepts a survivor claim at 59 —
  // which is why that one guards a wrong answer rather than a crash.

  it('rejects an own filing before 62, and accepts it at exactly 62', () => {
    // Born June 1964: 62 years 0 months is June 2026.
    const at62 = { ...BLANK_ALREADY_CLAIMED, ownSinceYear: 2026, ownSinceMonth: 6 };
    expect(widowedErrors(filled, at62, survivorBirth, asOf).ownSince).toBeUndefined();

    const oneMonthShort = { ...BLANK_ALREADY_CLAIMED, ownSinceYear: 2026, ownSinceMonth: 5 };
    expect(widowedErrors(filled, oneMonthShort, survivorBirth, asOf).ownSince).toBe(
      'claimBeforeSixtyTwo',
    );
  });

  it('rejects a survivor claim before 60, and accepts it at exactly 60', () => {
    // Born June 1964: 60 years 0 months is June 2024, after the March 2024
    // death, so the death rule is not what is firing here.
    const at60 = { ...BLANK_ALREADY_CLAIMED, survivorSinceYear: 2024, survivorSinceMonth: 6 };
    expect(widowedErrors(filled, at60, survivorBirth, asOf).survivorSince).toBeUndefined();

    // One month short — and the engine prices this happily, printing
    // "Claim the survivor benefit at age 59 years, 11 months".
    const oneMonthShort = {
      ...BLANK_ALREADY_CLAIMED,
      survivorSinceYear: 2024,
      survivorSinceMonth: 5,
    };
    expect(widowedErrors(filled, oneMonthShort, survivorBirth, asOf).survivorSince).toBe(
      'claimBeforeSixty',
    );
  });

  it('keeps the two floors on their own axes', () => {
    // 60 is legal for the survivor benefit and illegal for her own record.
    // One call, so neither fix can be "apply one floor to both".
    const both = {
      survivorSinceYear: 2024, survivorSinceMonth: 8,
      ownSinceYear: 2024, ownSinceMonth: 8,
    };
    const errors = widowedErrors(filled, both, survivorBirth, asOf);
    expect(errors.survivorSince).toBeUndefined();
    expect(errors.ownSince).toBe('claimBeforeSixtyTwo');
  });

  it('lets the more specific reason win over the age floor', () => {
    // Before she was born is also before she was 62; the reader needs the
    // first reason, not the second.
    const beforeBirth = { ...BLANK_ALREADY_CLAIMED, ownSinceYear: 1950, ownSinceMonth: 1 };
    expect(widowedErrors(filled, beforeBirth, survivorBirth, asOf).ownSince).toBe(
      'claimBeforeBirth',
    );
  });

  it('rejects a deceased who filed before their own 62nd birthday', () => {
    // Born March 1960, so 62 falls March 2022. This crashed the analysis with
    // the generic "Analysis failed" banner, and the filed date had no error
    // slot beside it at all.
    const early: DeceasedFormFields = {
      ...filled, hadFiled: true, filedYear: 2019, filedMonth: 4,
    };
    expect(widowedErrors(early, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).filed).toBe(
      'filedBeforeSixtyTwo',
    );

    const legal: DeceasedFormFields = { ...early, filedYear: 2022, filedMonth: 3 };
    expect(widowedErrors(legal, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).filed).toBeUndefined();
  });

  it('says nothing about a filing date that is still half-typed', () => {
    const halfTyped: DeceasedFormFields = { ...filled, hadFiled: true, filedYear: 2019, filedMonth: '' };
    expect(widowedErrors(halfTyped, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).filed).toBeUndefined();
  });
});
