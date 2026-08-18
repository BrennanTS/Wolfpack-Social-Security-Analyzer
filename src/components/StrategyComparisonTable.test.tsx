import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StrategyComparisonTable } from './StrategyComparisonTable';
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { HouseholdStrategy } from '../lib/household';
import type { Person } from '../lib/personAnalysis';
import {
  addScenario,
  resetScenarios,
  toggleScenarioHidden,
  type FilingAgeChoice,
  type ScenarioSet,
} from '../lib/scenario';
import { SURVIVOR_INCOME_COLUMN_HEADER } from './methodologyCopy';

const people = [
  { id: 'a', name: 'Dan' },
  { id: 'b', name: 'Sarah' },
] as Person[];

const age = (years: number) => ({ years, months: 0, label: String(years),
  decimalYears: years, monthDuration: null as never });

const comparisons: HouseholdStrategy[] = [
  { key: 'earliest', label: 'Both claim earliest (62)', filingAges: [age(62), age(62)],
    expectedNpv: 1_018_000, lifetimeTotal: null, survivorClaimDate: null,
    deltaVsOptimal: -225_000, isOptimal: false, survivorIncome: 24_000 },
  { key: 'optimal', label: 'Optimal', filingAges: [age(70), age(64)],
    expectedNpv: 1_243_000, lifetimeTotal: null, survivorClaimDate: null,
    deltaVsOptimal: 0, isOptimal: true, survivorIncome: 35_712 },
  { key: 'latest', label: 'Both delay to 70', filingAges: [age(70), age(70)],
    expectedNpv: 1_221_000, lifetimeTotal: null, survivorClaimDate: null,
    deltaVsOptimal: -22_000, isOptimal: false, survivorIncome: 35_712 },
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

  it('omits the column and its caption when no row carries a figure', () => {
    // Reachable, and the branch's own `household.test.ts` builds it: when both
    // people reach their plan-to age in the same month, `firstDeath` returns
    // null — it will not invent a survivor — so every row's `survivorIncome`
    // is null and every cell would render an em dash. The caption used to
    // print its claims over that column of dashes.
    const noFigures = comparisons.map((c) => ({ ...c, survivorIncome: null }));
    render(<StrategyComparisonTable comparisons={noFigures} people={people} />);
    expect(screen.queryByRole('columnheader', { name: SURVIVOR_INCOME_COLUMN_HEADER })).toBeNull();
    expect(screen.queryByTestId('survivor-income-caption')).toBeNull();
    expect(screen.queryByTestId('cell-survivor-optimal')).toBeNull();
  });

  it('keeps the column when only SOME rows lack a figure', () => {
    const partial = [{ ...comparisons[0], survivorIncome: null }, comparisons[1], comparisons[2]];
    render(<StrategyComparisonTable comparisons={partial} people={people} />);
    expect(screen.getByRole('columnheader', { name: SURVIVOR_INCOME_COLUMN_HEADER })).toBeDefined();
    expect(screen.getByTestId('survivor-income-caption')).toBeDefined();
  });

  it('drops the delay claim when the column falls with later filing', () => {
    // The measured household: Dan b. 1958 PIA 2400 plan-to 78, Sarah b. 1968
    // PIA 1200 plan-to 90. `survivorGap` is null, so nothing else in the
    // caption would have caught the claim being false.
    const falling: HouseholdStrategy[] = [
      { ...comparisons[1], filingAges: [age(70), age(62)], survivorIncome: 36_480 },
      { ...comparisons[2], filingAges: [age(70), age(70)], survivorIncome: 0 },
    ];
    render(<StrategyComparisonTable comparisons={falling} people={people} />);
    const caption = screen.getByTestId('survivor-income-caption');
    expect(caption.textContent).not.toContain('Delaying raises');
    expect(caption).toHaveTextContent('not simply larger for later filing');
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

  it('states the assumed death direction in the caption below the table, without naming one', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    const caption = screen.getByTestId('survivor-income-caption');
    expect(caption).toHaveTextContent("each spouse's own life-expectancy input");
    // Which spouse survives falls out of life expectancy, not PIA — a fixed
    // direction claim here would be false for a household whose higher
    // earner happens to be the one projected to survive.
    expect(caption.textContent).not.toContain('lower-earning spouse outliving the higher earner');
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

  // The column sits directly beside "Combined PV", which always stays in
  // present-value dollars regardless of this toggle — the caption is the
  // only thing in the table naming which dollars THIS column is in.
  describe('dollarsMode', () => {
    it('defaults to naming today’s dollars when omitted', () => {
      render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
      expect(screen.getByTestId('survivor-income-caption')).toHaveTextContent(
        /today.s dollars, before any cost-of-living/i,
      );
    });

    it('names nominal dollars, contrasted against Combined PV, when passed nominal', () => {
      render(
        <StrategyComparisonTable
          comparisons={comparisons}
          people={people}
          dollarsMode="nominal"
        />,
      );
      const caption = screen.getByTestId('survivor-income-caption');
      expect(caption).toHaveTextContent(/nominal/i);
      expect(caption).toHaveTextContent(/Combined PV/);
    });
  });
});

describe('StrategyComparisonTable — editing', () => {
  const optionsFor = (fromYears: number, fromMonths: number): FilingAgeChoice[] => {
    const out: FilingAgeChoice[] = [];
    for (let m = fromYears * 12 + fromMonths; m <= 70 * 12; m++) {
      out.push({ years: Math.floor(m / 12), months: m % 12 });
    }
    return out;
  };

  /** The three fixture rows above, marked up as a live scenario set. */
  const editableRows = (over: Partial<HouseholdStrategy>[] = []): HouseholdStrategy[] =>
    comparisons.map((c, i) => ({
      ...c,
      isSelected: c.key === 'optimal',
      hidden: false,
      ...(over[i] ?? {}),
    }));

  function renderEditable(
    over: {
      scenarios?: ScenarioSet;
      allComparisons?: HouseholdStrategy[];
      comparisons?: HouseholdStrategy[];
    } = {},
  ) {
    const onScenariosChange = vi.fn();
    const rows = over.allComparisons ?? editableRows();
    render(
      <StrategyComparisonTable
        comparisons={over.comparisons ?? rows.filter((r) => !r.hidden)}
        allComparisons={rows}
        people={people}
        scenarios={over.scenarios ?? resetScenarios()}
        onScenariosChange={onScenariosChange}
        filingAgeOptions={[optionsFor(63, 10), optionsFor(62, 1)]}
      />,
    );
    return onScenariosChange;
  }

  const enterEdit = async () => userEvent.click(screen.getByTestId('scenario-edit-toggle'));

  it('offers no editing at all without a scenario set behind the rows', () => {
    // A widowed household's rows are derived by the engine, not chosen.
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    expect(screen.queryByTestId('scenario-edit-toggle')).not.toBeInTheDocument();
  });

  it('starts in view mode with no controls in the way', () => {
    renderEditable();
    expect(screen.getByTestId('scenario-edit-toggle')).toHaveTextContent('Edit');
    expect(screen.queryByTestId('scenario-eye-latest')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scenario-add')).not.toBeInTheDocument();
  });

  it('keeps the money columns while editing — the point of editing in place', async () => {
    renderEditable();
    await enterEdit();
    const row = screen.getByTestId('strategy-row-latest');
    expect(row).toHaveTextContent('$1,221,000');
    expect(row).toHaveTextContent('$22,000');
  });

  it('shows hidden rows only while editing', async () => {
    const rows = editableRows([{}, {}, { hidden: true }]);
    renderEditable({ allComparisons: rows });
    expect(screen.queryByTestId('strategy-row-latest')).not.toBeInTheDocument();
    await enterEdit();
    expect(screen.getByTestId('strategy-row-latest')).toBeInTheDocument();
    expect(screen.getByTestId('hidden-count')).toHaveTextContent('1 hidden');
  });

  it('hides a row through its eye', async () => {
    const onChange = renderEditable();
    await enterEdit();
    await userEvent.click(screen.getByTestId('scenario-eye-latest'));
    const next = onChange.mock.calls[0][0] as ScenarioSet;
    expect(next.rows.find((r) => r.id === 'latest')?.hidden).toBe(true);
  });

  it('gives Optimal no eye and no remove — it is the benchmark', async () => {
    renderEditable();
    await enterEdit();
    expect(screen.queryByTestId('scenario-eye-optimal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scenario-remove-optimal')).not.toBeInTheDocument();
    expect(screen.getByTestId('scenario-eye-latest')).toBeInTheDocument();
  });

  it('gives a derived row no age controls, since its ages are re-derived', async () => {
    renderEditable();
    await enterEdit();
    expect(screen.queryByTestId('scenario-years-fra-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('strategy-row-latest')).toHaveTextContent('70');
  });

  it('adds a row seeded from whatever is currently shown', async () => {
    const onChange = renderEditable();
    await enterEdit();
    await userEvent.click(screen.getByTestId('scenario-add'));
    const next = onChange.mock.calls[0][0] as ScenarioSet;
    expect(next.rows).toHaveLength(5);
    expect(next.rows[4].scenario).toEqual({
      kind: 'custom',
      ages: [{ years: 70, months: 0 }, { years: 64, months: 0 }],
    });
  });

  it('switches which row drives the report', async () => {
    const onChange = renderEditable();
    await enterEdit();
    await userEvent.click(screen.getByTestId('scenario-use-latest'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selectedId: 'latest' }));
  });

  it('snaps to the earliest month in the year rather than carrying one across', async () => {
    // The defect this replaces: a row sitting at 62 years 1 month became
    // "69 years, 1 month" when only the year was changed. Nobody asked for
    // that month.
    const custom: HouseholdStrategy = {
      ...comparisons[0],
      key: 's1',
      label: 'Scenario 1',
      filingAges: [age(64), { ...age(62), months: 1, label: '62 years, 1 month' }],
      isSelected: true,
      hidden: false,
    };
    const set = addScenario(resetScenarios(), [
      { years: 64, months: 0 },
      { years: 62, months: 1 },
    ]);
    const onChange = renderEditable({ scenarios: set, allComparisons: [custom] });
    await enterEdit();
    await userEvent.selectOptions(screen.getByTestId('scenario-years-s1-1'), '69');
    const next = onChange.mock.calls[0][0] as ScenarioSet;
    expect(next.rows.find((r) => r.id === 's1')?.scenario).toEqual({
      kind: 'custom',
      ages: [{ years: 64, months: 0 }, { years: 69, months: 0 }],
    });
  });

  it('snaps to the person’s own floor where a whole year is behind them', async () => {
    const custom: HouseholdStrategy = {
      ...comparisons[0],
      key: 's1',
      label: 'Scenario 1',
      filingAges: [age(65), age(65)],
      isSelected: true,
      hidden: false,
    };
    const set = addScenario(resetScenarios(), [
      { years: 65, months: 0 },
      { years: 65, months: 0 },
    ]);
    const onChange = renderEditable({ scenarios: set, allComparisons: [custom] });
    await enterEdit();
    // Person A's floor is 63 years 10 months, so year 63 starts at month 10.
    await userEvent.selectOptions(screen.getByTestId('scenario-years-s1-0'), '63');
    const next = onChange.mock.calls[0][0] as ScenarioSet;
    const row = next.rows.find((r) => r.id === 's1')?.scenario;
    expect(row).toEqual({
      kind: 'custom',
      ages: [{ years: 63, months: 10 }, { years: 65, months: 0 }],
    });
  });

  it('never offers a year or a month the person has already passed', async () => {
    const custom: HouseholdStrategy = {
      ...comparisons[0],
      key: 's1',
      label: 'Scenario 1',
      filingAges: [{ ...age(63), months: 10, label: '63 years, 10 months' }, age(65)],
      isSelected: true,
      hidden: false,
    };
    renderEditable({
      scenarios: addScenario(resetScenarios(), [
        { years: 63, months: 10 },
        { years: 65, months: 0 },
      ]),
      allComparisons: [custom],
    });
    await enterEdit();
    const years = [...(screen.getByTestId('scenario-years-s1-0') as HTMLSelectElement).options].map(
      (o) => Number(o.value),
    );
    expect(years).not.toContain(62);
    const months = [
      ...(screen.getByTestId('scenario-months-s1-0') as HTMLSelectElement).options,
    ].map((o) => Number(o.value));
    expect(months).toEqual([10, 11]);
  });

  it('resets, and offers nothing to reset when already at the defaults', async () => {
    const onChange = renderEditable({
      scenarios: toggleScenarioHidden(resetScenarios(), 'latest'),
    });
    await enterEdit();
    expect(screen.getByTestId('scenario-reset')).toBeEnabled();
    await userEvent.click(screen.getByTestId('scenario-reset'));
    expect(onChange).toHaveBeenCalledWith(resetScenarios());
  });

  it('does not badge the shown row — the rule and tint already mark it', async () => {
    renderEditable();
    // Only "Best", on the optimal row. A second badge beside it was two
    // labels competing over one row.
    expect(screen.getAllByText('Best')).toHaveLength(1);
    expect(screen.queryByText('Shown')).not.toBeInTheDocument();
    expect(screen.getByTestId('strategy-row-optimal').className).toContain('row-selected');
  });

  it('holds the row order while editing, and re-sorts on Done', async () => {
    // The table sorts by filing age, which is right for reading and wrong for
    // editing: a row that moves out from under the control you are holding is
    // the complaint this exists to fix.
    const late: HouseholdStrategy = {
      ...comparisons[0],
      key: 's1',
      label: 'Scenario 1',
      filingAges: [age(70), age(70)],
      isSelected: true,
      hidden: false,
    };
    const early: HouseholdStrategy = { ...late, filingAges: [age(62), age(62)] };
    const set = addScenario(resetScenarios(), [
      { years: 70, months: 0 },
      { years: 70, months: 0 },
    ]);

    const rowOrder = () =>
      screen.getAllByTestId(/^strategy-row-/).map((r) => r.getAttribute('data-testid'));

    // Enters edit mode with s1 last, then its ages move to the earliest.
    const { rerender } = render(
      <StrategyComparisonTable
        comparisons={[...editableRows(), late].filter((r) => !r.hidden)}
        allComparisons={[...editableRows(), late]}
        people={people}
        scenarios={set}
        onScenariosChange={vi.fn()}
        filingAgeOptions={[optionsFor(62, 0), optionsFor(62, 0)]}
      />,
    );
    await userEvent.click(screen.getByTestId('scenario-edit-toggle'));
    expect(rowOrder().at(-1)).toBe('strategy-row-s1');

    // The analysis comes back with s1 re-sorted to the front; the table must
    // not move it while editing.
    rerender(
      <StrategyComparisonTable
        comparisons={[early, ...editableRows()]}
        allComparisons={[early, ...editableRows()]}
        people={people}
        scenarios={set}
        onScenariosChange={vi.fn()}
        filingAgeOptions={[optionsFor(62, 0), optionsFor(62, 0)]}
      />,
    );
    expect(rowOrder().at(-1)).toBe('strategy-row-s1');

    // Done releases it, and the reader sees age order again.
    await userEvent.click(screen.getByTestId('scenario-edit-toggle'));
    expect(rowOrder()[0]).toBe('strategy-row-s1');
  });

  it('returns to view mode, dropping every control', async () => {
    const rows = editableRows([{}, {}, { hidden: true }]);
    renderEditable({ allComparisons: rows });
    await enterEdit();
    expect(screen.getByTestId('strategy-row-latest')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('scenario-edit-toggle'));
    expect(screen.queryByTestId('strategy-row-latest')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scenario-add')).not.toBeInTheDocument();
    expect(screen.getByTestId('scenario-edit-toggle')).toHaveTextContent('Edit');
  });
});
