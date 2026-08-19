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
  'ssa.gov, by phone, or at a local office.';

export const ACTION_CHECK_EARNINGS =
  'Check your earnings record at ssa.gov/myaccount. A missing year lowers your benefit, ' +
  'and it is far easier to correct now than later.';

export const ACTION_DEATH_STEP =
  'Tell Social Security. The survivor benefit does not start on its own, and a one-off ' +
  'payment of $255 is due to the surviving spouse.';

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
      '$3,000 a month means $3,000 of today’s buying power, whatever the actual cheque ' +
      'says by then. (You may see this called a COLA.)',
  },
  {
    term: 'Spousal benefit',
    body:
      'If your own benefit is small, you may be topped up to as much as half of your ' +
      'spouse’s full benefit. It is a top-up, not a second cheque, and your spouse has ' +
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
