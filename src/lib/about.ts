/**
 * What the About panel says.
 *
 * Words as data, following `resources.ts`'s precedent, so the panel is markup
 * and the copy sits in one reviewable place. These are NOT shared with the PDF
 * — `methodologyCopy.ts` is the module for sentences that appear on both
 * surfaces, and nothing here does.
 */

export interface AboutCard {
  title: string;
  body: string;
}

export const ABOUT_INTRO =
  'This tool models Social Security claiming decisions for a household: when each person ' +
  'should file, what they receive, and how household income changes when one spouse dies. ' +
  'It is an estimate for planning conversations, not advice, and not affiliated with the ' +
  'Social Security Administration.';

export const ABOUT_CARDS: AboutCard[] = [
  {
    title: 'Full Retirement Age (FRA)',
    body:
      "Set by birth year on SSA's published schedule — 66 for those born 1943-1954, " +
      'rising to 67 for 1960 and later.',
  },
  {
    title: 'Early claiming (before FRA)',
    body:
      'Benefits are reduced 5/9 of 1% per month for the first 36 months early, then ' +
      '5/12 of 1% per month thereafter.',
  },
  {
    title: 'Delayed credits (after FRA)',
    body: 'Benefits increase 2/3 of 1% per month (8% per year) until age 70.',
  },
  {
    title: 'Life expectancy by gender',
    body:
      "SSA's 2021 period life table supplies a suggested planning age for each person. " +
      'Adjust it under Planning assumptions — every lifetime total moves with it.',
  },
];

/**
 * The single engine attribution. This is the one place in the app, outside
 * `resources.ts`'s links, where the engine is named — the whole point of
 * consolidating twenty scattered mentions into one accurate statement.
 */
export const ENGINE_ATTRIBUTION = {
  title: 'Calculation engine',
  body:
    'Benefit amounts, full retirement ages, spousal and survivor rules, and the ' +
    'mortality-weighted optimal filing search all come from the open-source ssa.tools ' +
    'calculator, used under the MIT licence. This app supplies the dates, the household ' +
    'model and the presentation; it computes no benefit rule of its own.',
  href: 'https://ssa.tools/',
  linkText: 'ssa.tools',
};
