import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersonPanel } from './PersonPanel';
import type { PersonAnalysis } from '../lib/personAnalysis';

// Minimal hand-built analysis — components take data as props and never
// call the engine, so no mocking or fixture loading is needed here.
const analysis = {
  person: { id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
            gender: 'male', piaMonthly: 2400, lifeExpectancy: 85 },
  fra: { years: 67, months: 0, totalMonths: 804, fraDate: new Date(2029, 0, 1) },
  currentAge: { years: 63, months: 9 },
  claimingOptions: [62, 67, 70].map((age) => ({
    age,
    monthlyBenefit: age === 62 ? 1680 : age === 67 ? 2400 : 2976,
    percentOfPia: age === 62 ? 70 : age === 67 ? 100 : 124,
    lifetimeBenefits: 100_000,
    yearsOfPayments: 0,
    isEligible: age <= 63,
    monthsFromFra: 0,
  })),
  recommendedFilingAge: { years: 70, months: 0, label: '70', decimalYears: 70,
                          monthDuration: null as never },
  recommendedMonthly: 2976,
  breakEvens: [],
  ssaSuggestedLifeExpectancy: 82,
} as unknown as PersonAnalysis;

describe('PersonPanel', () => {
  it('renders one table row per claiming age with monthly and %PIA', () => {
    render(<PersonPanel analysis={analysis} index={0} annualCola={2.5} />);
    const row = screen.getByTestId('claim-row-70');
    expect(within(row).getByTestId('cell-monthly')).toHaveTextContent('$2,976.00');
    expect(within(row).getByTestId('cell-percent')).toHaveTextContent('124%');
  });

  it('marks ages the person has not reached as future', () => {
    render(<PersonPanel analysis={analysis} index={0} annualCola={2.5} />);
    expect(within(screen.getByTestId('claim-row-70')).getByText('Future')).toBeDefined();
  });

  it('shows no survivor figure anywhere', () => {
    render(<PersonPanel analysis={analysis} index={0} annualCola={2.5} />);
    expect(screen.queryByText(/survivor/i)).toBeNull();
  });

  it('uses the person name in the heading', () => {
    render(<PersonPanel analysis={analysis} index={0} annualCola={2.5} />);
    expect(screen.getByRole('heading', { name: /Dan/ })).toBeDefined();
  });
});
