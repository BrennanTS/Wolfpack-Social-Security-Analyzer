import { householdPeriods, type BenefitBand } from './benefitPeriods';
import type { HouseholdAnalysis, HouseholdStrategy } from './household';
import type { Person } from './personAnalysis';
import { createPiaRecipient } from './ssaTools';

/**
 * What every strategy is worth if Congress does nothing.
 *
 * The trust fund shortfall is the question clients bring to the meeting, and
 * a report that answers every other question about timing while ignoring this
 * one invites them to answer it themselves from a headline. It matters to the
 * decision for a real reason rather than a rhetorical one: a plan that delays
 * puts more of its money into later years, which is exactly where a reduction
 * would fall, so a cut does not scale every strategy equally.
 *
 * A WHAT-IF, never a forecast. Nobody knows what Congress will do, and every
 * sentence this feeds says so. The default is the Trustees' own projection so
 * the reader is arguing with the actuaries rather than with us.
 */

/**
 * The 2026 OASDI Trustees Report's projection for the OASI trust fund, which
 * is the one that pays retirement and survivor benefits.
 *
 * Reserves are projected to deplete in the fourth quarter of 2032, with 78%
 * of scheduled benefits payable at that point. The combined OASI and DI
 * figure often quoted — 2034 and 83% — describes a fund that does not legally
 * exist: combining them takes an act of Congress, which is the very thing
 * this page declines to predict.
 *
 * `dataVintage.ts` carries the annual alarm that brings this back for review.
 */
export const TRUSTEES_PROJECTION = {
  /** First calendar year in which benefits would be reduced. */
  fromYear: 2032,
  /** Percent of scheduled benefits payable from that year. */
  payablePercent: 78,
  report: '2026 OASDI Trustees Report',
} as const;

export interface SolvencyAssumption {
  /**
   * Whether the report prices a reduction at all.
   *
   * OFF unless an adviser turns it on, and that is a compliance position
   * rather than a default. A page that prices a benefit cut is a claim about
   * a client's future that nobody asked for, and it must never reach a
   * client because it happened to be on. Everything downstream reads this
   * one flag: `solvencySensitivity` returns null, the block renders nothing,
   * and the link parameter is absent.
   */
  enabled: boolean;
  fromYear: number;
  payablePercent: number;
}

/** Off, with the trustees' figures ready for whenever it is switched on. */
export const DEFAULT_SOLVENCY: SolvencyAssumption = {
  enabled: false,
  fromYear: TRUSTEES_PROJECTION.fromYear,
  payablePercent: TRUSTEES_PROJECTION.payablePercent,
};

/** The trustees' own projection, switched on. What the reset button restores. */
export const TRUSTEES_ASSUMPTION: SolvencyAssumption = {
  enabled: true,
  fromYear: TRUSTEES_PROJECTION.fromYear,
  payablePercent: TRUSTEES_PROJECTION.payablePercent,
};

/** Whether an assumption still carries the trustees' own figures. */
export function isTrusteesProjection(assumption: SolvencyAssumption): boolean {
  return (
    assumption.fromYear === TRUSTEES_PROJECTION.fromYear &&
    assumption.payablePercent === TRUSTEES_PROJECTION.payablePercent
  );
}

/** Bounds a stored or shared value has to fall inside to be honored. */
export const SOLVENCY_YEAR_BOUNDS = { min: 2026, max: 2100 };
export const SOLVENCY_PAYABLE_BOUNDS = { min: 1, max: 100 };

export interface SolvencyRow {
  key: string;
  label: string;
  /** What the report already scores this plan at, as scheduled. */
  full: number;
  /** The same score with benefits from `fromYear` reduced. */
  reduced: number;
}

export interface SolvencySensitivity {
  assumption: SolvencyAssumption;
  rows: SolvencyRow[];
  /** The strategy worth the most with no reduction. */
  bestFullKey: string;
  /** The strategy worth the most under the reduction. */
  bestReducedKey: string;
  /**
   * True when the reduction does not change which strategy leads.
   *
   * The finding the page exists for. It is usually true, and saying so is
   * worth more to a client than the dollar figures beside it.
   */
  sameWinner: boolean;
}

/**
 * The share of a plan's value a reduction removes.
 *
 * A ratio rather than a dollar figure, and that is the point. The total it
 * gets applied to is the engine's; the bands are ours, and the two do not
 * agree to the cent — the engine prices six months past the last band (the
 * six-month seam, `ssaTools.ts`). Measured, that gap made a straight
 * subtraction understate a 22% cut by about 1%. Taking numerator and
 * denominator from the same bands cancels it: a reduction that touches every
 * dollar returns exactly the reduction, whatever the bands are missing.
 *
 * Discounting follows the engine's convention — a monthly rate of
 * `(1 + annual) ** (1/12) - 1`, a payment `k` months after the as-of month
 * discounted by `(1 + monthly) ** -k` (`strategy-calc.ts:181` and `:195`) —
 * because a cut lands in later months, and an undiscounted share would
 * overstate what it costs a plan whose score is a present value. A rate of
 * zero gives a straight share, which is what a widowed household's score
 * wants.
 *
 * Zero when the plan pays nothing at all, so a household with no bands
 * cannot divide by zero.
 */
function cutShare(
  bands: BenefitBand[],
  fromYear: number,
  cutFraction: number,
  asOfIndex: number,
  annualDiscountRate: number,
): number {
  const monthly = annualDiscountRate === 0 ? 0 : (1 + annualDiscountRate) ** (1 / 12) - 1;
  let whole = 0;
  let cut = 0;
  for (const band of bands) {
    for (let m = band.startIndex; m <= band.endIndex; m++) {
      const value =
        monthly === 0
          ? band.monthlyAmount
          : band.monthlyAmount * (1 + monthly) ** -(m - asOfIndex);
      whole += value;
      // The band index convention: calendarYear * 12 + (month - 1).
      if (Math.floor(m / 12) >= fromYear) cut += value * cutFraction;
    }
  }
  return whole === 0 ? 0 : cut / whole;
}

/**
 * Prices every strategy twice: as scheduled, and reduced.
 *
 * The as-scheduled column is the strategy's own score, untouched — the same
 * number the comparison table prints. That is not a convenience: this page
 * exists to say whether a reduction changes the answer, and it cannot say
 * that if its own as-scheduled column ranks the plans differently from the
 * report giving the answer. Measured on a 1962/1964 couple at 2.5%, an
 * undiscounted sum here named "Both wait until 70" while the report
 * recommended a different plan on the page before.
 *
 * The reduction is then applied as a share of that score, measured on the
 * bands and discounted the same way the score was: a present value for single
 * and married households, a straight share for a widowed one, whose optimum
 * is scored in undiscounted lifetime dollars
 * (`HouseholdStrategy.lifetimeTotal`).
 *
 * The share is measured from the bands rather than by re-running the engine,
 * which has no concept of a benefit cut and cannot be given one.
 *
 * Null when the adviser has not switched the scenario on, for a household
 * with no strategies to compare, and for a payable percentage of 100, where
 * there is nothing to show.
 */
export function solvencySensitivity(
  analysis: HouseholdAnalysis,
  assumption: SolvencyAssumption = DEFAULT_SOLVENCY,
): SolvencySensitivity | null {
  if (!assumption.enabled) return null;
  if (analysis.comparisons.length === 0) return null;
  if (assumption.payablePercent >= 100) return null;

  const people: Person[] = analysis.people.map((p) => p.person);
  const recipients = people.map((p) =>
    createPiaRecipient(p.birthYear, p.birthMonth, p.piaMonthly, p.gender),
  );
  const labels = analysis.people.map((p, i) => p.person.name || (i === 0 ? 'Client' : 'Spouse'));
  const cutFraction = 1 - assumption.payablePercent / 100;
  const asOfIndex = analysis.asOf.getFullYear() * 12 + analysis.asOf.getMonth();

  const rows: SolvencyRow[] = analysis.comparisons.map((comparison: HouseholdStrategy) => {
    const { bands } = householdPeriods(
      people,
      recipients,
      comparison.filingAges.map((f) => f.monthDuration),
      labels,
    );
    // `lifetimeTotal` non-null means this household is scored in undiscounted
    // dollars and `expectedNpv` is not an NPV at all. Discounting the cut
    // against that total would mix two yardsticks inside one row.
    const undiscounted = comparison.lifetimeTotal !== null;
    const full = undiscounted ? comparison.lifetimeTotal! : comparison.expectedNpv;
    const share = cutShare(
      bands,
      assumption.fromYear,
      cutFraction,
      asOfIndex,
      undiscounted ? 0 : analysis.assumptions.discountRate,
    );
    return {
      key: comparison.key,
      label: comparison.label,
      full: Math.round(full),
      reduced: Math.round(full * (1 - share)),
    };
  });

  const bestBy = (pick: (row: SolvencyRow) => number) =>
    rows.reduce((best, row) => (pick(row) > pick(best) ? row : best), rows[0]).key;
  const bestFullKey = bestBy((r) => r.full);
  const bestReducedKey = bestBy((r) => r.reduced);

  return {
    assumption,
    rows,
    bestFullKey,
    bestReducedKey,
    sameWinner: bestFullKey === bestReducedKey,
  };
}
