import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  combinedIncomeCaption,
  coupleModelingNote,
  incomeCliffSentence,
  SINGLE_CLAIMANT_BENEFIT_NOTE,
  spousalMethodologyCopy,
  spousalSummary,
  survivorGapNote,
  survivorIncomeCaption,
} from './methodologyCopy';
import { analyzeHousehold, type HouseholdAnalysis } from '../lib/household';
import type { IncomeCliff } from '../lib/incomeCliff';
import type { Person } from '../lib/personAnalysis';

/**
 * Only the fields `spousalMethodologyCopy` reads. The full HouseholdAnalysis
 * is an engine output; building one here would mean running the optimizer,
 * which this pure copy function has no business depending on. (The last
 * describe in this file deliberately does run it — see the note there.)
 */
function analysisWith(spousalTopUp?: HouseholdAnalysis['spousalTopUp']): HouseholdAnalysis {
  return {
    status: spousalTopUp ? 'married' : 'single',
    spousalTopUp,
  } as HouseholdAnalysis;
}

describe('spousalMethodologyCopy', () => {
  it('prompts for a marital status when the household is single', () => {
    expect(spousalMethodologyCopy(analysisWith())).toContain('Select Married');
  });

  it('never tells a single claimant that survivor benefits require a couple', () => {
    // "Survivor benefits apply only to a couple" is false as a benefit rule:
    // a survivor benefit is paid precisely to someone who is no longer part of
    // one. A widowed user selecting "Single" was told the benefit they may be
    // collecting does not exist.
    const copy = spousalMethodologyCopy(analysisWith());
    expect(copy).not.toMatch(/only to a couple/i);
    expect(copy).toContain(SINGLE_CLAIMANT_BENEFIT_NOTE);
    expect(copy).toMatch(/SSA does pay survivor benefits to a widow\(er\)/);
  });

  it('states both the reduced and unreduced amounts, attributed to the lower earner', () => {
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 1200,
        atRecommendedFilingAge: 790,
        startsAtSpouseAge: '67',
        lowerEarnerLabel: 'Sarah',
      }),
    );
    expect(copy).toContain("Sarah's spousal top-up is $790.00/mo under the recommended strategy");
    expect(copy).toContain("beginning at Sarah's age 67");
    expect(copy).toContain("The unreduced amount at Sarah's own FRA is $1,200.00/mo");
  });

  it('never describes the top-up as 50% of the other person PIA', () => {
    // The top-up is max(0, higherPIA/2 - lowerPIA), so for a $3,000 / $1,000
    // household it is $500 while 50% of the PIA is $1,500 — the old copy
    // printed the first number under the second's label.
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 500,
        atRecommendedFilingAge: 500,
        startsAtSpouseAge: '67',
        lowerEarnerLabel: 'You',
      }),
    );
    expect(copy).not.toContain('50%');
    expect(copy).toContain('$500.00/mo');
  });

  it('says plainly that no top-up applies rather than printing $0.00', () => {
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 0,
        atRecommendedFilingAge: 0,
        startsAtSpouseAge: null,
        lowerEarnerLabel: 'You',
      }),
    );
    expect(copy).toContain('No top-up applies');
    expect(copy).toContain("does not exceed You's own benefit");
  });

  it('qualifies the zero-entitlement comparison to the FRA benefit it actually makes', () => {
    // `household.ts:262` derives `atFra` from `baseSpousalBenefit`, which
    // compares half the higher earner's PIA against the lower earner's own
    // PIA — their benefit at their own FRA. Unqualified, this sentence denied
    // something that is routinely true: for a lower earner filing at 62 the
    // benefit is ~70% of PIA, so half the higher earner's PIA can genuinely
    // exceed what they are paid while no top-up applies.
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 0,
        atRecommendedFilingAge: 0,
        startsAtSpouseAge: null,
        lowerEarnerLabel: 'You',
      }),
    );
    expect(copy).toContain("does not exceed You's own benefit at their own FRA");
  });

  it('states when the spousal benefit begins', () => {
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 1250,
        atRecommendedFilingAge: 1250,
        startsAtSpouseAge: '68 years, 3 months',
        lowerEarnerLabel: 'Sarah',
      }),
    );
    expect(copy).toMatch(/68 years, 3 months/);
    expect(copy).toMatch(/Sarah/);
  });

  it('no longer claims survivor benefits are unmodeled, because they are modeled', () => {
    // The timeline and the recommendation both include survivor benefits as
    // of the benefit-periods rebase. This sentence used to say the opposite
    // unconditionally.
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 250,
        atRecommendedFilingAge: 200,
        startsAtSpouseAge: '69 years, 1 months',
        lowerEarnerLabel: 'Spouse',
      }),
    );
    expect(copy).not.toContain('Survivor benefits are not modeled');
    expect(copy).toContain('Survivor benefits are included');
  });
});

/**
 * `spousalSummary` is the single source for this sentence on all three
 * surfaces — the on-screen panel, the PDF household page, and the PDF
 * methodology appendix. It exists because three hand-maintained copies
 * drifted: only the screen one grew the zero-entitlement branch, so the PDF
 * printed an unguarded absence marker for the common case.
 */
describe('spousalSummary', () => {
  const base = { atFra: 1000, atRecommendedFilingAge: 800, lowerEarnerLabel: 'Sarah' };

  it('capitalizes a non-proper-noun subject at the start of the sentence', () => {
    const copy = spousalSummary({ ...base, startsAtSpouseAge: '67' }, 'the lower earner');
    expect(copy.startsWith("The lower earner's spousal top-up is $800.00/mo")).toBe(true);
  });

  it('keeps the subject lowercase mid-sentence', () => {
    const copy = spousalSummary(
      { ...base, atFra: 0, atRecommendedFilingAge: 0, startsAtSpouseAge: null },
      'the lower earner',
    );
    expect(copy).toContain("does not exceed the lower earner's own benefit");
    expect(copy).not.toContain('The lower earner');
  });

  it('never emits a start clause when there is no start date', () => {
    // The regression: `beginning at age — — the later of…` reached print for
    // six of the eleven married golden scenarios.
    for (const atFra of [0, 1000]) {
      const copy = spousalSummary(
        { ...base, atFra, atRecommendedFilingAge: 0, startsAtSpouseAge: null },
        'the lower earner',
      );
      expect(copy).not.toContain('beginning at');
      expect(copy).not.toContain('—  ');
      expect(copy).not.toMatch(/age\s*—/);
    }
  });

  it('says a positive entitlement never begins without asserting a single cause', () => {
    // `strategy-calc.ts:145-158` runs the band from the later of the two
    // filing dates to min(survivorStartDate − 1, dependentFinalDate), so the
    // band is dropped by EITHER of two configurations — see the two pipeline
    // tests below. An earlier version of this clause blamed one of them ("the
    // other spouse does not file within their lifetime"), which is flatly
    // untrue in the other. It must name the empty overlap, not a cause.
    const copy = spousalSummary(
      { ...base, atFra: 1000, atRecommendedFilingAge: 0, startsAtSpouseAge: null },
      'the lower earner',
    );
    expect(copy).toContain('never begins under the recommended strategy');
    expect(copy).toContain('both spouses have filed and both are still living');
    expect(copy).toContain("The unreduced amount at the lower earner's own FRA is $1,000.00/mo");
    // The specific false claims this replaced.
    expect(copy).not.toContain('does not file');
    expect(copy).not.toMatch(/within .*lifetime/);
  });

  it('keeps the start date of a $0.00 top-up, which does begin', () => {
    // A band the engine emits at $0.00 — the entitlement is real and starts on
    // a real date, it is just fully absorbed by the lower earner's own
    // delayed credits. Distinct from having no band at all.
    const copy = spousalSummary(
      {
        atFra: 100,
        atRecommendedFilingAge: 0,
        startsAtSpouseAge: '72 years, 3 months',
        lowerEarnerLabel: 'Blythe',
      },
      'Blythe',
    );
    expect(copy).toContain("beginning at Blythe's age 72 years, 3 months");
    expect(copy).toContain('$0.00/mo');
  });
});

/**
 * End-to-end guard on the string the PDF actually prints. The pure cases
 * above cover the branches; this covers the wiring — that real
 * `analyzeHousehold` output, fed through the exact call the PDF makes,
 * never produces a placeholder. This is the one place in this file that runs
 * the optimizer, and it is deliberate: the regression it guards lived in the
 * gap between the calculation's output and the print surface's assumptions.
 */
describe('the printed spousal sentence, over real households', () => {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

  beforeAll(() => {
    vi.stubGlobal('fetch', async (url: string) => {
      const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
      return { ok: true, json: async () => JSON.parse(contents) } as Response;
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  const asOf = new Date(2026, 0, 15);
  const assumptions = { annualCola: 2.5, discountRate: 0.025 };

  const printed = async (people: [Person, Person]) => {
    const analysis = await analyzeHousehold({ status: 'married', people }, assumptions, asOf);
    return spousalSummary(analysis.spousalTopUp!, 'the lower earner');
  };

  const dan: Person = {
    id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
    gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
  };
  const sarah: Person = {
    id: 'b', name: 'Sarah', birthYear: 1964, birthMonth: 2,
    gender: 'female', piaMonthly: 2100, lifeExpectancy: 88,
  };

  it('prints no placeholder for a household with no entitlement', async () => {
    // Two substantial records: half of Dan's PIA never exceeds Sarah's own,
    // so the engine emits no Spousal band and there is no start date. This is
    // the shape of six of the eleven married golden scenarios.
    const copy = await printed([dan, sarah]);
    expect(copy).toContain('No top-up applies');
    expect(copy).not.toContain('beginning at');
    expect(copy).not.toMatch(/—\s*—/);
  });

  it('prints no placeholder when the lower earner dies before the higher earner files', async () => {
    // Eligible but bandless: `atFra` is a positive $1,250 and the engine still
    // emits no Spousal period, because the period's end date precedes its
    // start. Before the absence was modelled as null this printed
    // "beginning at age — — the later of…".
    const young: Person = {
      id: 'a', name: 'Avery', birthYear: 1976, birthMonth: 6,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 85,
    };
    const old: Person = {
      id: 'b', name: 'Blythe', birthYear: 1958, birthMonth: 6,
      gender: 'female', piaMonthly: 500, lifeExpectancy: 75,
    };
    const analysis = await analyzeHousehold(
      { status: 'married', people: [young, old] },
      assumptions,
      asOf,
    );
    // Guards the assertions below — this must genuinely be the positive-
    // entitlement, no-band case, not the zero-entitlement one.
    expect(analysis.spousalTopUp!.atFra).toBeGreaterThan(0);
    expect(analysis.periods.some((b) => b.type === 'spousal')).toBe(false);
    expect(analysis.spousalTopUp!.startsAtSpouseAge).toBeNull();

    const copy = spousalSummary(analysis.spousalTopUp!, 'the lower earner');
    expect(copy).toContain('never begins under the recommended strategy');
    expect(copy).not.toContain('beginning at');
    expect(copy).not.toMatch(/age\s*—/);
  });

  it('prints no placeholder when the HIGHER earner dies before the lower earner files', async () => {
    // The second, distinct way the Spousal band is dropped, and the one the
    // "does not file within their lifetime" wording was false for. Avery is
    // the higher earner, files, and dies Jun 2033 (born Jun 1958, plan-to 75).
    // Blythe is seventeen years younger, so her earliest possible filing —
    // age 62, Jun 2037 — is already after his death, and the band's end
    // (survivorStartDate − 1) falls before its start. The other spouse DID
    // file, and Blythe is alive and collecting survivor benefits, so any
    // sentence blaming a missing filing is untrue here.
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1958, birthMonth: 6,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 75,
    };
    const blythe: Person = {
      id: 'b', name: 'Blythe', birthYear: 1975, birthMonth: 6,
      gender: 'female', piaMonthly: 500, lifeExpectancy: 90,
    };
    const analysis = await analyzeHousehold(
      { status: 'married', people: [avery, blythe] },
      assumptions,
      asOf,
    );
    // Guards: this must be the positive-entitlement, no-band case, and it must
    // be the sub-case where the higher earner did file and then died.
    expect(analysis.spousalTopUp!.atFra).toBeGreaterThan(0);
    expect(analysis.periods.some((b) => b.type === 'spousal')).toBe(false);
    expect(analysis.spousalTopUp!.startsAtSpouseAge).toBeNull();
    expect(analysis.periods.some((b) => b.personId === 'a' && b.type === 'personal')).toBe(true);
    expect(analysis.periods.some((b) => b.personId === 'b' && b.type === 'survivor')).toBe(true);

    const copy = spousalSummary(analysis.spousalTopUp!, 'the lower earner');
    expect(copy).toContain('both spouses have filed and both are still living');
    expect(copy).not.toContain('does not file');
    expect(copy).not.toMatch(/age\s*—/);
  });

  it('prints the real start date when there is one', async () => {
    const noRecord: Person = { ...sarah, piaMonthly: 0 };
    const copy = await printed([dan, noRecord]);
    expect(copy).toMatch(/beginning at the lower earner's age \d+/);
    expect(copy).not.toMatch(/age\s*—/);
  });
});

/**
 * The disclosure for the survivor direction the engine does not model. The
 * combined-income caption affirmatively says each band includes "any spousal
 * or survivor benefit"; for these households that is false, and the figures
 * shown for the survivor are too low.
 */
describe('survivorGapNote', () => {
  /** The three shapes, with the exact figures the pipeline tests below pin. */
  const contemporaneous = {
    survivorLabel: 'Blake',
    deceasedMonthly: 1780,
    survivorOwnMonthly: 1760,
    survivorUnder60: false,
  };
  const notFiled = {
    survivorLabel: 'Blake',
    deceasedMonthly: 1780,
    survivorOwnMonthly: null,
    survivorUnder60: false,
  };
  const under60 = {
    survivorLabel: 'Blake',
    deceasedMonthly: 2016,
    survivorOwnMonthly: null,
    survivorUnder60: true,
  };

  it('renders nothing when there is nothing to disclose', () => {
    expect(survivorGapNote(null)).toBeNull();
    // A caller that has not been updated to pass the field renders nothing
    // rather than throwing.
    expect(survivorGapNote(undefined)).toBeNull();
  });

  it('names the survivor and both monthly figures when both are contemporaneous', () => {
    const note = survivorGapNote(contemporaneous)!;
    expect(note).toContain('modeled only for the lower-earning spouse');
    expect(note).toContain('no step-up is shown for Blake');
    expect(note).toContain('$1,780.00/mo'); // what the deceased was receiving
    expect(note).toContain('$1,760.00/mo'); // the survivor's own, at that death
    expect(note).toContain('lower than SSA would pay');
  });

  it('quotes no dollar figure for a survivor who has not filed at the death', () => {
    // The C1 defect: the survivor's own figure used to be read off their LAST
    // personal band with no date test at all, so the sentence asserted, in the
    // present tense, an amount that may not begin for decades — over a chart
    // rendering those same years at zero.
    const note = survivorGapNote(notFiled)!;
    expect(note).toContain('$1,780.00/mo'); // the deceased's, which is real
    expect(note).toContain('has not filed on their own record by then');
    expect(note).toContain('shows them nothing from that death');
    // Exactly one dollar figure, and it is the deceased's.
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual(['$1,780.00']);
    expect(note).not.toContain('of their own');
  });

  it('says a step-up cannot begin before 60 when the survivor is under 60', () => {
    const note = survivorGapNote(under60)!;
    expect(note).toContain('is under 60 then');
    expect(note).toContain('no widow(er) benefit is payable yet');
    expect(note).toContain('the chart is right to show none');
    expect(note).toContain('from age 60 onward');
    // No claim of an immediate, permanent shortfall, and no invented figure.
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual(['$2,016.00']);
    expect(note).not.toContain('lower than SSA would pay');
  });

  it('replaces the blanket "survivor benefits are included" claim in the panel copy', () => {
    const withGap = {
      status: 'married',
      spousalTopUp: {
        atFra: 0, atRecommendedFilingAge: 0, startsAtSpouseAge: null, lowerEarnerLabel: 'Blake',
      },
      survivorGap: contemporaneous,
    } as unknown as HouseholdAnalysis;

    const copy = spousalMethodologyCopy(withGap);
    expect(copy).toContain('no step-up is shown for Blake');
    // The claim that would be false for this household must not also appear.
    expect(copy).not.toContain('Survivor benefits are included');
  });

  it('keeps the included-survivors sentence when there is no gap', () => {
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 250,
        atRecommendedFilingAge: 200,
        startsAtSpouseAge: '69 years, 1 months',
        lowerEarnerLabel: 'Spouse',
      }),
    );
    expect(copy).toContain('Survivor benefits are included');
    expect(copy).not.toContain('no step-up is shown');
  });
});

describe('survivorIncomeCaption', () => {
  it('states the figure assumes the modeled death direction, for a household with no gap', () => {
    const caption = survivorIncomeCaption(null);
    expect(caption).toContain('ssa.tools engine models');
    expect(caption).toContain('lower-earning spouse outliving the higher earner');
    // Nothing here claims this household's gap is unmodeled — there is none.
    expect(caption).not.toContain('modeled direction runs the other way');
  });

  it('renders the same for undefined as for null, so a caller need not pass the field', () => {
    expect(survivorIncomeCaption(undefined)).toBe(survivorIncomeCaption(null));
  });

  it('points at the existing gap note rather than restating its figures', () => {
    const gap = {
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    };
    const caption = survivorIncomeCaption(gap);
    expect(caption).toContain('understate what the survivor would actually receive');
    expect(caption).toContain('see the note below');
    // The gap note's own figures belong to `survivorGapNote`, not here — a
    // second rendering of them is the exact duplication three of this
    // project's prior defects were made of.
    expect(caption).not.toContain('1,780');
    expect(caption).not.toContain('1,760');
    expect(caption).not.toContain('Blake');
  });
});

/**
 * The chart caption, shared by the on-screen chart and the PDF household page.
 * It was a verbatim duplicate across those two files, and both copies claimed
 * unconditionally that a band includes "any spousal or survivor benefit" —
 * contradicting the gap note directly beneath them.
 *
 * Rewritten a second time once the chart stopped drawing one band per person:
 * "each person's band is everything they are paid" became false the moment a
 * person could hold an own-benefit segment alongside a separate spousal or
 * survivor segment. These tests pin the corrected "segments sum to" wording
 * and the new survivor-increment explanation against drifting back.
 */
describe('combinedIncomeCaption', () => {
  it('claims spousal and survivor segments are included when they are', () => {
    const caption = combinedIncomeCaption(null);
    expect(caption).toContain('their own benefit, plus any spousal or survivor segment');
    expect(caption).toContain('only the months actually paid');
    expect(caption).toContain("today’s dollars, before any cost-of-living adjustment");
    expect(caption).not.toContain('No survivor segment is included');
  });

  it('drops the survivor claim for a household whose survivor benefit is unmodeled', () => {
    const caption = combinedIncomeCaption({
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    });
    expect(caption).not.toContain('or survivor segment is included');
    expect(caption).toContain('their own benefit, plus any spousal segment');
    expect(caption).toContain('No survivor segment is included for this household');
    // The parts that stay true either way.
    expect(caption).toContain('only the months actually paid');
    expect(caption).toContain("today’s dollars, before any cost-of-living adjustment");
  });

  it('treats an unpassed gap the same as no gap', () => {
    expect(combinedIncomeCaption(undefined)).toBe(combinedIncomeCaption(null));
  });

  it('uses typographic apostrophes, as the copies it replaced did', () => {
    // Both deleted copies wrote `&rsquo;`. This sentence prints beside copy
    // that still does — the PDF disclaimer's "today’s dollars" shares its
    // page — so ASCII here renders straight quotes next to curly ones.
    const caption = combinedIncomeCaption(null);
    expect(caption).toContain('Each person’s segments');
    expect(caption).toContain('today’s dollars');
    expect(caption).not.toContain("'");
  });

  // The one fact a reader needs to parse the chart at all: a survivor
  // segment is stacked ON TOP of the personal band, not a replacement for
  // it. Asserted for both the modeled and the unmodeled-direction household,
  // since it's a general statement about how the chart works, not a claim
  // about this particular household's bands.
  it('explains that a survivor segment is the increment above the personal band, not a replacement', () => {
    const noGap = combinedIncomeCaption(null);
    expect(noGap).toMatch(/survivor segment is the increment above the personal band/i);
    expect(noGap).toMatch(/personal band keeps paying what it already was/i);

    const gap = combinedIncomeCaption({
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    });
    expect(gap).toMatch(/survivor segment is the increment above the personal band/i);
  });
});

/**
 * The couple half of the PDF disclosures block. Conditional for the same
 * reason the caption is, and covered here as well as at the print surface
 * because the two live on one physical page for a married report.
 */
describe('coupleModelingNote', () => {
  it('claims survivor benefits are modeled when they are', () => {
    const note = coupleModelingNote(null);
    expect(note).toContain('The spousal top-up and survivor benefits are both modeled');
    expect(note).toContain('ssa.tools couple optimizer');
  });

  it('stops claiming survivor benefits are modeled for a gap household', () => {
    const note = coupleModelingNote({
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    });
    expect(note).toContain('The spousal top-up is modeled');
    expect(note).toContain('the survivor benefit this household would actually receive is not');
    expect(note).not.toMatch(/survivor benefits are (both )?modeled/);
  });
});

/**
 * The income-cliff sentence — the one an adviser says out loud about what
 * happens to household income at the first death. Shared by the on-screen
 * `IncomeCliffCallout` and `pdf/HouseholdSection`.
 */
describe('incomeCliffSentence', () => {
  const base: IncomeCliff = {
    deathYear: 2047,
    before: 60000,
    after: 38000,
    dropPercent: 36.666666666666664,
    survivorLabel: 'Sarah',
  };

  it('states the year, both full-year totals, and the survivor', () => {
    const sentence = incomeCliffSentence(base);
    expect(sentence).toContain('2047');
    expect(sentence).toContain('$60,000');
    expect(sentence).toContain('$38,000');
    expect(sentence).toContain('Sarah');
    expect(sentence).toMatch(/falls 36\.7%/);
  });

  it('says income does not fall, rather than "falls 0.0%", when dropPercent is zero', () => {
    const sentence = incomeCliffSentence({ ...base, before: 50000, after: 52000, dropPercent: 0 });
    expect(sentence).toContain('does not fall');
    expect(sentence).not.toMatch(/falls \d/);
    expect(sentence).toContain('$50,000');
    expect(sentence).toContain('$52,000');
  });

  // Code-review finding: an earlier draft closed with "once {survivor} is
  // the only one still collecting" — a payment claim that is false the
  // moment `after` is $0, which `incomeCliff.test.ts` and a live run against
  // the engine (the under-60 survivor-gap fixture from
  // `benefitPeriods.test.ts`, b. Jun 1956 PIA $1,600 plan-to 76 / b. Jun
  // 1976) both confirm is reachable. The closing clause must be a
  // household-composition fact, true regardless of the dollar amount.
  it('never claims the survivor is "collecting" anything, even when after is $0', () => {
    const sentence = incomeCliffSentence({
      ...base,
      before: 24192,
      after: 0,
      dropPercent: 100,
    });
    expect(sentence).toContain('$0');
    expect(sentence).not.toMatch(/collecting/i);
    expect(sentence).toContain("Sarah is the household's only remaining member");
  });

  it('never asserts how the survivor benefit is determined, only that they are the last one left', () => {
    // "steps up to the larger of the two" is SSA's real rule but is false for
    // a survivorGap household, where `after` is understated because the
    // engine did not model the step-up in that direction. The sentence must
    // not claim it for any household shape, gap or not.
    const sentence = incomeCliffSentence(base);
    expect(sentence).not.toMatch(/larger/i);
    expect(sentence).not.toMatch(/steps? (up|into)/i);
  });
});

/**
 * The gap note over real `analyzeHousehold` output, one household per branch.
 *
 * The pure cases above cover the wording; these cover the thing the C1 defect
 * actually was — that the figure in the sentence must be the one the person is
 * being paid *in the month of the death being described*. Each test reads the
 * bands back and asserts the note against them, so a note that drifts back to
 * an end-of-life figure fails here rather than looking plausible.
 */
describe('the survivor-gap note over real households', () => {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

  beforeAll(() => {
    vi.stubGlobal('fetch', async (url: string) => {
      const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
      return { ok: true, json: async () => JSON.parse(contents) } as Response;
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  const asOf = new Date(2026, 0, 15);
  const noCola = { annualCola: 0, discountRate: 0.025 };

  const run = (a: Person, b: Person) =>
    analyzeHousehold({ status: 'married', people: [a, b] }, noCola, asOf);

  /** What `personId` is actually paid on their own record in `monthIndex`. */
  const paidAt = (analysis: HouseholdAnalysis, personId: string, monthIndex: number) =>
    analysis.periods.find(
      (x) =>
        x.personId === personId &&
        x.type === 'personal' &&
        x.startIndex <= monthIndex &&
        monthIndex <= x.endIndex,
    ) ?? null;

  const lastBand = (analysis: HouseholdAnalysis, personId: string) =>
    analysis.periods
      .filter((x) => x.personId === personId && x.type === 'personal')
      .reduce((latest, x) => (x.startIndex > latest.startIndex ? x : latest));

  it('quotes contemporaneous figures when the survivor has already filed', async () => {
    // Avery (b. Mar 1957, PIA $1,500, plan-to 85) is the engine's dependent
    // and dies Mar 2042. Blake (b. Sep 1970, PIA $1,600, plan-to 100) is the
    // earner, has filed by then, and holds the smaller benefit.
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1957, birthMonth: 3,
      gender: 'female', piaMonthly: 1500, lifeExpectancy: 85,
    };
    const blake: Person = {
      id: 'b', name: 'Blake', birthYear: 1970, birthMonth: 9,
      gender: 'male', piaMonthly: 1600, lifeExpectancy: 100,
    };
    const analysis = await run(avery, blake);
    const death = (1957 + 85) * 12 + 2; // Mar 2042, inclusive.

    expect(analysis.survivorGap).not.toBeNull();
    const gap = analysis.survivorGap!;
    expect(gap.survivorLabel).toBe('Blake');
    expect(gap.survivorUnder60).toBe(false);
    // Both figures are what each person is actually paid at that death.
    expect(gap.deceasedMonthly).toBe(paidAt(analysis, 'a', death)!.monthlyAmount);
    expect(gap.survivorOwnMonthly).toBe(paidAt(analysis, 'b', death + 1)!.monthlyAmount);

    const note = survivorGapNote(gap)!;
    expect(note).toContain('$1,780.00/mo'); // Avery's, at the death
    expect(note).toContain('$1,760.00/mo'); // Blake's own, that same month
    expect(note).toContain('lower than SSA would pay');
  });

  it('quotes no figure for the survivor when the chart shows them nothing', async () => {
    // Same couple, but Avery's plan-to age of 75 puts the death in Mar 2032 —
    // six years before Blake files. The note used to assert the $1,760 his
    // last band pays, in the present tense, while the chart beneath showed him
    // at $0 for those years.
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1957, birthMonth: 3,
      gender: 'female', piaMonthly: 1500, lifeExpectancy: 75,
    };
    const blake: Person = {
      id: 'b', name: 'Blake', birthYear: 1970, birthMonth: 9,
      gender: 'male', piaMonthly: 1600, lifeExpectancy: 100,
    };
    const analysis = await run(avery, blake);
    const death = (1957 + 75) * 12 + 2; // Mar 2032.

    const gap = analysis.survivorGap!;
    expect(gap.survivorOwnMonthly).toBeNull();
    expect(gap.survivorUnder60).toBe(false);
    // Guard: he really is paid nothing then, and really is paid something later.
    expect(paidAt(analysis, 'b', death + 1)).toBeNull();
    const later = lastBand(analysis, 'b').monthlyAmount;
    expect(later).toBeGreaterThan(0);

    const note = survivorGapNote(gap)!;
    expect(note).toContain('has not filed on their own record by then');
    // The figure the old note printed must not appear anywhere in the new one.
    expect(note).not.toContain(`$${later.toLocaleString('en-US')}.00`);
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual([
      `$${gap.deceasedMonthly.toLocaleString('en-US')}.00`,
    ]);
  });

  it('says a step-up cannot begin until 60 when the survivor is too young', async () => {
    // The household from the C1 report: Avery (b. Jun 1956, PIA $1,600,
    // plan-to 76) dies Jun 2032, when Blake (b. Jun 1976) is 56. No widow(er)
    // benefit is payable to anyone under 60, so the chart's $0 is correct for
    // those years — the old note asserted an immediate permanent shortfall.
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1956, birthMonth: 6,
      gender: 'female', piaMonthly: 1600, lifeExpectancy: 76,
    };
    const blake: Person = {
      id: 'b', name: 'Blake', birthYear: 1976, birthMonth: 6,
      gender: 'male', piaMonthly: 1650, lifeExpectancy: 88,
    };
    const analysis = await run(avery, blake);
    const death = (1956 + 76) * 12 + 5; // Jun 2032.

    const gap = analysis.survivorGap!;
    expect(gap.survivorLabel).toBe('Blake');
    expect(gap.survivorUnder60).toBe(true);
    expect(gap.survivorOwnMonthly).toBeNull();
    expect(gap.deceasedMonthly).toBe(paidAt(analysis, 'a', death)!.monthlyAmount);
    expect(paidAt(analysis, 'b', death + 1)).toBeNull();

    // And the chart really does render a multi-year hole at zero there, which
    // is what makes an asserted monthly amount a fabricated figure.
    const holeYears = analysis.combinedTimeline.filter(
      (p) => p.year > 2032 && p.year < 2045 && p.total === 0,
    );
    expect(holeYears.length).toBeGreaterThan(5);

    const note = survivorGapNote(gap)!;
    expect(note).toContain('is under 60 then');
    expect(note).toContain('from age 60 onward');
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual([
      `$${gap.deceasedMonthly.toLocaleString('en-US')}.00`,
    ]);
  });
});
