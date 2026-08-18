import { yearsMonthsLabel } from './format';

/**
 * Which filing ages the analysis is built on — the household's "what if".
 *
 * The app used to have exactly one answer: whatever the optimizer picked.
 * Every figure downstream (bands, timeline, income cliff, survivor claim,
 * spousal top-up, both surfaces' recommendation cards, the whole PDF) was
 * derived from `optimal.filingAges`, and the comparison table's other rows
 * carried a lifetime PV and nothing else. An adviser asking "what does it
 * look like if they both file at 65?" could read one number.
 *
 * A scenario makes that choice an input. `analyzeHousehold` resolves it to a
 * `selected` strategy and derives everything from THAT, leaving `optimal` as
 * the optimizer's answer so the cost of deviating stays on screen.
 *
 * Two shapes rather than a nullable age array, so "the optimizer's answer"
 * survives a change of inputs: `{ kind: 'best' }` re-resolves to whatever is
 * best for the household as it now stands, where a pinned age array would
 * quietly stop being the optimum the moment a birth year was corrected.
 */
export interface FilingAgeChoice {
  years: number;
  months: number;
}

export type Scenario =
  /**
   * The four DERIVED scenarios. None carries an age, because none of them is
   * an age — each is a rule that has to be re-applied to the household as it
   * currently stands. `fra` is a different pair of ages for every couple;
   * `best` changes the moment a birth year or a benefit is corrected. Storing
   * the resolved ages instead would have frozen an answer that had stopped
   * being true, with nothing on screen saying so.
   */
  | { kind: 'best' }
  | { kind: 'earliest' }
  | { kind: 'fra' }
  | { kind: 'latest' }
  /**
   * One entry per person, in DISPLAY order (the order the form collects
   * them), not the engine's canonical order — this is a UI choice travelling
   * inward, and `analyzeHousehold` owns the mapping. A length that doesn't
   * match the household's people is treated as no scenario at all rather
   * than as a partial one: switching married → single leaves a two-entry
   * array behind, and pairing person A with person B's age would be a wrong
   * answer rather than a missing one.
   */
  | { kind: 'custom'; ages: FilingAgeChoice[] };

export const BEST_SCENARIO: Scenario = { kind: 'best' };

/**
 * One row of the adviser's scenario list — a scenario plus the identity the
 * UI needs to edit it.
 *
 * `id` is stable across edits so the selection survives a rename or an age
 * change; array position is not, because the comparison table sorts by filing
 * age while the sidebar keeps the adviser's own order.
 */
export interface ScenarioRow {
  id: string;
  /**
   * Read ONLY for a `custom` row. Every derived kind takes its label from
   * `scenarioLabel` below, which is status-aware ("Claim at 62" for one
   * person, "Both claim earliest (62)" for two) — a label stored on the row
   * would be a second copy of that wording, drifting the moment the adviser
   * switched from single to married.
   */
  label: string;
  scenario: Scenario;
  /**
   * Kept in the list but off both surfaces — the screen table and the PDF
   * alike. One control for both, deliberately: an adviser who hides a row
   * for a meeting and then exports would otherwise find it back in the
   * report, and a per-surface pair of toggles is two states per row to keep
   * straight.
   *
   * Hidden rows are still ANALYSED — they carry ages, they appear in the
   * editor, and un-hiding one costs nothing. What they lose is only their
   * place in the rendered table.
   */
  hidden?: boolean;
}

/**
 * The whole list, plus which row the analysis is built on.
 *
 * `selectedId` rather than a `selected: boolean` on each row: exactly one row
 * can be selected, and a boolean per row can represent zero or five.
 */
export interface ScenarioSet {
  rows: ScenarioRow[];
  selectedId: string;
}

/**
 * The id of the row that can never be removed — see `removeScenario`.
 *
 * Spelled `optimal` rather than `best` because it is also the comparison
 * row's key, which both surfaces' tests and the e2e selectors have addressed
 * as `strategy-row-optimal` since long before scenarios existed.
 */
export const BEST_ROW_ID = 'optimal';

export const DEFAULT_SCENARIO_ROWS: readonly ScenarioRow[] = [
  { id: BEST_ROW_ID, label: 'Best', scenario: { kind: 'best' } },
  { id: 'earliest', label: 'Earliest', scenario: { kind: 'earliest' } },
  { id: 'fra', label: 'Full retirement age', scenario: { kind: 'fra' } },
  { id: 'latest', label: 'Delay to 70', scenario: { kind: 'latest' } },
];

export const DEFAULT_SCENARIO_SET: ScenarioSet = {
  rows: [...DEFAULT_SCENARIO_ROWS],
  selectedId: BEST_ROW_ID,
};

/** Back to the four built-in rows, with Best selected. */
export function resetScenarios(): ScenarioSet {
  return { rows: DEFAULT_SCENARIO_ROWS.map((row) => ({ ...row })), selectedId: BEST_ROW_ID };
}

/**
 * Whether the set is untouched — the four defaults, in order, with Best
 * selected. Drives whether the Reset control is worth offering.
 */
export function isDefaultScenarioSet(set: ScenarioSet): boolean {
  if (set.selectedId !== BEST_ROW_ID) return false;
  if (set.rows.length !== DEFAULT_SCENARIO_ROWS.length) return false;
  return set.rows.every(
    (row, i) =>
      row.id === DEFAULT_SCENARIO_ROWS[i].id &&
      row.label === DEFAULT_SCENARIO_ROWS[i].label &&
      row.scenario.kind === DEFAULT_SCENARIO_ROWS[i].scenario.kind &&
      row.hidden !== true,
  );
}

/**
 * Shows or hides a row on both surfaces.
 *
 * Optimal is never hideable, for the same reason it is never removable: the
 * "vs. best" column measures every other row against it, and a benchmark the
 * reader cannot see is worse than no benchmark.
 *
 * Hiding the row the analysis is BUILT on moves the selection to Optimal.
 * The alternative — a report whose every figure comes from a strategy that
 * appears nowhere on it — is exactly the shape of defect this project keeps
 * having to fix.
 */
export function toggleScenarioHidden(set: ScenarioSet, id: string): ScenarioSet {
  if (id === BEST_ROW_ID) return set;
  const target = set.rows.find((row) => row.id === id);
  if (target === undefined) return set;
  const nextHidden = target.hidden !== true;
  return {
    rows: set.rows.map((row) => (row.id === id ? { ...row, hidden: nextHidden } : row)),
    selectedId: nextHidden && set.selectedId === id ? BEST_ROW_ID : set.selectedId,
  };
}

/**
 * Appends a custom row and selects it.
 *
 * Ids are minted from the highest existing numeric suffix rather than from
 * `rows.length`, so deleting "Scenario 2" and adding another cannot mint a
 * second row with the same id — which would make the two indistinguishable to
 * `selectedId` and let a delete remove the wrong one.
 */
export function addScenario(set: ScenarioSet, ages: FilingAgeChoice[]): ScenarioSet {
  let highest = 0;
  for (const row of set.rows) {
    const match = /^s(\d+)$/.exec(row.id);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  const id = `s${highest + 1}`;
  const row: ScenarioRow = {
    id,
    label: `Scenario ${highest + 1}`,
    hidden: false,
    scenario: { kind: 'custom', ages: ages.map((a) => ({ years: a.years, months: a.months })) },
  };
  return { rows: [...set.rows, row], selectedId: id };
}

/**
 * Replaces one row's ages, converting a derived row into a custom one.
 *
 * Editing "Full retirement age" to something that is not FRA has to stop
 * being the FRA row — leaving the kind alone would have re-derived FRA on the
 * next analysis and silently discarded the edit.
 */
export function updateScenarioAges(
  set: ScenarioSet,
  id: string,
  ages: FilingAgeChoice[],
): ScenarioSet {
  return {
    ...set,
    rows: set.rows.map((row) =>
      row.id === id
        ? {
            ...row,
            scenario: {
              kind: 'custom',
              ages: ages.map((a) => ({ years: a.years, months: a.months })),
            },
          }
        : row,
    ),
  };
}

export function renameScenario(set: ScenarioSet, id: string, label: string): ScenarioSet {
  return {
    ...set,
    rows: set.rows.map((row) => (row.id === id ? { ...row, label } : row)),
  };
}

/**
 * Removes a row, moving the selection to Best if it was the one removed.
 *
 * Best itself cannot be removed: every row's "vs. best" figure is measured
 * against the optimum, and a list with no benchmark row in it would print a
 * column of deltas against something the reader cannot see.
 */
export function removeScenario(set: ScenarioSet, id: string): ScenarioSet {
  if (id === BEST_ROW_ID) return set;
  const rows = set.rows.filter((row) => row.id !== id);
  if (rows.length === set.rows.length) return set;
  return { rows, selectedId: set.selectedId === id ? BEST_ROW_ID : set.selectedId };
}

/**
 * Selects a row, ignoring an id the set does not contain.
 *
 * Selecting a HIDDEN row reveals it. The selected row is the one every figure
 * on both surfaces is computed from, so it has to be one the reader can see —
 * this is the same rule `toggleScenarioHidden` enforces from the other side.
 */
export function selectScenario(set: ScenarioSet, id: string): ScenarioSet {
  if (!set.rows.some((row) => row.id === id)) return set;
  return {
    rows: set.rows.map((row) => (row.id === id && row.hidden ? { ...row, hidden: false } : row)),
    selectedId: id,
  };
}

/**
 * The row the analysis is built on. Falls back to the first row rather than
 * throwing: a `selectedId` can only go stale through a bug here, and the
 * honest recovery is to show the top of the list, not to refuse to render.
 */
export function selectedRow(set: ScenarioSet): ScenarioRow {
  return set.rows.find((row) => row.id === set.selectedId) ?? set.rows[0];
}

const DERIVED_LABELS: Record<
  Exclude<Scenario['kind'], 'custom'>,
  { single: string; married: string }
> = {
  best: { single: 'Optimal', married: 'Optimal' },
  earliest: { single: 'Claim at 62', married: 'Both claim earliest (62)' },
  fra: { single: 'Claim at FRA', married: 'Both claim at FRA' },
  latest: { single: 'Claim at 70', married: 'Both delay to 70' },
};

/**
 * The one place a scenario's displayed name is decided, for the sidebar
 * table, the on-screen comparison table and the PDF alike.
 *
 * The derived kinds ignore `row.label` entirely — their wording depends on
 * how many people the household has, and this project has already shipped
 * two surfaces disagreeing about the same sentence more than once.
 */
export function scenarioLabel(row: ScenarioRow, isMarried: boolean): string {
  if (row.scenario.kind === 'custom') return row.label;
  return DERIVED_LABELS[row.scenario.kind][isMarried ? 'married' : 'single'];
}

/** Filing ages compare as whole months; a `{years, months}` pair is just its total. */
export function filingAgeMonths(age: FilingAgeChoice): number {
  return age.years * 12 + age.months;
}

export function sameFilingAge(a: FilingAgeChoice, b: FilingAgeChoice): boolean {
  return a.years === b.years && a.months === b.months;
}

export function filingAgeLabel(age: FilingAgeChoice): string {
  return age.months === 0 ? String(age.years) : yearsMonthsLabel(age.years, age.months);
}

/**
 * The attainable age nearest the one asked for.
 *
 * Every path into `analyzeHousehold` clamps rather than throws or falls back
 * to the optimum, because the requested age can go stale under the reader's
 * feet without anyone doing anything wrong: a scenario of "both at 62" stays
 * in state while the adviser corrects a birth year, and the moment that
 * person is past 62 the engine no longer offers it. Refusing to render would
 * put "Analysis failed" on screen for a legal edit; silently reverting to the
 * optimum would move every figure with nothing saying so.
 *
 * Clamping is safe to do silently only because the clamped age is what gets
 * displayed: `selected.filingAges` drives the picker as well as the figures,
 * so a clamp is visible in the control the moment it happens.
 *
 * Ties go to the LATER age — `<` rather than `<=` — so a request below the
 * whole attainable range lands on its floor and one above lands on its
 * ceiling, and neither direction is favoured by accident of iteration order.
 */
export function clampToAttainable(
  options: readonly FilingAgeChoice[],
  want: FilingAgeChoice,
): FilingAgeChoice | null {
  if (options.length === 0) return null;
  const target = filingAgeMonths(want);
  let best = options[0];
  let bestDistance = Math.abs(filingAgeMonths(best) - target);
  for (const option of options) {
    const distance = Math.abs(filingAgeMonths(option) - target);
    if (distance < bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The month to land on when the adviser changes only the YEAR.
 *
 * The earliest month still available in that year — 0 wherever the person can
 * still reach it, their own floor where they cannot. Carrying the previous
 * month across instead (the first version of this) turned "put them both at
 * 69" into "69 years, 1 month" for whichever spouse happened to be sitting at
 * 62 years 1 month, which is not an age anybody asked for.
 *
 * `months` is assumed non-empty — every year offered by the picker comes from
 * the attainable set, so it has at least one month in it — but an empty array
 * returns 0 rather than `undefined`, since a `NaN` age would reach the engine.
 */
export function firstMonthInYear(months: readonly number[]): number {
  return months.length === 0 ? 0 : Math.min(...months);
}

/**
 * The eyebrow above the recommendation card, on screen and in print.
 *
 * One function rather than a literal in each of the four call sites
 * (`HouseholdPanel`, `PersonPanel`, `pdf/HouseholdSection`,
 * `pdf/PersonSection`). Calling a scenario the adviser typed in "Recommended"
 * is the exact defect this project keeps shipping — a true number under a
 * label that is not true of it — and four hand-maintained copies of the
 * branch is how three of them would end up saying it.
 */
export function scenarioEyebrow(isBest: boolean): string {
  return isBest ? 'Recommended Strategy' : 'Selected Scenario';
}

