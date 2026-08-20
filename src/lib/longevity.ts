import { analyzeHousehold, type Assumptions, type Household } from './household';
import type { Person } from './personAnalysis';
import type { ScenarioSet } from './scenario';

/**
 * How far either side of the plan-to age the sensitivity runs.
 *
 * Ten years, which is what SSAnalyzer and RSSA both use, and the number is
 * doing real work rather than being round: a decade is roughly the spread
 * between the 25th and 75th percentile of remaining life at 65, so the three
 * rows bracket most of where the answer actually lands.
 */
export const LONGEVITY_SPREAD_YEARS = 10;

/**
 * How far ahead a strategy must be before the page calls it the winner.
 *
 * Half a percent of a lifetime total is a few thousand dollars across thirty
 * years — below the precision of every assumption feeding it, and below what
 * the table itself prints. Leading by less is not a reason to choose.
 */
export const MATERIAL_MARGIN = 0.005;

/** The lowest plan-to age worth pricing. Below it nobody has filed yet. */
const FLOOR_AGE = 70;
const CEILING_AGE = 100;

export interface LongevityRow {
  /** "If you live 10 years less", and so on — the row's own label. */
  label: string;
  /** Plan-to age used for each person, in display order. */
  ages: number[];
  /** Lifetime value of each strategy, keyed by comparison row key. */
  valueByKey: Record<string, number>;
  /** The strategy key with the highest value in this row. */
  bestKey: string;
  /** True for the row built on the ages the report is actually using. */
  isPlanned: boolean;
}

export interface LongevitySensitivity {
  rows: LongevityRow[];
  /** Strategy keys and labels, in the order the comparison table shows them. */
  strategies: { key: string; label: string }[];
  /**
   * Strategies the planned run shows but that some other lifespan folds into
   * a neighbor, so they cannot be compared across rows. Named rather than
   * silently dropped — a table that quietly loses a column reads as complete.
   */
  droppedKeys: string[];
  /**
   * A strategy that leads every row by a margin worth acting on. The whole
   * point of the page: one that leads whatever the lifespan can be chosen
   * without having to be right about longevity, which is a far stronger
   * thing to tell a client than a single figure.
   *
   * Null when no strategy leads every row, and ALSO null when one leads them
   * all by less than `MATERIAL_MARGIN` — see `tiedEveryRow`.
   */
  winsEveryRow: string | null;
  /**
   * Set when the top two are within `MATERIAL_MARGIN` of each other in every
   * row. A verdict naming a winner while two figures on the page print the
   * same number is the kind of small untruth that makes a reader stop
   * trusting the rest of it — and "these are level, choose on other grounds"
   * is the more useful thing to say anyway.
   */
  tiedEveryRow: boolean;
}

/**
 * `household` with each person's plan-to age replaced.
 *
 * Switched on `status` rather than spread, because `people` is a
 * status-specific tuple: a `.map` widens `[Person, Person]` to `Person[]` and
 * the union stops accepting it. The switch also means a fourth status becomes
 * a type error here rather than a silent fallthrough — the same reason
 * `householdDisplayShape` is exhaustive.
 */
function withLifeExpectancies(household: Household, ages: readonly number[]): Household {
  const at = (i: number, p: Person): Person => ({ ...p, lifeExpectancy: ages[i] });
  switch (household.status) {
    case 'single':
      return { ...household, people: [at(0, household.people[0])] };
    case 'married':
      return { ...household, people: [at(0, household.people[0]), at(1, household.people[1])] };
    case 'widowed':
      return { ...household, people: [at(0, household.people[0])] };
  }
}

/** The three plan-to ages to price, given the ages the report is built on. */
export function longevityAges(planned: readonly number[]): number[][] {
  const shift = (delta: number) =>
    planned.map((age) => Math.min(CEILING_AGE, Math.max(FLOOR_AGE, age + delta)));
  return [shift(-LONGEVITY_SPREAD_YEARS), [...planned], shift(LONGEVITY_SPREAD_YEARS)];
}

function rowLabel(index: number, ages: number[], planned: readonly number[]): string {
  if (index === 1) return `As planned — ${ages.join(' and ')}`;
  // Named by the ages rather than by "10 years less", because the floor and
  // ceiling can clamp a shift to something other than ten and a label that
  // said ten would then be wrong.
  const direction = index === 0 ? 'shorter' : 'longer';
  const same = ages.every((a, i) => a === planned[i]);
  return same ? `Same again — ${ages.join(' and ')}` : `Much ${direction} — ${ages.join(' and ')}`;
}

/**
 * Prices every strategy at three different lifespans.
 *
 * The report commits to one plan-to age and derives every figure from it,
 * which is honest but leaves the obvious question unanswered. Three re-runs
 * answer it, and they are cheap — the whole sensitivity costs about 50ms for
 * a couple, because `analyzeHousehold` already returns a value for every
 * strategy on each run. The expensive version of this page would price each
 * lifespan pair separately; this one gets the same table for a twentieth of
 * the work.
 *
 * Deliberately re-runs the WHOLE analysis rather than rescaling the bands: a
 * different horizon changes which strategy the optimizer picks, when a
 * survivor benefit starts, and how long it is paid, and none of that survives
 * a multiplication.
 */
export async function longevitySensitivity(
  household: Household,
  assumptions: Assumptions,
  asOf: Date,
  scenarios?: ScenarioSet,
): Promise<LongevitySensitivity | null> {
  const planned = household.people.map((p) => p.lifeExpectancy);
  if (planned.length === 0) return null;

  const variants = longevityAges(planned);
  const analyses = await Promise.all(
    variants.map((ages) =>
      analyzeHousehold(
        // `people` is a fixed-length tuple; mapping widens it, so the shape
        // is rebuilt rather than spread.
        withLifeExpectancies(household, ages),
        assumptions,
        asOf,
        scenarios,
      ),
    ),
  );

  const planIndex = 1;
  const priced = analyses.map((analysis) => {
    const valueByKey: Record<string, number> = {};
    for (const comparison of analysis.comparisons) {
      valueByKey[comparison.key] = comparison.expectedNpv;
    }
    return valueByKey;
  });

  // Columns are the strategies priced in EVERY row, ordered as the planned
  // run's table orders them.
  //
  // The list cannot simply be the planned run's, because a comparison row
  // that resolves to the same filing ages as another is folded into it —
  // "Both delay to 70" disappears for a household whose optimum IS 70/70 —
  // and which rows collapse depends on the horizon. A column missing a cell
  // in one row would print as a gap, and worse, would win rows by absence.
  const strategies = analyses[planIndex].comparisons
    .filter((c) => priced.every((row) => row[c.key] !== undefined))
    .map((c) => ({ key: c.key, label: c.label }));

  const droppedKeys = analyses[planIndex].comparisons
    .filter((c) => !priced.every((row) => row[c.key] !== undefined))
    .map((c) => c.label);

  const rows = priced.map((valueByKey, i) => ({
    label: rowLabel(i, variants[i], planned),
    ages: variants[i],
    valueByKey,
    bestKey: strategies.reduce(
      (best, s) => (valueByKey[s.key] > (valueByKey[best] ?? -Infinity) ? s.key : best),
      strategies[0]?.key ?? '',
    ),
    isPlanned: i === planIndex,
  }));

  const first = rows[0]?.bestKey ?? null;
  const leadsEveryRow = first !== null && first !== '' && rows.every((r) => r.bestKey === first);

  // The runner-up in each row, and how far behind it is.
  const closest = (row: (typeof rows)[number]) => {
    const best = row.valueByKey[row.bestKey];
    const others = strategies.filter((s) => s.key !== row.bestKey).map((s) => row.valueByKey[s.key]);
    if (others.length === 0 || best <= 0) return Infinity;
    return (best - Math.max(...others)) / best;
  };
  const materialEverywhere = rows.every((r) => closest(r) >= MATERIAL_MARGIN);

  return {
    rows,
    strategies,
    droppedKeys,
    winsEveryRow: leadsEveryRow && materialEverywhere ? first : null,
    tiedEveryRow: leadsEveryRow && !materialEverywhere,
  };
}
