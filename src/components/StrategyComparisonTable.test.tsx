import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StrategyComparisonTable } from './StrategyComparisonTable';
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { HouseholdStrategy } from '../lib/household';
import type { Person } from '../lib/personAnalysis';
import { SURVIVOR_INCOME_COLUMN_HEADER } from './methodologyCopy';

const people = [
  { id: 'a', name: 'Dan' },
  { id: 'b', name: 'Sarah' },
] as Person[];

const age = (years: number) => ({ years, months: 0, label: String(years),
  decimalYears: years, monthDuration: null as never });

const comparisons: HouseholdStrategy[] = [
  { key: 'earliest', label: 'Both claim earliest (62)', filingAges: [age(62), age(62)],
    expectedNpv: 1_018_000, deltaVsOptimal: -225_000, isOptimal: false, survivorIncome: 24_000 },
  { key: 'optimal', label: 'Optimal', filingAges: [age(70), age(64)],
    expectedNpv: 1_243_000, deltaVsOptimal: 0, isOptimal: true, survivorIncome: 35_712 },
  { key: 'latest', label: 'Both delay to 70', filingAges: [age(70), age(70)],
    expectedNpv: 1_221_000, deltaVsOptimal: -22_000, isOptimal: false, survivorIncome: 35_712 },
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
    // A real single-claimant row always carries `survivorIncome: null`
    // (`household.ts`); set explicitly here rather than inherited from a
    // married fixture row, so this test reflects what the pipeline actually
    // produces.
    const single = [{ ...comparisons[1], filingAges: [age(70)], survivorIncome: null }];
    render(<StrategyComparisonTable comparisons={single} people={[people[0]]} />);
    expect(screen.queryByTestId('cell-age-b')).toBeNull();
  });

  it('adds a survivor-income column for a married household', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    expect(screen.getByRole('columnheader', { name: SURVIVOR_INCOME_COLUMN_HEADER })).toBeDefined();
    const optimalRow = screen.getByTestId('strategy-row-optimal');
    expect(within(optimalRow).getByTestId('cell-survivor-optimal')).toHaveTextContent('$35,712');
  });

  it('omits the survivor-income column entirely for a single claimant', () => {
    const single = [{ ...comparisons[1], filingAges: [age(70)], survivorIncome: null }];
    render(<StrategyComparisonTable comparisons={single} people={[people[0]]} />);
    expect(screen.queryByRole('columnheader', { name: SURVIVOR_INCOME_COLUMN_HEADER })).toBeNull();
    expect(screen.queryByTestId('survivor-income-caption')).toBeNull();
  });

  it('shows an em dash rather than a currency figure when a row has no survivor income', () => {
    const withNullRow: HouseholdStrategy[] = [
      { ...comparisons[0], survivorIncome: null },
      comparisons[1],
    ];
    render(<StrategyComparisonTable comparisons={withNullRow} people={people} />);
    const row = screen.getByTestId('strategy-row-earliest');
    expect(within(row).getByTestId('cell-survivor-earliest')).toHaveTextContent('—');
  });

  it('states the modeled death direction in the caption below the table', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    const caption = screen.getByTestId('survivor-income-caption');
    expect(caption).toHaveTextContent('ssa.tools engine models');
  });

  it("points at the existing gap note, rather than repeating it, when survivorGap is set", () => {
    const gap: SurvivorGap = {
      survivorLabel: 'Sarah',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    };
    render(<StrategyComparisonTable comparisons={comparisons} people={people} survivorGap={gap} />);
    const caption = screen.getByTestId('survivor-income-caption');
    expect(caption).toHaveTextContent('understate what the survivor would actually receive');
    // The gap note's own figures belong to `survivorGapNote` alone — this
    // caption must not repeat them.
    expect(caption.textContent).not.toContain('1,780');
    expect(caption.textContent).not.toContain('Sarah');
  });
});
