/**
 * The household's lifetime value, computed from its own payment stream.
 *
 * WHY THIS EXISTS, rather than the strategy table simply printing the
 * optimizer's `expectedNpv`: the two disagree, by a known and measurable
 * amount. `planToAgeDistribution` (`ssaTools.ts`) documents it as the
 * **six-month seam** — the vendored engine buckets a death age to
 * `{years: age, months: 6}`, a yearly distribution's representative month,
 * while every horizon the app owns (the bands, `combinedTimeline`,
 * `projectedFinalMonth`) uses `{years: age, months: 0}`. So the engine prices
 * six months more per person than the app's own stream contains.
 *
 * For one couple measured against a competitor's report that was 26,016 +
 * 26,394 = $52,410 — exactly six months of each spouse's benefit, 1.95% of
 * the headline figure. Small enough to have gone unnoticed, large enough that
 * a year-by-year table printed beside it visibly fails to add up.
 *
 * That is the point. Once the report shows a per-year table and cumulative
 * charts, the headline number and the exhibits below it are read together,
 * and they must be the same arithmetic. So the displayed value is computed
 * HERE, from the same `combinedTimeline` every exhibit reads.
 *
 * It RANKS too (`rankOnPrintedValue` in `household.ts`). Leaving the ranking
 * on `expectedNpv` let the seam choose Best: its six extra months pay most
 * to whoever files latest, so a later pair could win on the engine's figure
 * while an earlier one printed higher beside it. The seam still exists
 * inside the engine and is still documented there; it no longer reaches the
 * page or the recommendation.
 *
 * COLA and the discount rate are applied with the SAME year exponent
 * (`year - asOfYear`), so the two are exact inverses of one another and a
 * household viewed in nominal dollars at a discount rate equal to its COLA
 * reads back its real undiscounted total. They stay independent knobs:
 * nominal cash flows discounted at a nominal rate is the financially correct
 * pairing, and forcing either to imply the other would make that
 * inexpressible.
 */
import { roundCents } from './benefitMath';
import type { DollarsMode } from './dollarsMode';
import type { CombinedTimelinePoint } from './household';

export interface LifetimeValueOptions {
  /** Real leaves the stream alone; nominal compounds `annualCola` onto it. */
  dollarsMode: DollarsMode;
  /** A PERCENT (2.54 means 2.54%), matching `annualCola` everywhere else. */
  annualCola: number;
  /** A FRACTION (0.025 means 2.5%), matching `discountRate` everywhere else. */
  discountRate: number;
  /** The year the household is evaluated as of — exponent zero for both factors. */
  asOfYear: number;
}

/**
 * What a payment made in `year` is worth as of `asOfYear`, discount alone.
 *
 * Exported separately from `factorFor` because a stream already stated in
 * display dollars carries its COLA in the figures themselves: the year-by-year
 * exhibit renders a timeline that `displayDollars` has already converted, so
 * discounting is the only step left to reconcile its running total with the
 * household value summed here from the real one. Two places applying the same
 * exponent, from one definition.
 */
export function discountFactor(year: number, asOfYear: number, discountRate: number): number {
  return 1 / Math.pow(1 + discountRate, year - asOfYear);
}

/**
 * The factor a single calendar year's payments carry: COLA growth if nominal,
 * divided by the discount applied for being that far away.
 */
function factorFor(year: number, opts: LifetimeValueOptions): number {
  const n = year - opts.asOfYear;
  const inflate = opts.dollarsMode === 'nominal' ? Math.pow(1 + opts.annualCola / 100, n) : 1;
  return inflate * discountFactor(year, opts.asOfYear, opts.discountRate);
}

/**
 * Sum a household's calendar-year payments into one lifetime figure.
 *
 * Reduces to a plain sum of the stream at `discountRate: 0` in real dollars,
 * which is the basis most competitor reports print, and which is why the
 * comparison preset sets exactly those two.
 */
export function householdValueFromTimeline(
  // Only the year and its total are read, so the ranking pass in
  // `household.ts` can value thousands of candidates without building the
  // keyed per-series objects the exhibits need.
  timeline: readonly Pick<CombinedTimelinePoint, 'year' | 'total'>[],
  opts: LifetimeValueOptions,
): number {
  let total = 0;
  for (const point of timeline) total += point.total * factorFor(point.year, opts);
  return roundCents(total);
}
