/**
 * What an adviser knows about a deceased spouse, turned into what the engine
 * needs: a `Recipient` carrying a PIA, and a filing date.
 *
 * `survivorBenefit` needs the deceased's PIA and the date they filed. An
 * adviser usually knows neither precisely — what they have is "he was getting
 * $2,400 a month". So this module accepts either, and recovers a PIA from a
 * check amount by BINARY SEARCH OVER ENGINE CALLS rather than by inverting
 * SSA's reduction formula: the app computes no benefit rule, here or anywhere.
 *
 * The recovered PIA is an ESTIMATE and says so. A current check includes every
 * COLA since the deceased filed, while the engine's PIA carries none, so the
 * recovered figure is in the filing year's dollars. For a recent death the
 * error is small; for a death twenty years ago it is not. Callers must
 * propagate `estimated` to anything a client reads.
 */
import { benefitOnDate } from '$lib/benefit-calculator';
import { MonthDate, MonthDuration } from '$lib/month-time';
import type { Recipient } from '$lib/recipient';
import { createPiaRecipient } from './ssaTools';

export interface YearMonth {
  /** Calendar year. */
  year: number;
  /** 1-12, matching the app's `birthMonth` convention rather than JS's 0-11. */
  month: number;
}

export type DeceasedRecord =
  /** The precise case: a known PIA. `filed: null` means they died without filing. */
  | { kind: 'pia'; piaMonthly: number; filed: YearMonth | null }
  /** What the checks actually were. Always implies they had filed. */
  | { kind: 'checkAmount'; monthlyAmount: number; filed: YearMonth };

export interface Deceased {
  birthYear: number;
  /** 1-12. */
  birthMonth: number;
  deathYear: number;
  /** 1-12. */
  deathMonth: number;
  record: DeceasedRecord;
}

const monthDateOf = (ym: YearMonth): MonthDate =>
  MonthDate.initFromYearsMonths({ years: ym.year, months: ym.month - 1 });

/**
 * The benefit the engine would pay `piaMonthly` for a filing at `filingDate`,
 * read a year later so the January bump is included — the same convention
 * `survivorClaim.ts`'s `ownRetirementBenefit` uses, so the two cannot disagree
 * about which of the ≤11 pre-bump months they mean.
 */
function benefitFor(
  d: Deceased,
  piaMonthly: number,
  filingDate: MonthDate,
): number {
  const recipient = createPiaRecipient(d.birthYear, d.birthMonth, piaMonthly, 'male');
  return benefitOnDate(
    recipient,
    filingDate,
    filingDate.addDuration(MonthDuration.OneYear()),
  ).value();
}

/** Widest PIA bracket worth searching. SSA's maximum benefit is far below this. */
const MAX_PIA = 30_000;

/**
 * The deceased's PIA, and whether it was estimated.
 *
 * The benefit is monotonically non-decreasing in PIA, so a plain bisection
 * converges. It is also a STEP function (the engine floors to whole dollars),
 * so many PIAs map to one benefit; this returns the smallest PIA whose benefit
 * reaches the target, which round-trips a known PIA to within a dollar.
 *
 * Guards its bracket: a target the bracket's top PIA cannot reach, or a
 * negative/non-finite target, throws rather than silently returning the
 * bracket's edge dressed up as a normal estimate. Unguarded, a data-entry
 * typo (an extra digit on a check amount) would feed a fabricated PIA into
 * `survivorBenefit` for a client-facing recommendation with no signal that
 * anything was wrong. A target of exactly 0 is a legitimate case — the
 * deceased had filed but the benefit was fully offset — so it is exempt.
 */
export function deceasedPia(d: Deceased): { piaMonthly: number; estimated: boolean } {
  if (d.record.kind === 'pia') {
    return { piaMonthly: d.record.piaMonthly, estimated: false };
  }

  const filingDate = monthDateOf(d.record.filed);
  const target = d.record.monthlyAmount;

  if (!Number.isFinite(target) || target < 0) {
    throw new Error(
      `deceasedPia: check amount ${target} is not a valid monthly amount ` +
        '(must be finite and >= 0).',
    );
  }

  let lo = 0;
  let hi = MAX_PIA;

  if (target > 0) {
    const maxReachable = benefitFor(d, hi, filingDate);
    if (maxReachable < target) {
      throw new Error(
        `deceasedPia: check amount $${target}/mo exceeds the $${maxReachable}/mo the ` +
          `search bracket can reach at its top PIA of $${hi}/mo. This looks like a ` +
          'data-entry error (e.g. an extra digit on the check amount), not a real benefit.',
      );
    }
  }

  // 0.01 resolution over a 30,000 bracket needs ~22 halvings; 40 is ample and
  // still trivially fast.
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (benefitFor(d, mid, filingDate) >= target) hi = mid;
    else lo = mid;
  }
  return { piaMonthly: Math.round(hi * 100) / 100, estimated: true };
}

/**
 * Everything downstream needs about the deceased, in engine terms.
 *
 * `filingDate` EQUALS `deathDate` when they never filed. `survivorBenefit`
 * branches on `deceasedFilingDate >= deceasedDeathDate` to select its
 * unfiled path, so this equality is the documented selector for that case —
 * not a sentinel this module invented.
 *
 * Gender is irrelevant for a deceased recipient: it selects a life table, and
 * no mortality distribution is drawn for someone whose death date is an input.
 * 'male' is passed as an arbitrary constant rather than collected from the
 * adviser, who should not be asked for a fact that changes no output.
 */
export function deceasedContext(d: Deceased): {
  recipient: Recipient;
  filingDate: MonthDate;
  deathDate: MonthDate;
  piaEstimated: boolean;
} {
  const { piaMonthly, estimated } = deceasedPia(d);
  const deathDate = MonthDate.initFromYearsMonths({
    years: d.deathYear,
    months: d.deathMonth - 1,
  });
  const filingDate =
    d.record.kind === 'checkAmount'
      ? monthDateOf(d.record.filed)
      : d.record.filed === null
        ? deathDate
        : monthDateOf(d.record.filed);

  return {
    recipient: createPiaRecipient(d.birthYear, d.birthMonth, piaMonthly, 'male'),
    filingDate,
    deathDate,
    piaEstimated: estimated,
  };
}
