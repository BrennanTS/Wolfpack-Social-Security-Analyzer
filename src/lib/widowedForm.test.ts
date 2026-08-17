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
    expect(widowedErrors(filled, at, survivorBirth, asOf).survivorSince).toBe('claimBeforeDeath');

    const after = { ...BLANK_ALREADY_CLAIMED, survivorSinceYear: 2024, survivorSinceMonth: 4 };
    expect(widowedErrors(filled, after, survivorBirth, asOf).survivorSince).toBeUndefined();
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
    const beforeDeath = { ...BLANK_ALREADY_CLAIMED, ownSinceYear: 2020, ownSinceMonth: 8 };
    expect(widowedErrors(filled, beforeDeath, survivorBirth, asOf)).toEqual({});
  });

  // Both halves in ONE call, so the fix cannot be "delete claimBeforeDeath":
  // the same pre-death month is an error on the survivor axis and accepted on
  // her own.
  it('applies claimBeforeDeath to the survivor axis and not to her own', () => {
    const both = {
      survivorSinceYear: 2020, survivorSinceMonth: 8,
      ownSinceYear: 2020, ownSinceMonth: 8,
    };
    const errors = widowedErrors(filled, both, survivorBirth, asOf);
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
    expect(widowedErrors(filled, past, survivorBirth, asOf)).toEqual({});
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
