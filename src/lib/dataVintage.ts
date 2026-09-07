import { getCpiLast30Years } from './cpiHistory';

/**
 * How old the rules and the data behind every figure are.
 *
 * Three things go stale on their own schedule and none of them fails a test
 * when it does: the Social Security rules the app applies, the SSA period
 * life table it suggests planning ages from, and the BLS price series the
 * COLA assumption is drawn from. This is the one place their vintage is
 * stated, so the report can print it and a test can object to it.
 *
 * `dataVintage.test.ts` fails from the first of January until each of these
 * has been looked at again. That is deliberate: a stale figure printed under
 * a firm's name is worse than a red test in the new year.
 */
export const DATA_VINTAGE = {
  /**
   * The date the rules in this app were last checked against SSA's own
   * published figures: the FRA schedule, the early-filing reduction and
   * delayed-credit rates, the survivor reduction schedule, the earnings-test
   * treatment, and the $255 lump-sum death payment. Update after checking,
   * not before.
   */
  rulesVerified: '2026-09-07',
  /** The SSA period life table the suggested planning ages come from. */
  lifeTableYear: 2021,
} as const;

/** The vintage line printed on the report, in one sentence. */
export function dataVintageLine(): string {
  const cpi = getCpiLast30Years();
  const verified = new Date(`${DATA_VINTAGE.rulesVerified}T00:00:00`);
  const when = verified.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return (
    `Social Security rules as verified on ${when}. Planning ages from the SSA ` +
    `${DATA_VINTAGE.lifeTableYear} period life table. Price history from BLS CPI-U ` +
    `${cpi.startYear} to ${cpi.endYear}.`
  );
}
