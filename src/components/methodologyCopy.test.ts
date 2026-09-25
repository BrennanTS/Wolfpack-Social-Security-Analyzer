import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  COMBINED_INCOME_SUBTITLE,
  combinedIncomeCaption,
  coupleModelingNote,
  incomeCliffSentence,
  nominalFirstDeathNote,
  SINGLE_CLAIMANT_BENEFIT_NOTE,
  spousalMethodologyCopy,
  spousalSummary,
  survivorClaimNote,
  survivorFloorNote,
  survivorGapNote,
  survivorGapScope,
  survivorIncomeCaption,
  householdValueCaption,
} from './methodologyCopy';
import {
  analyzeHousehold,
  type HouseholdAnalysis,
  type HouseholdStrategy,
} from '../lib/household';
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
        lowerEarnerLabel: 'Jane', lowerEarnerGender: null,
      }),
    );
    expect(copy).toContain("Jane's spousal benefit is $790.00/mo under the recommended strategy");
    expect(copy).toContain("starting at Jane's age 67, once both spouses have filed");
    expect(copy).toContain("The unreduced amount at Jane's own full retirement age is $1,200.00/mo");
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
        lowerEarnerLabel: 'Client', lowerEarnerGender: null,
      }),
    );
    expect(copy).not.toContain('50%');
    expect(copy).toContain('$500.00/mo');
  });

  it('says plainly that no spousal benefit applies rather than printing $0.00', () => {
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 0,
        atRecommendedFilingAge: 0,
        startsAtSpouseAge: null,
        lowerEarnerLabel: 'Client', lowerEarnerGender: null,
      }),
    );
    expect(copy).toContain('No spousal benefit applies');
    expect(copy).toContain("does not exceed Client's own benefit");
    expect(copy).not.toContain('$0.00');
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
        lowerEarnerLabel: 'Client', lowerEarnerGender: null,
      }),
    );
    expect(copy).toContain("does not exceed Client's own benefit at their own full retirement age");
  });

  it('states when the spousal benefit begins', () => {
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 1250,
        atRecommendedFilingAge: 1250,
        startsAtSpouseAge: '68 years, 3 months',
        lowerEarnerLabel: 'Jane', lowerEarnerGender: null,
      }),
    );
    expect(copy).toMatch(/68 years, 3 months/);
    expect(copy).toMatch(/Jane/);
  });

  it('no longer claims survivor benefits are unmodeled, because they are modeled', () => {
    // The timeline and the recommendation both include survivor benefits as
    // of the benefit-periods rebase. This sentence used to say the opposite
    // unconditionally.
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 250,
        atRecommendedFilingAge: 200,
        startsAtSpouseAge: '69 years, 1 month',
        lowerEarnerLabel: 'Spouse', lowerEarnerGender: null,
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
  const base = {
    atFra: 1000,
    atRecommendedFilingAge: 800,
    lowerEarnerLabel: 'Jane',
    lowerEarnerGender: null,
  };

  it('capitalizes a non-proper-noun subject at the start of the sentence', () => {
    const copy = spousalSummary({ ...base, startsAtSpouseAge: '67' }, 'the lower earner');
    expect(copy.startsWith("The lower earner's spousal benefit is $800.00/mo")).toBe(true);
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
      expect(copy).not.toContain('starting at');
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
    expect(copy).toContain('never starts under the recommended strategy');
    expect(copy).toContain('both spouses have filed and both are living');
    expect(copy).toContain("The unreduced amount at the lower earner's own full retirement age is $1,000.00/mo");
    // Rule 5: a benefit that never starts gets no dollar figure of its own.
    // It printed "$0.00/mo ... though it never begins".
    expect(copy).not.toContain('$0.00');
    // The specific false claims this replaced.
    expect(copy).not.toContain('does not file');
    expect(copy).not.toMatch(/within .*lifetime/);
  });

  it('keeps the start date of a $0.00 spousal benefit, which does begin', () => {
    // A band the engine emits at $0.00 — the entitlement is real and starts on
    // a real date, it is just fully absorbed by the lower earner's own
    // delayed credits. Distinct from having no band at all.
    const copy = spousalSummary(
      {
        atFra: 100,
        atRecommendedFilingAge: 0,
        startsAtSpouseAge: '72 years, 3 months',
        lowerEarnerLabel: 'Blythe', lowerEarnerGender: null,
      },
      'Blythe',
    );
    expect(copy).toContain("starting at Blythe's age 72 years, 3 months");
    expect(copy).toContain('$0.00/mo');
  });

  // `subject === null` is how `household.ts` reports an exact PIA tie: there
  // is no lower earner, so no name should reach the sentence at all. And the
  // sentence must claim only what the guard establishes — an exact PIA
  // match, not "identical records": two people can share a PIA with
  // completely different earnings histories, ages, or genders.
  //
  // Asserted as an EXACT match, not a substring check, and independent of
  // `atFra`: a `subject ?? 'the lower earner'`-style fallback would silently
  // route this branch through the SAME `atFra`-driven templates the
  // named-subject tests above exercise (e.g. "does not exceed the lower
  // earner's own benefit"), which also contain the words "the lower earner"
  // — a substring check on that phrase cannot tell the real null-branch
  // sentence apart from that fallback, and would pass either way.
  it('renders the exact PIA-scoped, name-agnostic sentence when subject is null, regardless of atFra', () => {
    for (const atFra of [0, 1000]) {
      const copy = spousalSummary(
        { ...base, atFra, atRecommendedFilingAge: 0, startsAtSpouseAge: null, lowerEarnerLabel: null },
        null,
      );
      expect(copy).toBe(
        `Both spouses have the same full benefit at full retirement age, so neither is the lower earner, and ` +
          `there is no spousal benefit to claim on the other's record.`,
      );
    }
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

  const john: Person = {
    id: 'a', name: 'John', birthYear: 1962, birthMonth: 4, birthDay: 15,
    gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
  };
  const jane: Person = {
    id: 'b', name: 'Jane', birthYear: 1964, birthMonth: 2, birthDay: 15,
    gender: 'female', piaMonthly: 2100, lifeExpectancy: 88,
  };

  it('prints no placeholder for a household with no entitlement', async () => {
    // Two substantial records: half of John's PIA never exceeds Jane's own,
    // so the engine emits no Spousal band and there is no start date. This is
    // the shape of six of the eleven married golden scenarios.
    const copy = await printed([john, jane]);
    expect(copy).toContain('No spousal benefit applies');
    expect(copy).not.toContain('starting at');
    expect(copy).not.toMatch(/—\s*—/);
  });

  it('prints no placeholder when the lower earner dies before the higher earner files', async () => {
    // Eligible but bandless: `atFra` is a positive $1,250 and the engine still
    // emits no Spousal period, because the period's end date precedes its
    // start. Before the absence was modeled as null this printed
    // "beginning at age — — the later of…".
    const young: Person = {
      id: 'a', name: 'Avery', birthYear: 1976, birthMonth: 6, birthDay: 15,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 85,
    };
    const old: Person = {
      id: 'b', name: 'Blythe', birthYear: 1958, birthMonth: 6, birthDay: 15,
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
    expect(copy).toContain('never starts under the recommended strategy');
    expect(copy).not.toContain('starting at');
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
      id: 'a', name: 'Avery', birthYear: 1958, birthMonth: 6, birthDay: 15,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 75,
    };
    const blythe: Person = {
      id: 'b', name: 'Blythe', birthYear: 1975, birthMonth: 6, birthDay: 15,
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
    expect(copy).toContain('both spouses have filed and both are living');
    expect(copy).not.toContain('does not file');
    expect(copy).not.toMatch(/age\s*—/);
  });

  it('prints the real start date when there is one', async () => {
    const noRecord: Person = { ...jane, piaMonthly: 0 };
    const copy = await printed([john, noRecord]);
    expect(copy).toMatch(/starting at the lower earner's age \d+/);
    expect(copy).not.toMatch(/age\s*—/);
  });
});

/**
 * The on-screen path specifically — `spousalMethodologyCopy` interpolates
 * `analysis.spousalTopUp.lowerEarnerLabel` as a name
 * (`methodologyCopy.ts:330`), unlike the PDF's `printed` helper above, which
 * always passes the generic literal `'the lower earner'`. On an exact PIA
 * tie that is exactly where a positional tie-break would leak: the engine's
 * `classifyEarnerDependent` still has to pick a slot on a tie
 * (`earner-dependent.ts:15-28`, falling through to a fixed `else`), and an
 * earlier version of `household.ts` mirrored that pick into
 * `lowerEarnerLabel` — internally consistent with the engine, but still
 * naming whichever spouse happened to be entered first. A test that
 * recomputes the classifier the same way `household.ts` does, with the same
 * array order, cannot catch this (it is a tautology); this drives a real
 * household through BOTH entry orders and diffs the rendered sentence.
 */
describe('spousalMethodologyCopy — entry order on an equal-PIA tie', () => {
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

  const equalA: Person = {
    id: 'a', name: 'John', birthYear: 1962, birthMonth: 4, birthDay: 15,
    gender: 'male', piaMonthly: 2200, lifeExpectancy: 85,
  };
  const equalB: Person = {
    id: 'b', name: 'Jane', birthYear: 1964, birthMonth: 2, birthDay: 15,
    gender: 'female', piaMonthly: 2200, lifeExpectancy: 88,
  };

  it('prints the identical sentence whichever spouse is entered first, naming neither', async () => {
    const forward = await analyzeHousehold(
      { status: 'married', people: [equalA, equalB] },
      assumptions,
      asOf,
    );
    const swapped = await analyzeHousehold(
      { status: 'married', people: [{ ...equalB, id: 'a' }, { ...equalA, id: 'b' }] },
      assumptions,
      asOf,
    );

    // Guards this really is the tie this test means to exercise.
    expect(forward.spousalTopUp!.lowerEarnerLabel).toBeNull();
    expect(swapped.spousalTopUp!.lowerEarnerLabel).toBeNull();

    const forwardCopy = spousalMethodologyCopy(forward);
    const swappedCopy = spousalMethodologyCopy(swapped);
    expect(swappedCopy).toBe(forwardCopy);
    expect(forwardCopy).not.toContain('John');
    expect(forwardCopy).not.toContain('Jane');
    // The exact null-subject sentence, not a substring check on "Primary
    // Insurance Amount" or "the lower earner" alone: either would also pass
    // for a `subject ?? 'the lower earner'`-style fallback that silently
    // routed this branch through the named-subject templates instead (see
    // `spousalSummary`'s equivalent guard above for the full reasoning), and
    // this also re-proves the overclaim fix — "identical records" would fail
    // this exact match too.
    expect(forwardCopy).toContain(
      `Both spouses have the same full benefit at full retirement age, so neither is the lower earner, and ` +
        `there is no spousal benefit to claim on the other's record.`,
    );
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
    survivorLabel: 'Blake', survivorGender: null,
    deceasedMonthly: 1780,
    survivorOwnMonthly: 1760,
    survivorUnder60: false,
  };
  const notFiled = {
    survivorLabel: 'Blake', survivorGender: null,
    deceasedMonthly: 1780,
    survivorOwnMonthly: null,
    survivorUnder60: false,
  };
  const under60 = {
    survivorLabel: 'Blake', survivorGender: null,
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
    expect(note).toContain('no survivor benefit is shown for Blake');
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

  it('says a survivor benefit usually cannot begin before 60 when the survivor is under 60', () => {
    const note = survivorGapNote(under60)!;
    expect(note).toContain('is under 60 then');
    // "Usual", not "none is payable": a disabled widow(er) can claim from 50,
    // and one caring for a young child at any age.
    expect(note).toContain('the usual earliest age for a widow(er)’s benefit');
    expect(note).not.toContain('no widow(er) benefit is payable');
    // It said the chart was "right to show none" and then that none is shown
    // from 60 either; the two read as a contradiction. Only the second stays.
    expect(note).not.toContain('right to show none');
    expect(note).toContain('from 60 onward, and none is shown');
    // No claim of an immediate, permanent shortfall, and no invented figure.
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual(['$2,016.00']);
    expect(note).not.toContain('lower than SSA would pay');
  });

  it('replaces the blanket "survivor benefits are included" claim in the panel copy', () => {
    const withGap = {
      status: 'married',
      spousalTopUp: {
        atFra: 0, atRecommendedFilingAge: 0, startsAtSpouseAge: null, lowerEarnerLabel: 'Blake', lowerEarnerGender: null,
      },
      survivorGap: contemporaneous,
    } as unknown as HouseholdAnalysis;

    const copy = spousalMethodologyCopy(withGap);
    expect(copy).toContain('the survivor benefit SSA would pay Blake is not in the recommendation');
    // The claim that would be false for this household must not also appear.
    expect(copy).not.toContain('Survivor benefits are included');
  });

  it('points at the gap note on the Household tab rather than printing it a second time', () => {
    // The card sits below the tabs, so on the Household tab it shares a
    // screen with `CombinedIncomeChart`, which prints the gap note itself.
    // Embedding the note here put the same paragraph on screen twice.
    for (const gap of [contemporaneous, notFiled, under60]) {
      const withGap = {
        status: 'married',
        spousalTopUp: {
          atFra: 0, atRecommendedFilingAge: 0, startsAtSpouseAge: null, lowerEarnerLabel: 'Blake', lowerEarnerGender: null,
        },
        survivorGap: gap,
      } as unknown as HouseholdAnalysis;

      const copy = spousalMethodologyCopy(withGap);
      const note = survivorGapNote(gap)!;
      // No sentence of the note reappears here, and neither do its figures.
      for (const sentence of note.split(/(?<=\.)\s+/)) {
        expect(copy).not.toContain(sentence);
      }
      expect(copy).not.toMatch(/\$[\d,]+\.\d\d\/mo at that death/);
      expect(copy).toContain('the note under the combined income chart, on the Household tab');
    }
  });

  it('keeps the included-survivors sentence when there is no gap', () => {
    const copy = spousalMethodologyCopy(
      analysisWith({
        atFra: 250,
        atRecommendedFilingAge: 200,
        startsAtSpouseAge: '69 years, 1 month',
        lowerEarnerLabel: 'Spouse', lowerEarnerGender: null,
      }),
    );
    expect(copy).toContain('Survivor benefits are included');
    expect(copy).not.toContain('no step-up is shown');
  });
});

/**
 * Comparison rows carrying only what the caption reads: each row's filing
 * ages (for the total-delay ordering) and its survivor-income figure. The
 * cast is the same device `analysisWith` above uses and for the same reason —
 * a full `HouseholdStrategy` carries engine objects (`MonthDuration`), and
 * this is a copy test, not an engine test. The engine-fed version of these
 * assertions lives in `household.test.ts`, on a real household.
 */
function rowsWith(...entries: [ages: number[], income: number | null][]): HouseholdStrategy[] {
  return entries.map(([ages, income], i) => ({
    key: `row-${i}`,
    filingAges: ages.map((decimalYears) => ({ decimalYears })),
    survivorIncome: income,
  })) as unknown as HouseholdStrategy[];
}

/** Delaying genuinely does raise the survivor's income for this household. */
const RISING = rowsWith([[67, 67], 44000], [[70, 70], 52000], [[70, 64], 48000]);

/**
 * The household that falsified the old unbranched claim, in row form: John
 * b. 1958 PIA 2400 plan-to 78 with Jane b. 1968 PIA 1200 plan-to 90. The
 * optimum (John 70, Jane 62y1m) leaves the survivor $36,480; delaying both to
 * 70 leaves her $0, because she has not filed by the year after his death.
 * `survivorGap` is null for it — no gap branch ever covered this.
 */
const FALLING = rowsWith([[70, 62.08], 36480], [[70, 70], 0]);

describe('survivorIncomeCaption', () => {
  it('states which spouse is assumed to die first, without naming one', () => {
    const caption = survivorIncomeCaption(RISING, null);
    // In the reader's terms. It said "the death direction implied by each
    // spouse's own life-expectancy input", which is the model's vocabulary.
    expect(caption).toContain('the spouse who reaches their plan-to age first dies first');
    expect(caption).not.toMatch(/death direction|life-expectancy input/);
    // The earlier version hardcoded a direction — false for a household whose
    // higher earner happens to be the one projected to survive, with no gap
    // firing to correct it (that direction is a fact about who dies first
    // per life expectancy, not about who earns more).
    expect(caption).not.toContain('lower-earning spouse outliving the higher earner');
    // Nothing here claims this household's gap is unmodeled — there is none.
    expect(caption).not.toContain('understate');
  });

  it('makes the delay claim when the rows beneath it actually rise', () => {
    const caption = survivorIncomeCaption(RISING, null);
    expect(caption).toContain('Filing later raises this figure for this household');
    expect(caption).not.toContain('Here it depends on');
    // It states what the figures show and stops: "the argument for delaying"
    // was advocacy under the table where the plan is chosen.
    expect(caption).not.toMatch(/argument for/i);
  });

  it('states the composition fact instead when delaying LOWERS the figure', () => {
    // The critical case: no gap at all, so nothing else in the caption would
    // have caught it. The old copy said "Delaying raises this every year the
    // survivor lives through it" directly beneath a column reading $36,480
    // for the optimum and $0 for "both delay to 70".
    const caption = survivorIncomeCaption(FALLING, null);
    expect(caption).not.toContain('Filing later raises');
    expect(caption).toContain('whether the survivor has started benefits by then');
    expect(caption).toContain('$0 means nothing has started yet');
    // Both drivers named, not just the survivor's own filing age: the figure
    // is a survivor benefit derived from the first-to-die's record too.
    expect(caption).toContain('what the spouse who died was receiving');
  });

  it('does not read a flat all-zero column as rising', () => {
    const caption = survivorIncomeCaption(rowsWith([[67, 67], 0], [[70, 70], 0]), null);
    expect(caption).not.toContain('Filing later raises');
  });

  it('claims nothing about figures when no row has one', () => {
    // Both people reach their plan-to age in the same month: `firstDeath`
    // returns null, every cell is an em dash. Both surfaces hide the column
    // and this caption; if one ever renders it anyway, it must not assert
    // figures — or a dollars basis for figures that are not there.
    const caption = survivorIncomeCaption(rowsWith([[67, 67], null], [[70, 70], null]), null);
    expect(caption).toContain('No strategy in this table has a figure');
    expect(caption).not.toContain('Filing later raises');
    expect(caption).not.toMatch(/today.s dollars/i);
  });

  it('renders the same for undefined as for null, so a caller need not pass the field', () => {
    expect(survivorIncomeCaption(RISING, undefined)).toBe(survivorIncomeCaption(RISING, null));
  });

  it('points at the existing gap note rather than restating its figures, when the survivor has already reached 60', () => {
    const gap = {
      survivorLabel: 'Blake', survivorGender: null,
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    };
    const caption = survivorIncomeCaption(RISING, gap);
    expect(caption).toContain('understate what the survivor would receive');
    expect(caption).toContain('See the note below');
    expect(caption).toContain('Filing later raises this figure for this household');
    expect(caption).not.toMatch(/\bengine\b/i);
    // The gap note's own figures belong to `survivorGapNote`, not here — a
    // second rendering of them is the exact duplication three of this
    // project's prior defects were made of.
    expect(caption).not.toContain('1,780');
    expect(caption).not.toContain('1,760');
    expect(caption).not.toContain('Blake');
  });

  it('makes neither the delay claim nor the understate claim when the survivor is under 60', () => {
    // Reachable household: the survivor is the engine's earner (so no
    // step-up is modeled for them at all) and is under 60 at the death, with
    // no personal band that month. Every named row shares the same death
    // month (filing strategy doesn't move it — see `withSurvivorIncome`), and
    // every row's own filing age is >= 62, so no row's survivor benefit has
    // started either. The column reads $0 across every strategy — which the
    // rise check now reads off the rows rather than inferring from the guard.
    const gap = {
      survivorLabel: 'Blake', survivorGender: null,
      deceasedMonthly: 2016,
      survivorOwnMonthly: null,
      survivorUnder60: true,
    };
    const caption = survivorIncomeCaption(rowsWith([[67, 67], 0], [[70, 70], 0]), gap);
    expect(caption).toContain('the usual earliest age for a widow(er)’s benefit');
    expect(caption).toContain('See the note below');
    expect(caption).not.toContain('Filing later raises');
    expect(caption).not.toContain('understate');
  });

  // The column sits directly beside "Household value", which stays in
  // present-value dollars no matter what this toggle does — two unmarked
  // unit systems in one table otherwise. Covered across all three gap
  // branches, since the basis clause is appended in every one of them.
  describe('dollars mode', () => {
    it('defaults to naming today’s dollars when mode is omitted', () => {
      expect(survivorIncomeCaption(RISING, null)).toMatch(/In today.s dollars\./);
    });

    it('names today’s dollars in real mode, in the no-gap branch', () => {
      const caption = survivorIncomeCaption(RISING, null, 'real');
      expect(caption).toMatch(/In today.s dollars\./);
      expect(caption).not.toMatch(/future dollars/i);
    });

    it('names future dollars, and says the rest of the table matches, in the no-gap branch', () => {
      const caption = survivorIncomeCaption(RISING, null, 'nominal');
      expect(caption).toMatch(/future dollars, like the other figures in this table/i);
      expect(caption).not.toMatch(/today.s dollars/i);
      // The em dash the nominal branch ended in.
      expect(caption).not.toContain('—');
    });

    it('states the dollars basis in the falling branch too', () => {
      expect(survivorIncomeCaption(FALLING, null, 'real')).toMatch(/today.s dollars/i);
      expect(survivorIncomeCaption(FALLING, null, 'nominal')).toMatch(/future dollars/i);
    });

    it('states the dollars basis in the under-60 branch too', () => {
      const gap = {
        survivorLabel: 'Blake', survivorGender: null,
        deceasedMonthly: 2016,
        survivorOwnMonthly: null,
        survivorUnder60: true,
      };
      const zeroed = rowsWith([[67, 67], 0], [[70, 70], 0]);
      expect(survivorIncomeCaption(zeroed, gap, 'real')).toMatch(/today.s dollars/i);
      expect(survivorIncomeCaption(zeroed, gap, 'nominal')).toMatch(/future dollars/i);
    });

    it('states the dollars basis in the gap branch too', () => {
      const gap = {
        survivorLabel: 'Blake', survivorGender: null,
        deceasedMonthly: 1780,
        survivorOwnMonthly: 1760,
        survivorUnder60: false,
      };
      expect(survivorIncomeCaption(RISING, gap, 'real')).toMatch(/today.s dollars/i);
      expect(survivorIncomeCaption(RISING, gap, 'nominal')).toMatch(/future dollars/i);
    });
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
 *
 * Rewritten a third time (crediting a band's full annual rate to every year
 * it merely touched) and partly undone in a fourth once that version turned
 * out to double-count a transition year shared by an outgoing and an
 * incoming band — the chart moved to its own MONTHLY series instead
 * (`buildMonthlyIncomeSeries` in `household.ts`), which has no year-bucket
 * artifact left to disclose. The third rewrite's added clause ("a filing
 * year and a final year render at the same height as a full one") is
 * therefore gone, not reworded again; the tests below pin its absence
 * alongside the "annual rate" framing that survives every version.
 */
/**
 * The subtitle directly above `combinedIncomeCaption`'s own sentence —
 * they used to be independently hand-typed strings in `CombinedIncomeChart`
 * and `HouseholdSection`, and in print the two are concatenated straight
 * into the SAME `<Text>`, so a reader hits both in one breath. It used to
 * say "Annual Social Security income BY YEAR", which stopped being true the
 * moment the chart moved off calendar-year buckets — a filing year and a
 * final year plot at full height, not by-year. These pin that the wording
 * agrees with `combinedIncomeCaption`'s own "annual rate" framing rather
 * than contradicting it.
 */
describe('COMBINED_INCOME_SUBTITLE', () => {
  it('does not claim the chart is bucketed by year', () => {
    expect(COMBINED_INCOME_SUBTITLE).not.toMatch(/by year/i);
  });

  it('states the annual-rate framing, and the caption beneath does not restate or contradict it', () => {
    expect(COMBINED_INCOME_SUBTITLE).toMatch(/annual rate/i);
    // In print the two share one <Text>; the caption used to open by saying
    // the annual-rate framing a second time.
    expect(combinedIncomeCaption(null)).not.toMatch(/annual rate/i);
    expect(combinedIncomeCaption(null)).not.toMatch(/by year|lifetime/i);
  });
});

describe('combinedIncomeCaption', () => {
  it('claims spousal and survivor segments are included when they are', () => {
    const caption = combinedIncomeCaption(null);
    expect(caption).toContain('includes any spousal or survivor benefit');
    expect(caption).toContain("today’s dollars, before any cost-of-living adjustment");
    expect(caption).not.toContain('No survivor benefit is shown');
  });

  it('drops the survivor claim for a household whose survivor benefit is unmodeled', () => {
    const caption = combinedIncomeCaption({
      survivorLabel: 'Blake', survivorGender: null,
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    });
    expect(caption).not.toContain('or survivor benefit');
    expect(caption).toContain('includes any spousal benefit');
    expect(caption).toContain('No survivor benefit is shown for this household');
    // It used to explain how a survivor segment stacks right after saying
    // there was none.
    expect(caption).not.toMatch(/sits on top|one check/);
    // The part that stays true either way.
    expect(caption).toContain("today’s dollars, before any cost-of-living adjustment");
  });

  // The clause a briefly-shipped, calendar-year-bucketed version of the
  // chart needed and a monthly-resolution one does not — a month is either
  // inside a band or it isn't, so there is no partial-year height to
  // disclose. Pinned absent rather than left untested, since this exact
  // clause shipped once already and is the obvious thing to accidentally
  // reintroduce.
  it('does not claim a filing or final year renders at full height, now that the chart is monthly', () => {
    const caption = combinedIncomeCaption(null);
    expect(caption).not.toMatch(/filing year and a final year render at the same height/i);
    expect(caption).not.toMatch(/shorter than a full one/i);
    expect(caption).not.toMatch(/counting only the months actually paid/i);
    expect(caption).not.toMatch(/only part of each is actually paid/i);
  });

  it('treats an unpassed gap the same as no gap', () => {
    expect(combinedIncomeCaption(undefined)).toBe(combinedIncomeCaption(null));
  });

  it('uses typographic apostrophes, as the copies it replaced did', () => {
    // Both deleted copies wrote `&rsquo;`. This sentence prints beside copy
    // that still does — the PDF disclaimer's "today’s dollars" shares its
    // page — so ASCII here renders straight quotes next to curly ones.
    const caption = combinedIncomeCaption(null);
    expect(caption).toContain('Each person’s part of the chart');
    expect(caption).toContain('today’s dollars');
    expect(caption).not.toContain("'");
  });

  // The one fact a reader needs to parse the chart at all: the survivor's
  // amount is stacked ON TOP of their own benefit, not a replacement for it,
  // and the two are one payment. Said in terms of what is paid rather than
  // how the chart is drawn: "the increment above the personal band beneath
  // it" was the chart's construction, in its own vocabulary.
  it('explains that the survivor amount sits on top of their own benefit, as one check', () => {
    const noGap = combinedIncomeCaption(null);
    expect(noGap).toContain('the survivor’s added amount sits on top of any benefit of their own');
    expect(noGap).toContain('SSA pays the two as one check');
    expect(noGap).not.toMatch(/increment|personal band|segment/i);
  });

  // The toggle's whole reason for existing: a chart in nominal dollars beside
  // a caption still claiming "today's dollars" would be exactly the recurring
  // defect this project keeps finding — a right number with wrong text next
  // to it. `mode` defaults to 'real' so every call above, written before the
  // toggle existed, keeps asserting the sentence that was already correct.
  describe('dollars mode', () => {
    it('defaults to the today’s-dollars sentence when mode is omitted', () => {
      expect(combinedIncomeCaption(null)).toContain(
        'today’s dollars, before any cost-of-living adjustment',
      );
    });

    it('states today’s dollars explicitly in real mode', () => {
      const caption = combinedIncomeCaption(null, 'real');
      expect(caption).toContain('today’s dollars, before any cost-of-living adjustment');
      expect(caption).not.toMatch(/future dollars/i);
    });

    it('says nominal in nominal mode, and stops claiming today’s dollars', () => {
      const caption = combinedIncomeCaption(null, 'nominal');
      expect(caption).toMatch(/future dollars/i);
      expect(caption).not.toContain('today’s dollars, before any cost-of-living adjustment');
    });

    // Code-review finding: an earlier version of this test asserted the
    // caption was byte-identical between modes once the trailing "Amounts
    // are..." sentence was stripped — which does not verify mode-independence,
    // it MANDATES it. That is wrong: "that personal band keeps paying what
    // it already was" is a claim that the band's amount is constant over
    // time, true in real dollars (the engine applies no COLA) but false in
    // nominal, where every band compounds forward and a reader checking the
    // personal band either side of the death year sees it grow. The
    // structural point the sentence exists to make — a survivor segment is
    // an increment on top of the personal band, never a replacement for it —
    // does survive the mode; only the "stays flat" wording is mode-specific.
    // These three tests replace the single over-broad one, pinning exactly
    // that boundary instead of erasing it.
    // The caption no longer says whether the survivor's own benefit stays
    // flat or grows, which is the one claim that differed between modes, so
    // everything before the dollars sentence is now the same in both. That
    // is asserted rather than assumed: a flat-band claim creeping back into
    // one mode would be the defect the old three tests were guarding.
    it('says the same thing in both modes apart from the dollars sentence', () => {
      const lead = (caption: string) => caption.split(' Amounts are in ')[0];
      expect(lead(combinedIncomeCaption(null, 'nominal'))).toBe(
        lead(combinedIncomeCaption(null, 'real')),
      );
      expect(combinedIncomeCaption(null, 'nominal')).not.toMatch(/keeps paying what it already was/);
      expect(combinedIncomeCaption(null, 'nominal')).not.toMatch(/\bCOLA\b/);
    });
  });
});

/**
 * The couple half of the PDF disclosures block. Conditional for the same
 * reason the caption is, and covered here as well as at the print surface
 * because the two live on one physical page for a married report.
 */
describe('coupleModelingNote', () => {
  it('claims survivor benefits are modeled when they are', () => {
    const note = coupleModelingNote(null, true);
    expect(note).toContain('Spousal and survivor benefits are both modeled');
    expect(note).toContain('the couple optimizer');
  });

  const gap = {
    survivorLabel: 'Blake', survivorGender: null,
    deceasedMonthly: 1780,
    survivorOwnMonthly: 1760,
    survivorUnder60: false,
  };

  it('stops claiming survivor benefits are modeled for a gap household', () => {
    for (const householdPrinted of [true, false]) {
      const note = coupleModelingNote(gap, householdPrinted);
      expect(note).toContain('Spousal benefits are modeled');
      expect(note).toContain(survivorGapScope(gap));
      expect(note).not.toMatch(/survivor benefits are (both )?modeled via/i);
    }
  });

  it('points at the gap note only when the report prints the household block', () => {
    // The appendix is its own layout block. A layout without the household
    // block has no "Combined Household Income" section, and a pointer to it
    // sends the reader looking for a page that is not there.
    expect(coupleModelingNote(gap, true)).toContain('See the note under Combined Household Income');
    expect(coupleModelingNote(gap, false)).not.toContain('See the note');
    expect(coupleModelingNote(gap, false)).not.toContain('household page');
  });
});

/**
 * The scope sentence both the screen card and the PDF appendix use for a gap
 * household, so the two cannot describe what is left out differently.
 */
describe('survivorGapScope', () => {
  it('names the survivor and says what the figures leave out, without the note’s amounts', () => {
    const scope = survivorGapScope({
      survivorLabel: 'Blake', survivorGender: null,
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    });
    expect(scope).toContain('modeled only for the lower-earning spouse');
    expect(scope).toContain('the survivor benefit SSA would pay Blake is not in the recommendation');
    expect(scope).not.toMatch(/\$[\d,]+/);
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
    survivorLabel: 'Jane',
  };

  it('states the year, both full-year totals, and the survivor', () => {
    const sentence = incomeCliffSentence(base);
    expect(sentence).toContain('2047');
    expect(sentence).toContain('$60,000');
    expect(sentence).toContain('$38,000');
    expect(sentence).toContain('Jane');
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
    expect(sentence).toContain("Jane is the household's only remaining member");
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

  // The boxed callout has no unit statement anywhere else in it — this
  // clause is the only place the sentence says which dollars `before`/
  // `after` are in. `mode` states, it does not convert: the caller
  // (`HouseholdPanel`, via `IncomeCliffCallout`) already fed `cliff` figures
  // in the right mode; this just names them.
  describe('dollars mode', () => {
    it('defaults to stating today’s dollars when mode is omitted', () => {
      expect(incomeCliffSentence(base)).toMatch(/today.s dollars, before any cost-of-living/i);
    });

    it('states today’s dollars explicitly in real mode', () => {
      const sentence = incomeCliffSentence(base, 'real');
      expect(sentence).toMatch(/today.s dollars, before any cost-of-living/i);
      expect(sentence).not.toMatch(/future dollars/i);
    });

    it('states nominal dollars in nominal mode, and stops claiming today’s', () => {
      const sentence = incomeCliffSentence(base, 'nominal');
      expect(sentence).toMatch(/future dollars/i);
      expect(sentence).not.toMatch(/today.s dollars, before any cost-of-living/i);
    });

    it('changes only the trailing dollars-basis clause, not the figures or the survivor claim', () => {
      const real = incomeCliffSentence(base, 'real').replace(/These figures.*$/, '');
      const nominal = incomeCliffSentence(base, 'nominal').replace(/These figures.*$/, '');
      expect(nominal).toBe(real);
    });
  });
});

/**
 * The print-only sentence stating the nominal-dollar equivalent of the
 * income cliff's `after` figure — the one nominal number clients ask about,
 * preserved in prose since the PDF can't offer the on-screen toggle. Takes
 * the nominal figure already computed (by `lib/dollarsMode.ts`) rather than
 * computing it, so these tests pin only the wording, not the compounding
 * arithmetic — that's `dollarsMode.test.ts`'s job.
 */
describe('nominalFirstDeathNote', () => {
  const base: IncomeCliff = {
    deathYear: 2047,
    before: 60000,
    after: 38000,
    dropPercent: 36.666666666666664,
    survivorLabel: 'Jane',
  };

  it('states the year after the death, the nominal figure, and the COLA assumed', () => {
    const note = nominalFirstDeathNote(base, 48620.15, 2.5);
    expect(note).toContain('2048');
    expect(note).toContain('$48,620');
    expect(note).toContain('2.50%');
    expect(note).toMatch(/as it will actually be paid/i);
  });

  it('is the identity at a zero COLA — same figure, still labeled nominal', () => {
    const note = nominalFirstDeathNote(base, 38000, 0);
    expect(note).toContain('$38,000');
    expect(note).toContain('0.00%');
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
    // Re-homed when the optimizer moved to a plan-to-age horizon; the old
    // couple stopped reaching this branch. Found by
    // `find-candidates.sweep.ts` (`SWEEP_FIND=survivor-gap-filed`), which
    // searches the real pipeline. Avery is the SURVIVOR here — the shorter
    // plan-to age belongs to the person who nonetheless outlives the other,
    // because Blake is eleven years older.
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1975, birthMonth: 1, birthDay: 15,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 72,
    };
    const blake: Person = {
      id: 'b', name: 'Blake', birthYear: 1962, birthMonth: 12, birthDay: 15,
      gender: 'female', piaMonthly: 2400, lifeExpectancy: 84,
    };
    const analysis = await run(avery, blake);
    const death = (1962 + 84) * 12 + 11; // Dec 2046, inclusive — Blake's.

    expect(analysis.survivorGap).not.toBeNull();
    const gap = analysis.survivorGap!;
    expect(gap.survivorLabel).toBe('Avery');
    expect(gap.survivorUnder60).toBe(false);
    // Both figures are what each person is actually paid at that death —
    // read off the bands rather than restated, so the note and the chart
    // cannot drift apart.
    expect(gap.deceasedMonthly).toBe(paidAt(analysis, 'b', death)!.monthlyAmount);
    expect(gap.survivorOwnMonthly).toBe(paidAt(analysis, 'a', death + 1)!.monthlyAmount);

    const note = survivorGapNote(gap)!;
    expect(note).toContain('$2,608.00/mo'); // Blake's, at the death
    expect(note).toContain('$2,112.00/mo'); // Avery's own, that same month
    expect(note).toContain('lower than SSA would pay');
  });

  it('quotes no figure for the survivor when the chart shows them nothing', async () => {
    // Same couple, but Avery's plan-to age of 75 puts the death in Mar 2032 —
    // six years before Blake files. The note used to assert the $1,760 his
    // last band pays, in the present tense, while the chart beneath showed him
    // at $0 for those years.
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1957, birthMonth: 3, birthDay: 15,
      gender: 'female', piaMonthly: 1500, lifeExpectancy: 75,
    };
    const blake: Person = {
      id: 'b', name: 'Blake', birthYear: 1970, birthMonth: 9, birthDay: 15,
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
    // Blake's own pronoun, because the report knows it. The gap carries the
    // survivor's gender for exactly this sentence; a household that left the
    // field blank gets they/them, which `pronouns.test.ts` pins.
    expect(gap.survivorGender).toBe('male');
    expect(note).toContain('has not filed on his own record by then');
    expect(note).toContain('shows him nothing');
    expect(note).toContain('until his own benefit begins');
    expect(note).not.toContain('their own record');
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
      id: 'a', name: 'Avery', birthYear: 1956, birthMonth: 6, birthDay: 15,
      gender: 'female', piaMonthly: 1600, lifeExpectancy: 76,
    };
    const blake: Person = {
      id: 'b', name: 'Blake', birthYear: 1976, birthMonth: 6, birthDay: 15,
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
    expect(note).toContain('from 60 onward');
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual([
      `$${gap.deceasedMonthly.toLocaleString('en-US')}.00`,
    ]);
  });
});

describe('survivorClaimNote', () => {
  it('states the claim month and the gain, and says the optimizer cannot consider it', () => {
    const note = survivorClaimNote({
      claimIndex: 2036 * 12 + 4,
      claimAge: '68 years, 0 months',
      survivorLabel: 'Jane',
      baselineTotal: 300_000,
      bestTotal: 435_700,
      gain: 135_700,
      baselineHasSurvivorBand: true,
    })!;
    expect(note).toMatch(/Jane/);
    expect(note).toMatch(/68 years, 0 months/);
    expect(note).toMatch(/\$135,700/);
    expect(note).toMatch(/one filing date/);
  });

  it('renders nothing when there is no alternative to show', () => {
    expect(survivorClaimNote(null)).toBeNull();
  });

  it('says it is for comparison only, when the baseline already shows a survivor band', () => {
    const note = survivorClaimNote({
      claimIndex: 2036 * 12 + 4,
      claimAge: '67 years, 10 months',
      survivorLabel: 'Jane',
      baselineTotal: 732_640,
      bestTotal: 811_680,
      gain: 79_040,
      baselineHasSurvivorBand: true,
    })!;
    expect(note).toContain('It is shown for comparison only');
    // Discriminating: the `true` branch names the date the chart already
    // shows, and must not also read like the `false` branch, which claims no
    // such date is shown at all — a ternary bug that swapped the two would
    // pass a merely-`toContain` check on either alone.
    expect(note).toContain('instead of when the chart above shows it starting');
    expect(note).not.toContain('which the chart above does not show');
    // Points at the chart, not an invented "plan" noun — the thing that
    // actually shows a survivor-benefit start date on this page.
    expect(note).toContain('the chart above');
  });

  it('does not claim the alternative is earlier than a chart the baseline never showed it on', () => {
    // `baselineHasSurvivorBand: false` means there is NO survivor benefit
    // anywhere on screen for this figure to be an alternative to — a phrase
    // like "earlier than the chart shows" would be false here, since the
    // chart shows nothing. Discriminating in the same way as the
    // `true`-branch test above: deleting the ternary and always emitting the
    // `true` clause must fail THIS assertion, where a merely-`toMatch`
    // regex calibrated to the wrong phrasing would not.
    const note = survivorClaimNote({
      claimIndex: 2035 * 12 + 4,
      claimAge: '60',
      survivorLabel: 'Bob',
      baselineTotal: 0,
      bestTotal: 102_960,
      gain: 102_960,
      baselineHasSurvivorBand: false,
    })!;
    expect(note).toMatch(/Bob/);
    expect(note).toMatch(/\$102,960/);
    expect(note).toContain('which the chart above does not show');
    expect(note).not.toContain('instead of when');
    expect(note).toContain('the chart above');
  });

  it('calls itself a plain sum in both dollars modes, and not a present value where the page is one', () => {
    const build = (mode: 'real' | 'nominal') =>
      survivorClaimNote(
        {
          claimIndex: 2036 * 12 + 4,
          claimAge: '68 years, 0 months',
          survivorLabel: 'Jane',
          baselineTotal: 300_000,
          bestTotal: 435_700,
          gain: 135_700,
          baselineHasSurvivorBand: true,
        },
        mode,
      )!;
    expect(build('real')).toMatch(/plain sum, not a present value/i);
    expect(build('nominal')).toMatch(/plain sum/i);
  });

  it('states its dollars basis only in nominal mode, where the figure and the page can disagree', () => {
    // `gain`/`baselineTotal`/`bestTotal` are real-dollars sums straight off
    // the engine's bands and are NEVER run through the nominal transform —
    // `mode` here only decides whether to SAY so, never whether to convert.
    const alt = {
      claimIndex: 2036 * 12 + 4,
      claimAge: '68 years, 0 months',
      survivorLabel: 'Jane', survivorGender: null,
      baselineTotal: 300_000,
      bestTotal: 435_700,
      gain: 135_700,
      baselineHasSurvivorBand: true,
    };

    // Real mode (the default, and print's only mode): `incomeCliffSentence`
    // directly above already states this exact clause, so repeating it here
    // would print the identical sentence twice on one page. The clause must
    // be ABSENT — this is the assertion that matters, not the presence check
    // below.
    const real = survivorClaimNote(alt, 'real')!;
    expect(real).not.toMatch(/future dollars/i);
    expect(real).not.toContain('today’s dollars');

    // Nominal mode: the figure above says future dollars, this figure has
    // not moved, and that mismatch is exactly what the clause exists to
    // prevent a reader from missing. The GAIN ITSELF must be unchanged
    // between the two calls — only the disclosure differs.
    const nominal = survivorClaimNote(alt, 'nominal')!;
    expect(nominal).toContain('in today’s dollars');
    expect(nominal).toContain('$135,700');
    // Everything but the basis sentence is the same in both modes.
    const withoutBasis = (note: string) => note.replace(/ It is a plain sum[^.]*\./, '');
    expect(withoutBasis(real)).toBe(withoutBasis(nominal));

    // The default with no `mode` argument at all matches the explicit
    // `'real'` call — every pre-existing call site keeps its exact prior
    // wording.
    expect(survivorClaimNote(alt)).toBe(real);
  });

  it('marks itself as the one figure the basis does not move', () => {
    // History, because the sentence has been wrong in both directions. It
    // first read "Unlike the figures above", which overclaimed; it was then
    // narrowed to the chart and the first-death figures, the only two the
    // toggle moved at the time. The report basis now drives the whole page —
    // Household value, "vs. best", the grid, every exhibit — so this note's
    // own straight-sum figures are the exception, and naming two surfaces
    // would tell a reader the strategy table had not moved when it had.
    const nominal = survivorClaimNote(
      {
        claimIndex: 2036 * 12 + 4,
        claimAge: '68 years, 0 months',
        survivorLabel: 'Jane',
        baselineTotal: 300_000,
        bestTotal: 435_700,
        gain: 135_700,
        baselineHasSurvivorBand: true,
      },
      'nominal',
    )!;
    expect(nominal).not.toContain('Unlike the figures above');
    expect(nominal).not.toContain('Unlike the chart above');
    expect(nominal).toContain('unlike the other figures on this page');
    // The grammar slip this sentence shipped with: "this one figures are".
    expect(nominal).not.toContain('this one figures');
    // The sentence beside it on the same screen, which used to say the
    // opposite. Pinned here so a future reword of either one has to face the
    // other: both columns of the strategy table are on the report's basis,
    // and only this note's figure is not.
    expect(
      survivorIncomeCaption(
        [{ survivorIncome: 36_480 } as HouseholdStrategy],
        null,
        'nominal',
      ),
    ).toContain('like the other figures in this table');
  });

  it('names the benefit with one on-screen noun in both branches', () => {
    // The chart legend this sentence points at says "survivor"
    // (`benefitSeriesLabel`), so both halves of the ternary say "survivor
    // benefit". They used to split — "the survivor benefit" when a band was
    // on screen, "a widow(er) benefit" when none was — which reads as two
    // different benefits rather than one shown two ways.
    const base = {
      claimIndex: 2036 * 12 + 4,
      claimAge: '60',
      survivorLabel: 'Bob', survivorGender: null,
      baselineTotal: 0,
      bestTotal: 102_960,
      gain: 102_960,
    };
    for (const baselineHasSurvivorBand of [true, false]) {
      const note = survivorClaimNote({ ...base, baselineHasSurvivorBand })!;
      expect(note).toMatch(/survivor benefit at age 60/);
      expect(note).not.toMatch(/widow\(er\)/);
    }
  });

  it('does not describe the optimizer as holding filing ages fixed', () => {
    // The strategy table directly above varies exactly those ages, row by
    // row, so "holds each spouse's own filing date fixed" read as a denial of
    // the table. What is true — and what the module's own docstring already
    // said — is that it carries ONE filing date per person, with no second
    // date for a survivor claim.
    const note = survivorClaimNote({
      claimIndex: 2036 * 12 + 4,
      claimAge: '60',
      survivorLabel: 'Bob',
      baselineTotal: 0,
      bestTotal: 102_960,
      gain: 102_960,
      baselineHasSurvivorBand: false,
    })!;
    expect(note).toContain('gives each person one filing date');
    expect(note).not.toContain('filing date fixed');
    expect(note).toContain('cannot set a separate one for the survivor benefit');
  });

  it('reads correctly for a bare-year claim age, e.g. exactly 60', () => {
    const note = survivorClaimNote({
      claimIndex: 2038 * 12 + 4,
      claimAge: '60',
      survivorLabel: 'Jane',
      baselineTotal: 732_640,
      bestTotal: 858_440,
      gain: 125_800,
      baselineHasSurvivorBand: true,
    })!;
    expect(note).toMatch(/age 60\b/);
  });
});

describe('survivorFloorNote', () => {
  const floor = {
    survivorLabel: 'Spouse', survivorGender: null,
    deceasedLabel: 'Client',
    deceasedMonthly: 2789,
    survivorMonthly: 3268.65,
  };

  it('renders nothing when there is nothing to explain', () => {
    expect(survivorFloorNote(null)).toBeNull();
    expect(survivorFloorNote(undefined)).toBeNull();
  });

  it('quotes both amounts, so the figure being doubted is in the sentence', () => {
    // An adviser reading it is checking the chart against a number they think
    // is too high. Naming only the rule leaves them to do the multiplication.
    const note = survivorFloorNote(floor)!;
    expect(note).toContain('$3,268.65');
    expect(note).toContain('$2,789.00');
  });

  it('names the rule and which direction it runs', () => {
    const note = survivorFloorNote(floor)!;
    expect(note).toMatch(/widow\(er\)’s limit/);
    expect(note).toContain('82.5%');
    // The reason the survivor comes out ahead: they do not inherit the whole
    // of an early-filing reduction. Without this the sentence states a rule
    // without saying why it produces the shape on screen.
    expect(note).toContain('filed before full retirement age');
  });
});

/**
 * The caption under the column the whole report is anchored on.
 *
 * It said "in today's money" and named a discount rate unconditionally, which
 * survived only because nothing could change either. The report basis changes
 * both, and a caption describing the wrong one is worse than none — a reader
 * who believes a column of inflated figures is in today's money has no way to
 * find out from the page.
 */
describe('householdValueCaption', () => {
  it('names today’s dollars only when that is what the column holds', () => {
    expect(householdValueCaption('2.50%', 'real')).toContain('in today’s dollars');
    const nominal = householdValueCaption('2.50%', 'nominal');
    expect(nominal).not.toContain('today’s');
    expect(nominal).toContain('in future dollars, including the assumed yearly increase');
  });

  it('gives a single person one lifetime, not "both your lifetimes"', () => {
    // The horizon is part of what the figure is. The caption said "both your
    // lifetimes" and "each of you" beside one person's number.
    const single = householdValueCaption('2.50%', 'real', true, false);
    expect(single).toContain('over your lifetime, assuming you live exactly to the age set for you');
    expect(single).not.toMatch(/lifetimes|each of you|both/);
    expect(householdValueCaption('2.50%', 'real', true, true)).toContain(
      'over your lifetimes, assuming each of you lives exactly to the age set for you',
    );
  });

  it('says the fixed-age assumption once', () => {
    // It said it twice in one sentence: "rather than averaging over how long
    // someone might live, so it is a figure for those ages and not an average
    // across all of them".
    const caption = householdValueCaption('2.50%', 'real');
    expect(caption).not.toMatch(/averag/);
    expect(caption.match(/age set for/g)).toHaveLength(1);
  });

  it('stops charging for distance when nothing is discounted', () => {
    // "counted at 0.00% less per year for being further away" is not false so
    // much as absurd, and it reads as a setting the adviser forgot rather than
    // one they chose.
    const off = householdValueCaption('0.00%', 'nominal', false);
    expect(off).not.toContain('0.00%');
    expect(off).toContain('Nothing is discounted for how far away a payment is');
    expect(householdValueCaption('2.50%', 'real', true)).toContain('2.50% less per year');
  });

  it('defaults to the basis every existing caller had', () => {
    expect(householdValueCaption('2.50%')).toBe(householdValueCaption('2.50%', 'real', true));
  });
});

/**
 * Pronouns for the person a sentence is about.
 *
 * The report names one claimant and then says "their own record" beside that
 * name — a form's register, in a document an adviser hands to the person it
 * describes. Every sentence about ONE named individual now reads the gender
 * the app already collects, and falls back to they/them when it is blank.
 */
describe('sentences about one named person', () => {
  const spousal = (gender: 'male' | 'female' | null) => ({
    atFra: 0,
    atRecommendedFilingAge: 0,
    startsAtSpouseAge: null,
    lowerEarnerLabel: 'Jane',
    lowerEarnerGender: gender,
  });

  it('uses the lower earner’s own pronoun in the no-top-up sentence', () => {
    expect(spousalSummary(spousal('female'), 'Jane')).toContain(
      "exceed Jane's own benefit at her own full retirement age",
    );
    expect(spousalSummary(spousal('male'), 'Jane')).toContain('at his own full retirement age');
  });

  it('falls back to they/them when the gender was never entered', () => {
    // Not a defensive branch: the field is optional, and a report can reach
    // print without it. The neutral wording has to stay grammatical.
    expect(spousalSummary(spousal(null), 'Jane')).toContain(
      'at their own full retirement age',
    );
  });
});
