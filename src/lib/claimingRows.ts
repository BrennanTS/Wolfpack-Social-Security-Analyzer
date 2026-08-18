import { MonthDuration } from '$lib/month-time';
import type { PersonAnalysis } from './personAnalysis';
import { yearsMonthsLabel } from './format';
import { filingAgeMonths, type FilingAgeChoice } from './scenario';
import { createPiaRecipient, lifetimeNpvToAge, ssaMonthlyBenefitAtFilingAge } from './ssaTools';

/**
 * One row of a person's "Benefit by Claiming Age" table.
 *
 * A DISPLAY row, not a strategy. Nothing else on the page moves when this
 * list changes: the four charts beside the table, the break-evens and the
 * household analysis all keep reading `PersonAnalysis.claimingOptions`, which
 * this never touches. That is the whole reason the two are separate types —
 * `ClaimingOption.age` is a whole number that four charts and
 * `computeBreakEvens` index by, and letting an adviser put 69 years 1 month
 * into it would have rippled through every one of them to serve a table.
 */
export interface ClaimingRow {
  /** `"67"` or `"69-1"` — stable across re-renders and re-analyses. */
  id: string;
  years: number;
  months: number;
  /** `"67"` or `"69 years, 1 month"`. */
  label: string;
  monthlyBenefit: number;
  percentOfPia: number;
  lifetimeBenefits: number;
  /** Whether this age is already behind the person. */
  isEligible: boolean;
  /** Added by the adviser, and therefore removable. Built-in rows are not. */
  added: boolean;
  /** Kept off both surfaces, but still listed (and un-hideable) in the editor. */
  hidden: boolean;
}

/**
 * Which rows of one person's table are hidden, and which extra ages have been
 * added to it. Deliberately NOT stored on `PersonAnalysis`: this is a display
 * preference, and putting it on the analysis would re-run the engine's
 * optimizer every time a row was hidden.
 */
export interface ClaimingTablePrefs {
  /** `ClaimingRow.id`s the adviser has hidden. */
  hidden: string[];
  added: FilingAgeChoice[];
}

/** Keyed by `Person.id`. Absent means untouched. */
export type ClaimingPrefsByPerson = Record<string, ClaimingTablePrefs>;

export const BLANK_CLAIMING_PREFS: ClaimingTablePrefs = { hidden: [], added: [] };

export function claimingRowId(age: FilingAgeChoice): string {
  return age.months === 0 ? String(age.years) : `${age.years}-${age.months}`;
}

export function claimingRowLabel(age: FilingAgeChoice): string {
  return age.months === 0 ? String(age.years) : yearsMonthsLabel(age.years, age.months);
}

export function prefsFor(
  prefs: ClaimingPrefsByPerson,
  personId: string,
): ClaimingTablePrefs {
  return prefs[personId] ?? BLANK_CLAIMING_PREFS;
}

export function withPrefsFor(
  prefs: ClaimingPrefsByPerson,
  personId: string,
  next: ClaimingTablePrefs,
): ClaimingPrefsByPerson {
  return { ...prefs, [personId]: next };
}

export function toggleClaimingRowHidden(
  prefs: ClaimingTablePrefs,
  id: string,
): ClaimingTablePrefs {
  return prefs.hidden.includes(id)
    ? { ...prefs, hidden: prefs.hidden.filter((h) => h !== id) }
    : { ...prefs, hidden: [...prefs.hidden, id] };
}

/**
 * Adds an age, ignoring one the table already carries.
 *
 * An added age that duplicates a built-in row is dropped rather than shown
 * twice — unlike a household scenario, a row here has no name and no
 * strategy of its own, so two rows for age 67 would be indistinguishable.
 * Un-hiding is what the adviser wants there, and adding a hidden age reveals
 * it for exactly that reason.
 */
export function addClaimingRow(
  prefs: ClaimingTablePrefs,
  age: FilingAgeChoice,
  existingIds: readonly string[],
): ClaimingTablePrefs {
  const id = claimingRowId(age);
  const revealed = { ...prefs, hidden: prefs.hidden.filter((h) => h !== id) };
  if (existingIds.includes(id)) return revealed;
  return { ...revealed, added: [...revealed.added, { years: age.years, months: age.months }] };
}

/** Removes an ADDED age. A built-in row is hidden, never removed. */
export function removeClaimingRow(prefs: ClaimingTablePrefs, id: string): ClaimingTablePrefs {
  return {
    hidden: prefs.hidden.filter((h) => h !== id),
    added: prefs.added.filter((a) => claimingRowId(a) !== id),
  };
}

export function resetClaimingPrefs(): ClaimingTablePrefs {
  return { hidden: [], added: [] };
}

export function isDefaultClaimingPrefs(prefs: ClaimingTablePrefs): boolean {
  return prefs.hidden.length === 0 && prefs.added.length === 0;
}

/**
 * The table's rows: this person's whole-year claiming options, plus whatever
 * ages the adviser added, in age order.
 *
 * Whole-year rows already behind the person are dropped — the table shows the
 * decision still available, and a row for 62 when they are 66 offers a choice
 * that has gone by. An ADDED age is kept regardless, because the adviser
 * typed it: silently discarding it would leave the Add control looking broken.
 *
 * `hidden` rows are returned, flagged. Both surfaces filter them out; the
 * editor needs them, or un-hiding one would be a blind click.
 */
export function buildClaimingRows(
  analysis: PersonAnalysis,
  prefs: ClaimingTablePrefs,
  asOf: Date,
): ClaimingRow[] {
  const currentMonths = analysis.currentAge.years * 12 + analysis.currentAge.months;
  const hidden = new Set(prefs.hidden);

  const rows = new Map<string, ClaimingRow>();

  for (const option of analysis.claimingOptions) {
    if (option.age < analysis.currentAge.years) continue;
    const age = { years: option.age, months: 0 };
    const id = claimingRowId(age);
    rows.set(id, {
      id,
      years: option.age,
      months: 0,
      label: claimingRowLabel(age),
      monthlyBenefit: option.monthlyBenefit,
      percentOfPia: option.percentOfPia,
      lifetimeBenefits: option.lifetimeBenefits,
      isEligible: option.isEligible,
      added: false,
      hidden: hidden.has(id),
    });
  }

  if (prefs.added.length > 0) {
    const { person } = analysis;
    const recipient = createPiaRecipient(
      person.birthYear,
      person.birthMonth,
      person.piaMonthly,
      person.gender,
    );
    for (const age of prefs.added) {
      const id = claimingRowId(age);
      // An added age that coincides with a whole-year row is the same row.
      if (rows.has(id)) continue;
      const filingAge = MonthDuration.initFromYearsMonths({
        years: age.years,
        months: age.months,
      });
      const { benefit, percentOfPia } = ssaMonthlyBenefitAtFilingAge(recipient, filingAge);
      rows.set(id, {
        id,
        years: age.years,
        months: age.months,
        label: claimingRowLabel(age),
        monthlyBenefit: benefit,
        percentOfPia,
        // The same call `analyzePerson` makes for the whole-year rows — same
        // zero discount rate, same plan-to age, same `asOf` — so an added row
        // is comparable with the ones beside it rather than computed a
        // second way.
        lifetimeBenefits: lifetimeNpvToAge(
          recipient,
          filingAge,
          person.lifeExpectancy,
          0,
          asOf,
        ),
        isEligible: filingAgeMonths(age) <= currentMonths,
        added: true,
        hidden: hidden.has(id),
      });
    }
  }

  return [...rows.values()].sort(
    (a, b) => filingAgeMonths(a) - filingAgeMonths(b),
  );
}

/** The visible rows, in order — what both surfaces render. */
export function visibleClaimingRows(rows: ClaimingRow[]): ClaimingRow[] {
  return rows.filter((r) => !r.hidden);
}
