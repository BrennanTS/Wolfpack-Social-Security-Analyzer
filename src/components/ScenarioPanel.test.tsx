import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScenarioPanel } from './ScenarioPanel';
import {
  addScenario,
  resetScenarios,
  type FilingAgeChoice,
  type ScenarioSet,
} from '../lib/scenario';

/** A person's attainable set: whole months from `from` up to 70 years 0 months. */
function optionsFrom(fromYears: number, fromMonths: number): FilingAgeChoice[] {
  const out: FilingAgeChoice[] = [];
  for (let m = fromYears * 12 + fromMonths; m <= 70 * 12; m++) {
    out.push({ years: Math.floor(m / 12), months: m % 12 });
  }
  return out;
}

const AGES_BY_ROW: Record<string, FilingAgeChoice[]> = {
  optimal: [{ years: 70, months: 0 }, { years: 62, months: 1 }],
  earliest: [{ years: 62, months: 0 }, { years: 62, months: 0 }],
  fra: [{ years: 67, months: 0 }, { years: 67, months: 0 }],
  latest: [{ years: 70, months: 0 }, { years: 70, months: 0 }],
};

function renderPanel(overrides: Partial<Parameters<typeof ScenarioPanel>[0]> = {}) {
  const onChange = vi.fn();
  const result = render(
    <ScenarioPanel
      scenarios={resetScenarios()}
      onChange={onChange}
      expanded
      onToggle={vi.fn()}
      personNames={['Dan', 'Sarah']}
      options={[optionsFrom(63, 10), optionsFrom(62, 1)]}
      resolvedAges={AGES_BY_ROW}
      isMarried
      {...overrides}
    />,
  );
  return { onChange, ...result };
}

describe('ScenarioPanel', () => {
  it('renders nothing but its header while collapsed', () => {
    renderPanel({ expanded: false });
    expect(screen.getByRole('button', { name: /Claiming scenarios/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('scenario-table')).not.toBeInTheDocument();
  });

  it('lists every scenario with the ages the analysis resolved them to', () => {
    renderPanel();
    expect(screen.getAllByTestId(/^scenario-row-/)).toHaveLength(4);
    const optimal = screen.getByTestId('scenario-row-optimal');
    // The optimum's own ages, which the row itself does not store.
    expect(optimal).toHaveTextContent('70');
    expect(optimal).toHaveTextContent('62 years, 1 month');
  });

  it('labels the built-in rows for a couple, and for one person differently', () => {
    const { unmount } = renderPanel();
    expect(screen.getByTestId('scenario-row-fra')).toHaveTextContent('Both claim at FRA');
    unmount();
    renderPanel({
      isMarried: false,
      personNames: ['Dan'],
      options: [optionsFrom(63, 10)],
      resolvedAges: { optimal: [{ years: 70, months: 0 }], fra: [{ years: 67, months: 0 }] },
    });
    expect(screen.getByTestId('scenario-row-fra')).toHaveTextContent('Claim at FRA');
  });

  it('selects a row through its radio', async () => {
    const { onChange } = renderPanel();
    await userEvent.click(screen.getByTestId('scenario-select-fra'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selectedId: 'fra' }));
  });

  it('gives a built-in row no age controls, since its ages are derived', () => {
    renderPanel();
    // "Both claim at FRA" is a different pair for every couple — an age
    // control on it would invite an edit the next analysis would discard.
    expect(screen.queryByTestId('scenario-years-fra-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('scenario-row-fra')).toHaveTextContent('67');
  });

  it('adds a row seeded from whatever is currently shown', async () => {
    const { onChange } = renderPanel();
    await userEvent.click(screen.getByTestId('scenario-add'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as ScenarioSet;
    expect(next.rows).toHaveLength(5);
    expect(next.rows[4].scenario).toEqual({ kind: 'custom', ages: AGES_BY_ROW.optimal });
    // And it becomes the shown one, so the results move with the click.
    expect(next.selectedId).toBe(next.rows[4].id);
  });

  it('gives an added row editable ages and a name', () => {
    const set = addScenario(resetScenarios(), [
      { years: 65, months: 0 },
      { years: 65, months: 0 },
    ]);
    renderPanel({
      scenarios: set,
      resolvedAges: { ...AGES_BY_ROW, [set.selectedId]: [{ years: 65, months: 0 }, { years: 65, months: 0 }] },
    });
    expect(screen.getByTestId(`scenario-name-${set.selectedId}`)).toHaveValue('Scenario 1');
    expect(screen.getByTestId(`scenario-years-${set.selectedId}-0`)).toBeInTheDocument();
    expect(screen.getByTestId(`scenario-months-${set.selectedId}-1`)).toBeInTheDocument();
  });

  it('changes one person’s age and carries the other through untouched', async () => {
    const set = addScenario(resetScenarios(), [
      { years: 65, months: 0 },
      { years: 65, months: 0 },
    ]);
    const ages = [{ years: 65, months: 0 }, { years: 65, months: 0 }];
    const { onChange } = renderPanel({
      scenarios: set,
      resolvedAges: { ...AGES_BY_ROW, [set.selectedId]: ages },
    });
    await userEvent.selectOptions(screen.getByTestId(`scenario-years-${set.selectedId}-1`), '68');
    const next = onChange.mock.calls[0][0] as ScenarioSet;
    const row = next.rows.find((r) => r.id === set.selectedId)!;
    expect(row.scenario).toEqual({
      kind: 'custom',
      ages: [{ years: 65, months: 0 }, { years: 68, months: 0 }],
    });
  });

  it('never offers a year the person can no longer file in', () => {
    const set = addScenario(resetScenarios(), [
      { years: 65, months: 0 },
      { years: 65, months: 0 },
    ]);
    renderPanel({
      scenarios: set,
      resolvedAges: { ...AGES_BY_ROW, [set.selectedId]: [{ years: 65, months: 0 }, { years: 65, months: 0 }] },
    });
    const years = [
      ...(screen.getByTestId(`scenario-years-${set.selectedId}-0`) as HTMLSelectElement).options,
    ].map((o) => Number(o.value));
    // Dan's floor is 63 years 10 months, so 62 is gone entirely.
    expect(years).not.toContain(62);
    expect(years).toEqual([63, 64, 65, 66, 67, 68, 69, 70]);
  });

  it('offers only month 0 at age 70, since 70y1m is not a filing age', async () => {
    const set = addScenario(resetScenarios(), [
      { years: 70, months: 0 },
      { years: 65, months: 0 },
    ]);
    renderPanel({
      scenarios: set,
      resolvedAges: { ...AGES_BY_ROW, [set.selectedId]: [{ years: 70, months: 0 }, { years: 65, months: 0 }] },
    });
    const months = [
      ...(screen.getByTestId(`scenario-months-${set.selectedId}-0`) as HTMLSelectElement).options,
    ].map((o) => Number(o.value));
    expect(months).toEqual([0]);
  });

  it('renames a custom row', async () => {
    const set = addScenario(resetScenarios(), [{ years: 65, months: 0 }, { years: 65, months: 0 }]);
    const { onChange } = renderPanel({
      scenarios: set,
      resolvedAges: { ...AGES_BY_ROW, [set.selectedId]: [{ years: 65, months: 0 }, { years: 65, months: 0 }] },
    });
    await userEvent.type(screen.getByTestId(`scenario-name-${set.selectedId}`), '!');
    const next = onChange.mock.calls.at(-1)![0] as ScenarioSet;
    expect(next.rows.find((r) => r.id === set.selectedId)?.label).toBe('Scenario 1!');
  });

  it('removes a row', async () => {
    const { onChange } = renderPanel();
    await userEvent.click(screen.getByTestId('scenario-remove-latest'));
    const next = onChange.mock.calls[0][0] as ScenarioSet;
    expect(next.rows.map((r) => r.id)).not.toContain('latest');
  });

  it('offers no way to remove Optimal — every delta is measured against it', () => {
    renderPanel();
    expect(screen.queryByTestId('scenario-remove-optimal')).not.toBeInTheDocument();
    expect(screen.getByTestId('scenario-remove-fra')).toBeInTheDocument();
  });

  it('resets to the defaults, and offers nothing to reset when already there', async () => {
    const { unmount, onChange } = renderPanel({ scenarios: resetScenarios() });
    expect(screen.getByTestId('scenario-reset')).toBeDisabled();
    unmount();

    const touched = addScenario(resetScenarios(), [{ years: 65, months: 0 }, { years: 65, months: 0 }]);
    const second = renderPanel({
      scenarios: touched,
      resolvedAges: { ...AGES_BY_ROW, [touched.selectedId]: [{ years: 65, months: 0 }, { years: 65, months: 0 }] },
    });
    expect(screen.getByTestId('scenario-reset')).toBeEnabled();
    await userEvent.click(screen.getByTestId('scenario-reset'));
    expect(second.onChange).toHaveBeenCalledWith(resetScenarios());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says why a row the analysis could not reach shows no ages', () => {
    // "Both claim earliest (62)" for a household where someone is already 64.
    renderPanel({ resolvedAges: { ...AGES_BY_ROW, earliest: undefined as never } });
    const cell = screen.getByTestId('scenario-unreachable-earliest-0');
    expect(cell).toHaveTextContent('—');
    expect(cell).toHaveAttribute('title', expect.stringContaining('Out of reach'));
    // And the row is still listed, so correcting a birth year brings it back.
    expect(screen.getByTestId('scenario-row-earliest')).toBeInTheDocument();
  });

  it('holds off editing until there is an analysis to take ages from', () => {
    renderPanel({ options: null, resolvedAges: {} });
    expect(screen.getByTestId('scenario-not-ready')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-add')).toBeDisabled();
    // The rows are still listed and named — only the ages are withheld.
    expect(screen.getAllByTestId(/^scenario-row-/)).toHaveLength(4);
    expect(screen.getByTestId('scenario-row-fra')).toHaveTextContent('—');
  });
});
