import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import { filingMonth } from './filingDates';
import { getFullRetirementAge, type Person } from './personAnalysis';
import { createPiaRecipient, ssaBirthMonth } from './ssaTools';
import { analyzeHousehold } from './household';
import {
  BLANK_BIRTH_DATE,
  claimantBirthDateBounds,
  deceasedBirthDateBounds,
  fromBirthDateInput,
  isBirthDateInRange,
  toBirthDateInput,
} from './birthDate';
import { BLANK_FORM, isFormComplete, type AnalyzerFormState } from './formState';

beforeAll(() => {
  globalThis.fetch = (async (url: string) => {
    const contents = await readFile(
      path.join(process.cwd(), 'public', String(url).replace(/^\//, '')),
      'utf8',
    );
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  }) as typeof fetch;
});

const person = (birthYear: number, birthMonth: number, birthDay: number): Person => ({
  id: 'a',
  birthYear,
  birthMonth,
  birthDay,
  gender: 'male',
  piaMonthly: 2400,
  lifeExpectancy: 85,
});

describe('the birth day, and the one day that matters', () => {
  it('moves the SSA month only for the 1st', () => {
    // Measured against the engine across days 2, 3, 15 and 28: identical.
    // This is what makes the field safe to add — every fixture recorded at
    // the old default of 15 reproduces exactly.
    for (const day of [2, 3, 15, 28]) {
      expect(ssaBirthMonth(1962, 4, day)).toEqual({ year: 1962, month: 4 });
    }
    expect(ssaBirthMonth(1962, 4, 1)).toEqual({ year: 1962, month: 3 });
  });

  it('rolls back across the year for a 1 January birthday', () => {
    expect(ssaBirthMonth(1960, 1, 1)).toEqual({ year: 1959, month: 12 });
    expect(ssaBirthMonth(1960, 1, 2)).toEqual({ year: 1960, month: 1 });
  });

  it('reads a 1 January birthday into the earlier full-retirement-age bracket', () => {
    // The defect this field exists to fix. SSA reads 1 January 1960 as
    // December 1959, which is a different bracket: 66 years 10 months, not
    // 67. The app said 67 for this client until the day was collected.
    expect(getFullRetirementAge(1960, 1, 1)).toEqual({ years: 66, months: 10 });
    expect(getFullRetirementAge(1960, 1, 2)).toEqual({ years: 67, months: 0 });
    // And the year-only form, which the form's live hint uses before a day is
    // chosen, still answers for the calendar year.
    expect(getFullRetirementAge(1960)).toEqual({ years: 67, months: 0 });
  });

  it('dates a filing the same month the engine does, on every day', () => {
    // `filingMonth` is the app's own arithmetic — it never asks the engine.
    // That is fine only while the two agree, so this asserts they do rather
    // than asserting the app against itself.
    for (const day of [1, 2, 15, 28]) {
      for (const [year, month] of [
        [1962, 4],
        [1960, 1],
        [1958, 12],
      ] as const) {
        const p = person(year, month, day);
        const recipient = createPiaRecipient(year, month, day, 2400, 'male');
        for (const age of [62, 67, 70]) {
          const engine = recipient.birthdate.dateAtSsaAge(
            MonthDuration.initFromYearsMonths({ years: age, months: 0 }),
          );
          const app = filingMonth(p, { years: age, months: 0 });
          expect({ year: app.year, month: app.month }).toEqual({
            year: engine.year(),
            // The engine's month index is 0-11; the app's convention is 1-12.
            month: engine.monthIndex() + 1,
          });
        }
      }
    }
  });
});

describe('the birthday as one value', () => {
  it('round-trips through the control it is shown in', () => {
    expect(toBirthDateInput({ birthYear: 1962, birthMonth: 4, birthDay: 7 })).toBe('1962-04-07');
    expect(fromBirthDateInput('1962-04-07')).toEqual({
      birthYear: 1962,
      birthMonth: 4,
      birthDay: 7,
    });
  });

  it('shows nothing until the whole date is there', () => {
    // A date input cannot display half a date, so a partial record has to
    // read as no date at all rather than as some invented one.
    expect(toBirthDateInput({ birthYear: 1962, birthMonth: 4, birthDay: '' })).toBe('');
    expect(toBirthDateInput({ birthYear: 1962, birthMonth: '', birthDay: 7 })).toBe('');
    expect(toBirthDateInput({ birthYear: '', birthMonth: 4, birthDay: 7 })).toBe('');
  });

  it('refuses a date that does not exist', () => {
    // `Birthdate.FromYMD` throws on 31 February rather than returning
    // something wrong, so an impossible date must never reach the analysis.
    // The browser will not report one; a pasted value could.
    for (const bad of ['1962-02-31', '1962-02-30', '1961-02-29', '1962-13-01', '1962-04-31']) {
      expect(fromBirthDateInput(bad)).toEqual(BLANK_BIRTH_DATE);
    }
    // And a real leap day is kept.
    expect(fromBirthDateInput('1960-02-29').birthDay).toBe(29);
  });

  it('keeps an out-of-range date rather than blanking the field', () => {
    // `min`/`max` mark it invalid but do not stop it being typed, and
    // clearing the field mid-entry is how a controlled input starts fighting
    // its user. The completeness gate refuses it instead.
    const typed = fromBirthDateInput('1875-12-15');
    expect(typed.birthYear).toBe(1875);
    const bounds = claimantBirthDateBounds(new Date(2026, 0, 15));
    expect(isBirthDateInRange('1875-12-15', bounds)).toBe(false);
    expect(isBirthDateInRange('1962-04-07', bounds)).toBe(true);
  });

  it('offers a claimant exactly the years the selects used to', () => {
    // The control changed; what it accepts did not.
    const bounds = claimantBirthDateBounds(new Date(2026, 0, 15));
    expect(bounds).toEqual({ min: '1939-01-01', max: '2008-12-31' });
    // A deceased spouse has no lower age bound to get wrong.
    expect(deceasedBirthDateBounds(new Date(2026, 0, 15))).toEqual({
      min: '1917-01-01',
      max: '2026-12-31',
    });
  });
});

describe('a birth date the control allows to be typed', () => {
  const asOf = new Date(2026, 0, 15);
  const form = (birthYear: number, birthMonth: number, birthDay: number): AnalyzerFormState => ({
    ...BLANK_FORM,
    maritalStatus: 'single',
    personA: {
      ...BLANK_FORM.personA,
      birthYear,
      birthMonth,
      birthDay,
      gender: 'male',
      monthlyBenefit: 2400,
    },
  });

  it('is refused when it falls outside the years offered', () => {
    // Not a hypothetical. `min`/`max` mark an out-of-range date invalid but
    // do not stop it being typed, and `Birthdate.FromYMD` throws below 1900
    // rather than returning something wrong — so a typed 1875 took the whole
    // app down until this gate agreed with the control.
    expect(isFormComplete(form(1875, 12, 15), asOf)).toBe(false);
    expect(isFormComplete(form(2020, 12, 15), asOf)).toBe(false);
    expect(isFormComplete(form(1962, 4, 15), asOf)).toBe(true);
  });

  it('accepts the exact ends of the range the control offers', () => {
    // The gate and the control have to agree on the boundary, or one of them
    // is lying about what the app accepts.
    const { min, max } = claimantBirthDateBounds(asOf);
    expect(min).toBe('1939-01-01');
    expect(max).toBe('2008-12-31');
    expect(isFormComplete(form(1939, 1, 1), asOf)).toBe(true);
    expect(isFormComplete(form(2008, 12, 31), asOf)).toBe(true);
    expect(isFormComplete(form(1938, 12, 31), asOf)).toBe(false);
  });
});

describe('the form requires a day', () => {
  it('is incomplete until one is chosen', () => {
    // Optional would default to "not the 1st", which is the wrong answer for
    // exactly the people the field exists to serve — and silence is how they
    // would keep getting it.
    const withDay: AnalyzerFormState = {
      ...BLANK_FORM,
      maritalStatus: 'single',
      personA: {
        ...BLANK_FORM.personA,
        birthYear: 1962,
        birthMonth: 4,
        birthDay: 15,
        gender: 'male',
        monthlyBenefit: 2400,
      },
    };
    expect(isFormComplete(withDay, new Date(2026, 0, 15))).toBe(true);
    expect(
      isFormComplete(
        { ...withDay, personA: { ...withDay.personA, birthDay: '' } },
        new Date(2026, 0, 15),
      ),
    ).toBe(false);
  });
});

describe('a whole analysis for a 1 January birthday', () => {
  it('files a month earlier than the same person born a day later', async () => {
    // End to end, not just the month arithmetic: the engine, the
    // recommendation and the dates the report prints all move together, or
    // the report contradicts its own engine.
    const asOf = new Date(2026, 0, 15);
    const assumptions = { annualCola: 2.5, discountRate: 0.025 };
    const first = await analyzeHousehold(
      { status: 'single', people: [person(1960, 1, 1)] },
      assumptions,
      asOf,
    );
    const second = await analyzeHousehold(
      { status: 'single', people: [person(1960, 1, 2)] },
      assumptions,
      asOf,
    );

    // The bracket difference, carried all the way into the analysis.
    expect(first.people[0].fra).toEqual({ years: 66, months: 10 });
    expect(second.people[0].fra).toEqual({ years: 67, months: 0 });

    // And the printed date for the same filing age is one month apart.
    const age = { years: 67, months: 0 };
    const a = filingMonth(person(1960, 1, 1), age);
    const b = filingMonth(person(1960, 1, 2), age);
    expect(a).toEqual({ year: 2026, month: 12 });
    expect(b).toEqual({ year: 2027, month: 1 });
  }, 30000);

  it('leaves every other day exactly where it was', async () => {
    // The guarantee that made this change safe to make: 15 was the old
    // assumed day, and every day but the 1st still agrees with it to the
    // cent. This is what says the recorded fixtures did not move.
    const asOf = new Date(2026, 0, 15);
    const assumptions = { annualCola: 2.5, discountRate: 0.025 };
    const base = await analyzeHousehold(
      { status: 'single', people: [person(1962, 4, 15)] },
      assumptions,
      asOf,
    );
    for (const day of [2, 3, 20, 28]) {
      const other = await analyzeHousehold(
        { status: 'single', people: [person(1962, 4, day)] },
        assumptions,
        asOf,
      );
      expect(other.comparisons.map((c) => [c.key, c.expectedNpv])).toEqual(
        base.comparisons.map((c) => [c.key, c.expectedNpv]),
      );
      expect(other.people[0].fra).toEqual(base.people[0].fra);
    }
  }, 30000);
});

