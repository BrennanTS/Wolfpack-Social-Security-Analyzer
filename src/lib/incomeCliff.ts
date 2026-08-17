/**
 * The income-cliff figure: what happens to household income at the first
 * death, stated as full-year totals either side of it.
 *
 * Pure arithmetic over `HouseholdAnalysis.combinedTimeline` and
 * `finalIndexByPersonId` — it derives no benefit rule and makes no engine
 * call. `finalIndexByPersonId` is required rather than inferred from
 * `periods`: a person who dies before filing holds no band at all, so their
 * death month is not recoverable from the band ends. (The reason previously
 * given here — that the dual-entitlement split extends the deceased's
 * personal band to the survivor's death — was wrong; see
 * `benefitPeriods.ts`'s `HouseholdPeriods.finalIndexByPersonId`.)
 */
import { personLabel } from './format';
import type { HouseholdAnalysis } from './household';

export interface IncomeCliff {
  /** Calendar year of the first death. */
  deathYear: number;
  /** Household total in the last full year before it. */
  before: number;
  /** Household total in the first full year after it. */
  after: number;
  /** Positive percentage drop, e.g. 37.3. Zero when income does not fall. */
  dropPercent: number;
  survivorLabel: string;
}

export interface FirstDeath {
  /** Calendar year of the first death. */
  deathYear: number;
  /** Index (0 or 1), in `people`/id-array order, of whoever survives. */
  survivorIndex: 0 | 1;
  /**
   * The deceased's own inclusive final month, on the same absolute-month
   * index `BenefitBand` uses — the exact month the household's income shape
   * changes is one month later. Exposed so a consumer that needs
   * month-precision (the chart's monthly series, for its "First death"
   * marker) reads it from here rather than re-deriving `Math.min` over the
   * two final indexes itself — the same duplication risk `deathYear` exists
   * to prevent, at finer grain.
   */
  deathMonthIndex: number;
}

/**
 * The calendar year of the first death, plus which of the two people
 * survives — the arithmetic `incomeCliff` and `household.ts`'s per-strategy
 * survivor-income figure both need and must agree on. The two are read side
 * by side on the same page, and a second, subtly different notion of "the
 * year after the first death" living in the same codebase is exactly how
 * figures that should agree drift apart.
 *
 * Takes the two ids directly rather than a `HouseholdAnalysis`, so
 * `household.ts` can call it mid-analysis, before it has assembled one.
 *
 * Null when either person's final index is missing, and also on an exact
 * tie (identical final months for both people). A tie-break there would pick
 * a "first to die" and a "survivor" that the household does not actually
 * have — two independent mortality draws landing on the same month is not
 * evidence either person outlives the other, and entry order must not be
 * able to decide it. `detectSurvivorGap` in `benefitPeriods.ts` already
 * treats an exact tie the same way, for the same reason.
 */
export function firstDeath(
  personIds: readonly [string, string],
  finalIndexByPersonId: Record<string, number>,
): FirstDeath | null {
  const finalIndexes = personIds.map((id) => finalIndexByPersonId[id]);
  if (finalIndexes.some((idx) => idx === undefined)) return null;
  if (finalIndexes[0] === finalIndexes[1]) return null;

  // The first-to-die is whichever person's inclusive final month comes
  // first.
  const firstIndex = finalIndexes[0] < finalIndexes[1] ? 0 : 1;
  const survivorIndex: 0 | 1 = firstIndex === 0 ? 1 : 0;
  const deathMonthIndex = finalIndexes[firstIndex];
  const deathYear = Math.floor(deathMonthIndex / 12);

  return { deathYear, survivorIndex, deathMonthIndex };
}

/**
 * Null for a single claimant (there is no "first" death to speak of), for a
 * couple whose first death falls in the timeline's first or last year — the
 * full year on the missing side does not exist to compare against — and for
 * a couple whose final months tie exactly, via `firstDeath` (see there).
 *
 * Deliberately measures full calendar years either side of the death year,
 * never the death year itself: the deceased is paid for only part of it by
 * construction, so a comparison that reached into it would report a drop
 * that is an artefact of the calendar rather than a change in income.
 */
export function incomeCliff(analysis: HouseholdAnalysis): IncomeCliff | null {
  if (analysis.people.length !== 2) return null;
  if (!analysis.finalIndexByPersonId) return null;

  const ids: [string, string] = [analysis.people[0].person.id, analysis.people[1].person.id];
  const death = firstDeath(ids, analysis.finalIndexByPersonId);
  if (death === null) return null;

  const beforePoint = analysis.combinedTimeline.find((p) => p.year === death.deathYear - 1);
  const afterPoint = analysis.combinedTimeline.find((p) => p.year === death.deathYear + 1);
  if (!beforePoint || !afterPoint) return null;

  const before = beforePoint.total;
  const after = afterPoint.total;
  // Clamped at zero rather than left negative: a survivor step-up can offset
  // or exceed the loss, and "the drop" is not a meaningful negative quantity
  // — it is simply the case that income did not fall.
  const dropPercent = before > 0 ? Math.max(0, ((before - after) / before) * 100) : 0;

  const survivorPerson = analysis.people[death.survivorIndex];
  const survivorLabel = personLabel(survivorPerson.person.name, death.survivorIndex);

  return { deathYear: death.deathYear, before, after, dropPercent, survivorLabel };
}
