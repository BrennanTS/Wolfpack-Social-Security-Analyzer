import { filingAgeMonths, type FilingAgeChoice } from './scenario';
import type { RankedStrategy } from './ssaTools';

/**
 * One square of the claiming-age grid: a pair of WHOLE ages, and the best the
 * household can do with both people filing somewhere inside those two years.
 *
 * A cell is a max over months, not a single month-pair. The engine returns
 * every month combination — around 9,200 for a typical couple — and pinning
 * each cell to `{years: Y, months: 0}` would have two costs. Some of those
 * pairs are unattainable (nobody can file at 62 years 0 months; SSA needs a
 * full month, so 62y1m is the floor), leaving holes in the grid at exactly
 * the ages an adviser asks about most. And the optimum itself usually falls
 * on an odd month — 67 years 11 months for the household this was built
 * against — so the grid's own maximum would sit below the figure the rest of
 * the report calls best, and no cell would read 100%.
 *
 * Taking the best inside each year-pair fixes both: every attainable year
 * pair has a cell, the grid's maximum IS the optimizer's answer, and the cell
 * carries the exact ages that achieve it so the label can say 67 years, 11
 * months rather than implying a whole year.
 */
export interface ClaimingGridCell {
  /** The whole ages this cell sits at, in DISPLAY order. */
  years: [number, number];
  /** The exact filing ages achieving `value`, in DISPLAY order. */
  ages: [FilingAgeChoice, FilingAgeChoice];
  /** Household value at those ages — the same figure the strategy table shows. */
  value: number;
}

export interface ClaimingGrid {
  /** Attainable whole ages per person, ascending, in DISPLAY order. */
  years: [number[], number[]];
  cells: ClaimingGridCell[];
  /** The optimizer's own answer: no cell can exceed it, and one always meets it. */
  max: number;
  min: number;
}

/** `${yearsA}|${yearsB}` — the lookup key for a cell, in display order. */
export function gridKey(a: number, b: number): string {
  return `${a}|${b}`;
}

/**
 * Builds the grid from the engine's full ranked cross-product.
 *
 * `toDisplay` is the same slot permutation `analyzeHousehold` applies to
 * everything else it returns — `ranked` is in ENGINE order, and a grid whose
 * axes depended on which spouse was typed into the form first is the exact
 * order-dependence Phase 2b closed everywhere else. Defaults to identity so a
 * caller with nothing to permute (and every test) can omit it.
 *
 * Returns null for anything that is not a two-person cross-product: a single
 * claimant has one axis, which is the benefit-by-claiming-age table it
 * already has, and a widowed household's two dates are not two people.
 */
export function buildClaimingGrid(
  ranked: readonly RankedStrategy[],
  toDisplay: <T>(pair: readonly T[]) => [T, T] = (pair) => [pair[0], pair[1]],
): ClaimingGrid | null {
  if (ranked.length === 0 || ranked[0].filingAges.length !== 2) return null;

  const best = new Map<string, ClaimingGridCell>();
  for (const strategy of ranked) {
    const ages = toDisplay(strategy.filingAges);
    const key = gridKey(ages[0].years, ages[1].years);
    const current = best.get(key);
    // Strictly greater, so a tie keeps the FIRST strategy seen. `ranked` is
    // sorted best-first, so ties resolve to the earlier-listed combination
    // rather than to iteration order — the same tie rule the comparison
    // table's lookup uses.
    if (current !== undefined && strategy.expectedNpv <= current.value) continue;
    best.set(key, {
      years: [ages[0].years, ages[1].years],
      ages: [
        { years: ages[0].years, months: ages[0].months },
        { years: ages[1].years, months: ages[1].months },
      ],
      value: strategy.expectedNpv,
    });
  }

  const cells = [...best.values()];
  const values = cells.map((c) => c.value);
  const years = ([0, 1] as const).map((slot) =>
    [...new Set(cells.map((c) => c.years[slot]))].sort((a, b) => a - b),
  );

  return {
    years: [years[0], years[1]],
    cells,
    max: Math.max(...values),
    min: Math.min(...values),
  };
}

/**
 * The keys of every cell within `percent` of the best — the near-optimal
 * region.
 *
 * The point of drawing it: on the household this was built against, 23 of 81
 * combinations are within 1% of the optimum and 54 are within 5%. A grid that
 * only marked the single best square would say "claim at 70" and hide that
 * almost a third of the board buys the same outcome, which is the question an
 * adviser is actually being asked.
 *
 * Measured against the optimizer's answer, not against the range: a cell 1%
 * below the best is 1% below in dollars, whatever the spread of the grid
 * happens to be.
 */
export function cellsWithin(grid: ClaimingGrid, percent: number): Set<string> {
  const floor = grid.max * (1 - Math.max(0, percent) / 100);
  const keys = new Set<string>();
  for (const cell of grid.cells) {
    if (cell.value >= floor) keys.add(gridKey(cell.years[0], cell.years[1]));
  }
  return keys;
}

/**
 * Where a cell sits on the color ramp, 0 (palest) to 1 (darkest).
 *
 * Stretched across the grid's OWN range rather than anchored at zero. Every
 * combination on the board pays a lifetime of benefits, so an absolute scale
 * renders the whole grid one shade and shows nothing; this household spans
 * 93.3% to 100% of its own maximum. The percentage printed in each cell and
 * the near-best outline are what keep the contrast from overstating the
 * differences — the color ranks, the number quantifies.
 *
 * A flat grid (every combination identical) returns 1 for every cell rather
 * than dividing by zero.
 */
export function gridRatio(grid: ClaimingGrid, value: number): number {
  const span = grid.max - grid.min;
  return span <= 0 ? 1 : (value - grid.min) / span;
}

/**
 * A cell's share of the optimum, as a percentage — what each square prints.
 *
 * Rounded DOWN to one decimal, so only the best square can print 100.0. A
 * cell 0.04% behind rounds up to 100.0 under normal rounding, and two squares
 * both claiming to be the maximum is the kind of small untruth that makes a
 * reader distrust the rest of the board. Flooring reads as "at least this
 * much", which is true of every square.
 */
export function percentOfBest(grid: ClaimingGrid, value: number): number {
  if (grid.max <= 0) return 0;
  return Math.floor((value / grid.max) * 1000) / 10;
}

/** Whether two cells name the same pair of exact filing ages. */
export function sameCellAges(cell: ClaimingGridCell, ages: readonly FilingAgeChoice[]): boolean {
  return (
    ages.length === 2 &&
    filingAgeMonths(cell.ages[0]) === filingAgeMonths(ages[0]) &&
    filingAgeMonths(cell.ages[1]) === filingAgeMonths(ages[1])
  );
}
