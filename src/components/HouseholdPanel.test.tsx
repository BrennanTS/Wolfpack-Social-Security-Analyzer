import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HouseholdPanel } from './HouseholdPanel';
import type { HouseholdAnalysis } from '../lib/household';
import type { PersonAnalysis } from '../lib/personAnalysis';

// Minimal hand-built fixtures — HouseholdPanel takes data as props and never
// calls the engine, so no mocking is needed. `claimingOptions` only needs the
// three break-even ages (62/67/70; see `BREAK_EVEN_AGES` in benefitMath.ts)
// with strictly increasing monthly benefits, since flat-COLA compounding only
// produces a *different* break-even age (not just a different value clamped
// to the same age) when there's real growth to compound over years of gap.
function buildPersonAnalysis(id: 'a' | 'b', name: string): PersonAnalysis {
  return {
    person: { id, name, birthYear: 1962, birthMonth: 4,
              gender: id === 'a' ? 'male' : 'female', piaMonthly: 2400, lifeExpectancy: 85 },
    fra: { years: 67, months: 0 },
    currentAge: { years: 63, months: 9 },
    claimingOptions: [
      { age: 62, monthlyBenefit: 1680, percentOfPia: 70, lifetimeBenefits: 378_000,
        yearsOfPayments: 23, isEligible: true, monthsFromFra: -60 },
      { age: 67, monthlyBenefit: 2400, percentOfPia: 100, lifetimeBenefits: 460_800,
        yearsOfPayments: 18, isEligible: true, monthsFromFra: 0 },
      { age: 70, monthlyBenefit: 2976, percentOfPia: 124, lifetimeBenefits: 535_680,
        yearsOfPayments: 15, isEligible: true, monthsFromFra: 36 },
    ],
    filingAge: {
      years: 70, months: 0, label: '70', decimalYears: 70, monthDuration: null as never,
    },
    monthlyAtFilingAge: 2976,
    // Deliberately stale relative to whatever `annualCola` a test passes in —
    // the whole point of the fix under test is that HouseholdPanel must NOT
    // read this field for its break-even section.
    breakEvens: [{ earlierAge: 62, laterAge: 70, breakEvenAge: 999, breakEvenYears: 999 }],
    ssaSuggestedLifeExpectancy: 82,
  } as unknown as PersonAnalysis;
}

function buildAnalysis(): HouseholdAnalysis {
  const personA = buildPersonAnalysis('a', 'Dan');
  const age = (years: number) => ({ years, months: 0, label: String(years),
    decimalYears: years, monthDuration: null as never });
  const optimal = {
    key: 'optimal' as const,
    label: 'Claim at 70',
    filingAges: [age(70)],
    expectedNpv: 535_680,
    lifetimeTotal: null,
    survivorClaimDate: null,
    deltaVsOptimal: 0,
    isOptimal: true,
    isSelected: true,
    hidden: false,
    survivorIncome: null,
  };

  return {
    status: 'single',
    people: [personA],
    optimal,
    selected: optimal,
    scenarioIsBest: true,
    filingAgeOptions: [[{ years: 70, months: 0 }]],
    comparisons: [optimal],
    allComparisons: [optimal],
    combinedTimeline: [
      { year: 2032, bySeries: { 'a:personal': 35_712 }, byPersonId: { a: 35_712 }, total: 35_712 },
    ],
    // `HouseholdPanel` now also builds the chart's own monthly series from
    // `periods` (`buildMonthlyIncomeSeries`, not `combinedTimeline`) — empty
    // here since none of these tests assert on the chart's rendered bars,
    // only on the break-even section and the survivor-gap note, neither of
    // which reads `periods`.
    periods: [],
    // Explicit `null`, not omitted — `HouseholdAnalysis.survivorClaim` is
    // typed non-optional, and the null-case test below relies on this
    // fixture actually carrying the modelled absence rather than an
    // `undefined` the type says cannot exist.
    survivorClaim: null,
    survivorGap: null,
    finalIndexByPersonId: { a: 24_653 },
    piaEstimated: null,
    deceased: null,
    recommendation: 'Claim at age 70',
    recommendationDetail: 'ssa.tools recommends filing at age 70.',
    assumptions: { annualCola: 0, discountRate: 3 },
    asOf: new Date(2026, 7, 15),
  };
}

describe('HouseholdPanel', () => {
  it('recomputes break-even ages live from the annualCola prop, not the stale analysis.people[0].breakEvens', () => {
    const analysis = buildAnalysis();

    const zeroCola = render(<HouseholdPanel analysis={analysis} annualCola={0} dollarsMode="real" onDollarsModeChange={vi.fn()} />);
    const zeroAges = Array.from(
      zeroCola.container.querySelectorAll('.be-age-value'),
    ).map((el) => el.textContent);
    zeroCola.unmount();

    const highCola = render(<HouseholdPanel analysis={analysis} annualCola={8} dollarsMode="real" onDollarsModeChange={vi.fn()} />);
    const highAges = Array.from(
      highCola.container.querySelectorAll('.be-age-value'),
    ).map((el) => el.textContent);
    highCola.unmount();

    // Neither render shows the stale 999 placeholder baked into
    // `analysis.people[0].breakEvens` — proves the component recomputes
    // rather than reading that field.
    expect(zeroAges).not.toContain('999');
    expect(highAges).not.toContain('999');

    // A higher COLA compounds the later, larger benefit faster, pulling the
    // break-even age earlier — the two renders must differ.
    expect(highAges).not.toEqual(zeroAges);
  });

  // The section is fed person A's claiming options and life expectancy but
  // sits under a tab labelled "Household", and its cards speak in the second
  // person ("you live past break-even"). Without attribution a reader takes
  // it for a couple-level result, which it is not.
  it('attributes the break-even section to the person it is actually computed for', () => {
    const { getByTestId } = render(<HouseholdPanel analysis={buildAnalysis()} annualCola={0} dollarsMode="real" onDollarsModeChange={vi.fn()} />);
    const attribution = getByTestId('break-even-attribution');
    expect(attribution.textContent).toContain('Break-even for Dan');
    expect(attribution.textContent).toContain('age 85');
    expect(attribution.textContent).toContain('not modeled');
  });

  // Wiring guard: the disclosure is computed in `lib` and rendered by
  // `CombinedIncomeChart`, and this panel is the only thing joining them. Both
  // ends were unit-tested while the field went unpassed, which is exactly how
  // `survivorGap` sat computed-but-unrendered in the first place.
  it('passes the survivor gap through to the combined income chart', () => {
    const analysis = {
      ...buildAnalysis(),
      survivorGap: {
        survivorLabel: 'Dan',
        deceasedMonthly: 1780,
        survivorOwnMonthly: 1760,
        survivorUnder60: false,
      },
    } as HouseholdAnalysis;
    const { getByTestId } = render(<HouseholdPanel analysis={analysis} annualCola={0} dollarsMode="real" onDollarsModeChange={vi.fn()} />);
    expect(getByTestId('survivor-gap-note').textContent).toContain('no step-up is shown for Dan');
  });

  it('renders no survivor-gap note when the analysis has none', () => {
    const { queryByTestId } = render(
      <HouseholdPanel analysis={buildAnalysis()} annualCola={0} dollarsMode="real" onDollarsModeChange={vi.fn()} />,
    );
    expect(queryByTestId('survivor-gap-note')).toBeNull();
  });

  // Code-review finding: `CombinedIncomeChart` renders `survivorGapNote`
  // above the chart, and `IncomeCliffCallout` renders below it — on the
  // FIRST pass both called `survivorGapNote(gap)` themselves, so a married
  // household with a set `survivorGap` showed the identical disclosure
  // paragraph twice on one screen. No existing test caught it: this file's
  // only `survivorGap` fixture (above) is a single-person household, where
  // `incomeCliff` returns null and the callout never renders at all, so the
  // duplication path never fired. This is a genuine two-person married
  // household with `finalIndexByPersonId` and a three-year timeline — the
  // fields `incomeCliff` needs — so both the chart's note and the callout
  // are actually on screen together, and the fix (the callout no longer
  // renders its own copy) is pinned here rather than only at the unit level.
  it('prints the survivor-gap note exactly once, even though both the chart and the callout are on screen', () => {
    const personA = buildPersonAnalysis('a', 'Dan');
    const personB = buildPersonAnalysis('b', 'Sarah');
    const analysis = {
      ...buildAnalysis(),
      status: 'married',
      people: [personA, personB],
      finalIndexByPersonId: { a: 2047 * 12 + 3, b: 2052 * 12 + 1 },
      combinedTimeline: [
        { year: 2046, bySeries: {}, byPersonId: {}, total: 60000 },
        { year: 2047, bySeries: {}, byPersonId: {}, total: 55000 },
        { year: 2048, bySeries: {}, byPersonId: {}, total: 38000 },
      ],
      survivorGap: {
        survivorLabel: 'Sarah',
        deceasedMonthly: 1780,
        survivorOwnMonthly: 1760,
        survivorUnder60: false,
      },
    } as HouseholdAnalysis;

    render(<HouseholdPanel analysis={analysis} annualCola={0} dollarsMode="real" onDollarsModeChange={vi.fn()} />);

    // The callout really is on screen (guards against this passing
    // vacuously because `incomeCliff` returned null).
    expect(screen.getByTestId('income-cliff-sentence').textContent).toContain('Sarah');
    // Exactly one copy of the disclosure — not zero (it must still say so
    // somewhere) and not two (it must not say so twice).
    expect(screen.getAllByTestId('survivor-gap-note')).toHaveLength(1);
  });

  // Wiring guard, same shape as the survivor-gap one above: the note is
  // computed in `lib/survivorClaim.ts` and rendered by `SurvivorClaimNote`,
  // and this panel is the only thing joining them. Checks actual DOM order,
  // not just that both nodes exist somewhere on the page — two `getByTestId`
  // calls alone would pass even if the note rendered above the callout, or
  // anywhere else on the page.
  it('renders the survivor-claim note after the income-cliff callout, in document order', () => {
    const personA = buildPersonAnalysis('a', 'Dan');
    const personB = buildPersonAnalysis('b', 'Sarah');
    const analysis = {
      ...buildAnalysis(),
      status: 'married',
      people: [personA, personB],
      finalIndexByPersonId: { a: 2047 * 12 + 3, b: 2052 * 12 + 1 },
      combinedTimeline: [
        { year: 2046, bySeries: {}, byPersonId: {}, total: 60000 },
        { year: 2047, bySeries: {}, byPersonId: {}, total: 55000 },
        { year: 2048, bySeries: {}, byPersonId: {}, total: 38000 },
      ],
      survivorClaim: {
        claimIndex: 2047 * 12 + 5,
        claimAge: '68 years, 0 months',
        survivorLabel: 'Sarah',
        baselineTotal: 300_000,
        bestTotal: 435_700,
        gain: 135_700,
        baselineHasSurvivorBand: true,
      },
    } as HouseholdAnalysis;

    render(<HouseholdPanel analysis={analysis} annualCola={0} dollarsMode="real" onDollarsModeChange={vi.fn()} />);

    // The callout really is on screen (guards against this passing
    // vacuously because `incomeCliff` returned null).
    const cliff = screen.getByTestId('income-cliff-sentence');
    const note = screen.getByTestId('survivor-claim-note');
    expect(note.textContent).toContain('135,700');
    // `note` follows `cliff` in the DOM — not merely that both exist.
    expect(cliff.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no survivor-claim note when the analysis has none', () => {
    const { queryByTestId } = render(
      <HouseholdPanel analysis={buildAnalysis()} annualCola={0} dollarsMode="real" onDollarsModeChange={vi.fn()} />,
    );
    expect(queryByTestId('survivor-claim-note')).toBeNull();
  });

  // Wiring for the dollars-basis clause: `HouseholdPanel` passes `dollarsMode`
  // through to `SurvivorClaimNote` unchanged (never through `toNominal*` —
  // the figure itself must not move), only so the note can decide whether to
  // STATE the basis. Real mode must omit it (the callout above already said
  // so); nominal mode must include it (the one case the two figures can be
  // mistaken for the same basis).
  it('passes dollarsMode through to the survivor-claim note without transforming the figure', () => {
    const personA = buildPersonAnalysis('a', 'Dan');
    const personB = buildPersonAnalysis('b', 'Sarah');
    const married = {
      ...buildAnalysis(),
      status: 'married',
      people: [personA, personB],
      finalIndexByPersonId: { a: 2047 * 12 + 3, b: 2052 * 12 + 1 },
      combinedTimeline: [
        { year: 2046, bySeries: {}, byPersonId: {}, total: 60000 },
        { year: 2047, bySeries: {}, byPersonId: {}, total: 55000 },
        { year: 2048, bySeries: {}, byPersonId: {}, total: 38000 },
      ],
      survivorClaim: {
        claimIndex: 2047 * 12 + 5,
        claimAge: '68 years, 0 months',
        survivorLabel: 'Sarah',
        baselineTotal: 300_000,
        bestTotal: 435_700,
        gain: 135_700,
        baselineHasSurvivorBand: true,
      },
    } as HouseholdAnalysis;

    const real = render(
      <HouseholdPanel
        analysis={married}
        annualCola={0}
        dollarsMode="real"
        onDollarsModeChange={() => {}}
      />,
    );
    const realText = screen.getByTestId('survivor-claim-note').textContent!;
    expect(realText).toContain('135,700');
    expect(realText).not.toContain('today’s dollars, before any cost-of-living adjustment');
    real.unmount();

    const nominal = render(
      <HouseholdPanel
        analysis={married}
        annualCola={2.5}
        dollarsMode="nominal"
        onDollarsModeChange={() => {}}
      />,
    );
    const nominalText = screen.getByTestId('survivor-claim-note').textContent!;
    // The gain itself is UNCHANGED — this is the assertion that matters: the
    // toggle must decide only whether to disclose the basis, never transform
    // the figure.
    expect(nominalText).toContain('135,700');
    expect(nominalText).toContain('today’s dollars, before any cost-of-living adjustment');
    nominal.unmount();
  });

  it('falls back to the Client/Spouse label when person A is unnamed', () => {
    const analysis = buildAnalysis();
    const unnamed = {
      ...analysis,
      people: [
        {
          ...analysis.people[0],
          person: { ...analysis.people[0].person, name: undefined },
        },
      ],
    } as HouseholdAnalysis;
    const { getByTestId } = render(<HouseholdPanel analysis={unnamed} annualCola={0} dollarsMode="real" onDollarsModeChange={vi.fn()} />);
    expect(getByTestId('break-even-attribution').textContent).toContain('Break-even for Client');
  });

  // Newly reachable since the benefit floor dropped to $0: person A can have
  // no work record of their own, so every claiming option is $0. The
  // break-even loop used to "find" a crossover at the later age on its first
  // iteration (0 >= 0) and the tab rendered three cards reading "Break-even
  // age 67 / 70 / 70 — Delaying to 70 wins" for someone receiving nothing.
  // The section must be absent entirely, not present-but-empty.
  it('renders no break-even section at all when person A has a zero benefit', () => {
    const analysis = buildAnalysis();
    const zeroPia = {
      ...analysis,
      people: [
        {
          ...analysis.people[0],
          person: { ...analysis.people[0].person, piaMonthly: 0 },
          claimingOptions: analysis.people[0].claimingOptions.map((o) => ({
            ...o,
            monthlyBenefit: 0,
            lifetimeBenefits: 0,
          })),
        },
      ],
    } as HouseholdAnalysis;

    // 2.5 is the CPI default the app actually ships — the value the old
    // `annualCola === 0` guard could never catch.
    const { container, queryByTestId, queryByText } = render(
      <HouseholdPanel analysis={zeroPia} annualCola={2.5} dollarsMode="real" onDollarsModeChange={vi.fn()} />,
    );
    expect(queryByText('Break-Even Analysis')).toBeNull();
    expect(queryByTestId('break-even-attribution')).toBeNull();
    expect(container.querySelectorAll('.be-age-value')).toHaveLength(0);
    expect(container.querySelectorAll('.breakeven-section')).toHaveLength(0);
    // The rest of the tab still renders — the recommendation is spousal-aware
    // and remains correct for this household.
    expect(queryByTestId('recommendation-title')).not.toBeNull();
  });
});
