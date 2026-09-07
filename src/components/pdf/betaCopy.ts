/**
 * Copy for the beta report's client-facing half.
 *
 * Separate from `methodologyCopy` because the two are written to different
 * readers and the difference is the point of the beta. Four rules produced
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

export const BETA_LABEL = 'Beta';

/* ------------------------------------------------------------------ *
 * Page 1 — the answer
 * ------------------------------------------------------------------ */

export const ANSWER_TITLE = 'Your Social Security decision';

export const LIFETIME_CAPTION = 'What you receive over your lifetimes, in today’s money';

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

export const CHANGE_TABLE_NOTE =
  'Amounts are what arrives each month once each change has taken effect, in today’s ' +
  'money. Social Security raises them each year to keep pace with prices.';

/* ------------------------------------------------------------------ *
 * Survivor page
 * ------------------------------------------------------------------ */

export const SURVIVOR_TITLE = 'What the one left behind receives';

export const SURVIVOR_INTRO =
  'When one of you dies, the other keeps the larger of the two benefits — not both. ' +
  'Waiting raises that figure for whoever outlives the other, for every year they ' +
  'live on. This is the reason to wait that a lifetime total on its own cannot show.';

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
      `${lead} — for every year the survivor lives on. On the ages in this report they ` +
      'die within a year of each other, so the difference barely arises; it is worth ' +
      'weighing because those ages are the least certain thing here.'
    );
  }
  return `${lead} — and about ${years} years to receive it, on the ages in this report.`;
}

export const SURVIVOR_CHART_CAPTION =
  'Household income in the first full year after the first death, under each plan.';

/* ------------------------------------------------------------------ *
 * Longevity page
 * ------------------------------------------------------------------ */

export const LONGEVITY_TITLE = 'What if we are wrong about how long you live';

export const LONGEVITY_INTRO =
  'Every figure in this report rests on the ages you told us to plan to. Nobody knows ' +
  'those ages. So here is the same comparison priced three ways — as planned, and if ' +
  'you both live about ten years less or ten years more.';

export function longevityVerdict(winnerLabel: string | null, tied = false): string {
  if (winnerLabel === null && tied) {
    return (
      'The leading plans are within half a percent of each other however long you live — ' +
      'a few thousand dollars across thirty years, which is less than the assumptions ' +
      'behind them can be trusted to. Choose between them on when you actually want to ' +
      'stop working, not on these figures.'
    );
  }
  if (winnerLabel === null) {
    return (
      'No single plan wins in all three cases. Which one suits you depends on how long ' +
      'you expect to live, and on how much it would matter to run short late in life. ' +
      'That is a conversation to have rather than a number to read.'
    );
  }
  return (
    `“${winnerLabel}” pays the most in all three cases. You do not have to be right ` +
    'about how long you live for it to be the better choice — which is a stronger ' +
    'reason to pick it than any single figure in this report.'
  );
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
  'ssa.gov, by phone on 1-800-772-1213, or at a local office — call first for an ' +
  'appointment. A survivor benefit cannot be applied for online: it has to be by phone ' +
  'or in person.';

/**
 * Savvy's report is the only one of the six that tells the client what
 * happens AFTER applying. The award letter is where a wrong start month is
 * caught cheaply; a year later it is an argument.
 */
export const ACTION_VERIFY_STEP =
  'When your award letter arrives, check that the amount and the start month match ' +
  'this plan. Anything wrong is far easier to put right before the first payment.';

export const ACTION_CHECK_EARNINGS =
  'Check your earnings record at ssa.gov/myaccount. A missing year lowers your benefit, ' +
  'and it is far easier to correct now than later.';

export const ACTION_DEATH_STEP =
  'Tell Social Security. The survivor benefit does not start on its own, and a one-off ' +
  'payment of $255 is due to the surviving spouse — it has to be claimed within two ' +
  'years.';

export const ACTION_REVIEW_NOTE =
  'Review this once a year, and sooner if your health, your marriage, or your plans for ' +
  'work change.';

/* ------------------------------------------------------------------ *
 * Terms
 * ------------------------------------------------------------------ */

export interface Term {
  term: string;
  body: string;
}

export const KEY_TERMS: Term[] = [
  {
    term: 'Your full retirement age',
    body:
      'The age at which Social Security pays your whole benefit — 67 for anyone born in ' +
      '1960 or later, and between 66 and 67 for those born before. Claim earlier and the ' +
      'amount is permanently lower; wait and it is permanently higher, up to age 70. ' +
      '(You may see this called your FRA.)',
  },
  {
    term: 'Your full benefit',
    body:
      'What you would be paid each month if you claimed at your full retirement age. ' +
      'Everything else is worked out from it: about 70% of it at 62, and about 124% at ' +
      '70. (You may see this called your PIA, or primary insurance amount.)',
  },
  {
    term: 'The yearly rise',
    body:
      'Social Security raises benefits most years to keep pace with prices. Figures in ' +
      'this report are in today’s money, so they already allow for that — a figure of ' +
      '$3,000 a month means $3,000 of today’s buying power, whatever the actual check ' +
      'says by then. (You may see this called a COLA.)',
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
      'survivor lives — which is why a filing decision is partly a decision for the ' +
      'person left behind.',
  },
  {
    term: 'The widow’s limit',
    body:
      'A survivor is not made to inherit the whole of an early-claiming cut. If the ' +
      'spouse who died had claimed before their full retirement age, the survivor ' +
      'receives the greater of what that spouse was actually paid and 82.5% of their ' +
      'full benefit. It is the reason a survivor can be paid more than the person who died.',
  },
];

/* ------------------------------------------------------------------ *
 * Assumptions
 * ------------------------------------------------------------------ */

export const ASSUMPTIONS_TITLE = 'What this report assumes';

export const ASSUMPTIONS_INTRO =
  'The front of this report keeps the arithmetic out of the way. Here it is.';

export function planToNote(names: readonly string[], ages: readonly number[]): string {
  const each = names.map((name, i) => `${name} to ${ages[i]}`);
  // "A to 85 and B to 90" for two; an Oxford comma only once there are three
  // to separate, which a household never has but a caller might.
  const pairs =
    each.length <= 2
      ? each.join(' and ')
      : `${each.slice(0, -1).join(', ')}, and ${each[each.length - 1]}`;
  return (
    `Every figure assumes ${pairs}. These are the ages you chose, not a prediction. ` +
    'The page on longevity shows how much the answer moves if they are wrong.'
  );
}

/* ------------------------------------------------------------------ *
 * Cover
 * ------------------------------------------------------------------ */

export const COVER_TITLE = 'Social Security Claiming Analysis';
export const COVER_PREPARED_FOR = 'Prepared for';
export const COVER_PREPARED_BY = 'Prepared by';

/** The one line under the title, in the reader's own terms. */
export function coverSubtitle(hasSpouse: boolean): string {
  return hasSpouse
    ? 'When each of you should claim, and what it means for the two of you'
    : 'When you should claim, and what it means for you';
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
  'fewer payments, each one larger — and the larger figure is what the person left ' +
  'behind keeps. Every page here is that trade-off, worked out with your numbers.';

/** The questions a client walks in with, in the order the report answers them. */
export function introQuestions(hasSpouse: boolean): string[] {
  return hasSpouse
    ? [
        'When should each of you file?',
        'What will you receive each month — separately, and together?',
        'What happens to whoever is left, and for how long?',
        'How much does it matter if you live longer or shorter than expected?',
        'What do you actually have to do, and when?',
      ]
    : [
        'When should you file?',
        'What will you receive each month?',
        'How much does it matter if you live longer or shorter than expected?',
        'What do you actually have to do, and when?',
      ];
}

export const INTRO_HOW_TO_READ =
  'The first page is the answer. Everything after it is the reasoning, in the order ' +
  'you would ask for it. The words used are explained at the back.';

/* ------------------------------------------------------------------ *
 * What this report does not include
 * ------------------------------------------------------------------ */

export const LIMITS_TITLE = 'What this report does not include';

export const LIMITS_INTRO =
  'A report that only tells you what it knows is more useful than one that pretends ' +
  'to know everything. These are the edges of this one.';

/**
 * The limits, each named for what a reader might have assumed was covered.
 *
 * Savvy prints a page like this and it is the most trustworthy page in any of
 * the six reports. Adapted to what THIS app models rather than copied: several
 * of Savvy's caveats concern features we do not have, and one of ours (the
 * grid covering every whole-age pair) is a limit Savvy cannot claim.
 */
export const LIMITS: Term[] = [
  {
    term: 'The figures are estimates',
    body:
      'Your full benefit comes from your Social Security statement, and Social Security ' +
      'sets the real figure only when you apply. More years of work, or a change in the ' +
      'yearly rise, will move it — and every other figure here moves with it.',
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
      'This report assumes you have stopped work by the month you claim.',
  },
  {
    term: 'Other benefits',
    body:
      'Benefits for children, for a former spouse, for disability, and the reductions ' +
      'that apply to some public-sector pensions are not modeled. If any of these apply ' +
      'to you, say so — they can change the answer.',
  },
  {
    term: 'The law',
    body:
      'Every figure follows the rules as they stand today. Congress can change them, ' +
      'and has before. Nobody can say when or how.',
  },
  {
    term: 'Which ages were compared',
    body:
      'The comparisons price every whole year from 62 to 70 for each of you, and the ' +
      'best answer is found to the month. Plans that start in between a whole year are ' +
      'shown only where they win.',
  },
];
