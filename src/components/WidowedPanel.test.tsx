import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WidowedPanel } from './WidowedPanel';
import type { HouseholdAnalysis, HouseholdStrategy } from '../lib/household';
import { yearsMonthsLabel } from '../lib/format';

const age = (years: number, months = 0) => ({
  years, months,
  // The app's own formatter, not a hand-built template: an inline
  // `${months} months` reproduces the "1 months" defect this project has
  // already shipped once, and a fixture carrying the bug cannot catch it.
  label: months === 0 ? String(years) : yearsMonthsLabel(years, months),
  decimalYears: years + months / 12,
  monthDuration: null as never,
});

const row = (over: Partial<HouseholdStrategy>): HouseholdStrategy =>
  ({
    key: 'optimal', label: 'Optimal', filingAges: [age(62, 1)],
    expectedNpv: 735_430, lifetimeTotal: 735_430,
    survivorClaimDate: { monthIndex: 24_377, age: '67' },
    deltaVsOptimal: 0, isOptimal: true, isSelected: true, hidden: false,
    survivorIncome: null,
    ...over,
  }) as HouseholdStrategy;

const optimal = row({});
const ownFirst = row({
  key: 'ownFirst', label: 'Own benefit first, survivor at 67', isOptimal: false, isSelected: false,
  expectedNpv: 659_718, lifetimeTotal: 659_718, deltaVsOptimal: -75_712,
  survivorClaimDate: { monthIndex: 24_305, age: '61 years, 7 months' },
});

function buildAnalysis(over: Partial<HouseholdAnalysis> = {}): HouseholdAnalysis {
  return {
    status: 'widowed',
    people: [
      {
        person: {
          id: 'a', name: 'Mary', birthYear: 1964, birthMonth: 6,
          gender: 'female', piaMonthly: 1200, lifeExpectancy: 90,
        },
        fra: { years: 67, months: 0 },
        currentAge: { years: 61, months: 7 },
        // Emptied by `analyzeWidowed` — the whole reason this panel is not
        // `PersonPanel`.
        claimingOptions: [],
        breakEvens: [],
        filingAge: age(62, 1),
        monthlyAtFilingAge: 2475,
        ssaSuggestedLifeExpectancy: 85,
      },
    ],
    optimal,
    selected: optimal,
    scenarioIsBest: true,
    filingAgeOptions: [[]],
    comparisons: [optimal, ownFirst],
    allComparisons: [optimal, ownFirst],
    combinedTimeline: [],
    periods: [
      { personId: 'a', type: 'personal', startIndex: 24_318, endIndex: 24_653, monthlyAmount: 845 },
      { personId: 'a', type: 'survivor', startIndex: 24_377, endIndex: 24_653, monthlyAmount: 1630 },
    ],
    survivorGap: null,
    survivorClaim: null,
    finalIndexByPersonId: { a: 24_653 },
    recommendation:
      "Claim the survivor benefit at age 67, and file on Mary's own record at age 62 years, 1 month",
    recommendationDetail: 'SSA pays the larger of the two benefits each month.',
    assumptions: { annualCola: 2.5, discountRate: 0.025 },
    asOf: new Date(2026, 0, 15),
    piaEstimated: false,
    deceased: {
      birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 8,
      piaMonthly: 3000, filed: { year: 2022, month: 6 },
    },
    ...over,
  } as unknown as HouseholdAnalysis;
}

const renderPanel = (over: Partial<HouseholdAnalysis> = {}) =>
  render(
    <WidowedPanel analysis={buildAnalysis(over)} dollarsMode="real" onDollarsModeChange={vi.fn()} />,
  );

describe('WidowedPanel', () => {
  it('leads on both dates, not just the own-record one', () => {
    renderPanel();
    const title = screen.getByTestId('recommendation-title');
    expect(title).toHaveTextContent(/survivor benefit at age 67/i);
    expect(title).toHaveTextContent(/own record at age 62 years, 1 month/i);
  });

  it('states each stage at what it actually pays', () => {
    // Own record from 62y1m, then both benefits from 67. The second figure is
    // the TOTAL, not the survivor increment: 2,475, not 1,630.
    renderPanel();
    expect(screen.getByTestId('widowed-stage-0')).toHaveTextContent('$845.00');
    expect(screen.getByTestId('widowed-stage-1')).toHaveTextContent('$2,475.00');
    expect(screen.queryByTestId('widowed-stage-2')).not.toBeInTheDocument();
  });

  it('never reports a benefit that pays alone as an increment of zero', () => {
    // The reported defect. Own PIA 3,000 against a deceased 2,000: his own
    // record is the larger, so the engine ENDS the survivor band the month
    // his own starts and the two never overlap. The old three-figure split
    // computed both at one steady month and printed "Survivor increment,
    // from 60: $0.00" — over a survivor benefit that was his entire income
    // for the ten years from 60 to 70.
    renderPanel({
      periods: [
        { personId: 'a', type: 'survivor', startIndex: 24_324, endIndex: 24_443, monthlyAmount: 1430 },
        { personId: 'a', type: 'personal', startIndex: 24_444, endIndex: 24_589, monthlyAmount: 3720 },
      ],
    } as Partial<HouseholdAnalysis>);

    expect(screen.getByTestId('widowed-stage-0')).toHaveTextContent('$1,430.00');
    expect(screen.getByTestId('widowed-stage-1')).toHaveTextContent('$3,720.00');
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('names what is paying at each stage, and calls two benefits a total', () => {
    renderPanel();
    expect(screen.getByText(/Own record, from 62 years, 1 month/)).toBeInTheDocument();
    // "Both benefits", never "Survivor increment" — the figure beside it is
    // what the household receives, not the difference.
    expect(screen.getByText(/Both benefits, from 67/)).toBeInTheDocument();
    // Scoped to the stat labels: the chart's caption legitimately uses the
    // word when the two benefits DO stack, and that sentence is about the
    // chart's bands rather than about this figure.
    const stats = screen.getByTestId('widowed-stage-0').closest('.widowed-stats')!;
    expect(within(stats as HTMLElement).queryByText(/increment/i)).not.toBeInTheDocument();
  });

  it('carries a survivor-claim column, which the other tables have no room for', () => {
    renderPanel();
    const table = screen.getByTestId('widowed-strategy-table');
    expect(within(table).getByText('Survivor benefit at')).toBeInTheDocument();
    expect(within(table).getByText('Own record at')).toBeInTheDocument();
    // Without it the rows differ only by their label: `ownFirst` and
    // `optimal` share an own-record filing age here.
    const rows = within(table).getAllByTestId('cell-survivor-age').map((c) => c.textContent);
    expect(rows).toEqual(['67', '61 years, 7 months']);
  });

  it('never calls the lifetime sum a present value', () => {
    // `expectedNpv` and `lifetimeTotal` hold the same number for a widowed
    // row, and only one of them MEANS an undiscounted sum. This column used
    // to print the first under a "Combined PV" header.
    renderPanel();
    const table = screen.getByTestId('widowed-strategy-table');
    expect(within(table).getByText('Lifetime total')).toBeInTheDocument();
    expect(within(table).queryByText('Combined PV')).not.toBeInTheDocument();
    expect(screen.getByTestId('widowed-lifetime-caption')).toHaveTextContent(
      /not the mortality-weighted present value/i,
    );
  });

  it('reads the money column off `lifetimeTotal`, not `expectedNpv`', () => {
    // Same row, the two fields deliberately disagreeing. Only one is right
    // under this header.
    renderPanel({
      comparisons: [row({ lifetimeTotal: 111_111, expectedNpv: 999_999 })],
    });
    const cell = screen.getAllByTestId('cell-lifetime')[0];
    expect(cell).toHaveTextContent('$111,111');
    expect(cell).not.toHaveTextContent('$999,999');
  });

  it('shows nothing the widow(er) cannot use', () => {
    renderPanel();
    // Her own claiming-age table, her break-evens and the per-age charts all
    // describe income she may never receive — the survivor benefit can
    // exceed her own in every month she lives.
    expect(screen.queryByTestId('benefit-table')).not.toBeInTheDocument();
    expect(screen.queryByText('Break-Even Analysis')).not.toBeInTheDocument();
    expect(screen.queryByTestId('summary-age62')).not.toBeInTheDocument();
    // And no scenario editor: these rows are two dates the engine searches,
    // not a filing age an adviser picks.
    expect(screen.queryByTestId('scenario-edit-toggle')).not.toBeInTheDocument();
  });

  it('states the deceased’s record, including whether they had filed', () => {
    renderPanel();
    expect(screen.getByTestId('deceased-birth')).toHaveTextContent('March 1960');
    expect(screen.getByTestId('deceased-death')).toHaveTextContent('August 2024');
    expect(screen.getByTestId('deceased-filed')).toHaveTextContent('June 2022');
  });

  it('says "had not filed" rather than printing a substituted date', () => {
    // `deceasedContext` treats an unfiled death as filing AT the death date
    // so the engine has something to work with. Printing that as a fact
    // would state something the adviser never entered.
    renderPanel({
      deceased: {
        birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 8,
        piaMonthly: 3000, filed: null,
      },
    } as Partial<HouseholdAnalysis>);
    expect(screen.getByText('Had not filed')).toBeInTheDocument();
    expect(screen.getByTestId('deceased-filed')).toHaveTextContent('—');
    expect(screen.getByTestId('deceased-filed')).not.toHaveTextContent('August 2024');
  });

  it('says nothing about an estimate when the PIA was entered directly', () => {
    renderPanel();
    expect(screen.queryByTestId('pia-estimate-note')).not.toBeInTheDocument();
  });

  it('discloses a recovered PIA, and the year its dollars are in', () => {
    // A cheque carries every COLA since they filed and the engine's PIA
    // carries none, so the recovered figure is in the filing year's dollars.
    // Without the year the reader cannot judge how wide that gap is.
    renderPanel({ piaEstimated: true });
    const note = screen.getByTestId('pia-estimate-note');
    expect(note).toHaveTextContent(/estimate/i);
    expect(note).toHaveTextContent('2022 dollars');
  });

  it('stops claiming an increment when the two benefits never overlap', () => {
    // With no personal band beneath it, "the increment above the personal
    // band beneath it" describes a stacking that does not happen.
    renderPanel({
      periods: [
        { personId: 'a', type: 'survivor', startIndex: 24_324, endIndex: 24_443, monthlyAmount: 1430 },
        { personId: 'a', type: 'personal', startIndex: 24_444, endIndex: 24_589, monthlyAmount: 3720 },
      ],
    } as Partial<HouseholdAnalysis>);
    const caption = screen.getByTestId('combined-income-caveat');
    expect(caption).toHaveTextContent(/never run together here/i);
    expect(caption).not.toHaveTextContent(/increment above the personal band/i);
  });

  it('captions the chart for one person with no spousal benefit', () => {
    renderPanel();
    // The couple caption speaks of "each person's segments" and "any spousal
    // or survivor segment" — a widow(er) has one of each and neither is
    // spousal.
    const caption = screen.getByTestId('combined-income-caveat');
    expect(caption).toHaveTextContent(/survivor segment is the increment/i);
    // The couple caption speaks of "each person's segments" and "any spousal
    // or survivor segment" — a widow(er) has one of each and neither is
    // spousal.
    expect(caption).not.toHaveTextContent(/spousal/i);
    expect(caption).not.toHaveTextContent(/each person/i);
  });
});
