import {
  MAX_COLA_YEAR,
  MAX_MAXIMUM_EARNINGS_YEAR,
  MAX_WAGE_INDEX_YEAR,
  MAX_YEAR,
} from '$lib/constants';
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

/**
 * The year-keyed tables inside the VENDORED engine
 * (`src/vendor/ssa-tools/constants.ts`), which SSA republishes on its own
 * annual schedule and which nothing above tracks.
 *
 * These are a different kind of stale from the three vintages above. They are
 * not a date someone has to remember to re-check: every table states its own
 * last year (`MAX_YEAR`, `MAX_COLA_YEAR`, ...), so staleness is a fact that can
 * be read rather than attested. What was missing is anything that OBJECTS to
 * it. `CURRENT_YEAR` in that same file is `new Date().getFullYear()` — live —
 * while `MAX_YEAR` is a hardcoded literal, so the two drift apart silently on
 * January 1 and the engine quietly clamps to its last known year
 * (`earning-record.ts` returns `EARNINGS_PER_CREDIT[MAX_YEAR]` for any later
 * year).
 *
 * MITIGATING FACT, so nobody panics at a red test: this app enters a PIA
 * directly and never builds an earnings record, and a PIA-only recipient's
 * benefit is returned unchanged without consulting COLA, the wage indices or
 * the contribution base (`benefit-calculator.ts`'s "PIA-only recipients have
 * no earnings history to unwind COLAs from"). So a stale table here moves no
 * number the app displays today. It is a correctness trap waiting for the
 * first feature that reads an earnings record — which is exactly when nobody
 * will remember these tables exist.
 *
 * SSA's publication schedule, which the deadlines below encode:
 *   - COLA and the contribution base for year Y+1 are announced in mid-October
 *     of year Y (both keyed off the Q3 CPI-W release). November 1 is used as
 *     the deadline, giving a few weeks of grace.
 *   - The average wage index for year Y is published in October of Y+1, so it
 *     is always about two years behind.
 * COLA is keyed by MEASUREMENT year, not effective year: `COLA[2025]` is the
 * increase effective January 2026.
 */
export interface StaleTable {
  /** The exported constant that is behind. */
  table: string;
  /** What it currently says. */
  says: number;
  /** What it needs to cover. */
  needs: number;
  /** Why it matters, and where to fix it. */
  fix: string;
}

const SSA_SOURCE = 'https://www.ssa.gov/oact/cola/';

/**
 * Every vendored SSA table that is behind SSA's own publications as of
 * `asOf`. Empty means nothing is stale. Pure in `asOf` so the alarm can be
 * proven to fire at a future date rather than only observed not firing today.
 */
export function staleSsaTables(asOf: Date): StaleTable[] {
  const year = asOf.getFullYear();
  // getMonth() is 0-based; 10 is November.
  const afterThisYearsAnnouncement = asOf.getMonth() >= 10;
  const out: StaleTable[] = [];

  // Must at minimum cover the current calendar year, or the engine clamps
  // current-year figures to a past year's.
  if (MAX_YEAR < year) {
    out.push({
      table: 'MAX_YEAR',
      says: MAX_YEAR,
      needs: year,
      fix: `constants.ts's MAX_YEAR is behind the calendar. Add ${year}'s EARNINGS_PER_CREDIT and MAXIMUM_EARNINGS from ${SSA_SOURCE} and raise MAX_YEAR.`,
    });
  }
  if (MAX_MAXIMUM_EARNINGS_YEAR < year) {
    out.push({
      table: 'MAXIMUM_EARNINGS',
      says: MAX_MAXIMUM_EARNINGS_YEAR,
      needs: year,
      fix: `The contribution and benefit base is missing ${year}. Add it from ${SSA_SOURCE}cbb.html.`,
    });
  }
  // colaYearForDisplayDate() asks for COLA[CURRENT_YEAR - 1]; a missing key
  // there is undefined, not zero, and propagates as NaN.
  if (MAX_COLA_YEAR < year - 1) {
    out.push({
      table: 'COLA',
      says: MAX_COLA_YEAR,
      needs: year - 1,
      fix: `The COLA series is missing the increase effective January ${year} (keyed ${year - 1}). Add it from ${SSA_SOURCE}colaseries.html.`,
    });
  }
  // The AWI runs ~2 years behind by design; only complain past that.
  if (MAX_WAGE_INDEX_YEAR < year - 2) {
    out.push({
      table: 'WAGE_INDICES',
      says: MAX_WAGE_INDEX_YEAR,
      needs: year - 2,
      fix: `The average wage index is more than two years behind. Add it from https://www.ssa.gov/oact/cola/awidevelop.html.`,
    });
  }

  if (afterThisYearsAnnouncement) {
    // SSA has published next year's figures by now.
    if (MAX_YEAR < year + 1) {
      out.push({
        table: 'MAX_YEAR',
        says: MAX_YEAR,
        needs: year + 1,
        fix: `SSA announced ${year + 1}'s figures in October ${year}. Add ${year + 1}'s EARNINGS_PER_CREDIT and MAXIMUM_EARNINGS from ${SSA_SOURCE} and raise MAX_YEAR.`,
      });
    }
    if (MAX_COLA_YEAR < year) {
      out.push({
        table: 'COLA',
        says: MAX_COLA_YEAR,
        needs: year,
        fix: `SSA announced the January ${year + 1} COLA in October ${year}; it is keyed ${year}. Add it from ${SSA_SOURCE}colaseries.html.`,
      });
    }
    if (MAX_WAGE_INDEX_YEAR < year - 1) {
      out.push({
        table: 'WAGE_INDICES',
        says: MAX_WAGE_INDEX_YEAR,
        needs: year - 1,
        fix: `The average wage index for ${year - 1} was published in October ${year}. Add it from https://www.ssa.gov/oact/cola/awidevelop.html.`,
      });
    }
  }

  return out;
}

/** One line per stale table, for a test failure message. */
export function staleSsaTablesReport(asOf: Date): string {
  const stale = staleSsaTables(asOf);
  if (stale.length === 0) return 'All vendored SSA tables are current.';
  return stale
    .map((s) => `${s.table} says ${s.says}, needs >= ${s.needs}. ${s.fix}`)
    .join('\n');
}

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
