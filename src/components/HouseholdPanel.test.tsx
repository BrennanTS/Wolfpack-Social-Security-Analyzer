import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    recommendedFilingAge: {
      years: 70, months: 0, label: '70', decimalYears: 70, monthDuration: null as never,
    },
    recommendedMonthly: 2976,
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
    deltaVsOptimal: 0,
    isOptimal: true,
  };

  return {
    status: 'single',
    people: [personA],
    optimal,
    comparisons: [optimal],
    combinedTimeline: [
      { year: 2032, bySeries: { 'a:personal': 35_712 }, byPersonId: { a: 35_712 }, total: 35_712 },
    ],
    // `HouseholdPanel` now also builds the chart's own monthly series from
    // `periods` (`buildMonthlyIncomeSeries`, not `combinedTimeline`) — empty
    // here since none of these tests assert on the chart's rendered bars,
    // only on the break-even section and the survivor-gap note, neither of
    // which reads `periods`.
    periods: [],
    recommendation: 'Claim at age 70',
    recommendationDetail: 'ssa.tools recommends filing at age 70.',
    assumptions: { annualCola: 0, discountRate: 3 },
    asOf: new Date(2026, 7, 15),
  };
}

describe('HouseholdPanel', () => {
  it('recomputes break-even ages live from the annualCola prop, not the stale analysis.people[0].breakEvens', () => {
    const analysis = buildAnalysis();

    const zeroCola = render(<HouseholdPanel analysis={analysis} annualCola={0} />);
    const zeroAges = Array.from(
      zeroCola.container.querySelectorAll('.be-age-value'),
    ).map((el) => el.textContent);
    zeroCola.unmount();

    const highCola = render(<HouseholdPanel analysis={analysis} annualCola={8} />);
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
    const { getByTestId } = render(<HouseholdPanel analysis={buildAnalysis()} annualCola={0} />);
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
    const { getByTestId } = render(<HouseholdPanel analysis={analysis} annualCola={0} />);
    expect(getByTestId('survivor-gap-note').textContent).toContain('no step-up is shown for Dan');
  });

  it('renders no survivor-gap note when the analysis has none', () => {
    const { queryByTestId } = render(
      <HouseholdPanel analysis={buildAnalysis()} annualCola={0} />,
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

    render(<HouseholdPanel analysis={analysis} annualCola={0} />);

    // The callout really is on screen (guards against this passing
    // vacuously because `incomeCliff` returned null).
    expect(screen.getByTestId('income-cliff-sentence').textContent).toContain('Sarah');
    // Exactly one copy of the disclosure — not zero (it must still say so
    // somewhere) and not two (it must not say so twice).
    expect(screen.getAllByTestId('survivor-gap-note')).toHaveLength(1);
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
    const { getByTestId } = render(<HouseholdPanel analysis={unnamed} annualCola={0} />);
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
      <HouseholdPanel analysis={zeroPia} annualCola={2.5} />,
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
