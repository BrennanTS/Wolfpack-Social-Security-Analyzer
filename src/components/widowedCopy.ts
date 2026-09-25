import type { Gender } from '../lib/lifeExpectancy';
import { pronounsFor } from '../lib/pronouns';
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
 *
 * That difference is now stated in WORDS rather than by naming the method.
 * "Mortality-weighted" and "undiscounted" told a reader who already knew the
 * terms something they could have guessed, and told everyone else nothing at
 * all — while sitting on the page a widow(er) reads. "Present value" stays,
 * because a sentence can explain it in passing and the terms page now does.
 */
export function widowedLifetimeCaption(planToAge: number): string {
  return (
    // It went on to describe the married and single tables, which a widowed
    // reader never sees, by a method they no longer use ("allows for the
    // chance of not living to receive it"). What is left is the one fact
    // this page needs.
    `Lifetime total is every dollar paid through age ${planToAge}, added up, in ` +
    `today’s dollars, before any cost-of-living adjustment.`
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
export function widowedIncomeCaption(
  mode: DollarsMode = 'real',
  overlaps = true,
  /** The survivor's gender, for the pronoun in the non-overlapping branch. */
  survivorGender: Gender | null = null,
): string {
  // Stated only when the basis is the UNUSUAL one.
  //
  // Both surfaces that render this caption render `widowedLifetimeCaption`
  // above it on the same page, and that sentence already says the page is in
  // today's dollars before any cost-of-living adjustment. Repeating it ten
  // lines later taught the reader that the second caption was not telling
  // them anything new — and this caption's real content ("the two benefits
  // are one payment, and SSA pays the larger") is the part that got buried.
  //
  // Nominal is different: it is the basis a reader has to opt into, it
  // contradicts the page's default, and it must be flagged wherever it
  // appears. Spelled out rather than "the assumed COLA", because this sits
  // under a chart and the acronym is introduced pages later.
  const dollarsClause =
    mode === 'nominal'
      ? ' Amounts are in future (nominal) dollars: today’s figures compounded forward at ' +
        'the assumed yearly cost-of-living increase, rather than today’s purchasing power.'
      : '';
  const shape = overlaps
    ? 'The survivor amount sits on top of the survivor’s own benefit and is not a second ' +
      'check: SSA pays the larger of the two benefits as one payment.'
    : 'The two benefits never run together here. SSA pays the larger, and this person’s own ' +
      'record is worth more than the survivor benefit, so the survivor benefit stops the month ' +
      `${pronounsFor(survivorGender).possessive} own begins.`;
  return `${shape}${dollarsClause}`;
}

/**
 * The deceased's PIA, when it was recovered from a check amount rather than
 * known. Null when it was entered directly — there is nothing to disclose.
 *
 * Names the year the figure is in. The recovered number carries every
 * increase the last check did, so it is in the year of the death's dollars;
 * for a death twenty years ago that gap to today is large, and the reader can
 * only judge it if the year is on the page.
 */
export function piaEstimateNote(
  deceased: DeceasedSummary,
  piaEstimated: boolean,
): string | null {
  if (!piaEstimated) return null;
  // What `deceasedPia` actually does: it solves for the full benefit that
  // reproduces the check at the filing date and removes no increase, so the
  // figure carries every cost-of-living increase paid up to that check. The
  // note used to say the opposite ("this figure includes none") and to date
  // the increases from the filing, when SSA applies them from the year a
  // person turns 62. The form now asks for the LAST check, which is paid in
  // the year of the death, so that is the year the figure is in.
  return (
    `This benefit was estimated from the last monthly check you entered, so it includes ` +
    `the cost-of-living increases paid up to that check, which means ` +
    `${formatCurrency(deceased.piaMonthly)} is in ${deceased.deathYear} dollars. Every ` +
    `survivor figure on this page follows from it.`
  );
}

export const WIDOWED_DECEASED_HEADING = 'The deceased spouse’s record';
export const WIDOWED_COMPARISON_HEADING = 'The two dates, compared';

/**
 * The widowed arm of the PDF appendix's "Modeling notes" box.
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
/**
 * The survivor benefit's own rules, which the disclosure does not state: its
 * age floor, its separate reduction schedule, and the cap that applies when
 * the deceased had already filed.
 *
 * A function of the deceased's gender rather than a constant, because the last
 * clause is about THIS household's deceased spouse and not about deceased
 * spouses generally — the two before it are rules, and stay rules.
 */
export function widowedSurvivorCard(deceasedGender: Gender | null): string {
  const p = pronounsFor(deceasedGender);
  return (
    // The widow(er)'s limit, stated the right way round. It said "capped at
    // what he was receiving", which is the opposite of the rule the rest of
    // the report explains: for an early filer the ceiling is the LARGER of
    // that and 82.5% of the full benefit, so a survivor can be paid more. For
    // a filer at or after full retirement age the larger is simply what they
    // were receiving, so one sentence is true for both.
    'A survivor benefit can start at 60 and is reduced for each month before the ' +
    'survivor’s full retirement age, which follows its own schedule. If the deceased had ' +
    `already filed, it is limited to the larger of what ${p.subject} ` +
    `${p.verb('was', 'were')} receiving and 82.5% of ${p.possessive} full benefit.`
  );
}
