import { describe, expect, it } from 'vitest';
import {
  addMonths,
  ageAndDateLabel,
  APPLY_LEAD_MONTHS,
  applyMonth,
  filingMonth,
  monthYearLabel,
  shortMonthYearLabel,
} from './filingDates';
import type { Person } from './personAnalysis';

const person = (birthYear: number, birthMonth: number): Person => ({
  id: 'a',
  birthYear,
  birthMonth,
  gender: 'male',
  piaMonthly: 3000,
  lifeExpectancy: 90,
});

describe('addMonths', () => {
  it('rolls the year forwards', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('rolls the year backwards', () => {
    // The apply-by date crosses a year boundary for anyone filing in the first
    // quarter, which is a quarter of all clients. A `% 12` without the double
    // modulo returns month 0 or a negative here.
    expect(addMonths({ year: 2027, month: 2 }, -3)).toEqual({ year: 2026, month: 11 });
  });

  it('is exact across many years', () => {
    expect(addMonths({ year: 2026, month: 5 }, 12 * 22 + 7)).toEqual({ year: 2048, month: 12 });
  });
});

describe('filingMonth', () => {
  it('lands on the birthday month of the filing age', () => {
    // Born December 1978, filing at 70 → December 2048.
    expect(filingMonth(person(1978, 12), { years: 70, months: 0 })).toEqual({
      year: 2048,
      month: 12,
    });
  });

  it('carries the months of a part-year filing age', () => {
    // 62 years 1 month is the earliest anyone can claim, and it is one of the
    // most frequently shown ages in this app — it must not round to 62y0m.
    expect(filingMonth(person(1978, 12), { years: 62, months: 1 })).toEqual({
      year: 2041,
      month: 1,
    });
  });
});

describe('applyMonth', () => {
  it('is three months before the benefit starts', () => {
    expect(APPLY_LEAD_MONTHS).toBe(3);
    expect(applyMonth({ year: 2049, month: 1 })).toEqual({ year: 2048, month: 10 });
  });
});

describe('labels', () => {
  it('spells the month out for prose and abbreviates it for tables', () => {
    expect(monthYearLabel({ year: 2049, month: 1 })).toBe('January 2049');
    expect(shortMonthYearLabel({ year: 2049, month: 1 })).toBe('Jan 2049');
  });

  it('puts the age and its date together', () => {
    const label = ageAndDateLabel(person(1978, 12), {
      years: 70,
      months: 0,
      label: '70',
      decimalYears: 70,
      monthDuration: null as never,
    });
    expect(label).toBe('70 — Dec 2048');
  });
});
