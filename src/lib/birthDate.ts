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
 */
export function toBirthDateInput({ birthYear, birthMonth, birthDay }: BirthDateParts): string {
  if (birthYear === '' || birthMonth === '' || birthDay === '') return '';
  const mm = String(birthMonth).padStart(2, '0');
  const dd = String(birthDay).padStart(2, '0');
  return `${birthYear}-${mm}-${dd}`;
}

/**
 * The parts of a `yyyy-mm-dd` the control reported.
 *
 * Blank for anything that is not a real date. The browser will not report a
 * partial or impossible one — it fires only when the date is complete and the
 * calendar has one — so this is a guard against a pasted or programmatic
 * value rather than against ordinary typing.
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
