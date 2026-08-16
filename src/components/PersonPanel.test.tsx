import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersonPanel } from './PersonPanel';
import type { PersonAnalysis } from '../lib/personAnalysis';

// Minimal hand-built analysis — components take data as props and never
// call the engine, so no mocking or fixture loading is needed here.
// `claimingOptions` covers every whole-year age 62-70 (not just a sparse
// subset) so a rounded, non-whole-year `recommendedFilingAge` always has a
// real row to land on, matching what `analyzePerson` actually produces.
function buildAnalysis(recommendedFilingAge: PersonAnalysis['recommendedFilingAge']): PersonAnalysis {
  return {
    person: { id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
              gender: 'male', piaMonthly: 2400, lifeExpectancy: 85 },
    fra: { years: 67, months: 0 },
    currentAge: { years: 63, months: 9 },
    claimingOptions: [
      { age: 62, monthlyBenefit: 1680, percentOfPia: 70 },
      { age: 63, monthlyBenefit: 1800, percentOfPia: 75 },
      { age: 64, monthlyBenefit: 1920, percentOfPia: 80 },
      { age: 65, monthlyBenefit: 2080, percentOfPia: 86.7 },
      { age: 66, monthlyBenefit: 2240, percentOfPia: 93.3 },
      { age: 67, monthlyBenefit: 2400, percentOfPia: 100 },
      { age: 68, monthlyBenefit: 2592, percentOfPia: 108 },
      { age: 69, monthlyBenefit: 2784, percentOfPia: 116 },
      { age: 70, monthlyBenefit: 2976, percentOfPia: 124 },
    ].map(({ age, monthlyBenefit, percentOfPia }) => ({
      age,
      monthlyBenefit,
      percentOfPia,
      lifetimeBenefits: 100_000,
      yearsOfPayments: 0,
      isEligible: age <= 63,
      monthsFromFra: 0,
    })),
    recommendedFilingAge,
    recommendedMonthly: 2976,
    breakEvens: [],
    ssaSuggestedLifeExpectancy: 82,
  } as unknown as PersonAnalysis;
}

const wholeYearAnalysis = buildAnalysis({
  years: 70, months: 0, label: '70', decimalYears: 70,
  monthDuration: null as never,
});

// Task 8's fixtures had the couple optimizer choosing spouse filing ages
// like 64y5m — a non-whole-year age that never exactly equals a table row's
// integer `age`. Regression coverage for the badge/`isRecommended` logic
// dropping every row's highlight in that (common) case.
const nonWholeYearAnalysis = buildAnalysis({
  years: 64, months: 5, label: '64 years, 5 months', decimalYears: 64.42,
  monthDuration: null as never,
});

describe('PersonPanel', () => {
  it('renders one table row per claiming age with monthly and %PIA', () => {
    render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={2.5} />);
    const row = screen.getByTestId('claim-row-70');
    expect(within(row).getByTestId('cell-monthly')).toHaveTextContent('$2,976.00');
    expect(within(row).getByTestId('cell-percent')).toHaveTextContent('124%');
  });

  // The Lifetime column is computed from `person.lifeExpectancy` (see
  // `analyzePerson`), so the caption must cite that and not
  // `ssaSuggestedLifeExpectancy`, which is only the slider's default. The
  // fixture deliberately sets them apart (85 vs 82) — the state an adviser
  // reaches the moment they move the life-expectancy slider.
  it('captions the Lifetime column with the planning life expectancy, not SSA suggestion', () => {
    render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={2.5} />);
    const caption = screen.getByTestId('benefit-table-caption');
    expect(caption).toHaveTextContent('lifetime total to age 85');
    expect(caption).not.toHaveTextContent('age 82');
  });

  it('tracks the life expectancy when the adviser moves the slider', () => {
    const moved = {
      ...wholeYearAnalysis,
      person: { ...wholeYearAnalysis.person, lifeExpectancy: 92 },
    };
    render(<PersonPanel analysis={moved} index={0} annualCola={2.5} />);
    expect(screen.getByTestId('benefit-table-caption')).toHaveTextContent(
      'lifetime total to age 92',
    );
  });

  it('marks ages the person has not reached as future', () => {
    render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={2.5} />);
    expect(within(screen.getByTestId('claim-row-70')).getByText('Future')).toBeDefined();
  });

  it('shows no survivor figure anywhere', () => {
    render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={2.5} />);
    expect(screen.queryByText(/survivor/i)).toBeNull();
  });

  it('uses the person name in the heading', () => {
    render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={2.5} />);
    expect(screen.getByRole('heading', { name: /Dan/ })).toBeDefined();
  });

  it('marks exactly one row Best for a whole-year recommended filing age', () => {
    render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={2.5} />);
    expect(screen.getAllByText('Best')).toHaveLength(1);
    expect(within(screen.getByTestId('claim-row-70')).getByText('Best')).toBeDefined();
  });

  it('marks exactly one row Best for a non-whole-year recommended filing age, rounded to the nearest claiming age', () => {
    render(<PersonPanel analysis={nonWholeYearAnalysis} index={0} annualCola={2.5} />);
    expect(screen.getAllByText('Best')).toHaveLength(1);
    // 64y5m rounds to 64 — the nearest whole claiming age.
    expect(within(screen.getByTestId('claim-row-64')).getByText('Best')).toBeDefined();
  });

  // Regression coverage for a real bug: after Task 19 first wired HouseholdView
  // into Analyzer, BenefitChart and OptionalChartsPanel were dropped from every
  // render path in the app (they only existed inside their own component
  // tests). These two charts are per-person, so their home is here.
  it('renders the always-visible cumulative benefit chart', () => {
    render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={2.5} />);
    expect(screen.getByText('Cumulative Lifetime Benefits')).toBeDefined();
  });

  it('renders the optional charts gallery', () => {
    render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={2.5} />);
    expect(screen.getByText('Optional Visualizations')).toBeDefined();
  });

  // Regression coverage for a real bug found in Task 23's e2e pass: before
  // the couples refactor, every claimant (there was only ever one) saw a
  // Break-Even Analysis section. HouseholdPanel restored it for married
  // households' Household tab, but nothing restored it for a single
  // claimant or for each married person's own tab — PersonPanel is the only
  // component that renders for both, so it needs its own live-COLA
  // break-even section rather than relying on HouseholdPanel's.
  it('renders a break-even section, recomputed live from the annualCola prop', () => {
    const zeroCola = render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={0} />);
    expect(screen.getByText('Break-Even Analysis')).toBeDefined();
    const zeroColaAge = screen.getByTestId('break-even-62-70').textContent;
    zeroCola.unmount();

    // Not 8 (the slider's max): at 8% COLA this PIA's 62->70 break-even
    // never occurs within the search grid (an earlier claimant's extra years
    // of compounding can permanently outrun a later, larger check), so the
    // card would legitimately disappear rather than just show a different
    // age. 5% still lands a real, later break-even age.
    render(<PersonPanel analysis={wholeYearAnalysis} index={0} annualCola={5} />);
    expect(screen.getByTestId('break-even-62-70').textContent).not.toBe(zeroColaAge);
  });
});
