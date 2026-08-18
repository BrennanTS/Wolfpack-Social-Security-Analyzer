import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReferenceLine } from 'recharts';
import { CombinedIncomeChart, IncomeTooltip } from './CombinedIncomeChart';
import { analyzeHousehold, buildMonthlyIncomeSeries } from '../lib/household';
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { MonthlyIncomePoint } from '../lib/household';
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

let monthlySeriesWithSpousal: MonthlyIncomePoint[];
let monthlySeriesWithSurvivor: MonthlyIncomePoint[];
let monthlySeriesWithZeroSpousal: MonthlyIncomePoint[];

beforeAll(async () => {
  const spousalResult = await analyzeHousehold(
    { status: 'married', people: [dan, noRecordSarah] },
    assumptions,
    asOf,
  );
  monthlySeriesWithSpousal = buildMonthlyIncomeSeries(spousalResult.periods, [dan, noRecordSarah]);

  // dan/sarah (real figures both ways) — confirmed by `household.test.ts`
  // ("exposes the engine periods on the analysis") to produce a genuine
  // Survivor band for Sarah under the engine's one modeled direction.
  const survivorResult = await analyzeHousehold(
    { status: 'married', people: [dan, sarah] },
    assumptions,
    asOf,
  );
  monthlySeriesWithSurvivor = buildMonthlyIncomeSeries(survivorResult.periods, [dan, sarah]);

  const zeroResult = await analyzeHousehold(
    { status: 'married', people: [avery, blythe] },
    zeroSpousalAssumptions,
    asOf,
  );
  monthlySeriesWithZeroSpousal = buildMonthlyIncomeSeries(zeroResult.periods, [avery, blythe]);
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

// `bySeries` added so this fixture still satisfies `MonthlyIncomePoint`;
// the exact composition doesn't matter for the caption/note tests below,
// which don't read the series breakdown.
const monthlySeries: MonthlyIncomePoint[] = [
  {
    monthIndex: 2030 * 12,
    year: 2030,
    bySeries: { 'a:personal': 24000 },
    byPersonId: { a: 24000, b: 0 },
    total: 24000,
  },
  {
    monthIndex: 2031 * 12,
    year: 2031,
    bySeries: { 'a:personal': 24000, 'b:personal': 18000 },
    byPersonId: { a: 24000, b: 18000 },
    total: 42000,
  },
];

// For the single-claimant tests below: `visibleBenefitSeries` now throws if
// a `bySeries` key names someone absent from `people` (see household.ts —
// that used to default silently to person 0, drawing a wrong label with no
// visible error), so a single-person `people` array needs a series whose
// points only ever name that one person, not the two-person `monthlySeries`
// above.
const singleMonthlySeries: MonthlyIncomePoint[] = [
  { monthIndex: 2030 * 12, year: 2030, bySeries: { 'a:personal': 24000 }, byPersonId: { a: 24000 }, total: 24000 },
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
      render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} />),
    ).not.toThrow();
  });

  it('renders without throwing for a single-person household', () => {
    expect(() =>
      render(<CombinedIncomeChart monthlySeries={singleMonthlySeries} people={[people[0]]} />),
    ).not.toThrow();
  });

  // The subtitle used to read "Annual Social Security income BY YEAR" —
  // true while the chart was bucketed by calendar year, false once it moved
  // to a monthly series where a filing/final year plots at full height. It
  // sits one line above the caption's own "annual rate" sentence, so the
  // two must agree rather than contradict each other in the same breath.
  it('does not claim the chart is bucketed by year, in the subtitle', () => {
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} />);
    expect(screen.queryByText(/by year/i)).toBeNull();
    // "annual rate" appears in both the subtitle and the caveat below it —
    // at least one hit is enough to prove the wording made it onto the page.
    expect(screen.getAllByText(/annual rate/i).length).toBeGreaterThan(0);
  });

  it('labels the legend with personLabel names, not raw ids', () => {
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} />);
    expect(screen.getByText(/Dan/)).toBeDefined();
    expect(screen.getByText(/Sarah/)).toBeDefined();
  });

  it('falls back to Client/Spouse when a person has no name', () => {
    const unnamed = [{ id: 'a' }, { id: 'b' }] as Person[];
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={unnamed} />);
    expect(screen.getByText(/Client/)).toBeDefined();
    expect(screen.getByText(/Spouse/)).toBeDefined();
  });

  // `buildMonthlyIncomeSeries` sums the engine's benefit-period bands, so a
  // person's band is their personal benefit PLUS any spousal and survivor
  // benefit, credited at its full annual rate for every month it pays. The
  // caption used to say the exact opposite of all three — that bands were
  // own-benefit-only, that a no-record spouse showed as $0, and that
  // survivor benefits were unmodeled. These guard the corrected caption
  // against drifting back.
  it('says the bands include spousal and survivor benefits, for a couple', () => {
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} />);
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
  it("says each person's segments show the annual rate, and explains the survivor increment", () => {
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/segments show the annual rate they.re paid/i);
    expect(caveat.textContent).toMatch(/survivor segment is the increment above the personal band/i);
    expect(caveat.textContent).toMatch(/personal band keeps paying what it already was/i);
    // The old, now-false claims.
    expect(caveat.textContent).not.toMatch(/band is everything they are paid/i);
    expect(caveat.textContent).not.toMatch(/sum to what they were actually paid/i);
  });

  // The chart is plotted at MONTHLY resolution (`buildMonthlyIncomeSeries`),
  // so there is no year-bucket artifact left to disclose — a month is either
  // inside a band or it isn't. An earlier, calendar-year-bucketed version of
  // the chart needed a clause here saying a filing/final year rendered at
  // full height though only part was paid; that clause shipped once and was
  // removed once the resolution changed, so it's worth pinning its absence
  // rather than leaving it untested.
  it('does not claim a filing or final year renders at full height', () => {
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/annual rate/i);
    expect(caveat.textContent).not.toMatch(/filing year and a final year render at the same height/i);
    expect(caveat.textContent).not.toMatch(/shorter than a full one/i);
  });

  it('states that the amounts carry no cost-of-living adjustment', () => {
    // `HouseholdPanel` passes the series straight to the chart, so the COLA
    // slider never reaches these figures. Saying so is the honest caption.
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/before any cost-of-living adjustment/i);
  });

  it('omits the caveat for a single claimant, who has no second band', () => {
    render(<CombinedIncomeChart monthlySeries={singleMonthlySeries} people={[people[0]]} />);
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
      <CombinedIncomeChart monthlySeries={monthlySeries} people={people} survivorGap={contemporaneous} />,
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
      <CombinedIncomeChart monthlySeries={monthlySeries} people={people} survivorGap={contemporaneous} />,
    );
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).not.toMatch(/or survivor segment is included/i);
    expect(caveat.textContent).toMatch(/No survivor segment is included for this household/i);
  });

  it('quotes no figure on screen for a survivor who has not filed at the death', () => {
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} survivorGap={notFiled} />);
    const note = screen.getByTestId('survivor-gap-note');
    expect(note.textContent).toMatch(/has not filed on their own record by then/i);
    // Exactly one dollar figure, and it is the deceased's — the survivor is
    // being paid nothing that month and none may be asserted for them.
    expect(note.textContent!.match(/\$[\d,]+\.\d\d/g)).toEqual(['$1,780.00']);
  });

  it('says on screen that a step-up cannot begin before 60', () => {
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} survivorGap={under60} />);
    const note = screen.getByTestId('survivor-gap-note');
    expect(note.textContent).toMatch(/is under 60 then/i);
    expect(note.textContent).toMatch(/from age 60 onward/i);
    expect(note.textContent!.match(/\$[\d,]+\.\d\d/g)).toEqual(['$2,016.00']);
  });

  it('shows no survivor-gap note when the engine models the direction', () => {
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} survivorGap={null} />);
    expect(screen.queryByTestId('survivor-gap-note')).toBeNull();
  });

  it('shows no survivor-gap note when the prop is omitted entirely', () => {
    render(<CombinedIncomeChart monthlySeries={monthlySeries} people={people} />);
    expect(screen.queryByTestId('survivor-gap-note')).toBeNull();
  });

  describe('one legend entry per benefit type', () => {
    it('renders a legend entry per benefit type, not per person', () => {
      render(
        <CombinedIncomeChart monthlySeries={monthlySeriesWithSpousal} people={[dan, noRecordSarah]} />,
      );
      expect(screen.getByText(/Sarah — spousal/)).toBeInTheDocument();
      expect(screen.getByText(/Dan — own benefit/)).toBeInTheDocument();
    });

    it('omits a band and its legend entry when every month of it is zero', () => {
      // Scoped to the legend row, not the whole document: the caveat
      // paragraph above unconditionally says "any spousal or survivor
      // segment" — that's a statement about what the chart is capable of
      // showing, true regardless of this household, so it would false-match
      // a document-wide query for /spousal/i even once the zero band is
      // correctly dropped.
      const { container } = render(
        <CombinedIncomeChart monthlySeries={monthlySeriesWithZeroSpousal} people={[avery, blythe]} />,
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

    // The marker label is now a custom render function (`markerLabel` in
    // `CombinedIncomeChart.tsx`) rather than a bare string or a
    // `{ value, position, ... }` descriptor — needed so two close-together
    // markers can be pushed to different vertical rows instead of both
    // rendering at the same fixed height. This calls it with a throwaway
    // `viewBox` and pulls the text back out of the `<text>` element it
    // returns, so the assertions below still check the actual wording, not
    // the render-function shape that carries it.
    function labelText(rl: ReactElement<{ label?: unknown }>): unknown {
      const label = rl.props.label;
      if (typeof label === 'function') {
        const rendered = (label as (props: { viewBox: { x: number; y: number } }) => ReactElement<{ children?: unknown }>)(
          { viewBox: { x: 0, y: 0 } },
        );
        return rendered?.props?.children;
      }
      return label && typeof label === 'object' && 'value' in label
        ? (label as { value: unknown }).value
        : label;
    }

    // The vertical row a marker's label was assigned to, in pixels — the
    // `y` the custom label function computed for a given `viewBox.y`. Used
    // to assert that two colliding markers land on DIFFERENT rows, not just
    // that both labels still say the right words.
    function labelY(rl: ReactElement<{ label?: unknown }>, viewBoxY: number): number | undefined {
      const label = rl.props.label;
      if (typeof label !== 'function') return undefined;
      const rendered = (label as (props: { viewBox: { x: number; y: number } }) => ReactElement<{ y?: unknown }>)(
        { viewBox: { x: 0, y: viewBoxY } },
      );
      const y = rendered?.props?.y;
      return typeof y === 'number' ? y : undefined;
    }

    it('marks each person filing and the first death, at the exact month', () => {
      const finalIndexByPersonId = { a: 2046 * 12 + 2, b: 2040 * 12 + 8 };
      const tree = CombinedIncomeChart({
        monthlySeries: monthlySeriesWithSurvivor,
        people: [dan, sarah],
        finalIndexByPersonId,
      });
      const lines = collectReferenceLines(tree);

      // The household's shape changes the month AFTER the deceased's own
      // final month — that's where `buildMonthlyIncomeSeries` first stops
      // including their band, so that's where the marker belongs.
      const expectedDeathStepMonth =
        Math.min(finalIndexByPersonId.a, finalIndexByPersonId.b) + 1;
      expect(
        lines.some((rl) => rl.props.x === expectedDeathStepMonth && labelText(rl) === 'First death'),
      ).toBe(true);

      // The filing months read off the same `byPersonId` roll-up the
      // tooltip uses — "when the benefit was claimed" is the real data
      // already on screen, not a second computation of a benefit rule.
      const danFilingMonth = monthlySeriesWithSurvivor.find((p) => (p.byPersonId.a ?? 0) > 0)!
        .monthIndex;
      const sarahFilingMonth = monthlySeriesWithSurvivor.find((p) => (p.byPersonId.b ?? 0) > 0)!
        .monthIndex;
      expect(
        lines.some((rl) => rl.props.x === danFilingMonth && labelText(rl) === 'Dan files'),
      ).toBe(true);
      expect(
        lines.some((rl) => rl.props.x === sarahFilingMonth && labelText(rl) === 'Sarah files'),
      ).toBe(true);
    });

    it('omits the death marker for a single claimant', () => {
      // `monthlySeriesWithSurvivor` is dan/sarah's real 2-person series,
      // whose `bySeries` names both `a` and `b` — inconsistent with a
      // single-person `people` array now that `visibleBenefitSeries` throws
      // on that mismatch (see household.ts). `singleMonthlySeries` names
      // only `a`.
      const tree = CombinedIncomeChart({
        monthlySeries: singleMonthlySeries,
        people: [dan],
        finalIndexByPersonId: { a: 2046 * 12 + 2 },
      });
      const lines = collectReferenceLines(tree);
      expect(lines.some((rl) => labelText(rl) === 'First death')).toBe(false);
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
        monthlySeries: monthlySeriesWithSurvivor,
        people: [dan, sarah],
        finalIndexByPersonId: { a: tied, b: tied },
      });
      const lines = collectReferenceLines(tree);
      expect(lines.some((rl) => labelText(rl) === 'First death')).toBe(false);
      // Not vacuous: the other markers are still built for this household.
      expect(lines.some((rl) => labelText(rl) === 'Dan files')).toBe(true);
    });

    // `XAxis` is a numeric month-index axis: a `ReferenceLine` whose `x`
    // falls outside the plotted domain renders nothing at all — reachable
    // when the first death precedes the series' first month (a person who
    // dies having never held a band). The component must recognize that
    // case and skip constructing the marker, rather than build one Recharts
    // would have silently dropped anyway.
    it('omits the death marker when the first death precedes the series, rather than silently vanishing', () => {
      const isolatedMonthlySeries: MonthlyIncomePoint[] = [
        {
          monthIndex: 2030 * 12,
          year: 2030,
          bySeries: { 'a:personal': 24000, 'b:personal': 18000 },
          byPersonId: { a: 24000, b: 18000 },
          total: 42000,
        },
      ];
      const tree = CombinedIncomeChart({
        monthlySeries: isolatedMonthlySeries,
        people: [dan, sarah],
        // a's death (2010) precedes the series' first month (2030).
        finalIndexByPersonId: { a: 2010 * 12 + 2, b: 2040 * 12 + 8 },
      });
      const lines = collectReferenceLines(tree);
      expect(lines.some((rl) => labelText(rl) === 'First death')).toBe(false);
    });

    // The axis collision (a label sitting on top of the y-axis tick labels)
    // is fixed by `position: 'insideTopLeft'`; this is the OTHER collision —
    // two markers close enough in time that their labels, both anchored at
    // the same fixed height, would overlap each other. Dan files in January
    // 2030 and Sarah three months later, well inside the proximity window
    // (floored at 24 months) — the two filing labels must render at
    // DIFFERENT vertical rows rather than both at row 0.
    it('staggers two filing markers that land close together in time', () => {
      const closeFilingSeries: MonthlyIncomePoint[] = [
        {
          monthIndex: 2030 * 12,
          year: 2030,
          bySeries: { 'a:personal': 24000 },
          byPersonId: { a: 24000, b: 0 },
          total: 24000,
        },
        {
          monthIndex: 2030 * 12 + 3,
          year: 2030,
          bySeries: { 'a:personal': 24000, 'b:personal': 18000 },
          byPersonId: { a: 24000, b: 18000 },
          total: 42000,
        },
      ];
      const tree = CombinedIncomeChart({ monthlySeries: closeFilingSeries, people: [dan, sarah] });
      const lines = collectReferenceLines(tree);
      const danLine = lines.find((rl) => labelText(rl) === 'Dan files')!;
      const sarahLine = lines.find((rl) => labelText(rl) === 'Sarah files')!;
      expect(danLine).toBeDefined();
      expect(sarahLine).toBeDefined();
      // Same `viewBox.y` for both (as they'd actually get from Recharts,
      // since both lines span the same plot height) — if the two labels
      // still landed on the same row, these would be equal.
      expect(labelY(danLine, 8)).not.toBe(labelY(sarahLine, 8));
    });

    // The counterpart: two markers far enough apart must NOT be pushed onto
    // different rows just because rows are cheap — an unstaggered household
    // (the common case) should keep every label at the same, familiar
    // height rather than descending a step for no reason.
    it('does not stagger markers that are already far apart', async () => {
      // Its OWN household, not the shared `dan`/`sarah` fixture. Once the
      // optimizer began honouring the plan-to age, that pair's two filing
      // ages moved close enough together to stagger — so this test, which
      // exists to prove the unstaggered case, was asserting the staggered
      // one. A short-lived lower earner files at the floor while the higher
      // earner delays, which is about as far apart as the two can be.
      const shortLived = { ...sarah, lifeExpectancy: 72 };
      const result = await analyzeHousehold(
        { status: 'married', people: [dan, shortLived] },
        assumptions,
        asOf,
      );

      // Guard, so this cannot quietly become the staggered case again: the
      // two filings must be years apart for the assertion below to mean
      // anything at all.
      const [danAge, sarahAge] = result.optimal.filingAges.map((f) => f.decimalYears);
      expect(Math.abs(danAge - sarahAge)).toBeGreaterThan(5);

      const tree = CombinedIncomeChart({
        monthlySeries: buildMonthlyIncomeSeries(result.periods, [dan, shortLived]),
        people: [dan, shortLived],
      });
      const lines = collectReferenceLines(tree);
      const danLine = lines.find((rl) => labelText(rl) === 'Dan files')!;
      const sarahLine = lines.find((rl) => labelText(rl) === 'Sarah files')!;
      expect(labelY(danLine, 8)).toBe(labelY(sarahLine, 8));
    });
  });
});

/** Render `IncomeTooltip` with a payload and read back the rows it shows. */
function tooltipRows(
  payload: { dataKey: string; name: string; value: number; color: string }[],
): string[] {
  const { container } = render(
    <IncomeTooltip active payload={payload as never} label={2036 * 12} />,
  );
  return [...container.querySelectorAll('p')].slice(1).map((p) => p.textContent ?? '');
}

describe('the tooltip', () => {
  it('omits a band that is present in the stack but not yet paying', () => {
    // A survivor or spousal band sits in the series at $0 before it starts —
    // the stack needs the point — but a "$0/yr" row is noise beside the bands
    // actually paying, and there can be three of them at once.
    const rows = tooltipRows([
      { dataKey: 'a:personal', name: 'Client — own benefit', value: 66960, color: '#b8965a' },
      { dataKey: 'b:personal', name: 'Spouse — own benefit', value: 21732, color: '#9d78b0' },
      { dataKey: 'b:survivor', name: 'Spouse — survivor', value: 0, color: '#6f8ba3' },
    ]);
    expect(rows).toEqual([
      'Client — own benefit: $66,960/yr',
      'Spouse — own benefit: $21,732/yr',
    ]);
  });

  it('renders nothing at all when no band is paying', () => {
    expect(tooltipRows([{ dataKey: 'a:personal', name: 'Client', value: 0, color: '#b8965a' }]))
      .toEqual([]);
  });
});
