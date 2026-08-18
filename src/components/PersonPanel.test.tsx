import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PersonPanel } from './PersonPanel';
import type { PersonAnalysis } from '../lib/personAnalysis';
import type { ClaimingRow, ClaimingTablePrefs } from '../lib/claimingRows';
import type { FilingAgeChoice } from '../lib/scenario';

// Minimal hand-built analysis — components take data as props and never
// call the engine, so no mocking or fixture loading is needed here.
// `claimingOptions` covers every whole-year age 62-70 (not just a sparse
// subset) so a rounded, non-whole-year `filingAge` always has a
// real row to land on, matching what `analyzePerson` actually produces.
function buildAnalysis(filingAge: PersonAnalysis['filingAge']): PersonAnalysis {
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
    filingAge,
    monthlyAtFilingAge: 2976,
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

  // A person with no work record of their own: every claiming option is $0,
  // so there is no crossover to show. The section must vanish rather than
  // print a heading with nothing under it, and the surrounding grid must
  // collapse to one column so the chart isn't left beside a dead half.
  it('omits the break-even section and its column for a zero-benefit person', () => {
    const zeroPia = {
      ...wholeYearAnalysis,
      person: { ...wholeYearAnalysis.person, piaMonthly: 0 },
      monthlyAtFilingAge: 0,
      claimingOptions: wholeYearAnalysis.claimingOptions.map((o) => ({
        ...o,
        monthlyBenefit: 0,
        lifetimeBenefits: 0,
      })),
    } as PersonAnalysis;

    const { container } = render(
      <PersonPanel analysis={zeroPia} index={1} annualCola={2.5} />,
    );
    expect(screen.queryByText('Break-Even Analysis')).toBeNull();
    expect(container.querySelectorAll('.breakeven-section')).toHaveLength(0);
    expect(container.querySelector('.output-duo')?.className).toContain('output-duo-single');
    // The claiming-age table still renders, so the person's tab is not blank.
    expect(screen.getByTestId('claim-row-70')).toBeDefined();
  });
});

describe('PersonPanel — editing the claiming-age table', () => {
  const at70 = { years: 70, months: 0, label: '70', decimalYears: 70, monthDuration: null as never };
  const base = buildAnalysis(at70);

  const optionsFrom = (fromYears: number, fromMonths: number): FilingAgeChoice[] => {
    const out: FilingAgeChoice[] = [];
    for (let m = fromYears * 12 + fromMonths; m <= 70 * 12; m++) {
      out.push({ years: Math.floor(m / 12), months: m % 12 });
    }
    return out;
  };

  const rowsFor = (over: Partial<ClaimingRow>[] = []): ClaimingRow[] =>
    [63, 64, 65, 66, 67, 68, 69, 70].map((years, i) => ({
      id: String(years),
      years,
      months: 0,
      label: String(years),
      monthlyBenefit: 1800 + years * 20,
      percentOfPia: 75 + years,
      lifetimeBenefits: 100_000,
      isEligible: years <= 63,
      added: false,
      hidden: false,
      ...(over[i] ?? {}),
    }));

  function renderEditable(
    over: { rows?: ClaimingRow[]; prefs?: ClaimingTablePrefs } = {},
  ) {
    const onClaimingPrefsChange = vi.fn();
    render(
      <PersonPanel
        analysis={base}
        index={0}
        annualCola={2.5}
        claimingRows={over.rows ?? rowsFor()}
        claimingPrefs={over.prefs ?? { hidden: [], added: [] }}
        onClaimingPrefsChange={onClaimingPrefsChange}
        filingAgeOptions={optionsFrom(63, 9)}
      />,
    );
    return onClaimingPrefsChange;
  }

  const enterEdit = async () => userEvent.click(screen.getByTestId('claim-edit-toggle'));

  it('offers no editing when nothing is wired to receive the change', () => {
    render(<PersonPanel analysis={base} index={0} annualCola={2.5} />);
    expect(screen.queryByTestId('claim-edit-toggle')).not.toBeInTheDocument();
    // And the table still renders exactly as it did before.
    expect(screen.getByTestId('claim-row-70')).toBeInTheDocument();
  });

  it('starts in view mode with no controls in the way', () => {
    renderEditable();
    expect(screen.getByTestId('claim-edit-toggle')).toHaveTextContent('Edit');
    expect(screen.queryByTestId('claim-eye-65')).not.toBeInTheDocument();
    expect(screen.queryByTestId('claim-add')).not.toBeInTheDocument();
  });

  it('shows hidden rows only while editing', async () => {
    const rows = rowsFor([{}, {}, { hidden: true }]);
    renderEditable({ rows, prefs: { hidden: ['65'], added: [] } });
    expect(screen.queryByTestId('claim-row-65')).not.toBeInTheDocument();
    await enterEdit();
    expect(screen.getByTestId('claim-row-65')).toBeInTheDocument();
    expect(screen.getByTestId('claim-hidden-count')).toHaveTextContent('1 hidden');
  });

  it('hides a row through its eye', async () => {
    const onChange = renderEditable();
    await enterEdit();
    await userEvent.click(screen.getByTestId('claim-eye-65'));
    expect(onChange).toHaveBeenCalledWith({ hidden: ['65'], added: [] });
  });

  it('adds the age the control is pointing at', async () => {
    const onChange = renderEditable();
    await enterEdit();
    // Seeded from this person's own filing age — 70y0m.
    expect((screen.getByTestId('claim-add-years') as HTMLSelectElement).value).toBe('70');
    await userEvent.selectOptions(screen.getByTestId('claim-add-years'), '69');
    await userEvent.selectOptions(screen.getByTestId('claim-add-months'), '1');
    await userEvent.click(screen.getByTestId('claim-add'));
    expect(onChange).toHaveBeenLastCalledWith({
      hidden: [],
      added: [{ years: 69, months: 1 }],
    });
  });

  it('snaps the add control’s month when its year changes', async () => {
    renderEditable();
    await enterEdit();
    // 70 offers only month 0; moving to 63 must land on the person's floor,
    // not carry a month across.
    await userEvent.selectOptions(screen.getByTestId('claim-add-years'), '63');
    expect((screen.getByTestId('claim-add-months') as HTMLSelectElement).value).toBe('9');
    const months = [...(screen.getByTestId('claim-add-months') as HTMLSelectElement).options].map(
      (o) => Number(o.value),
    );
    expect(months).toEqual([9, 10, 11]);
  });

  it('removes an added row and hides a built-in one', async () => {
    const rows = [
      ...rowsFor(),
      {
        id: '69-1', years: 69, months: 1, label: '69 years, 1 month',
        monthlyBenefit: 2800, percentOfPia: 116.7, lifetimeBenefits: 100_000,
        isEligible: false, added: true, hidden: false,
      },
    ].sort((a, b) => a.years * 12 + a.months - (b.years * 12 + b.months));
    const onChange = renderEditable({ rows, prefs: { hidden: [], added: [{ years: 69, months: 1 }] } });
    await enterEdit();
    expect(screen.getByTestId('claim-remove-69-1')).toBeInTheDocument();
    // A built-in row is hidden, never removed: it is rebuilt on every analysis.
    expect(screen.queryByTestId('claim-remove-67')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('claim-remove-69-1'));
    expect(onChange).toHaveBeenCalledWith({ hidden: [], added: [] });
  });

  it('renders an added age with its own label', async () => {
    const rows = [
      ...rowsFor(),
      {
        id: '69-1', years: 69, months: 1, label: '69 years, 1 month',
        monthlyBenefit: 2800, percentOfPia: 116.7, lifetimeBenefits: 100_000,
        isEligible: false, added: true, hidden: false,
      },
    ];
    renderEditable({ rows });
    expect(screen.getByTestId('claim-row-69-1')).toHaveTextContent('69 years, 1 month');
  });

  it('moves the Best badge to an added row sitting exactly on the filing age', () => {
    // The badge normally lands on the nearest whole year. When the adviser
    // adds the exact age, the rounded year must give it up — two rows wearing
    // it, or the badge on the wrong one, is the defect this project keeps
    // shipping.
    const analysisAt69m1 = buildAnalysis({
      years: 69, months: 1, label: '69 years, 1 month',
      decimalYears: 69.08, monthDuration: null as never,
    });
    render(
      <PersonPanel
        analysis={analysisAt69m1}
        index={0}
        annualCola={2.5}
        claimingRows={[
          ...rowsFor(),
          {
            id: '69-1', years: 69, months: 1, label: '69 years, 1 month',
            monthlyBenefit: 2800, percentOfPia: 116.7, lifetimeBenefits: 100_000,
            isEligible: false, added: true, hidden: false,
          },
        ].sort((a, b) => a.years * 12 + a.months - (b.years * 12 + b.months))}
        claimingPrefs={{ hidden: [], added: [{ years: 69, months: 1 }] }}
        onClaimingPrefsChange={vi.fn()}
        filingAgeOptions={optionsFrom(63, 9)}
      />,
    );
    expect(within(screen.getByTestId('claim-row-69-1')).getByText('Best')).toBeInTheDocument();
    expect(screen.getAllByText('Best')).toHaveLength(1);
  });

  it('resets, and offers nothing to reset when already at the defaults', async () => {
    const onChange = renderEditable({ prefs: { hidden: ['65'], added: [] } });
    await enterEdit();
    expect(screen.getByTestId('claim-reset')).toBeEnabled();
    await userEvent.click(screen.getByTestId('claim-reset'));
    expect(onChange).toHaveBeenCalledWith({ hidden: [], added: [] });
  });

  it('returns to view mode, dropping every control', async () => {
    const rows = rowsFor([{}, {}, { hidden: true }]);
    renderEditable({ rows, prefs: { hidden: ['65'], added: [] } });
    await enterEdit();
    expect(screen.getByTestId('claim-row-65')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('claim-edit-toggle'));
    expect(screen.queryByTestId('claim-row-65')).not.toBeInTheDocument();
    expect(screen.queryByTestId('claim-add')).not.toBeInTheDocument();
  });
});
