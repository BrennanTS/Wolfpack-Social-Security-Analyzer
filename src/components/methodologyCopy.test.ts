import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spousalMethodologyCopy, spousalSummary, survivorGapNote } from './methodologyCopy';
import { analyzeHousehold, type HouseholdAnalysis } from '../lib/household';
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
  it('renders nothing when there is nothing to disclose', () => {
    expect(survivorGapNote(null)).toBeNull();
    // A caller that has not been updated to pass the field renders nothing
    // rather than throwing.
    expect(survivorGapNote(undefined)).toBeNull();
  });

  it('names the survivor and both monthly figures', () => {
    const note = survivorGapNote({
      survivorLabel: 'Blake',
      survivorOwnMonthly: 1760,
      deceasedMonthly: 1780,
    })!;
    expect(note).toContain('modeled only for the lower-earning spouse');
    expect(note).toContain('no step-up is shown for Blake');
    expect(note).toContain('$1,780.00/mo'); // what the deceased was receiving
    expect(note).toContain('$1,760.00/mo'); // the survivor's own
    expect(note).toContain('lower than SSA would pay');
  });

  it('replaces the blanket "survivor benefits are included" claim in the panel copy', () => {
    const withGap = {
      status: 'married',
      spousalTopUp: {
        atFra: 0, atRecommendedFilingAge: 0, startsAtSpouseAge: null, lowerEarnerLabel: 'Blake',
      },
      survivorGap: { survivorLabel: 'Blake', survivorOwnMonthly: 1760, deceasedMonthly: 1780 },
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
