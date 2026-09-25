/**
 * Copy for the report's client-facing half.
 *
 * Separate from `methodologyCopy` because the two are written to different
 * readers and the difference is the whole point. Four rules produced
 * every sentence here:
 *
 *  - Second person. "You file at 70", not "Client files at age 70".
 *  - No term the reader would have to look up. Present value, discounted,
 *    optimizer, mortality-weighted, PIA and FRA are all barred from these
 *    pages; each appears once, defined, on the terms page.
 *  - Every figure carries a unit and a horizon — a month, a year, over your
 *    lifetimes.
 *  - Caveats move, they do not vanish. The assumptions page keeps the exact
 *    wording the current report uses.
 *
 * A test asserts the second rule mechanically against everything exported
 * here, because it is the one that erodes silently.
 */
import type { DollarsMode } from '../../lib/dollarsMode';


/* ------------------------------------------------------------------ *
 * Page 1 — the answer
 * ------------------------------------------------------------------ */

export const ANSWER_TITLE = 'Your Social Security decision';

/**
 * The caption over the headline figure, in whichever basis it is printed.
 *
 * It was a constant saying "in today's money", which stayed on the page when
 * the report was switched to future value and every figure under it was
 * restated: page one then described a discounted figure over an undiscounted
 * sum. The two bases are different quantities, so they get different names:
 * a present value is a lifetime VALUE, a future-dollar figure is a TOTAL.
 */
export function lifetimeCaption(dollarsMode: DollarsMode, hasSpouse: boolean): string {
  return dollarsMode === 'nominal'
    ? `Total paid over your ${hasSpouse ? 'lifetimes' : 'lifetime'}, in future dollars`
    : 'Lifetime value of your benefits, in today’s dollars';
}

/**
 * The line under the headline figure.
 *
 * Measured against the WORST plan on the table and named after it, rather
 * than against "claiming as early as you can" — that plan is not always on
 * the table. A comparison row that resolves to the same filing ages as
 * another is folded into it, so the earliest row is missing from exactly the
 * households whose optimum is early, and a sentence naming it would then
 * compare against something the reader cannot find.
 */
export function versusWorstNote(gain: number, formatted: string, worstLabel: string): string | null {
  if (gain <= 0) return null;
  return `${formatted} more than “${worstLabel}”`;
}

export const CHANGE_TABLE_TITLE = 'What changes, and when';

/**
 * The note under the table of changes.
 *
 * The table is built from the engine's bands (`incomeChanges` reads
 * `analysis.periods`), which the report-basis restatement does not touch, so
 * its monthly amounts are in today's dollars in BOTH bases. In future value
 * that makes this table the exception on its page, and an exception has to
 * say so. "Most years", not "each year": some years carry no increase.
 */
export function changeTableNote(dollarsMode: DollarsMode): string {
  return dollarsMode === 'nominal'
    ? 'Amounts are what arrives each month once each change takes effect, in today’s ' +
        'dollars. Unlike the lifetime figures, they leave out the yearly increases.'
    : 'Amounts are what arrives each month once each change takes effect, in today’s ' +
        'dollars. Social Security raises them most years to keep pace with prices.';
}

/* ------------------------------------------------------------------ *
 * Survivor page
 * ------------------------------------------------------------------ */

export const SURVIVOR_TITLE = 'What the one left behind receives';

export const SURVIVOR_INTRO =
  'When one of you dies, the survivor receives the larger of your two benefits, not both. ' +
  'The later the higher earner claims, the larger that benefit is, for every year the ' +
  'survivor lives. A lifetime total on its own cannot show this.';

/**
 * How much better the chosen plan leaves the survivor, and for how long.
 *
 * The duration clause is dropped below a year. On the ages in this report the
 * two people can die within months of each other, and "for about 0 years"
 * turns the strongest argument on the page into an argument for nothing.
 */
export function survivorGainNote(gain: string, worstLabel: string, years: number): string {
  const lead = `${gain} a year more than “${worstLabel}”`;
  if (years < 1) {
    return (
      `${lead}, for every year the survivor lives on. On the ages in this report they ` +
      'die within a year of each other, so the difference barely arises. It is still ' +
      'worth weighing, because those ages are the least certain part of this report.'
    );
  }
  return `${lead}, for about ${years} years on the ages in this report.`;
}

export const SURVIVOR_CHART_CAPTION =
  'Household income in the first full year after the first death, under each plan.';

/* ------------------------------------------------------------------ *
 * Longevity page
 * ------------------------------------------------------------------ */

export const LONGEVITY_TITLE = 'What if we are wrong about how long you live';

export function longevityIntro(hasSpouse: boolean): string {
  return (
    'Every figure in this report rests on the ages you chose to plan to. Nobody knows ' +
    'those ages. This page prices the same comparison three ways: as planned, and if ' +
    `${hasSpouse ? 'you both live' : 'you live'} about ten years less or ten years more.`
  );
}

export function longevityVerdict(winnerLabel: string | null, tied = false): string {
  if (winnerLabel === null && tied) {
    return (
      'The leading plans are within half a percent of each other however long you live, ' +
      'which is less than the assumptions behind them can support. At a gap this small, ' +
      'other things, such as when you plan to stop working, may matter more than these figures.'
    );
  }
  if (winnerLabel === null) {
    return (
      'No single plan wins in all three cases. Which one suits you depends on how long ' +
      'you expect to live, and on how much it would matter to run short late in life. ' +
      'Talk this one through with your adviser.'
    );
  }
  return `“${winnerLabel}” pays the most at all three lifespans tested.`;
}

export function longevityDroppedNote(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  const list = labels.join(', ');
  return (
    `Not shown: ${list}. At one of these lifespans that plan turns out to be the same ` +
    'set of filing dates as another, so there is nothing separate to compare.'
  );
}

/* ------------------------------------------------------------------ *
 * Action plan
 * ------------------------------------------------------------------ */

export const ACTION_TITLE = 'Your action plan';

export const ACTION_INTRO =
  'Nothing here happens by itself. Social Security pays benefits from the month you ' +
  'ask for them, not from the month you become eligible.';

/** Said once, in the intro — not repeated on every filing row. */
export const ACTION_APPLY_NOTE =
  'Apply about three months before you want payments to start. You can apply online at ' +
  'ssa.gov, by phone at 1-800-772-1213, or at a local Social Security office. Call first ' +
  'for an appointment. Survivor benefits cannot be applied for online. Apply by phone or ' +
  'in person.';

/**
 * Savvy's report is the only one of the six that tells the client what
 * happens AFTER applying. The award letter is where a wrong start month is
 * caught cheaply; a year later it is an argument.
 */
export const ACTION_VERIFY_STEP =
  'When your award letter arrives, check that the amount and the start month match ' +
  'this plan. Anything wrong is much simpler to fix before the first payment.';

/**
 * The row that has nothing to do with Social Security and belongs here more
 * than most of the others.
 *
 * Almost everyone who delays Social Security still has to take Medicare at
 * 65, and the Part B penalty for missing that window is permanent. It is the
 * most expensive mistake a client following this report can make, and until
 * now no page mentioned it.
 *
 * Two versions, because the fact that matters is different in each: a client
 * already receiving Social Security at 65 is enrolled for them, and one who
 * is not has to act.
 */
export const ACTION_MEDICARE_MANUAL =
  'Sign up for Medicare yourself. It is automatic only when Social Security payments start ' +
  'at least four months before you turn 65. Part B costs more for life if you sign up late, ' +
  'unless you are covered by an employer plan through current work.';

export const ACTION_MEDICARE_AUTOMATIC =
  'Medicare starts on its own, because you will already be receiving Social Security. Watch ' +
  'for the card, and check that Part B is what you want before it begins.';

export const ACTION_CHECK_EARNINGS =
  'Check your earnings record at ssa.gov/myaccount. A missing year can lower your benefit, ' +
  'and it is easier to correct now than later.';

/**
 * Both conditional facts are stated as conditional. A spousal benefit is
 * converted to a survivor benefit by SSA once the death is reported, so "does
 * not start on its own" was untrue for some survivors; and the $255 is payable
 * to a spouse who lived with the deceased or is eligible on their record, so
 * it is not simply "due".
 */
export const ACTION_DEATH_STEP =
  'Report the death to Social Security. If the survivor benefit does not start on its ' +
  'own, apply for it. A one-time $255 lump-sum death payment may also be payable to the ' +
  'surviving spouse, and must be claimed within two years.';

/**
 * The death step for a household where the death has already happened.
 *
 * `ACTION_DEATH_STEP` is written forward, for a couple planning against a
 * death neither has had. A widow(er) needs the same facts in the past tense
 * and needs them MORE: the survivor benefit still does not start on its own,
 * and the lump sum still expires. The two-year limit is stated against the
 * date of death rather than left vague, because a reader has to be able to
 * work out whether it has already run out.
 */
export const ACTION_WIDOWED_DEATH_STEP =
  'If you have not already done so, report the death to Social Security and ask about the ' +
  'survivor benefit, which may not start on its own. A one-time $255 lump-sum death ' +
  'payment may also be payable to you, and it must be claimed within two years of the ' +
  'death.';

export const ACTION_REVIEW_NOTE =
  'Review this once a year, and sooner if your health, your marriage, or your plans for ' +
  'work change.';

/* ------------------------------------------------------------------ *
 * If benefits are reduced
 * ------------------------------------------------------------------ */

export const SOLVENCY_TITLE = 'What if benefits are reduced';

/**
 * The strip above the title, marking the page as a scenario.
 *
 * This page is off unless an adviser switches it on, and it is the only page
 * in the report that prices something that has not happened. It says so in
 * its own words, on its own line, before the title — so nobody reaches the
 * figures thinking they are being told what their benefit will be.
 */
export const SOLVENCY_SCENARIO_BANNER =
  'OPTIONAL SCENARIO, TURNED ON FOR THIS REPORT';

/** The same warning where a reviewer checks what was assumed. */
/** The same words wherever the scenario is flagged, so it reads as one thing. */
export const SOLVENCY_SCENARIO_HEADING = SOLVENCY_SCENARIO_BANNER;

/**
 * The line on the answer page, where the reader's eye already is.
 *
 * Not on the cover, which is the page nobody reads twice, and not only on the
 * scenario's own page, which announces itself to whoever reaches it and to
 * nobody else. This is the page an adviser opens to check the answer, so it
 * is where they will notice what they left switched on.
 *
 * Second clause first in importance: the headline figure beside it is at
 * scheduled benefits, and a reader who half-remembers a reduction being
 * mentioned must not wonder whether this number already carries one.
 */
export function solvencyAnswerNote(assumption: {
  fromYear: number;
  payablePercent: number;
}): string {
  return (
    `An optional scenario is switched on: benefits reduced to ${assumption.payablePercent}% ` +
    `of scheduled from ${assumption.fromYear}. It adds one page and changes nothing on this one.`
  );
}

/**
 * What the assumptions page says about the scenario.
 *
 * The banner on the page itself is unmissable to anyone who reaches that
 * page, and useless to anyone who does not. This is the line for the reader
 * who checks what was assumed rather than reading front to back: an adviser
 * looking for what they left switched on, or a compliance reviewer asking
 * whether a hypothetical leaked into the numbers.
 *
 * The second sentence is the one that matters. The fear a switched-on
 * scenario creates is not that the extra page exists, it is that it moved
 * everything else, and it does not.
 */
export function solvencyAssumptionNote(assumption: {
  fromYear: number;
  payablePercent: number;
}): string {
  return (
    `This report prices a reduction to ${assumption.payablePercent}% of scheduled benefits ` +
    `from ${assumption.fromYear}, on the “${SOLVENCY_TITLE}” page. Every other figure in ` +
    'this report is at scheduled benefits, unchanged by it.'
  );
}

/**
 * The question clients bring to the meeting, answered with their own numbers.
 *
 * Stated as the trustees state it and attributed to them, so a reader is
 * weighing an actuary's projection rather than our opinion. It says twice
 * that nobody knows what Congress will do, because the failure mode of a page
 * like this is a client reading a prediction into it.
 */
export function solvencyIntro(
  trustees: { fromYear: number; payablePercent: number; report: string },
  priced: { fromYear: number; payablePercent: number },
): string {
  // The projection and the figures this page used are stated separately, and
  // always both. An adviser may price a different reduction; attributing
  // their number to the trustees would put words in an actuary's mouth.
  const attribution =
    `Social Security is paid from a trust fund that is projected to run short. The ` +
    `${trustees.report} expects the retirement fund's reserves to be used up in ` +
    `${trustees.fromYear}, with about ${trustees.payablePercent}% of scheduled benefits ` +
    `payable from then on if the law does not change. Congress has changed the program ` +
    `before when it faced a shortfall. Nobody knows whether it will this time, or how.`;
  const used =
    priced.fromYear === trustees.fromYear && priced.payablePercent === trustees.payablePercent
      ? `This page prices your plans on that projection, so the question is answered with your ` +
        `own figures rather than a headline.`
      : `This page prices your plans on a different assumption, chosen by your adviser: ` +
        `${priced.payablePercent}% of scheduled benefits from ${priced.fromYear} onward.`;
  return `${attribution} ${used}`;
}

/**
 * What the two columns are, in whichever dollars the report is stated in.
 *
 * It said "in today's money" unconditionally, which was wrong twice over: the
 * left column was the engine's `expectedNpv` rather than the figure the
 * comparison table prints, and a report in future dollars said "today's"
 * under a column of inflated figures.
 */
export function solvencyTableCaption(dollarsMode: DollarsMode): string {
  const basis =
    dollarsMode === 'nominal'
      ? 'in future dollars, as they would be received'
      : 'in today’s dollars';
  return (
    `The left column is the same lifetime figure the comparison table gives each plan, ` +
    `${basis}. The right column is that figure with benefits reduced from the year above, ` +
    `and nothing else changed. Read the gap between the two columns, and the order of the rows ` +
    `within each one.`
  );
}

/**
 * Whether the reduction changes the answer, which is the point of the page.
 *
 * Three answers, not two. "It changes" and "it does not" are the ones the
 * figures can support when the gap is real; when the reduced column's top two
 * are within `MATERIAL_MARGIN`, neither is honest, and the page says so
 * rather than picking the one the arithmetic happens to land on. The
 * longevity page has answered its own version of this question in three ways
 * since it was written.
 */
export function solvencyVerdict(
  sameWinner: boolean,
  fullLabel: string,
  reducedLabel: string,
  tooCloseToCall = false,
): string {
  if (tooCloseToCall) {
    return (
      `Under a reduction, “${reducedLabel}” and “${fullLabel}” come within half a percent of ` +
      `each other. That is too small to rely on, given how uncertain any change to the law is. ` +
      `Read this as the two being level if benefits are cut, not as a reason to change plan. ` +
      `“${fullLabel}” pays the most as things stand.`
    );
  }
  if (sameWinner) {
    return (
      `“${fullLabel}” pays the most either way. A reduction of this size does not change ` +
      `which plan is best for you, and that is the most useful thing this page can tell you.`
    );
  }
  return (
    `As things stand, “${fullLabel}” pays the most. Under a reduction, “${reducedLabel}” does. ` +
    `A cut falls on the years furthest away, and a plan that waits puts more of its money ` +
    `there. This is worth talking through rather than settling from the figures alone.`
  );
}

export const SOLVENCY_DISCLAIMER =
  'This page is a what-if, not a prediction. Nothing here forecasts what Congress will do.';

/* ------------------------------------------------------------------ *
 * Terms
 * ------------------------------------------------------------------ */

export interface Term {
  term: string;
  body: string;
}

/**
 * The glossary, in the report's basis.
 *
 * Two entries describe how the figures are stated, and they were constants
 * written for present value: in a future-value report the terms page told the
 * reader that every figure was in today's buying power and that later
 * payments were counted for less, beside figures that were neither. The
 * other entries are about Social Security and read the same either way.
 *
 * `colaPercent` is the assumed yearly increase, already formatted.
 */
export function keyTerms(dollarsMode: DollarsMode = 'real', colaPercent = '2.50%'): Term[] {
  const future = dollarsMode === 'nominal';
  return [
    {
      term: 'Your full retirement age',
      body:
        'The age at which Social Security pays your full benefit: 67 for anyone born in ' +
        '1960 or later, and between 66 and 67 for those born before. Claim earlier and the ' +
        'amount is permanently lower. Wait and it is permanently higher, up to age 70. ' +
        '(Social Security calls this your FRA.)',
    },
    {
      term: 'Your full benefit',
      body:
        'What you would be paid each month if you claimed at your full retirement age. ' +
        'Everything else is worked out from it: about 70% of it at 62, and about 124% at ' +
        '70. (Social Security calls this your primary insurance amount, or PIA.)',
    },
    {
      term: 'Waiting past full retirement age',
      body:
        'For each month you wait past your full retirement age, up to age 70, your benefit ' +
        'grows by two-thirds of one percent, which is 8% a year. The increase is permanent. ' +
        '(Social Security calls these delayed retirement credits.)',
    },
    {
      term: 'The yearly increase',
      body: future
        ? 'Social Security raises benefits most years to keep pace with prices. The lifetime ' +
          `and yearly figures in this report include an assumed ${colaPercent} increase each ` +
          'year, so they show the dollars you will be paid rather than what those dollars will ' +
          'buy. Monthly amounts are in today’s dollars. (Social Security calls this a ' +
          'cost-of-living adjustment, or COLA.)'
        : 'Social Security raises benefits most years to keep pace with prices. Figures in ' +
          'this report are in today’s dollars: a figure of $3,000 a month means $3,000 of ' +
          'today’s buying power, whatever the check says by then. (Social Security calls ' +
          'this a cost-of-living adjustment, or COLA.)',
    },
    {
      // Added when the term was allowed onto client surfaces. It is easy to
      // explain in two sentences, and the report uses it in two places where
      // the alternative was either a wrong word or a paragraph — so it is
      // introduced here rather than avoided.
      term: future ? 'Lifetime total' : 'Lifetime value',
      body: future
        ? 'Every payment added up as it is paid. Nothing is counted for less for being ' +
          'further away, so this is not a present value.'
        : 'A single figure for a stream of payments spread over decades. A dollar arriving ' +
          'in thirty years is worth less than a dollar today, because today’s dollar could ' +
          'be spent or invested in the meantime, so later payments are counted for less. ' +
          'That is why two plans paying the same total can be worth different amounts here. ' +
          '(This is called a present value.)',
    },
    {
      term: 'Spousal benefit',
      body:
        'If your own benefit is small, you may be topped up to as much as half of your ' +
        'spouse’s full benefit. It is a top-up, not a second check, and your spouse has ' +
        'to have claimed before it can start.',
    },
    {
      term: 'Survivor benefit',
      body:
        'When one spouse dies, the other keeps the larger of the two benefits rather than ' +
        'both. The age the higher earner claimed at sets that figure for as long as the ' +
        'survivor lives, so a filing decision is also a decision about what the survivor ' +
        'will receive. (Social Security calls this a widow’s or widower’s benefit.)',
    },
    {
      // A ceiling, not a payment. It said the survivor "receives" the greater
      // of the two, which a survivor claiming at 60 (71.5% of the full benefit)
      // does not. The counter-intuitive half stays: a survivor CAN be paid more
      // than the person who died was receiving.
      term: 'The widow(er)’s limit',
      body:
        'If the spouse who died had claimed before their full retirement age, the survivor ' +
        'benefit is limited to the larger of what that spouse was paid and 82.5% of their ' +
        'full benefit. That is why a survivor can be paid more than the person who died. ' +
        'Claiming the survivor benefit early lowers it further.',
    },
  ];
}

/** The present-value glossary: the report's default basis. */
export const KEY_TERMS: Term[] = keyTerms('real');

/* ------------------------------------------------------------------ *
 * Assumptions
 * ------------------------------------------------------------------ */

export const ASSUMPTIONS_TITLE = 'What this report assumes';

export const ASSUMPTIONS_INTRO = 'The assumptions behind every figure in this report.';

export function planToNote(
  names: readonly string[],
  ages: readonly number[],
  hasLongevityPage = false,
): string {
  const each = names.map((name, i) => `${name}${i === 0 ? ' lives' : ''} to ${ages[i]}`);
  // "A to 85 and B to 90" for two; an Oxford comma only once there are three
  // to separate, which a household never has but a caller might.
  const pairs =
    each.length <= 2
      ? each.join(' and ')
      : `${each.slice(0, -1).join(', ')}, and ${each[each.length - 1]}`;
  // The pointer only where the page exists. Four of the five preset layouts
  // carry this note and leave the longevity page out, and a cross-reference
  // to a page the reader cannot find is the first thing a reviewer marks.
  const pointer = hasLongevityPage
    ? ' The page on longevity shows how much the answer moves if they are wrong.'
    : '';
  return (
    `Every figure assumes ${pairs}. These are the ages you chose to plan to, not a ` +
    `prediction.${pointer}`
  );
}

/* ------------------------------------------------------------------ *
 * Cover
 * ------------------------------------------------------------------ */

export const COVER_TITLE = 'Social Security Claiming Analysis';
export const COVER_PREPARED_FOR = 'Prepared for';
export const COVER_PREPARED_BY = 'Prepared by';

/**
 * The one line under the title, in the reader's own terms.
 *
 * It used to say "When you should claim, and what it means for you", which
 * promises on the cover what the disclosures on the last page take back: this
 * is one analysis of one variable, and it does not know about their taxes,
 * their health, their work plans, or the rest of their retirement income.
 * A cover that says "when you should claim" has already told the client the
 * decision is made before they reach anything qualifying it.
 *
 * So it now describes what the report contains rather than instructing, and
 * names the fact that the figures are not the whole decision. The report
 * still gives a clear answer inside; it just stops presenting that answer as
 * the whole decision on the way in.
 *
 * "could pay", not "would pay": every figure on the pages behind this one is
 * a projection standing on assumed COLA, an assumed discount rate and an
 * assumed age at death. "Would" states the payment as settled, which is the
 * same over-promise the title itself was rewritten to avoid.
 */
export function coverSubtitle(hasSpouse: boolean): string {
  return hasSpouse
    ? 'What each filing age could pay the two of you, and what else belongs in the decision'
    : 'What each filing age could pay you, and what else belongs in the decision';
}

/* ------------------------------------------------------------------ *
 * Introduction
 * ------------------------------------------------------------------ */

export const INTRO_TITLE = 'What this report answers';

/**
 * The whole decision in one sentence.
 *
 * Six competing reports were read for this page and one sentence in them was
 * clearer than anything we had: the trade-off is between starting earlier and
 * receiving more payments that are each smaller, or starting later and
 * receiving fewer payments that are each larger. Everything else in the
 * report is that sentence with your numbers in it.
 */
export const INTRO_LEAD =
  'Claim early and you receive more payments, each one smaller. Wait and you receive ' +
  'fewer payments, each one larger. The larger figure is also what a surviving spouse ' +
  'keeps. Every page here works out that trade-off with your numbers.';

/** The questions a client walks in with, in the order the report answers them. */
export function introQuestions(hasSpouse: boolean): string[] {
  return hasSpouse
    ? [
        'Which filing ages pay the most for the two of you?',
        'What will each of you receive each month, and what will you receive together?',
        'What happens to whoever is left, and for how long?',
        'How much does it matter if you live longer or shorter than expected?',
        'What do you actually have to do, and when?',
      ]
    : [
        'Which filing age pays the most?',
        'What will you receive each month?',
        'How much does it matter if you live longer or shorter than expected?',
        'What do you actually have to do, and when?',
      ];
}

/**
 * How to read the report.
 *
 * "The first page is the answer" was the most definitive sentence in the
 * document, and the least defensible one: the first page is the answer to the
 * question this report asks, which is not the same as the answer to when to
 * claim. It now says which page is which, and sends the reader to the page
 * that says where the analysis stops.
 */
export const INTRO_HOW_TO_READ =
  'The first page summarizes what this report found. The pages after it show the ' +
  'reasoning, and one of them sets out what the report leaves out, which is worth ' +
  'reading before you decide. The terms used are explained at the back.';

/* ------------------------------------------------------------------ *
 * What this report does not include
 * ------------------------------------------------------------------ */

export const LIMITS_TITLE = 'What this report does not include';

export const LIMITS_INTRO =
  'This report answers a specific question. Here is what it leaves out.';

/**
 * The limits, each named for what a reader might have assumed was covered.
 *
 * Savvy prints a page like this and it is the most trustworthy page in any of
 * the six reports. Adapted to what THIS app models rather than copied: several
 * of Savvy's caveats concern features we do not have, and one of ours (the
 * grid covering every whole-age pair) is a limit Savvy cannot claim.
 */
export function limitsFor(hasSpouse: boolean): Term[] {
  return [
    {
      // First, deliberately. Everything below it is a caveat about the model;
      // this one is about the decision, and it is the point of the page.
      term: 'What else belongs in this decision',
      body:
        'This report compares filing ages on one measure: what Social Security itself pays ' +
        `over your ${hasSpouse ? 'lifetimes' : 'lifetime'}. Your health and family history, ` +
        'when you plan to stop working, ' +
        'what else you have to draw on, the tax on your other income, and what your Medicare ' +
        'premiums will be all bear on the same choice, and none of them are in these figures. ' +
        'Treat this as one input to that conversation with your adviser rather than the ' +
        'conclusion of it.',
    },
    {
      term: 'The figures are estimates',
      body:
        'Your full benefit comes from your Social Security statement, and Social Security ' +
        'sets the real figure only when you apply. More years of work, or a change in the ' +
        'yearly increase, will move it, and every other figure here moves with it.',
    },
    {
      term: 'Taxes',
      body:
        'Depending on your other income, up to 85% of what you receive can be taxable. ' +
        'Nothing here is reduced for tax, because that depends on the rest of your ' +
        'retirement income and belongs in a plan that includes it.',
    },
    {
      term: 'Working while claiming',
      body:
        'If you claim before your full retirement age and keep working, Social Security ' +
        'holds back part of your benefit above an earnings limit, and restores it later. ' +
        '(Social Security calls this the earnings test.) This report assumes you have ' +
        'stopped work by the month you claim.',
    },
    {
      term: 'Other benefits',
      body:
        'Benefits for children, for a former spouse, and for disability are not modeled. ' +
        'If any of these apply to you, tell your adviser. They can change the answer.',
    },
    {
      term: 'The law',
      // The Social Security Fairness Act, signed in January 2025, repealed the
      // Windfall Elimination Provision and the Government Pension Offset. This
      // report used to list them among the things it did not model; a client
      // with a public pension deserves to hear that they no longer apply.
      body:
        'Every figure follows the rules as they stand today. Congress can change them, ' +
        'and has: in 2025 it repealed the rules that reduced Social Security for some ' +
        'people with government pensions. Nobody can say when or how the rules will ' +
        'change next.',
    },
    {
      term: 'Which ages were compared',
      body:
        'The tables compare each whole year of age from 62 to 70. The best age is then ' +
        'found to the month, so it can fall between whole years.',
    },
  ];
}

/** The couple's limits: the shape most reports take. */
export const LIMITS: Term[] = limitsFor(true);
