import type { FilingAgeDisplay } from './ssaTools';
import type { Person } from './personAnalysis';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

/** A calendar month, as `{ year, month }` with month 1-12. */
export interface CalendarMonth {
  year: number;
  month: number;
}

/**
 * The calendar month a filing age falls in.
 *
 * Every competing report gives DATES; ours gives ages only, and a client
 * cannot put an age in a diary. This is arithmetic on figures the app already
 * holds — birth month and filing age — not a benefit computation, so it
 * belongs here rather than behind the engine.
 *
 * SSA's own age convention: a person attains age N in the month containing
 * their birthday, and this returns that month. `addMonths` handles the year
 * roll rather than a `% 12` that a reader has to check twice.
 */
export function filingMonth(person: Person, age: { years: number; months: number }): CalendarMonth {
  return addMonths(
    { year: person.birthYear, month: person.birthMonth },
    age.years * 12 + age.months,
  );
}

/** `{ year, month }` shifted by whole months, forwards or backwards. */
export function addMonths(from: CalendarMonth, months: number): CalendarMonth {
  const total = from.year * 12 + (from.month - 1) + months;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

/** "January 2049" — for prose and for the action plan. */
export function monthYearLabel(when: CalendarMonth): string {
  return `${MONTH_NAMES[when.month - 1]} ${when.year}`;
}

/** "Jan 2049" — for table cells, where the long form wraps. */
export function shortMonthYearLabel(when: CalendarMonth): string {
  return `${SHORT_MONTHS[when.month - 1]} ${when.year}`;
}

/**
 * How far ahead to apply. SSA tells applicants to file up to four months
 * early and every report in the field says three, so three it is — early
 * enough to be safe, and the same number the client will hear elsewhere.
 */
export const APPLY_LEAD_MONTHS = 3;

/** The month to apply in, for a benefit starting at `filing`. */
export function applyMonth(filing: CalendarMonth): CalendarMonth {
  return addMonths(filing, -APPLY_LEAD_MONTHS);
}

/**
 * "70 — Jan 2049", the age and the date together.
 *
 * One function rather than an interpolation at each call site: the age and
 * the date are two spellings of one fact, and a page that shows them apart
 * invites a reader to check whether they agree.
 */
export function ageAndDateLabel(person: Person, age: FilingAgeDisplay): string {
  return `${age.label} — ${shortMonthYearLabel(filingMonth(person, age))}`;
}
