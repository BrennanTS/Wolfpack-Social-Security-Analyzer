import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StrategyComparisonTable } from './StrategyComparisonTable';
import type { HouseholdStrategy } from '../lib/household';
import type { Person } from '../lib/personAnalysis';

const people = [
  { id: 'a', name: 'Dan' },
  { id: 'b', name: 'Sarah' },
] as Person[];

const age = (years: number) => ({ years, months: 0, label: String(years),
  decimalYears: years, monthDuration: null as never });

const comparisons: HouseholdStrategy[] = [
  { key: 'earliest', label: 'Both claim earliest (62)', filingAges: [age(62), age(62)],
    expectedNpv: 1_018_000, deltaVsOptimal: -225_000, isOptimal: false },
  { key: 'optimal', label: 'Optimal', filingAges: [age(70), age(64)],
    expectedNpv: 1_243_000, deltaVsOptimal: 0, isOptimal: true },
  { key: 'latest', label: 'Both delay to 70', filingAges: [age(70), age(70)],
    expectedNpv: 1_221_000, deltaVsOptimal: -22_000, isOptimal: false },
];

describe('StrategyComparisonTable', () => {
  it('renders one row per strategy', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    expect(screen.getAllByTestId(/^strategy-row-/)).toHaveLength(3);
  });

  it('marks only the optimal row and shows an em dash for its delta', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    const optimal = screen.getByTestId('strategy-row-optimal');
    expect(optimal.className).toContain('row-optimal');
    expect(within(optimal).getByTestId('cell-delta')).toHaveTextContent('—');
  });

  it('shows each person filing age in its own column', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    const row = screen.getByTestId('strategy-row-optimal');
    expect(within(row).getByTestId('cell-age-a')).toHaveTextContent('70');
    expect(within(row).getByTestId('cell-age-b')).toHaveTextContent('64');
  });

  it('names the columns after the people', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    expect(screen.getByRole('columnheader', { name: 'Dan' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Sarah' })).toBeDefined();
  });

  it('renders a single age column for a one-person household', () => {
    const single = [{ ...comparisons[1], filingAges: [age(70)] }];
    render(<StrategyComparisonTable comparisons={single} people={[people[0]]} />);
    expect(screen.queryByTestId('cell-age-b')).toBeNull();
  });
});
