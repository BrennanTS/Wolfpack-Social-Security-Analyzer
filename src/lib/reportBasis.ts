/**
 * How the report states every total: what the money is worth today, or how
 * many dollars change hands.
 *
 * ONE SETTING, AND IT IS PRESENTATIONAL. This used to be two — a dollars
 * toggle and a discount rate — with the basis derived from both, which had
 * two faults. Setting the dollars alone produced a pair neither name
 * described, so the control showed nothing selected and the panel had to
 * explain a state it could not display. And choosing a basis rewrote the
 * discount rate, which the optimizer reads: picking how a figure was WORDED
 * could change which filing ages the report recommended.
 *
 * So the two are separated by what they actually are:
 *
 *   - The discount rate is a PLANNING ASSUMPTION. It says what this household
 *     thinks a dollar in 2045 is worth today, it always drives the
 *     recommendation, and nothing on this switch touches it.
 *   - The basis is a PRESENTATION choice. Present value states figures in
 *     today's money at that rate. Future value states the same analysis as
 *     the dollars that change hands — inflated by COLA, undiscounted.
 *
 * The recommendation is identical either way. Only the numbers printed beside
 * it move, which is what a reader switching between them expects.
 *
 * Still derived from `dollarsMode` rather than stored beside it, so there is
 * no second piece of state to fall out of step and a share link needs no new
 * parameter — `dollars` already carries it.
 */
import type { DollarsMode } from './dollarsMode';

/** Exactly two, and one of them is always true of any report. */
export type ReportBasis = 'present' | 'future';

/**
 * Kept as a name because layouts, copy and tests all say "named basis", and
 * because a third value was a real possibility until this file stopped
 * deriving the basis from two settings at once.
 */
export type NamedBasis = ReportBasis;

export function basisOf(dollarsMode: DollarsMode): ReportBasis {
  return dollarsMode === 'nominal' ? 'future' : 'present';
}

export function dollarsModeFor(basis: ReportBasis): DollarsMode {
  return basis === 'future' ? 'nominal' : 'real';
}

/**
 * The discount rate the DISPLAYED figures carry, which is not always the one
 * the analysis was run at.
 *
 * Future value means the dollars that change hands, so nothing is discounted
 * out of them — the rate is zero for display no matter what the assumption
 * says. The assumption itself is untouched and still ranks the strategies.
 *
 * Every surface that restates figures reads this rather than deciding for
 * itself: the strategy table, the claiming grid, the two sensitivity pages
 * and the year-by-year exhibit all have to agree about what "future value"
 * means, and they agreed by coincidence for exactly as long as one of them
 * was not looking.
 */
export function displayDiscountRate(dollarsMode: DollarsMode, assumed: number): number {
  return dollarsMode === 'nominal' ? 0 : assumed;
}

export const BASIS_LABEL: Record<ReportBasis, string> = {
  present: 'Present value',
  future: 'Future value',
};
