import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import type { SurvivorGap } from '../../lib/benefitPeriods';
import type { CombinedTimelinePoint, HouseholdAnalysis } from '../../lib/household';
import type { Person } from '../../lib/personAnalysis';
import { CombinedIncomeBars, HouseholdSection } from './HouseholdSection';
import { MethodologyAppendix } from './ReportDocument';
import { benefitSeriesLabel } from '../methodologyCopy';

/**
 * The PDF's half of the survivor-gap disclosure and the combined-income
 * caption.
 *
 * `ReportDocument.test.tsx` renders the real document, but PDFKit deflates
 * every content stream, so no assertion on the printed *words* is possible
 * from the blob. This walks the element tree `HouseholdSection` returns
 * instead — the strings it puts into the document, which is exactly what the
 * C1 and I2 findings are about. Without it the print surface has copy
 * coverage only by assumption, which is how the unguarded absence marker
 * reached print once already.
 */
function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectText);
  const element = node as ReactElement<{ children?: unknown }>;
  if (typeof element === 'object' && 'props' in element) {
    return collectText(element.props?.children);
  }
  return [];
}

/**
 * Only the fields `HouseholdSection` and `MethodologyAppendix` read. Running
 * the optimizer here would duplicate the pipeline coverage in
 * `methodologyCopy.test.ts`, which is where these exact gap figures are pinned
 * against real `analyzeHousehold` output.
 */
function analysisWith(survivorGap: SurvivorGap | null): HouseholdAnalysis {
  const rep = {
    person: {
      id: 'a', name: 'Avery', birthYear: 1957, birthMonth: 3,
      gender: 'female', piaMonthly: 1500, lifeExpectancy: 85,
    },
    fra: { years: 66, months: 6 },
    currentAge: { years: 68, months: 10 },
    ssaSuggestedLifeExpectancy: 86,
    claimingOptions: [
      { age: 62, percentOfPia: 72.5 },
      { age: 70, percentOfPia: 126.7 },
    ],
  };
  return {
    status: 'married',
    people: [rep, { person: { id: 'b', name: 'Blake' } }],
    comparisons: [],
    combinedTimeline: [
      { year: 2030, bySeries: { 'a:personal': 12000 }, byPersonId: { a: 12000, b: 0 }, total: 12000 },
    ],
    periods: [],
    survivorGap,
    spousalTopUp: {
      atFra: 0,
      atRecommendedFilingAge: 0,
      startsAtSpouseAge: null,
      lowerEarnerLabel: 'Avery',
    },
    assumptions: { annualCola: 0, discountRate: 0.025 },
    recommendation: 'r',
    recommendationDetail: 'd',
  } as unknown as HouseholdAnalysis;
}

const printed = (survivorGap: SurvivorGap | null) =>
  collectText(HouseholdSection({ analysis: analysisWith(survivorGap), footerText: 'f' })).join(' ');

/**
 * The household page as `ReportDocument` actually composes it for a married
 * report: the methodology appendix attaches to THIS page
 * (`ReportDocument.tsx:206-211`), so its disclosures print alongside the
 * combined-income caption and the gap note.
 */
const printedWithAppendix = (survivorGap: SurvivorGap | null) => {
  const analysis = analysisWith(survivorGap);
  return collectText(
    HouseholdSection({
      analysis,
      footerText: 'f',
      appendix: MethodologyAppendix({ analysis }),
    }),
  ).join(' ');
};

describe('HouseholdSection — the printed combined-income caption', () => {
  it('claims spousal and survivor segments are included when they are', () => {
    const text = printed(null);
    expect(text).toContain('their own benefit, plus any spousal or survivor segment');
    expect(text).toContain("today’s dollars, before any cost-of-living adjustment");
    expect(text).not.toContain('No survivor segment is included');
  });

  it('drops the survivor claim for a gap household, as the screen caption does', () => {
    // Both captions were verbatim duplicates rendered unconditionally, and
    // both contradicted the note printed directly beneath them.
    const text = printed({
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    });
    expect(text).not.toContain('or survivor segment is included');
    expect(text).toContain('No survivor segment is included for this household');
  });

  // The caption's second rewrite: the chart now draws one segment per person
  // per benefit type, so "each person's band is everything they are paid"
  // became false the moment a spousal or survivor segment could sit beside
  // the personal one. Printed unconditionally — it's a statement about how
  // the chart works, not a claim about this particular household's bands.
  it("prints that each person's segments sum to what they were paid, and explains the survivor increment", () => {
    const text = printed(null);
    expect(text).toContain('Each person’s segments for the year sum to what they were actually paid');
    expect(text).toMatch(/survivor segment is the increment above the personal band/i);
    expect(text).not.toMatch(/band is everything they are paid/i);
  });
});

describe('HouseholdSection — the printed survivor-gap note', () => {
  it('prints contemporaneous figures when the survivor has already filed', () => {
    const text = printed({
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    });
    expect(text).toContain('no step-up is shown for Blake');
    expect(text).toContain('$1,780.00/mo');
    expect(text).toContain('$1,760.00/mo');
  });

  it('prints no survivor figure when the survivor has not filed at the death', () => {
    const text = printed({
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: null,
      survivorUnder60: false,
    });
    expect(text).toContain('has not filed on their own record by then');
    // The one dollar figure on the page's note is the deceased's. A figure the
    // survivor is not receiving must not reach print — this is C1's failure.
    const note = text.slice(text.indexOf('Survivor benefits are modeled'));
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual(['$1,780.00']);
  });

  it('prints the under-60 branch without asserting an immediate shortfall', () => {
    const text = printed({
      survivorLabel: 'Blake',
      deceasedMonthly: 2016,
      survivorOwnMonthly: null,
      survivorUnder60: true,
    });
    expect(text).toContain('is under 60 then');
    expect(text).toContain('from age 60 onward');
    expect(text).not.toContain('lower than SSA would pay');
    const note = text.slice(text.indexOf('Survivor benefits are modeled'));
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual(['$2,016.00']);
  });

  it('prints nothing at all when there is no gap', () => {
    expect(printed(null)).not.toContain('no step-up is shown');
  });
});

/**
 * The whole married household page, appendix included — the composition
 * `ReportDocument` actually emits.
 *
 * This exists because the first fix wave removed the survivor contradiction
 * from the caption and reintroduced it in the disclosures block one line
 * below, where nothing tested the two together. They share a physical `<Page>`
 * for a married report, so they must be asserted on one page or they will
 * drift apart again.
 */
describe('HouseholdSection — the household page as the report composes it', () => {
  const gap: SurvivorGap = {
    survivorLabel: 'Blake',
    deceasedMonthly: 1780,
    survivorOwnMonthly: 1760,
    survivorUnder60: false,
  };

  it('never claims survivor benefits are modeled on a page saying they are not', () => {
    const page = printedWithAppendix(gap);
    // Guard: the caption and note really are on this page, so the absence
    // below is a contradiction removed, not a page that says nothing.
    expect(page).toContain('No survivor segment is included for this household');
    expect(page).toContain('no step-up is shown for Blake');
    // The reintroduced claim, in either of its wordings.
    expect(page).not.toMatch(/survivor benefits are (both )?modeled/);
    expect(page).toContain('the survivor benefit this household would actually receive is not');
  });

  it('does claim survivor benefits are modeled when the household has no gap', () => {
    const page = printedWithAppendix(null);
    expect(page).toContain('The spousal top-up and survivor benefits are both modeled');
    expect(page).toContain('their own benefit, plus any spousal or survivor segment');
    expect(page).not.toContain('No survivor segment is included');
  });

  it('keeps one apostrophe style across the page', () => {
    // The caption lost its `&rsquo;` when it was extracted to a plain string,
    // so it rendered straight quotes beside the disclaimer's curly ones.
    // Reaches the caption and the disclosures block, which is where the two
    // styles collided. The `MethodPair` bodies are behind an uncalled
    // component element, so this walk does not see them.
    const page = printedWithAppendix(null);
    expect(page).toContain('Each person’s segments');
    expect(page).toContain('today’s dollars, before any cost-of-living adjustment');
    expect(page).toContain('Benefit amounts are in today’s dollars');
  });
});

/**
 * `CombinedIncomeBars`' own decomposition — one legend entry per benefit
 * type, sourced from `benefitSeriesLabel`, the exact same function
 * `CombinedIncomeChart` calls on screen. Retyping the label here (rather than
 * calling the shared function) is precisely the mechanism behind three prior
 * defects; these tests fail if the printed text and the function's output
 * ever diverge, not just if the PDF renders nothing at all.
 *
 * Called directly rather than through `HouseholdSection`/`printed`: the
 * household page's caption says "any spousal or survivor segment"
 * unconditionally for every married household (a statement about what the
 * chart is capable of showing), which would false-match a page-wide
 * /spousal/i query regardless of whether this component correctly drops a
 * zero band. Isolating the bars avoids that collision.
 */
describe('CombinedIncomeBars — the printed combined-income decomposition', () => {
  const people: Person[] = [
    { id: 'a', name: 'Avery', birthYear: 1957, birthMonth: 3, gender: 'female', piaMonthly: 1500, lifeExpectancy: 85 },
    { id: 'b', name: 'Blake', birthYear: 1959, birthMonth: 7, gender: 'male', piaMonthly: 1000, lifeExpectancy: 85 },
  ];

  it('prints a legend entry per benefit type, not per person', () => {
    const timeline: CombinedTimelinePoint[] = [
      {
        year: 2030,
        bySeries: { 'a:personal': 12000, 'b:spousal': 6000 },
        byPersonId: { a: 12000, b: 6000 },
        total: 18000,
      },
    ];
    const text = collectText(CombinedIncomeBars({ timeline, people })).join(' ');
    expect(text).toContain(benefitSeriesLabel('Avery', 'personal'));
    expect(text).toContain(benefitSeriesLabel('Blake', 'spousal'));
  });

  it('omits a band and its legend entry when every year of it is zero', () => {
    // A $0.00 spousal band — reachable, not invented; see
    // `household.test.ts` ("keeps the start date of a spousal entitlement
    // that is fully absorbed") and `CombinedIncomeChart.test.tsx`'s
    // `timelineWithZeroSpousal`, which pins this against real
    // `analyzeHousehold` output. Hand-built here only to isolate this
    // component's own zero-dropping wiring from the pipeline coverage those
    // files own.
    const timeline: CombinedTimelinePoint[] = [
      {
        year: 2030,
        bySeries: { 'a:personal': 12000, 'b:spousal': 0 },
        byPersonId: { a: 12000, b: 0 },
        total: 12000,
      },
    ];
    const text = collectText(CombinedIncomeBars({ timeline, people })).join(' ');
    expect(text).not.toMatch(/spousal/i);
    // Self-sufficient against a `visibleBenefitSeries` that returned `[]`
    // unconditionally: that would also make the assertion above pass, so
    // this also pins that a real, surviving series is still printed.
    expect(text).toContain(benefitSeriesLabel('Avery', 'personal'));
  });
});
