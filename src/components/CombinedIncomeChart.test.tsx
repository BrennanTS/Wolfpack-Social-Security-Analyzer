import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReferenceLine } from 'recharts';
import { CombinedIncomeChart } from './CombinedIncomeChart';
import { analyzeHousehold } from '../lib/household';
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { CombinedTimelinePoint } from '../lib/household';
import type { Person } from '../lib/personAnalysis';

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

// Mirrors `household.test.ts` exactly rather than inventing new figures.
const dan: Person = {
  id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
  gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
};
const sarah: Person = {
  id: 'b', name: 'Sarah', birthYear: 1964, birthMonth: 2,
  gender: 'female', piaMonthly: 2100, lifeExpectancy: 88,
};
// dan/sarah both have substantial records and produce no spousal band (see
// `household.test.ts` — "reports no spousal start when there is no
// entitlement at all"), so the spousal fixture needs the pairing that
// genuinely has one: sarah with no record of her own draws a real spousal
// band on dan's record.
const noRecordSarah: Person = { ...sarah, piaMonthly: 0 };

// The $0.00 spousal-band fixture, reused verbatim from `household.test.ts`
// ("keeps the start date of a spousal entitlement that is fully absorbed")
// rather than invented. Avery (PIA $3,000) files at 70; the real couple
// *optimizer* — not a forced filing age — files Blythe (PIA $1,400, FRA
// 66y8m) at 67y10m, 14 months past her own FRA. Her own benefit is then
// 1400 * (1 + 14 * 2/3%) = $1,530.67, already above the $1,500 combined
// (half-of-Avery's-PIA) cap, so the engine's Spousal band is real — it does
// begin — but carries $0.00 for every month it runs. This makes it a
// genuinely optimizer-reachable $0 band, not one that needs forced ages.
const avery: Person = {
  id: 'a', name: 'Avery', birthYear: 1960, birthMonth: 6,
  gender: 'male', piaMonthly: 3000, lifeExpectancy: 85,
};
const blythe: Person = {
  id: 'b', name: 'Blythe', birthYear: 1958, birthMonth: 3,
  gender: 'female', piaMonthly: 1400, lifeExpectancy: 90,
};
const zeroSpousalAssumptions = { annualCola: 0, discountRate: 0.025 };

let timelineWithSpousal: CombinedTimelinePoint[];
let timelineWithSurvivor: CombinedTimelinePoint[];
let timelineWithZeroSpousal: CombinedTimelinePoint[];

beforeAll(async () => {
  const spousalResult = await analyzeHousehold(
    { status: 'married', people: [dan, noRecordSarah] },
    assumptions,
    asOf,
  );
  timelineWithSpousal = spousalResult.combinedTimeline;

  // dan/sarah (real figures both ways) — confirmed by `household.test.ts`
  // ("exposes the engine periods on the analysis") to produce a genuine
  // Survivor band for Sarah under the engine's one modeled direction.
  const survivorResult = await analyzeHousehold(
    { status: 'married', people: [dan, sarah] },
    assumptions,
    asOf,
  );
  timelineWithSurvivor = survivorResult.combinedTimeline;

  const zeroResult = await analyzeHousehold(
    { status: 'married', people: [avery, blythe] },
    zeroSpousalAssumptions,
    asOf,
  );
  timelineWithZeroSpousal = zeroResult.combinedTimeline;
  // Guard: if the optimizer ever stopped filing Blythe past her own FRA,
  // this fixture would stop being the $0-band case, and the "omits a band"
  // test below would pass vacuously — there would be no band to hide. Fail
  // loudly here instead of losing coverage silently.
  const zeroSpousalBand = zeroResult.periods.find((b) => b.type === 'spousal');
  if (!zeroSpousalBand || zeroSpousalBand.monthlyAmount !== 0) {
    throw new Error(
      'avery/blythe no longer produces a $0.00 spousal band under the optimizer — fixture is stale',
    );
  }
});

const people = [dan, sarah];

// `bySeries` added so this fixture still satisfies `CombinedTimelinePoint`;
// the exact composition doesn't matter for the caption/note tests below,
// which don't read the series breakdown.
const timeline: CombinedTimelinePoint[] = [
  { year: 2030, bySeries: { 'a:personal': 24000 }, byPersonId: { a: 24000, b: 0 }, total: 24000 },
  {
    year: 2031,
    bySeries: { 'a:personal': 24000, 'b:personal': 18000 },
    byPersonId: { a: 24000, b: 18000 },
    total: 42000,
  },
];

// For the single-claimant tests below: `visibleBenefitSeries` now throws if
// a `bySeries` key names someone absent from `people` (see household.ts —
// that used to default silently to person 0, drawing a wrong label with no
// visible error), so a single-person `people` array needs a timeline whose
// series only ever name that one person, not the two-person `timeline` above.
const singleTimeline: CombinedTimelinePoint[] = [
  { year: 2030, bySeries: { 'a:personal': 24000 }, byPersonId: { a: 24000 }, total: 24000 },
];

/**
 * `ResponsiveContainer` measures its parent via a resize observer, and
 * jsdom reports zero size for that parent — Recharts intentionally renders
 * nothing (no <svg>, no axes, no series) rather than divide by zero. So
 * these tests don't assert on chart internals; they assert on what the
 * component itself controls regardless of the measured size: it renders
 * without throwing, and the legend row (driven by `personLabel` /
 * `benefitSeriesLabel`, not by Recharts) shows the right names. See
 * task-18-report.md for the fuller explanation of this gap.
 */
describe('CombinedIncomeChart', () => {
  it('renders without throwing for a two-person household', () => {
    expect(() =>
      render(<CombinedIncomeChart timeline={timeline} people={people} />),
    ).not.toThrow();
  });

  it('renders without throwing for a single-person household', () => {
    expect(() =>
      render(<CombinedIncomeChart timeline={singleTimeline} people={[people[0]]} />),
    ).not.toThrow();
  });

  it('labels the legend with personLabel names, not raw ids', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    expect(screen.getByText(/Dan/)).toBeDefined();
    expect(screen.getByText(/Sarah/)).toBeDefined();
  });

  it('falls back to You/Spouse when a person has no name', () => {
    const unnamed = [{ id: 'a' }, { id: 'b' }] as Person[];
    render(<CombinedIncomeChart timeline={timeline} people={unnamed} />);
    expect(screen.getByText(/You/)).toBeDefined();
    expect(screen.getByText(/Spouse/)).toBeDefined();
  });

  // `buildCombinedTimeline` now sums the engine's benefit-period bands, so a
  // person's band is their personal benefit PLUS any spousal and survivor
  // benefit, credited only for the months actually paid. The caption used to
  // say the exact opposite of all three — that bands were own-benefit-only,
  // that a no-record spouse showed as $0, and that survivor benefits were
  // unmodeled. These guard the corrected caption against drifting back.
  it('says the bands include spousal and survivor benefits, for a couple', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/spousal or survivor segment/i);
    // The claims the rebase falsified must not come back.
    expect(caveat.textContent).not.toMatch(/excludes any spousal/i);
    expect(caveat.textContent).not.toMatch(/survivor benefits are not\s+modeled/i);
    expect(caveat.textContent).not.toMatch(/shows here as \$0/i);
  });

  // The chart now draws one segment per person per benefit type rather than
  // one band per person, so the old "each person's band is everything they
  // are paid" claim became false the moment a spousal or survivor segment
  // could sit beside the personal one. This is the caption's second
  // rewrite — guarding the corrected "segments sum to" wording, and the new
  // explanation that a survivor segment is stacked ON the personal band
  // rather than replacing it, against drifting back to either the old
  // wording or silence.
  it("says each person's segments sum to what they were paid, and explains the survivor increment", () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/segments for the year sum to what they were actually paid/i);
    expect(caveat.textContent).toMatch(/survivor segment is the increment above the personal band/i);
    expect(caveat.textContent).toMatch(/personal band keeps paying what it already was/i);
    // The old, now-false claim.
    expect(caveat.textContent).not.toMatch(/band is everything they are paid/i);
  });

  it('says partial years are credited only the months actually paid', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/only the months\s+actually paid/i);
  });

  it('states that the amounts carry no cost-of-living adjustment', () => {
    // `HouseholdPanel` passes the timeline straight to the chart, so the COLA
    // slider never reaches these figures. Saying so is the honest caption.
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/before any cost-of-living adjustment/i);
  });

  it('omits the caveat for a single claimant, who has no second band', () => {
    render(<CombinedIncomeChart timeline={singleTimeline} people={[people[0]]} />);
    expect(screen.queryByTestId('combined-income-caveat')).toBeNull();
  });

  // The three survivor-gap shapes, carrying the exact figures
  // `methodologyCopy.test.ts` pins against real `analyzeHousehold` output.
  const contemporaneous: SurvivorGap = {
    survivorLabel: 'Sarah',
    deceasedMonthly: 1780,
    survivorOwnMonthly: 1760,
    survivorUnder60: false,
  };
  const notFiled: SurvivorGap = {
    survivorLabel: 'Sarah',
    deceasedMonthly: 1780,
    survivorOwnMonthly: null,
    survivorUnder60: false,
  };
  const under60: SurvivorGap = {
    survivorLabel: 'Sarah',
    deceasedMonthly: 2016,
    survivorOwnMonthly: null,
    survivorUnder60: true,
  };

  // The caption above says each band includes "any spousal or survivor
  // benefit". For the one survivor direction the engine does not model that is
  // false, and the survivor's figures are too low — so that household gets a
  // second, conditional sentence saying so.
  it('discloses the unmodeled survivor direction when there is one', () => {
    render(
      <CombinedIncomeChart timeline={timeline} people={people} survivorGap={contemporaneous} />,
    );
    const note = screen.getByTestId('survivor-gap-note');
    expect(note.textContent).toMatch(/no step-up is shown for Sarah/i);
    expect(note.textContent).toMatch(/lower than SSA would pay/i);
    expect(note.textContent).toContain('$1,780.00/mo');
    expect(note.textContent).toContain('$1,760.00/mo');
  });

  // The caption is the sentence the note contradicts, so it must stop making
  // the survivor claim for exactly the households that get a note. Both were
  // rendered unconditionally while the note beneath said otherwise.
  it('stops claiming survivor benefits are included when they are not', () => {
    render(
      <CombinedIncomeChart timeline={timeline} people={people} survivorGap={contemporaneous} />,
    );
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).not.toMatch(/or survivor segment is included/i);
    expect(caveat.textContent).toMatch(/No survivor segment is included for this household/i);
  });

  it('quotes no figure on screen for a survivor who has not filed at the death', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} survivorGap={notFiled} />);
    const note = screen.getByTestId('survivor-gap-note');
    expect(note.textContent).toMatch(/has not filed on their own record by then/i);
    // Exactly one dollar figure, and it is the deceased's — the survivor is
    // being paid nothing that month and none may be asserted for them.
    expect(note.textContent!.match(/\$[\d,]+\.\d\d/g)).toEqual(['$1,780.00']);
  });

  it('says on screen that a step-up cannot begin before 60', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} survivorGap={under60} />);
    const note = screen.getByTestId('survivor-gap-note');
    expect(note.textContent).toMatch(/is under 60 then/i);
    expect(note.textContent).toMatch(/from age 60 onward/i);
    expect(note.textContent!.match(/\$[\d,]+\.\d\d/g)).toEqual(['$2,016.00']);
  });

  it('shows no survivor-gap note when the engine models the direction', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} survivorGap={null} />);
    expect(screen.queryByTestId('survivor-gap-note')).toBeNull();
  });

  it('shows no survivor-gap note when the prop is omitted entirely', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    expect(screen.queryByTestId('survivor-gap-note')).toBeNull();
  });

  describe('one legend entry per benefit type', () => {
    it('renders a legend entry per benefit type, not per person', () => {
      render(
        <CombinedIncomeChart timeline={timelineWithSpousal} people={[dan, noRecordSarah]} />,
      );
      expect(screen.getByText(/Sarah — spousal/)).toBeInTheDocument();
      expect(screen.getByText(/Dan — own benefit/)).toBeInTheDocument();
    });

    it('omits a band and its legend entry when every year of it is zero', () => {
      // Scoped to the legend row, not the whole document: the caveat
      // paragraph above unconditionally says "any spousal or survivor
      // segment" — that's a statement about what the chart is capable of
      // showing, true regardless of this household, so it would false-match
      // a document-wide query for /spousal/i even once the zero band is
      // correctly dropped.
      const { container } = render(
        <CombinedIncomeChart timeline={timelineWithZeroSpousal} people={[avery, blythe]} />,
      );
      const legend = container.querySelector('.chart-legend-row');
      expect(legend?.textContent).not.toMatch(/spousal/i);
      // Self-sufficient against a `visibleBenefitSeries` that returned `[]`
      // unconditionally: that would also make the assertion above pass, so
      // this also pins that a real, surviving series is still there.
      expect(legend?.textContent).toMatch(/Avery — own benefit/);
    });
  });

  describe('filing and first-death markers', () => {
    /**
     * `ResponsiveContainer` measures zero size in jsdom (confirmed above and
     * by a throwaway spike: even an explicit-size wrapper div still measures
     * 0x0, since jsdom has no real layout engine and no ResizeObserver).
     * Recharts renders nothing at all below that — not even a hidden <svg> —
     * so no DOM query, `getByTestId` included, can ever see a `ReferenceLine`
     * here. `render()` is therefore not usable for this assertion.
     *
     * `pdf/HouseholdSection.test.tsx` hits the same problem for a different
     * reason (PDFKit deflates its content streams) and solves it the same
     * way this does: call the function component directly — it holds no
     * React hooks, so this is just a plain function call — and walk the JSX
     * tree it returns before anything tries to render it. That tree is real:
     * if `CombinedIncomeChart` never constructs the `ReferenceLine`, it is
     * not in the tree and this fails, so it cannot pass without the marker
     * existing.
     */
    function collectReferenceLines(
      node: unknown,
    ): ReactElement<{ x?: number; label?: unknown; children?: unknown }>[] {
      if (node === null || node === undefined || typeof node === 'boolean') return [];
      if (Array.isArray(node)) return node.flatMap(collectReferenceLines);
      if (typeof node !== 'object') return [];
      const element = node as ReactElement<{ children?: unknown }>;
      if (!('props' in element)) return [];
      const found = element.type === ReferenceLine ? [element] : [];
      return [...found, ...collectReferenceLines(element.props?.children)];
    }

    it('marks each person filing and the first death', () => {
      const finalIndexByPersonId = { a: 2046 * 12 + 2, b: 2040 * 12 + 8 };
      const tree = CombinedIncomeChart({
        timeline: timelineWithSurvivor,
        people: [dan, sarah],
        finalIndexByPersonId,
      });
      const lines = collectReferenceLines(tree);

      const expectedDeathYear = Math.floor(
        Math.min(finalIndexByPersonId.a, finalIndexByPersonId.b) / 12,
      );
      expect(
        lines.some((rl) => rl.props.x === expectedDeathYear && rl.props.label === 'First death'),
      ).toBe(true);

      // The filing years read off the same `byPersonId` roll-up the tooltip
      // uses — "when the benefit was claimed" is the real data already on
      // screen, not a second computation of a benefit rule.
      const danFilingYear = timelineWithSurvivor.find((p) => (p.byPersonId.a ?? 0) > 0)!.year;
      const sarahFilingYear = timelineWithSurvivor.find((p) => (p.byPersonId.b ?? 0) > 0)!.year;
      expect(
        lines.some((rl) => rl.props.x === danFilingYear && rl.props.label === 'Dan files'),
      ).toBe(true);
      expect(
        lines.some((rl) => rl.props.x === sarahFilingYear && rl.props.label === 'Sarah files'),
      ).toBe(true);
    });

    it('omits the death marker for a single claimant', () => {
      // `timelineWithSurvivor` is dan/sarah's real 2-person timeline, whose
      // `bySeries` names both `a` and `b` — inconsistent with a single-person
      // `people` array now that `visibleBenefitSeries` throws on that
      // mismatch (see household.ts). `singleTimeline` names only `a`.
      const tree = CombinedIncomeChart({
        timeline: singleTimeline,
        people: [dan],
        finalIndexByPersonId: { a: 2046 * 12 + 2 },
      });
      const lines = collectReferenceLines(tree);
      expect(lines.some((rl) => rl.props.label === 'First death')).toBe(false);
    });

    it('omits the death marker when the two final months tie, as firstDeath does', () => {
      // The chart used to compute `Math.min(...finalIndexes)` inline, which
      // disagreed with `firstDeath` on exactly this household: identical
      // final months mean `firstDeath` returns null (two mortality draws
      // landing on one month is not evidence either outlives the other), so
      // the cliff callout is absent and the survivor column is all em dashes
      // — while the chart still drew a "First death" marker on the same
      // screen. One derivation, one answer.
      const tied = 2046 * 12 + 2;
      const tree = CombinedIncomeChart({
        timeline: timelineWithSurvivor,
        people: [dan, sarah],
        finalIndexByPersonId: { a: tied, b: tied },
      });
      const lines = collectReferenceLines(tree);
      expect(lines.some((rl) => rl.props.label === 'First death')).toBe(false);
      // Not vacuous: the other markers are still built for this household.
      expect(lines.some((rl) => rl.props.label === 'Dan files')).toBe(true);
    });

    // `XAxis` has no `type="number"`, so it's a category axis: a
    // `ReferenceLine` whose `x` isn't one of the chart's own year categories
    // renders nothing at all — reachable when the first death precedes the
    // timeline's first year (a person who dies having never held a band).
    // The component must recognize that case and skip constructing the
    // marker, rather than build one that Recharts would have silently
    // dropped anyway.
    it('omits the death marker when the first death precedes the timeline, rather than silently vanishing', () => {
      const isolatedTimeline: CombinedTimelinePoint[] = [
        {
          year: 2030,
          bySeries: { 'a:personal': 24000, 'b:personal': 18000 },
          byPersonId: { a: 24000, b: 18000 },
          total: 42000,
        },
      ];
      const tree = CombinedIncomeChart({
        timeline: isolatedTimeline,
        people: [dan, sarah],
        // a's death (2010) precedes the timeline's first year (2030).
        finalIndexByPersonId: { a: 2010 * 12 + 2, b: 2040 * 12 + 8 },
      });
      const lines = collectReferenceLines(tree);
      expect(lines.some((rl) => rl.props.label === 'First death')).toBe(false);
    });
  });
});
