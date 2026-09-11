/**
 * A birthday as one value.
 *
 * The form collects a complete date now that the day is required, and a
 * native date input is one control for one fact — so the three selects it
 * replaced took their day-list arithmetic with them: which months have 30
 * days, which Februaries have 29, and what a chosen 31st should become when
 * the month changes underneath it. The browser owns a calendar; the app does
 * not need a second one.
 *
 * Form state still holds year, month and day separately, because that is what
 * the share link, the analysis and every fixture already speak. This module is
 * only the seam between that and the control.
 */

export interface BirthDateParts {
  birthYear: number | '';
  birthMonth: number | '';
  birthDay: number | '';
}

/** Nothing chosen. */
export const BLANK_BIRTH_DATE: BirthDateParts = {
  birthYear: '',
  birthMonth: '',
  birthDay: '',
};

/**
 * `yyyy-mm-dd`, the only format `input[type=date]` accepts or reports —
 * whatever the browser chooses to DISPLAY, which follows the reader's locale.
 *
 * Empty unless all three parts are present: a date input has no way to show
 * half a date, so a partial record has to read as no date at all.
 *
 * The YEAR is padded to four digits like the other two parts. `yyyy-mm-dd` is
 * a fixed-width format, and a year that arrives short — which it does on every
 * keystroke while someone types one, since the control reports `0001` after
 * the first digit — produces `1-06-15`, which is not a date the control can
 * accept. Assigning it back blanks the whole field, taking the month and day
 * the reader had already entered with it.
 */
export function toBirthDateInput({ birthYear, birthMonth, birthDay }: BirthDateParts): string {
  if (birthYear === '' || birthMonth === '' || birthDay === '') return '';
  const yyyy = String(birthYear).padStart(4, '0');
  const mm = String(birthMonth).padStart(2, '0');
  const dd = String(birthDay).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * The parts of a `yyyy-mm-dd` the control reported.
 *
 * Blank for anything that is not a real date.
 *
 * It DOES fire during ordinary typing, contrary to what this comment used to
 * claim. A year is entered a digit at a time and the control reports a
 * complete date at every step — `0001-06-15`, then `0019-…`, `0196-…`,
 * `1960-…` — so a year of 1 is not a pasted curiosity, it is what every
 * reader's first keystroke in the year looks like.
 *
 * Deliberately does NOT range-check. A date outside the offered years is a
 * real date the reader typed, and blanking the field as they type is how a
 * controlled input starts fighting its user. It is kept, marked invalid, and
 * refused by the completeness gate.
 */
export function fromBirthDateInput(value: string): BirthDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) return BLANK_BIRTH_DATE;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return BLANK_BIRTH_DATE;
  // Rejects 31 February and 30 February, which pass the digit test above.
  // `Birthdate.FromYMD` throws on those rather than returning something
  // wrong, so an impossible date must never reach the analysis.
  const probe = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` reads 0-99 as 1900-1999, so year 1 comes back as 1901 and the
  // check below would reject it — blanking the field on the reader's first
  // year keystroke and taking their month and day with it. Undo that one
  // legacy remap; every other year is already itself.
  if (year >= 0 && year <= 99) probe.setUTCFullYear(year);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1) {
    return BLANK_BIRTH_DATE;
  }
  if (probe.getUTCDate() !== day) return BLANK_BIRTH_DATE;
  return { birthYear: year, birthMonth: month, birthDay: day };
}

/**
 * The range a living claimant's birthday may fall in.
 *
 * The same years the year select offered: at least 18 today, and no more than
 * 87, so the change of control accepts exactly what it accepted before. Whole
 * years rather than a date 18 years ago to the day, for the same reason — the
 * select could not express a partial year and neither should this.
 */
export function claimantBirthDateBounds(asOf: Date = new Date()): { min: string; max: string } {
  const year = asOf.getFullYear();
  return { min: `${year - 87}-01-01`, max: `${year - 18}-12-31` };
}

/** The same, for a deceased spouse, who has no lower age bound to get wrong. */
export function deceasedBirthDateBounds(asOf: Date = new Date()): { min: string; max: string } {
  const year = asOf.getFullYear();
  return { min: `${year - 109}-01-01`, max: `${year}-12-31` };
}

/** Whether a chosen date falls inside the offered range. */
export function isBirthDateInRange(value: string, bounds: { min: string; max: string }): boolean {
  if (value === '') return true;
  return value >= bounds.min && value <= bounds.max;
}
