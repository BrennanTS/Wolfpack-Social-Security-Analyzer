/**
 * Whether Medicare Parts A and B will start without the client signing up.
 *
 * Medicare enrolls someone automatically only when their Social Security
 * payments start at least four months before they turn 65 (medicare.gov,
 * "How do I sign up for Medicare?"). The gate was "by 65", which told a
 * client starting one to three months before 65 that enrollment was automatic
 * when it is not, and the cost of believing that is a Part B penalty for life.
 *
 * Both arguments are absolute month indexes.
 */
export const MEDICARE_AUTO_LEAD_MONTHS = 4;
export function medicareStartsAutomatically(startMonth: number, sixtyFiveMonth: number): boolean {
  return startMonth <= sixtyFiveMonth - MEDICARE_AUTO_LEAD_MONTHS;
}
