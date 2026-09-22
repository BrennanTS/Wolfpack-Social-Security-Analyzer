/**
 * Putting a whole analysis into the dollars the reader asked for.
 *
 * Extracted from `HouseholdPanel` because the PDF needs exactly the same
 * transform and had been getting none: `ReportSections` passed a hardcoded
 * `'real'` to its own caption while the screen beside it could be showing
 * nominal. An adviser exporting what they were looking at got a different
 * document. One function, both surfaces, so they cannot drift again.
 *
 * Two shapes of figure need two different treatments, and the distinction is
 * the whole reason this is not a single multiply:
 *
 *   - A figure that belongs to ONE year (survivor income in the first full
 *     year after a death) takes one factor, for that year.
 *   - A figure summed over MANY years (the household value) takes a different
 *     factor in each of them, so it is re-summed from the strategy's own
 *     stream rather than scaled. `lifetimeValue.ts` says more about why.
 */
import { roundCents } from './benefitMath';
import type { ClaimingGrid } from './claimingGrid';
import { toNominal, toNominalAmount, type DollarsMode } from './dollarsMode';
import type { HouseholdAnalysis, HouseholdStrategy } from './household';
import { firstDeath } from './incomeCliff';
import { householdValueFromTimeline } from './lifetimeValue';

export interface DisplayDollarsOptions {
  dollarsMode: DollarsMode;
  /** A PERCENT (2.54 means 2.54%). */
  annualCola: number;
  /** A FRACTION (0.025 means 2.5%) — the rate the analysis was computed at. */
  discountRate: number;
  asOfYear: number;
}

/**
 * Every strategy row restated in `dollarsMode`, with the deltas re-anchored on
 * whatever the value column ends up showing.
 *
 * Real mode returns the array untouched (identity, not a copy) so a memo
 * upstream does not see a new array on every render in the default mode.
 */
export function comparisonsInDollarsMode(
  comparisons: HouseholdStrategy[],
  people: HouseholdAnalysis['people'],
  finalIndexByPersonId: HouseholdAnalysis['finalIndexByPersonId'],
  opts: DisplayDollarsOptions,
): HouseholdStrategy[] {
  if (opts.dollarsMode !== 'nominal') return comparisons;

  const death =
    people.length === 2
      ? firstDeath([people[0].person.id, people[1].person.id], finalIndexByPersonId)
      : null;
  const survivorYear = death === null ? null : death.deathYear + 1;

  const revalued = comparisons.map((c) => ({
    ...c,
    // The stream itself, not just the total summed from it. The year-by-year
    // table and the cumulative charts render these points directly, so
    // converting the total alone put nominal headings over real rows — the
    // exact mismatch this module exists to prevent, caught in a rendered PDF
    // rather than by a test that had both sides in the same mode.
    timeline: toNominal(c.timeline, opts.annualCola, opts.asOfYear),
    // A widowed row carries no stream yet, so it keeps the figure it has
    // rather than being left unconverted in a way that looks converted.
    householdValue:
      c.timeline.length === 0
        ? c.householdValue
        : // `c.timeline` here is still the REAL stream: this object literal's
          // own `timeline` field above does not shadow it. Re-summing the
          // converted one would compound the COLA twice.
          householdValueFromTimeline(c.timeline, { ...opts, dollarsMode: 'nominal' }),
    survivorIncome:
      c.survivorIncome == null || survivorYear === null
        ? c.survivorIncome
        : toNominalAmount(c.survivorIncome, opts.annualCola, opts.asOfYear, survivorYear),
  }));

  const best = revalued.find((c) => c.isOptimal);
  if (best === undefined) return revalued;
  return revalued.map((c) => ({
    ...c,
    deltaVsOptimal: roundCents(c.householdValue - best.householdValue),
  }));
}

/**
 * The claiming grid restated, so a square cannot quote different dollars from
 * the strategy table printed beside it.
 *
 * The third shape of figure, after the one-year amount and the many-year sum:
 * a set of many-year sums whose streams are long gone. `buildClaimingGrid`
 * values each square in both modes while it still has the stream, so this
 * picks one — it cannot scale, for the same reason the household value cannot.
 *
 * `max` and `min` are recomputed rather than carried across, because
 * `gridRatio`, `percentOfBest` and `cellsWithin` all measure against them and
 * a nominal board measured against a real maximum would shade and label every
 * square wrongly. Note that the two bases do NOT rank identically: later
 * claiming pays in later years, which nominal weights more heavily, so a
 * square's share of the best shifts slightly between them. That is real, not
 * an artifact — the same reason the basis is worth stating on the page.
 *
 * Identity in real mode, and for a null grid (a single claimant, a widowed
 * household), so the default path allocates nothing.
 */
export function gridInDollarsMode(
  grid: ClaimingGrid | null,
  dollarsMode: DollarsMode,
): ClaimingGrid | null {
  if (grid === null || dollarsMode !== 'nominal') return grid;
  const cells = grid.cells.map((c) => ({ ...c, value: c.valueNominal }));
  const values = cells.map((c) => c.value);
  return { ...grid, cells, max: Math.max(...values), min: Math.min(...values) };
}

/**
 * The strategy that prints the LARGEST figure when that is not the one the
 * report recommends — otherwise null.
 *
 * This is the one inconsistency a basis switch cannot convert away, because
 * it is not a conversion error. Which plan is recommended is settled at the
 * adviser's discount rate; which plan shows the biggest number depends on
 * whether the reader is looking at discounted dollars. Stop discounting and a
 * plan that waits overtakes — it collects more dollars in total, later. On the
 * couple in `solvency.test.ts`: recommended at $1,645,856 against $1,649,647
 * for waiting longer, a `deltaVsOptimal` of +$3,791 on a row not marked best.
 *
 * Both are true. Printing them side by side without a word is what is not, so
 * the surfaces ask this and say so when it answers.
 */
export function outrankedByDisplay(
  comparisons: HouseholdStrategy[],
): HouseholdStrategy | null {
  if (comparisons.length === 0) return null;
  const largest = comparisons.reduce((a, b) => (b.householdValue > a.householdValue ? b : a));
  return largest.isOptimal ? null : largest;
}
