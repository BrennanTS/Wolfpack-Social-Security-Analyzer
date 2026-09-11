import type { FilingAgeDisplay } from './ssaTools';
import type { Person } from './personAnalysis';
import { ssaBirthMonth } from './ssaTools';

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
 * SSA's own age convention: a person attains an age the day BEFORE their
 * birthday, so the month they attain it in is the month of that day — the
 * same month for every birthday but the 1st, and the previous month for
 * that one. `ssaBirthMonth` is the single answer to that question, shared
 * with everything else here that has to ask it; the engine's own version is
 * `Birthdate.ssaBirthMonthDate`.
 *
 * This used to read the calendar birth month directly, which was right for
 * 30 days out of 31 and put every date a month late for the other one.
 *
 * `addMonths` handles the year roll rather than a `% 12` that a reader has
 * to check twice.
 */
export function filingMonth(person: Person, age: { years: number; months: number }): CalendarMonth {
  return addMonths(
    ssaBirthMonth(person.birthYear, person.birthMonth, person.birthDay),
    age.years * 12 + age.months,
  );
}

/**
 * A `{ year, month }` from an absolute month index.
 *
 * The inverse of the index `addMonths` computes, and of the band convention
 * `benefitPeriods` documents: `calendarYear * 12 + (month - 1)`. Written here
 * rather than at a call site because getting the off-by-one wrong produces a
 * date one month out, which reads as plausible and is exactly the error a
 * reader cannot catch.
 */
export function calendarMonthAt(index: number): CalendarMonth {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
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
  return `${age.label} (${shortMonthYearLabel(filingMonth(person, age))})`;
}
