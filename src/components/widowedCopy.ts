import type { DollarsMode } from '../lib/dollarsMode';
import { formatCurrency } from '../lib/format';
import type { DeceasedSummary } from '../lib/household';

/**
 * Every sentence the widowed surfaces print, in one place, for the same
 * reason `methodologyCopy.ts` exists: the on-screen panel and the PDF page
 * are twins, and a sentence hand-maintained in two files is how they drift.
 *
 * Kept beside `methodologyCopy` rather than inside it because that file is
 * already 780 lines of married-and-single copy and shares none of these
 * inputs — the same reason `widowedForm.ts` was split out of `formState.ts`.
 *
 * NOTHING here repeats `analyzeWidowed`'s `recommendationDetail`, which
 * already carries the load-bearing sentence about deemed filing and the two
 * independent dates. The sweep checks one surface for duplicate sentences,
 * and the recommendation card sits directly above every one of these.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthYear(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

/** Column headers for the widowed comparison table, on both surfaces. */
export const WIDOWED_HEADERS = {
  strategy: 'Strategy',
  survivorAge: 'Survivor benefit at',
  ownAge: 'Own record at',
  /**
   * NOT "Combined PV". A widowed row's score is an undiscounted sum of every
   * dollar paid, and the married and single tables' "Combined PV" is a
   * mortality-weighted expected present value. Printing a lifetime sum under
   * that header — which this app did until now — states one quantity and
   * shows another.
   */
  lifetime: 'Lifetime total',
  delta: 'vs. best',
} as const;

/**
 * Why the money column is not the one the other tables show.
 *
 * A reader who has seen a married report will compare these figures with
 * that one's, and they are not comparable: a lifetime sum through the plan-to
 * age is strictly larger than a mortality-weighted present value of the same
 * stream. Saying so is cheaper than being asked.
 */
export function widowedLifetimeCaption(planToAge: number): string {
  return (
    `Lifetime total is a straight sum of every dollar paid through age ${planToAge}, in ` +
    `today’s dollars — undiscounted, and before any cost-of-living adjustment. It is not ` +
    `the mortality-weighted present value the married and single tables show, and the two ` +
    `figures are not comparable.`
  );
}

/**
 * The chart's caption. Its own, not the couple version — a widow(er) has no
 * spousal segment.
 *
 * `overlaps` is load-bearing, not decoration. The increment sentence describes
 * a survivor segment stacked ON a personal band; when this person's own
 * benefit is the larger the engine ends the survivor band the month their own
 * starts, the two never share a month, and there is no band beneath to be an
 * increment of. Same conditional-caption problem `combinedIncomeCaption`
 * already handles for a survivor gap.
 */
export function widowedIncomeCaption(mode: DollarsMode = 'real', overlaps = true): string {
  const dollarsClause =
    mode === 'nominal'
      ? 'Amounts are in future (nominal) dollars — the engine’s own today’s-dollars figures, ' +
        'compounded forward using the assumed COLA — not today’s purchasing power.'
      : 'Amounts are in today’s dollars, before any cost-of-living adjustment.';
  const shape = overlaps
    ? 'The survivor segment is the increment above the personal band beneath it, not a second ' +
      'cheque: the two benefits are one payment, and SSA pays the larger.'
    : 'The two benefits never run together here — SSA pays the larger, and this person’s own ' +
      'record is worth more than the survivor benefit, so the survivor benefit stops the month ' +
      'their own begins.';
  return `${shape} ${dollarsClause}`;
}

/**
 * The deceased's PIA, when it was recovered from a check amount rather than
 * known. Null when it was entered directly — there is nothing to disclose.
 *
 * Names the year the figure is in. A cheque carries every cost-of-living rise
 * since they filed and the engine's PIA carries none, so the recovered number
 * is in the filing year's dollars; for a filing twenty years ago that gap is
 * large, and the reader can only judge it if the year is on the page.
 */
export function piaEstimateNote(
  deceased: DeceasedSummary,
  piaEstimated: boolean,
): string | null {
  if (!piaEstimated) return null;
  const basis = deceased.filed
    ? `${formatCurrency(deceased.piaMonthly)} is in ${deceased.filed.year} dollars`
    : `${formatCurrency(deceased.piaMonthly)} carries no cost-of-living adjustment`;
  return (
    `This benefit was worked back from the monthly cheque you entered, so it is an ` +
    `estimate: a cheque includes every cost-of-living rise since they filed and this ` +
    `figure includes none, which means ${basis}. Every survivor figure on this page ` +
    `follows from it.`
  );
}

export const WIDOWED_DECEASED_HEADING = 'The deceased spouse’s record';
export const WIDOWED_COMPARISON_HEADING = 'The two dates, compared';

/**
 * The widowed arm of the PDF's "Important Disclosures" block.
 *
 * `SINGLE_CLAIMANT_BENEFIT_NOTE` is actively wrong here — it says survivor
 * benefits are not modeled, which for this report is the opposite of the
 * truth, and it is the note a widowed report would have carried while
 * `hasSpouse` was a boolean.
 */
export const WIDOWED_MODELING_NOTE =
  'Both benefits are modeled: this person’s own retirement benefit and a survivor benefit ' +
  'on the deceased spouse’s record. Deemed filing does not apply to survivor benefits, so ' +
  'the two dates are chosen independently, and SSA pays the larger of the two each month.';

/**
 * The methodology grid's survivor card.
 *
 * A DIFFERENT sentence from `WIDOWED_MODELING_NOTE`, which is what the
 * disclosure block on the same physical page carries. Both slots held that
 * constant at first, and the sweep found it on its first widowed run — the
 * same verbatim-duplicate-in-consecutive-blocks shape this project has
 * shipped before. The married report has the same two slots and puts
 * `spousalSummary` in one and `coupleModelingNote` in the other; these are
 * the widowed equivalents.
 *
 * States the survivor benefit's own rules, which the disclosure does not: its
 * age floor, its separate reduction schedule, and the cap that applies when
 * the deceased had already filed.
 */
export const WIDOWED_SURVIVOR_CARD =
  'A survivor benefit is payable from age 60, reduced for each month claimed before the ' +
  'survivor full retirement age, which follows a different schedule from the retirement ' +
  'one. Where the deceased had already filed, it is capped at what they were receiving.';
