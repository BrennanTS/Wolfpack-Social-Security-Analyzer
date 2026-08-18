import { describe, expect, it } from 'vitest';
import {
  addScenario,
  BEST_ROW_ID,
  firstMonthInYear,
  toggleScenarioHidden,
  BEST_SCENARIO,
  clampToAttainable,
  DEFAULT_SCENARIO_SET,
  isDefaultScenarioSet,
  removeScenario,
  renameScenario,
  resetScenarios,
  scenarioLabel,
  selectedRow,
  selectScenario,
  updateScenarioAges,
  filingAgeLabel,
  filingAgeMonths,
  sameFilingAge,
  scenarioEyebrow,
  type FilingAgeChoice,
  type ScenarioSet,
} from './scenario';

const at = (years: number, months = 0): FilingAgeChoice => ({ years, months });

const OPTIONS: FilingAgeChoice[] = [
  { years: 64, months: 3 },
  { years: 64, months: 4 },
  { years: 65, months: 0 },
  { years: 70, months: 0 },
];

describe('filingAgeMonths', () => {
  it('counts a years/months pair as whole months', () => {
    expect(filingAgeMonths({ years: 62, months: 1 })).toBe(745);
  });
});

describe('sameFilingAge', () => {
  it('separates ages that differ only by months', () => {
    expect(sameFilingAge({ years: 67, months: 0 }, { years: 67, months: 1 })).toBe(false);
    expect(sameFilingAge({ years: 67, months: 1 }, { years: 67, months: 1 })).toBe(true);
  });
});

describe('filingAgeLabel', () => {
  it('drops the months on a whole year and keeps them otherwise', () => {
    expect(filingAgeLabel({ years: 70, months: 0 })).toBe('70');
    expect(filingAgeLabel({ years: 62, months: 1 })).toBe('62 years, 1 month');
    expect(filingAgeLabel({ years: 64, months: 5 })).toBe('64 years, 5 months');
  });
});

describe('clampToAttainable', () => {
  it('returns an exactly attainable age unchanged', () => {
    expect(clampToAttainable(OPTIONS, { years: 65, months: 0 })).toEqual({ years: 65, months: 0 });
  });

  it('lands on the floor for a request below the whole range', () => {
    // 62 is a legal SSA age but not one THIS person can still choose.
    expect(clampToAttainable(OPTIONS, { years: 62, months: 0 })).toEqual({ years: 64, months: 3 });
  });

  it('lands on the ceiling for a request above the whole range', () => {
    expect(clampToAttainable(OPTIONS, { years: 75, months: 0 })).toEqual({ years: 70, months: 0 });
  });

  it('picks the nearest by whole months, not by whole years', () => {
    // 64y5m is one month from 64y4m and seven from 65y0m. A years-first
    // comparison would have picked 65.
    expect(clampToAttainable(OPTIONS, { years: 64, months: 5 })).toEqual({ years: 64, months: 4 });
  });

  it('breaks an exact tie toward the earlier option, deterministically', () => {
    // 64y6m is two months from 64y4m and six from 65y0m — not a tie. This one
    // is: 66y0m sits 12 months from 65y0m and 48 from 70y0m, so it is not
    // either. Construct a real tie explicitly.
    const pair: FilingAgeChoice[] = [
      { years: 64, months: 0 },
      { years: 66, months: 0 },
    ];
    expect(clampToAttainable(pair, { years: 65, months: 0 })).toEqual({ years: 64, months: 0 });
  });

  it('returns null rather than inventing an age when nothing is attainable', () => {
    expect(clampToAttainable([], { years: 67, months: 0 })).toBeNull();
  });
});

describe('scenarioEyebrow', () => {
  it('only calls a strategy "recommended" when the optimizer chose it', () => {
    expect(scenarioEyebrow(true)).toBe('Recommended Strategy');
    expect(scenarioEyebrow(false)).toBe('Selected Scenario');
    expect(scenarioEyebrow(false)).not.toContain('Recommended');
  });
});

describe('BEST_SCENARIO', () => {
  it('carries no ages, so it re-resolves rather than remembering one', () => {
    expect(BEST_SCENARIO).toEqual({ kind: 'best' });
  });
});

describe('the default scenario set', () => {
  it('is the four built-ins with Optimal selected', () => {
    expect(DEFAULT_SCENARIO_SET.rows.map((r) => r.id)).toEqual([
      'optimal',
      'earliest',
      'fra',
      'latest',
    ]);
    expect(DEFAULT_SCENARIO_SET.selectedId).toBe(BEST_ROW_ID);
    expect(isDefaultScenarioSet(DEFAULT_SCENARIO_SET)).toBe(true);
  });

  it('hands out a fresh array, so an edit cannot mutate the default', () => {
    const set = resetScenarios();
    set.rows.push({ id: 'x', label: 'x', scenario: { kind: 'custom', ages: [at(65)] } });
    expect(DEFAULT_SCENARIO_SET.rows).toHaveLength(4);
    expect(resetScenarios().rows).toHaveLength(4);
  });

  it('stores no ages on a derived row, so it re-resolves', () => {
    for (const row of DEFAULT_SCENARIO_SET.rows) {
      expect(row.scenario).not.toHaveProperty('ages');
    }
  });
});

describe('addScenario', () => {
  it('appends a custom row carrying the ages, and selects it', () => {
    const set = addScenario(resetScenarios(), [at(65), at(66, 3)]);
    expect(set.rows).toHaveLength(5);
    const added = set.rows[4];
    expect(added.scenario).toEqual({ kind: 'custom', ages: [at(65), at(66, 3)] });
    expect(set.selectedId).toBe(added.id);
    expect(added.label).toBe('Scenario 1');
  });

  it('copies the ages rather than aliasing the caller’s array', () => {
    const ages = [at(65)];
    const set = addScenario(resetScenarios(), ages);
    ages[0].years = 70;
    const added = set.rows[4].scenario;
    expect(added.kind === 'custom' && added.ages[0].years).toBe(65);
  });

  it('never re-mints an id a deletion freed', () => {
    // s1, s2 → delete s1 → add. Reusing "s1" would make `selectedId` and
    // `removeScenario` address the wrong row.
    let set = addScenario(resetScenarios(), [at(65)]);
    const first = set.selectedId;
    set = addScenario(set, [at(66)]);
    set = removeScenario(set, first);
    set = addScenario(set, [at(67)]);
    const ids = set.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(first);
  });
});

describe('updateScenarioAges', () => {
  it('replaces the ages of a custom row', () => {
    let set = addScenario(resetScenarios(), [at(65)]);
    const id = set.selectedId;
    set = updateScenarioAges(set, id, [at(68, 4)]);
    expect(selectedRow(set).scenario).toEqual({ kind: 'custom', ages: [at(68, 4)] });
  });

  it('converts a derived row into a custom one, so the edit survives', () => {
    // Leaving the kind alone would re-derive FRA on the next analysis and
    // silently discard what was typed.
    const set = updateScenarioAges(resetScenarios(), 'fra', [at(64), at(64)]);
    const row = set.rows.find((r) => r.id === 'fra');
    expect(row?.scenario).toEqual({ kind: 'custom', ages: [at(64), at(64)] });
  });

  it('leaves every other row alone', () => {
    const set = updateScenarioAges(resetScenarios(), 'fra', [at(64)]);
    expect(set.rows.filter((r) => r.scenario.kind === 'custom')).toHaveLength(1);
  });
});

describe('renameScenario', () => {
  it('renames without touching the scenario or the selection', () => {
    let set = addScenario(resetScenarios(), [at(65)]);
    const id = set.selectedId;
    set = renameScenario(set, id, 'Retire at 65');
    expect(selectedRow(set).label).toBe('Retire at 65');
    expect(set.selectedId).toBe(id);
    expect(selectedRow(set).scenario).toEqual({ kind: 'custom', ages: [at(65)] });
  });
});

describe('removeScenario', () => {
  it('removes a custom row', () => {
    let set = addScenario(resetScenarios(), [at(65)]);
    const id = set.selectedId;
    set = removeScenario(set, id);
    expect(set.rows.map((r) => r.id)).not.toContain(id);
  });

  it('moves the selection to Optimal when the selected row goes', () => {
    let set = addScenario(resetScenarios(), [at(65)]);
    set = removeScenario(set, set.selectedId);
    expect(set.selectedId).toBe(BEST_ROW_ID);
  });

  it('leaves the selection alone when a different row goes', () => {
    let set = addScenario(resetScenarios(), [at(65)]);
    const kept = set.selectedId;
    set = removeScenario(set, 'latest');
    expect(set.selectedId).toBe(kept);
  });

  it('refuses to remove Optimal — every delta is measured against it', () => {
    const set = removeScenario(resetScenarios(), BEST_ROW_ID);
    expect(set.rows.map((r) => r.id)).toContain(BEST_ROW_ID);
    expect(set.rows).toHaveLength(4);
  });

  it('ignores an id the set does not hold', () => {
    const set = resetScenarios();
    expect(removeScenario(set, 'nope')).toBe(set);
  });
});

describe('selectScenario', () => {
  it('selects a row that exists', () => {
    expect(selectScenario(resetScenarios(), 'fra').selectedId).toBe('fra');
  });

  it('ignores an id the set does not hold rather than selecting nothing', () => {
    const set = resetScenarios();
    expect(selectScenario(set, 'nope')).toBe(set);
  });
});

describe('isDefaultScenarioSet', () => {
  it('is false once anything has changed', () => {
    expect(isDefaultScenarioSet(selectScenario(resetScenarios(), 'fra'))).toBe(false);
    expect(isDefaultScenarioSet(addScenario(resetScenarios(), [at(65)]))).toBe(false);
    expect(isDefaultScenarioSet(removeScenario(resetScenarios(), 'latest'))).toBe(false);
    expect(isDefaultScenarioSet(updateScenarioAges(resetScenarios(), 'fra', [at(64)]))).toBe(false);
  });

  it('is true again after a reset', () => {
    const touched = addScenario(resetScenarios(), [at(65)]);
    expect(isDefaultScenarioSet(resetScenarios())).toBe(true);
    expect(isDefaultScenarioSet(touched)).toBe(false);
  });
});

describe('scenarioLabel', () => {
  it('words a derived row for the household it is in', () => {
    const fra = DEFAULT_SCENARIO_SET.rows.find((r) => r.id === 'fra')!;
    expect(scenarioLabel(fra, true)).toBe('Both claim at FRA');
    expect(scenarioLabel(fra, false)).toBe('Claim at FRA');
  });

  it('ignores a stored label on a derived row', () => {
    const fra = { ...DEFAULT_SCENARIO_SET.rows.find((r) => r.id === 'fra')!, label: 'Nonsense' };
    expect(scenarioLabel(fra, true)).toBe('Both claim at FRA');
  });

  it('uses the adviser’s own name for a custom row', () => {
    const set = renameScenario(addScenario(resetScenarios(), [at(65)]), 's1', 'Retire at 65');
    expect(scenarioLabel(selectedRow(set), true)).toBe('Retire at 65');
  });
});

describe('selectedRow', () => {
  it('falls back to the first row rather than throwing on a stale id', () => {
    const set: ScenarioSet = { ...resetScenarios(), selectedId: 'gone' };
    expect(selectedRow(set).id).toBe(BEST_ROW_ID);
  });
});

describe('firstMonthInYear', () => {
  it('lands on 0 wherever the year is fully available', () => {
    expect(firstMonthInYear([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(0);
  });

  it('lands on the person’s own floor in a part-lived year', () => {
    // Someone already 69 years 1 month cannot file at 69 years 0 months.
    expect(firstMonthInYear([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(1);
    expect(firstMonthInYear([0])).toBe(0);
  });

  it('does not depend on the order the months arrive in', () => {
    expect(firstMonthInYear([7, 3, 11, 5])).toBe(3);
  });

  it('returns 0 rather than undefined for an empty year', () => {
    // A NaN age would reach the engine.
    expect(firstMonthInYear([])).toBe(0);
  });
});

describe('toggleScenarioHidden', () => {
  it('hides and shows a row', () => {
    let set = toggleScenarioHidden(resetScenarios(), 'latest');
    expect(set.rows.find((r) => r.id === 'latest')?.hidden).toBe(true);
    set = toggleScenarioHidden(set, 'latest');
    expect(set.rows.find((r) => r.id === 'latest')?.hidden).toBe(false);
  });

  it('refuses to hide Optimal — the benchmark every delta is measured against', () => {
    const set = toggleScenarioHidden(resetScenarios(), BEST_ROW_ID);
    expect(set.rows.find((r) => r.id === BEST_ROW_ID)?.hidden).not.toBe(true);
  });

  it('moves the selection off a row it hides', () => {
    // Otherwise the report is built on a strategy that appears nowhere on it.
    let set = addScenario(resetScenarios(), [at(65)]);
    const id = set.selectedId;
    set = toggleScenarioHidden(set, id);
    expect(set.selectedId).toBe(BEST_ROW_ID);
    expect(set.rows.find((r) => r.id === id)?.hidden).toBe(true);
  });

  it('leaves the selection alone when a different row is hidden', () => {
    let set = addScenario(resetScenarios(), [at(65)]);
    const kept = set.selectedId;
    set = toggleScenarioHidden(set, 'latest');
    expect(set.selectedId).toBe(kept);
  });

  it('ignores an id the set does not hold', () => {
    const set = resetScenarios();
    expect(toggleScenarioHidden(set, 'nope')).toBe(set);
  });
});

describe('selecting a hidden row', () => {
  it('reveals it, since the report has to show what it is built on', () => {
    let set = addScenario(resetScenarios(), [at(65)]);
    const id = set.selectedId;
    set = toggleScenarioHidden(set, id);
    set = selectScenario(set, id);
    expect(set.selectedId).toBe(id);
    expect(set.rows.find((r) => r.id === id)?.hidden).toBe(false);
  });
});

describe('isDefaultScenarioSet with hidden rows', () => {
  it('is false once a row is hidden, so Reset stays offered', () => {
    expect(isDefaultScenarioSet(toggleScenarioHidden(resetScenarios(), 'latest'))).toBe(false);
  });
});
