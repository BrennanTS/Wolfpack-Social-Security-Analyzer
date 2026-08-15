import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HouseholdView } from './HouseholdView';
import type { HouseholdAnalysis } from '../lib/household';
import type { PersonAnalysis } from '../lib/personAnalysis';

// `claimingOptions` covers every whole-year age 62-70 so a rounded
// `recommendedFilingAge` always lands on a real row — mirrors the fixture in
// PersonPanel.test.tsx.
function buildPersonAnalysis(id: 'a' | 'b', name: string): PersonAnalysis {
  return {
    person: { id, name, birthYear: 1962, birthMonth: 4,
              gender: id === 'a' ? 'male' : 'female', piaMonthly: 2400, lifeExpectancy: 85 },
    fra: { years: 67, months: 0, totalMonths: 804, fraDate: new Date(2029, 0, 1) },
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
    recommendedFilingAge: {
      years: 70, months: 0, label: '70', decimalYears: 70, monthDuration: null as never,
    },
    recommendedMonthly: 2976,
    breakEvens: [],
    ssaSuggestedLifeExpectancy: 82,
  } as unknown as PersonAnalysis;
}

const age = (years: number) => ({ years, months: 0, label: String(years),
  decimalYears: years, monthDuration: null as never });

// Build via a helper so both the single and married cases stay readable.
function buildAnalysis(status: 'single' | 'married'): HouseholdAnalysis {
  const dan = buildPersonAnalysis('a', 'Dan');
  const sarah = buildPersonAnalysis('b', 'Sarah');
  const people = status === 'married' ? [dan, sarah] : [dan];

  const optimal = {
    key: 'optimal' as const,
    label: 'Optimal',
    filingAges: status === 'married' ? [age(70), age(64)] : [age(70)],
    expectedNpv: 1_243_000,
    deltaVsOptimal: 0,
    isOptimal: true,
  };
  const earliest = {
    key: 'earliest' as const,
    label: status === 'married' ? 'Both claim earliest (62)' : 'Claim at 62',
    filingAges: status === 'married' ? [age(62), age(62)] : [age(62)],
    expectedNpv: 1_018_000,
    deltaVsOptimal: -225_000,
    isOptimal: false,
  };

  return {
    status,
    people,
    optimal,
    comparisons: [earliest, optimal],
    combinedTimeline: [
      { year: 2032, byPersonId: { a: 35_712, b: status === 'married' ? 23_040 : 0 }, total: status === 'married' ? 58_752 : 35_712 },
    ],
    recommendation: status === 'married'
      ? 'Dan files at 70 · Sarah files at 64'
      : 'Claim at age 70',
    recommendationDetail: 'The ssa.tools optimizer maximizes combined expected present value.',
    assumptions: { annualCola: 2.5, discountRate: 3 },
    asOf: new Date(2026, 7, 15),
  };
}

describe('HouseholdView', () => {
  it('renders no tab strip for a single claimant', () => {
    render(<HouseholdView analysis={buildAnalysis('single')} annualCola={2.5} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('benefit-table')).toBeDefined();
  });

  it('renders three tabs for a married household, household selected first', () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Household', 'Dan', 'Sarah']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('strategy-table')).toBeDefined();
  });

  it('switches panels on click', async () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Sarah' }));
    expect(screen.getByRole('tab', { name: 'Sarah' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('strategy-table')).toBeNull();
    expect(screen.getByTestId('benefit-table')).toBeDefined();
  });

  it('moves between tabs with the arrow keys', async () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    screen.getByRole('tab', { name: 'Household' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Dan' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Household' })).toHaveAttribute('aria-selected', 'true');
  });

  it('wraps from the last tab to the first on ArrowRight', async () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    // Click (rather than a bare .focus()) both selects and focuses Sarah's
    // tab, keeping selection and DOM focus in sync the way a real user's
    // click-then-arrow-key sequence would.
    await userEvent.click(screen.getByRole('tab', { name: 'Sarah' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Household' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Household' })).toHaveFocus();
  });

  it('wraps from the first tab to the last on ArrowLeft', async () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    screen.getByRole('tab', { name: 'Household' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Sarah' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Sarah' })).toHaveFocus();
  });

  it('gives every tab a roving tabIndex', () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabIndex', '0');
    expect(tabs[1]).toHaveAttribute('tabIndex', '-1');
    expect(tabs[2]).toHaveAttribute('tabIndex', '-1');
  });

  it('pairs each tab and panel via aria-controls/aria-labelledby', () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    const householdTab = screen.getByRole('tab', { name: 'Household' });
    const panel = screen.getByRole('tabpanel');
    expect(householdTab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', householdTab.id);
  });

  it('exposes exactly one visible tabpanel', () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });
});
