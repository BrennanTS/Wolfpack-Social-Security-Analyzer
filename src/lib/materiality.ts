/**
 * How far ahead a strategy must be before a page in this report calls it the
 * winner.
 *
 * Half a percent of a lifetime total is a few thousand dollars across thirty
 * years — below the precision of every assumption feeding it, and below what
 * the tables themselves print. Leading by less is not a reason to choose.
 *
 * Its own module because two pages now answer a "does the answer change"
 * question and both have to answer it the same way. The longevity page has
 * used it since it was written; the reduction page did not, and would name a
 * different winner under a cut on any margin at all — for the couple in
 * `solvency.test.ts` it flipped its verdict on $3,046 of $627,000, and the
 * reassuring verdict it gave before that was itself decided by $444. A reader
 * cannot tell those apart from the sentence, which is the whole reason a
 * threshold exists rather than a strict comparison.
 *
 * One number, one meaning: a second constant at the same value would drift
 * the first time either page was tuned.
 */
export const MATERIAL_MARGIN = 0.005;

/**
 * How far the leader is ahead of the runner-up, as a fraction of the leader.
 *
 * Zero for a set where nothing is ahead, and for a leader at or below zero —
 * a margin measured against a non-positive base is not a proportion, and
 * calling it immaterial is the safe reading.
 */
export function leadMargin(values: readonly number[]): number {
  if (values.length < 2) return Infinity;
  const sorted = [...values].sort((a, b) => b - a);
  return sorted[0] <= 0 ? 0 : (sorted[0] - sorted[1]) / sorted[0];
}
