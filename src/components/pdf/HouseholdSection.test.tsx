import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import type { SurvivorGap } from '../../lib/benefitPeriods';
import type { HouseholdAnalysis, MonthlyIncomePoint } from '../../lib/household';
import type { Person } from '../../lib/personAnalysis';
import { CombinedIncomeBars, HouseholdSection, StrategyTable } from './HouseholdSection';
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
  it("prints that each person's segments show the annual rate, and explains the survivor increment", () => {
    const text = printed(null);
    expect(text).toContain('Each person’s segments show the annual rate they’re paid');
    expect(text).toMatch(/survivor segment is the increment above the personal band/i);
    expect(text).not.toMatch(/band is everything they are paid/i);
    expect(text).not.toContain('sum to what they were actually paid');
  });

  // The chart (and now `CombinedIncomeBars`, its PDF twin) is plotted at
  // MONTHLY resolution, so there is no year-bucket artifact left to
  // disclose. A briefly-shipped, calendar-year-bucketed version of this
  // caption needed a clause saying a filing/final year rendered at full
  // height though only part was paid; pinned absent here since it shipped
  // once already.
  it('does not claim a filing or final year renders at full height', () => {
    const text = printed(null);
    expect(text).toMatch(/annual rate/i);
    expect(text).not.toMatch(/filing year and a final year render at the same height/i);
    expect(text).not.toMatch(/shorter than a full one/i);
  });

  // `HouseholdSection.tsx` concatenates `COMBINED_INCOME_SUBTITLE` and
  // `combinedIncomeCaption` straight into ONE `<Text>` — a reader hits both
  // sentences in a single breath, so print is exactly where "income BY
  // YEAR" beside "shows the annual RATE" would have read as a direct,
  // one-paragraph contradiction. The subtitle no longer claims a yearly
  // bucket that the underlying chart doesn't have.
  it('does not print "by year" beside the caption\'s "annual rate" sentence', () => {
    const text = printed(null);
    expect(text).not.toMatch(/by year/i);
    expect(text).toMatch(/annual rate/i);
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
 * The printed survivor-income column and its caption.
 *
 * `analysisWith` carries `comparisons: []`, which is exactly the "no row has a
 * figure" shape — so these tests build their own rows. The column and the
 * caption share one gate (`showSurvivorIncomeColumn`), asserted here on the
 * surface where a caption printing over a column of em dashes would actually
 * be seen.
 */
describe('HouseholdSection — the printed survivor-income column', () => {
  const rows = (survivorIncome: [number | null, number | null]) =>
    [
      {
        key: 'optimal', label: 'Optimal', isOptimal: true, expectedNpv: 1, deltaVsOptimal: 0,
        filingAges: [{ label: '70', decimalYears: 70 }, { label: '62', decimalYears: 62 }],
        survivorIncome: survivorIncome[0],
      },
      {
        key: 'latest', label: 'Both delay to 70', isOptimal: false, expectedNpv: 1,
        deltaVsOptimal: -1,
        filingAges: [{ label: '70', decimalYears: 70 }, { label: '70', decimalYears: 70 }],
        survivorIncome: survivorIncome[1],
      },
    ] as unknown as HouseholdAnalysis['comparisons'];

  // The page's own text walk cannot see inside `<StrategyTable />` (an
  // uncalled component element has no children to walk), so the column itself
  // is asserted on that component directly and the caption on the page.
  const table = (survivorIncome: [number | null, number | null]) =>
    collectText(
      StrategyTable({
        comparisons: rows(survivorIncome),
        people: [{ id: 'a', name: 'Avery' }, { id: 'b', name: 'Blake' }] as Person[],
      }),
    ).join(' ');

  const page = (survivorIncome: [number | null, number | null]) =>
    collectText(
      HouseholdSection({
        analysis: {
          ...analysisWith(null),
          comparisons: rows(survivorIncome),
        } as unknown as HouseholdAnalysis,
        footerText: 'f',
      }),
    ).join(' ');

  it('prints the column and its caption when the rows carry figures', () => {
    expect(table([36_480, 41_000])).toContain('Survivor income');
    expect(table([36_480, 41_000])).toContain('$36,480');
    expect(page([36_480, 41_000])).toContain("each spouse's own life-expectancy input");
  });

  it('prints neither the column nor its caption when no row carries a figure', () => {
    // Identical final months: `firstDeath` returns null for every row, so
    // every cell would be an em dash and the caption would assert figures
    // that are not on the page.
    expect(table([null, null])).not.toContain('Survivor income');
    // One em dash survives, in the optimal row's "vs. best" cell — the
    // survivor column's own dashes are what must be gone, and the header
    // above is what proves the column is.
    expect((table([null, null]).match(/—/g) ?? []).length).toBe(1);
    expect(page([null, null])).not.toContain("each spouse's own life-expectancy input");
  });

  it('drops the delay claim in print too when the figures fall with later filing', () => {
    const text = page([36_480, 0]);
    expect(text).not.toContain('Delaying raises');
    expect(text).toContain('not simply larger for later filing');
  });
});

/**
 * The spousal sentence in print, on an exact PIA tie.
 *
 * Both print call sites passed a hardcoded `'the lower earner'`, which made
 * `spousalSummary`'s `subject === null` branch unreachable on this surface: a
 * tie household has `atFra === 0`, so print fell into the `atFra <= 0` branch
 * and asserted something about "the lower earner" for a household with
 * neither a higher nor a lower one — while the screen printed the symmetric
 * sentence for the same household.
 */
describe('HouseholdSection — the spousal sentence on a PIA tie', () => {
  const tieAnalysis = (): HouseholdAnalysis =>
    ({
      ...analysisWith(null),
      spousalTopUp: {
        atFra: 0,
        atRecommendedFilingAge: 0,
        startsAtSpouseAge: null,
        lowerEarnerLabel: null,
      },
    }) as unknown as HouseholdAnalysis;

  it('states the symmetric no-lower-earner sentence on the household page', () => {
    const text = collectText(
      HouseholdSection({ analysis: tieAnalysis(), footerText: 'f' }),
    ).join(' ');
    expect(text).toContain('Both spouses have the same Primary Insurance Amount');
    // The sentence print used to take instead, presupposing a higher and a
    // lower earner this household does not have.
    expect(text).not.toContain("half of the higher earner's PIA");
  });

  it('states it in the methodology appendix on the same page', () => {
    const analysis = tieAnalysis();
    const text = collectText(
      HouseholdSection({
        analysis,
        footerText: 'f',
        appendix: MethodologyAppendix({ analysis }),
      }),
    ).join(' ');
    expect(text).toContain('Both spouses have the same Primary Insurance Amount');
    expect(text).not.toContain("half of the higher earner's PIA");
  });

  it('still names the lower earner in print when there is one', () => {
    // Guard: the fix must not have turned the subject off everywhere.
    const analysis = {
      ...analysisWith(null),
      spousalTopUp: {
        atFra: 250,
        atRecommendedFilingAge: 200,
        startsAtSpouseAge: '69 years, 1 months',
        lowerEarnerLabel: 'Blake',
      },
    } as unknown as HouseholdAnalysis;
    const text = collectText(HouseholdSection({ analysis, footerText: 'f' })).join(' ');
    expect(text).toContain("The lower earner's spousal top-up is");
    expect(text).not.toContain('Both spouses have the same Primary Insurance Amount');
  });
});

/**
 * The printed income-cliff callout — the same `incomeCliffSentence` the
 * on-screen `IncomeCliffCallout` renders, printed by `HouseholdSection`
 * itself rather than a component of its own (there is no PDF equivalent of
 * `IncomeCliffCallout`; the section prints the sentence directly).
 *
 * `analysisWith` above has only a single-year `combinedTimeline` and no
 * `finalIndexByPersonId`, so `incomeCliff` returns null against it and none
 * of those tests exercise this block — this fixture adds the fields
 * `incomeCliff` actually reads.
 */
function analysisWithCliff(survivorGap: SurvivorGap | null): HouseholdAnalysis {
  return {
    ...analysisWith(survivorGap),
    // `nominalFirstDeathNote` needs a year to compound from — `incomeCliff`
    // itself doesn't read `asOf`, so no earlier test here needed one.
    asOf: new Date(2026, 0, 15),
    finalIndexByPersonId: { a: 2047 * 12 + 2, b: 2052 * 12 + 0 },
    combinedTimeline: [
      { year: 2046, bySeries: {}, byPersonId: {}, total: 60000 },
      { year: 2047, bySeries: {}, byPersonId: {}, total: 55000 },
      { year: 2048, bySeries: {}, byPersonId: {}, total: 38000 },
    ],
  } as unknown as HouseholdAnalysis;
}

describe('HouseholdSection — the printed income-cliff callout', () => {
  it('prints the cliff sentence with the full-year figures either side of the first death', () => {
    const text = collectText(
      HouseholdSection({ analysis: analysisWithCliff(null), footerText: 'f' }),
    ).join(' ');
    expect(text).toContain('Income at the First Death');
    expect(text).toContain('2047');
    expect(text).toContain('$60,000');
    expect(text).toContain('$38,000');
  });

  it('prints the reused survivor-gap note exactly once, not once above the chart and again beside the cliff sentence', () => {
    // Code-review finding: the first pass rendered `survivorGapNote(gap)`
    // once above `CombinedIncomeBars` (line ~204, pre-existing) AND again
    // beside the cliff sentence below it, so a survivor-gap household
    // printed the identical paragraph twice on one page. `analysisWith`'s
    // own gap tests (above) can't catch this — that fixture has no
    // `finalIndexByPersonId`, so `incomeCliff` returns null and the cliff
    // section (where the duplicate lived) never rendered at all.
    const gap: SurvivorGap = {
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    };
    const text = collectText(
      HouseholdSection({ analysis: analysisWithCliff(gap), footerText: 'f' }),
    ).join(' ');
    // The cliff section really is on the page (guards against the count
    // below passing vacuously because the section didn't render).
    expect(text).toContain('Income at the First Death');
    // Exactly one occurrence of the note's distinguishing text — not zero
    // (it must still say so somewhere) and not two.
    const occurrences = text.match(/no step-up is shown for Blake/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(text).toContain('$1,780.00/mo');
    expect(text).toContain('$1,760.00/mo');
  });

  it('prints nothing for the cliff section when the first death falls outside the timeline', () => {
    const text = collectText(
      HouseholdSection({ analysis: analysisWith(null), footerText: 'f' }),
    ).join(' ');
    expect(text).not.toContain('Income at the First Death');
  });

  // Print always renders real dollars and has no toggle, so this is the one
  // nominal number preserved in prose. Pinned with a non-zero COLA — every
  // other fixture in this file uses `annualCola: 0`, under which nominal and
  // real are numerically identical and this addition couldn't be told apart
  // from a no-op.
  it('states the nominal first-death figure in prose, compounded from the analysis’s own COLA', () => {
    const analysis = {
      ...analysisWithCliff(null),
      assumptions: { annualCola: 2.5, discountRate: 0.025 },
    };
    const text = collectText(HouseholdSection({ analysis, footerText: 'f' })).join(' ');
    expect(text).toContain('Income at the First Death');
    expect(text).toMatch(/nominal/i);
    expect(text).toContain('2.50%');
    // 2048 is `deathYear + 1` (2047 + 1); household total that year is
    // $38,000 real. `asOf` is 2026, so this is 22 years of 2.5% compounding:
    // 38000 * 1.025^22 ≈ $65,420.
    expect(text).toContain('$65,420');
  });
});

/**
 * The printed survivor-claim-date alternative — the same `survivorClaimNote`
 * function the on-screen `SurvivorClaimNote` calls, printed by
 * `HouseholdSection` directly (there is no PDF equivalent component, same as
 * the income-cliff callout above it).
 */
describe('HouseholdSection — the printed survivor-claim note', () => {
  const claim = {
    claimIndex: 2036 * 12 + 4,
    claimAge: '68 years, 0 months',
    survivorLabel: 'Blake',
    baselineTotal: 300_000,
    bestTotal: 435_700,
    gain: 135_700,
    baselineHasSurvivorBand: true,
  };

  it('prints the note exactly once', () => {
    const analysis = { ...analysisWithCliff(null), survivorClaim: claim };
    const text = collectText(
      HouseholdSection({ analysis: analysis as unknown as HouseholdAnalysis, footerText: 'f' }),
    ).join(' ');
    // Counted, not `toContain` — a prior defect on this project printed an
    // identical note twice on one page and `toContain` could not see it.
    const occurrences = text.match(/\$135,700/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(text).toContain('68 years, 0 months');
    expect(text).toMatch(/optimizer/i);
  });

  // Order, not just presence. The note is written to be read AFTER the cliff
  // section — it names no death year of its own because the cliff sentence
  // directly above has just given one, and in nominal mode on screen its
  // dollars-basis clause is phrased as a contrast with those same figures. A
  // note printed above them would be a forward reference to a sentence the
  // reader has not reached. The on-screen surface pins this with a real
  // `compareDocumentPosition` check (`HouseholdPanel.test.tsx`); print had
  // presence coverage only, and `collectText` already returns the strings in
  // document order, so an index comparison is all it needs.
  it('prints the note after the income-cliff section, not before it', () => {
    const analysis = { ...analysisWithCliff(null), survivorClaim: claim };
    const parts = collectText(
      HouseholdSection({ analysis: analysis as unknown as HouseholdAnalysis, footerText: 'f' }),
    );
    const heading = parts.findIndex((t) => t.includes('Income at the First Death'));
    const cliffSentence = parts.findIndex((t) => t.includes('At the first death, projected for'));
    const note = parts.findIndex((t) => t.includes('$135,700'));
    // Guards: all three really are on the page, so the ordering below is not
    // comparing against a -1 from something that never rendered.
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(cliffSentence).toBeGreaterThanOrEqual(0);
    expect(note).toBeGreaterThanOrEqual(0);
    expect(note).toBeGreaterThan(heading);
    // The stronger of the two: after the cliff SENTENCE, not merely after the
    // heading that opens the section.
    expect(note).toBeGreaterThan(cliffSentence);
  });

  it('prints nothing when there is no alternative to show', () => {
    const analysis = { ...analysisWithCliff(null), survivorClaim: null };
    const text = collectText(
      HouseholdSection({ analysis: analysis as unknown as HouseholdAnalysis, footerText: 'f' }),
    ).join(' ');
    expect(text).not.toMatch(/separate survivor claim date/i);
    expect(text).not.toContain('68 years, 0 months');
  });

  // Regression: print always renders real dollars, and `incomeCliffSentence`
  // right above already states "today's dollars, before any cost-of-living
  // adjustment" once (the combined-income caption also legitimately ends in
  // this same clause, for an unrelated sentence about an unrelated chart —
  // that pre-existing occurrence is not the defect this guards against, so
  // this compares WITH and WITHOUT the claim note rather than asserting an
  // absolute count). A version of `survivorClaimNote` that stated its own
  // basis unconditionally added a second, genuinely duplicate copy of the
  // cliff sentence's own clause when the claim note rendered. Counted, not
  // `toContain` — the same reason the "exactly once" test above counts
  // rather than contains.
  it('does not repeat the dollars-basis clause the cliff sentence already stated', () => {
    const countBasisClauses = (survivorClaim: typeof claim | null) => {
      const analysis = { ...analysisWithCliff(null), survivorClaim };
      const text = collectText(
        HouseholdSection({ analysis: analysis as unknown as HouseholdAnalysis, footerText: 'f' }),
      ).join(' ');
      return {
        text,
        count: (text.match(/today.s dollars, before any cost-of-living adjustment/g) ?? [])
          .length,
      };
    };

    const without = countBasisClauses(null);
    const withNote = countBasisClauses(claim);

    // Guard: both sections really are on the page (the cliff sentence and
    // the claim note), so the comparison below isn't passing vacuously
    // because the note didn't render.
    expect(withNote.text).toContain('Income at the First Death');
    expect(withNote.text).toContain('$135,700');
    // The count with the note present must equal the count without it — the
    // note added no new occurrence of the clause in real mode.
    expect(withNote.count).toBe(without.count);
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
    const monthlySeries: MonthlyIncomePoint[] = [
      {
        monthIndex: 2030 * 12,
        year: 2030,
        bySeries: { 'a:personal': 12000, 'b:spousal': 6000 },
        byPersonId: { a: 12000, b: 6000 },
        total: 18000,
      },
    ];
    const text = collectText(CombinedIncomeBars({ monthlySeries, people })).join(' ');
    expect(text).toContain(benefitSeriesLabel('Avery', 'personal'));
    expect(text).toContain(benefitSeriesLabel('Blake', 'spousal'));
  });

  it('omits a band and its legend entry when every month of it is zero', () => {
    // A $0.00 spousal band — reachable, not invented; see
    // `household.test.ts` ("keeps the start date of a spousal entitlement
    // that is fully absorbed") and `CombinedIncomeChart.test.tsx`'s
    // `monthlySeriesWithZeroSpousal`, which pins this against real
    // `analyzeHousehold` output. Hand-built here only to isolate this
    // component's own zero-dropping wiring from the pipeline coverage those
    // files own.
    const monthlySeries: MonthlyIncomePoint[] = [
      {
        monthIndex: 2030 * 12,
        year: 2030,
        bySeries: { 'a:personal': 12000, 'b:spousal': 0 },
        byPersonId: { a: 12000, b: 0 },
        total: 12000,
      },
    ];
    const text = collectText(CombinedIncomeBars({ monthlySeries, people })).join(' ');
    expect(text).not.toMatch(/spousal/i);
    // Self-sufficient against a `visibleBenefitSeries` that returned `[]`
    // unconditionally: that would also make the assertion above pass, so
    // this also pins that a real, surviving series is still printed.
    expect(text).toContain(benefitSeriesLabel('Avery', 'personal'));
  });
});
