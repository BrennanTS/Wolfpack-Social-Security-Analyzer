/**
 * The report, described for someone approving its wording.
 *
 * Maps each `report/<Block>.<what>` source that `surfaces.ts` produces to the
 * section a reader sees it in, in the order `CLIENT_LAYOUT` places them, with
 * a note saying WHEN each line appears.
 *
 * That last part is the reason this file exists. A compliance reviewer handed
 * one exported PDF has approved one household's wording: the report says
 * materially different things depending on the household, and the variants
 * they would not have seen are disproportionately the conditional ones — a
 * widow's limit that binds, a spousal top-up that never begins, a chart
 * honestly showing nothing where SSA would pay something. The schedule exists
 * so an approval covers the product rather than one sample of it.
 *
 * Kept beside the rubric rather than in the generator, so changing what the
 * reviewer is told is a diff somebody can read.
 */

export interface ScheduleSection {
  /** As it appears in the report, so a reviewer can find it in the sample. */
  title: string;
  /** What the section is for, in one sentence, for someone who has not read the code. */
  purpose: string;
  /** Sources from `reportSurface`, in the order they are printed. */
  sources: string[];
  /** When a given source appears, keyed by source. Absent means "always". */
  appears?: Record<string, string>;
}

export const SCHEDULE_SECTIONS: ScheduleSection[] = [
  {
    title: 'Cover',
    purpose:
      'The title page. Carries the firm name, the adviser line and the logo from the ' +
      'report theme, plus who the report was prepared for and the date it was produced.',
    sources: ['report/Cover.title', 'report/Cover.subtitle'],
    appears: {
      'report/Cover.subtitle':
        'Always. Two wordings: one for a single claimant, one for a couple.',
    },
  },
  {
    title: 'What this report answers',
    purpose:
      'Sets up the trade-off the whole report works through, and lists the questions the ' +
      'pages after it answer, in the order they answer them.',
    sources: [
      'report/Intro.title',
      'report/Intro.lead',
      'report/Intro.questions',
      'report/Intro.howToRead',
    ],
    appears: {
      'report/Intro.questions':
        'Always. A couple is asked five questions and a single claimant four: the ' +
        'question about what happens to whoever is left does not arise.',
    },
  },
  {
    title: 'Your Social Security decision',
    purpose:
      'The answer page: the filing ages, what arrives each month, and the lifetime figure. ' +
      'The page a client reads first and the one most likely to be read alone.',
    sources: [
      'report/Answer.title',
      'report/Answer.lifetimeCaption',
      'report/Answer.versusWorstNote',
    ],
    appears: {
      'report/Answer.versusWorstNote':
        'Only when the recommended plan is worth more than the weakest plan on the ' +
        'comparison table. Omitted entirely when there is no gain to state.',
    },
  },
  {
    title: 'What changes, and when',
    purpose:
      'A dated table of every month the household income changes, and what causes each ' +
      'change, so a client can see the plan as a sequence rather than a single figure.',
    sources: ['report/Changes.title', 'report/Changes.note'],
  },
  {
    title: 'What the one left behind receives',
    purpose:
      'What each plan leaves the surviving spouse, which a lifetime total alone cannot ' +
      'show. This is the strongest argument for delaying, and the one most often missed.',
    sources: [
      'report/Survivor.title',
      'report/Survivor.intro',
      'report/Survivor.gainNote',
      'report/Survivor.chartCaption',
    ],
    appears: {
      'report/Survivor.title': 'Couples only. The whole section is omitted for a single claimant.',
      'report/Survivor.gainNote':
        'Couples only, and in two wordings. Where the two people are projected to die ' +
        'within a year of each other the sentence says so rather than claiming a gain ' +
        '"for about 0 years".',
    },
  },
  {
    title: 'Your action plan',
    purpose:
      'What the client actually has to do, and when. Dated steps, plus the standing ' +
      'obligations that follow filing.',
    sources: [
      'report/Action.title',
      'report/Action.intro',
      'report/Action.applyNote',
      'report/Action.medicareManual',
      'report/Action.medicareAutomatic',
      'report/Action.verifyStep',
      'report/Action.checkEarnings',
      'report/Action.deathStep',
      'report/Action.reviewNote',
    ],
    appears: {
      'report/Action.medicareManual':
        'Per person, and only where they have not yet reached 65. Shown when they will ' +
        'NOT already be receiving Social Security at 65, so enrollment is not automatic ' +
        'and the Part B late penalty is a real risk.',
      'report/Action.medicareAutomatic':
        'Per person, and only where they have not yet reached 65. The alternative to the ' +
        'line above: shown when they will already be receiving Social Security at 65.',
    },
  },
  {
    title: 'What this report assumes',
    purpose:
      'The assumptions every figure rests on, stated where a reader can check them ' +
      'against what they told the adviser.',
    sources: [
      'report/Assumptions.title',
      'report/Assumptions.intro',
      'report/Assumptions.planToNote',
    ],
  },
  {
    title: 'Words used in this report',
    purpose:
      'The glossary. Every Social Security term the report uses is introduced here in ' +
      'plain words BEFORE it is named, so the rest of the document can be read without ' +
      'one. This is the only section where terms of art are permitted.',
    sources: ['report/Terms.term', 'report/Terms.body'],
  },
  {
    title: 'What this report does not include',
    purpose:
      'The limits of the analysis, led by what else belongs in the decision. This is the ' +
      'section that keeps the report an analysis rather than advice.',
    sources: ['report/Limits.term', 'report/Limits.body'],
  },
  {
    title: 'Important disclosures',
    purpose:
      'The firm disclosures, printed on every report. These ship with the app as the ' +
      'default report theme and are what an unedited install prints. A firm can replace ' +
      'them in the theme editor; the final paragraph is a bracketed placeholder that is ' +
      'meant to be replaced with the firm’s own regulatory disclosure.',
    sources: ['report/Disclosure.paragraph'],
  },
];

/**
 * Sections and blocks a client report does NOT carry, listed so the reviewer
 * knows the schedule is the whole of what they are approving.
 */
export const NOT_IN_THE_CLIENT_REPORT = [
  'The claiming grid, the per-person detail pages and their charts, and the ' +
    'methodology appendix. These are in the adviser layout only.',
  'The "What if benefits are reduced" page. It is off unless an adviser switches it ' +
    'on, it is in the adviser layout only, and when it is on the page says so on itself.',
  'The "What if we are wrong about how long you live" page, which is in the adviser ' +
    'layout only.',
];
