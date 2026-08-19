import { useEffect, useState } from 'react';
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { DollarsMode } from '../lib/dollarsMode';
import { formatCurrency, personLabel } from '../lib/format';
import { showSurvivorIncomeColumn, type HouseholdStrategy } from '../lib/household';
import type { Person } from '../lib/personAnalysis';
import { EyeIcon } from './EyeIcon';
import {
  HOUSEHOLD_VALUE_COLUMN_HEADER,
  householdValueCaption,
  SURVIVOR_INCOME_COLUMN_HEADER,
  survivorIncomeCaption,
} from './methodologyCopy';
import {
  addScenario,
  BEST_ROW_ID,
  firstMonthInYear,
  isDefaultScenarioSet,
  removeScenario,
  renameScenario,
  resetScenarios,
  selectScenario,
  toggleScenarioHidden,
  updateScenarioAges,
  type FilingAgeChoice,
  type ScenarioSet,
} from '../lib/scenario';

interface StrategyComparisonTableProps {
  /**
   * The rows to render in VIEW mode — `analysis.comparisons`, already filtered
   * to the visible ones and already carrying whichever dollars mode the caller
   * chose (`HouseholdPanel` transforms `survivorIncome` before this component
   * sees it, alongside `dollarsMode` below, which only *names* that mode).
   */
  comparisons: HouseholdStrategy[];
  /**
   * Every row including the hidden ones — `analysis.allComparisons`. Only
   * edit mode reads it: a hidden row must show its ages and its figures there,
   * or un-hiding one would be a blind click. Optional, defaulting to
   * `comparisons`, so a call site with nothing to edit needs no second array.
   */
  allComparisons?: HouseholdStrategy[];
  people: Person[];
  survivorGap?: SurvivorGap | null;
  dollarsMode?: DollarsMode;
  /**
   * The discount rate the household value is discounted at, already formatted
   * as a percent. Optional so a call site with fixed rows can omit the
   * caption entirely rather than print one naming a rate it does not know.
   */
  discountRateLabel?: string;
  /**
   * The scenario list behind these rows. Editing is offered only when this
   * and `onScenariosChange` and `filingAgeOptions` are all present — a
   * widowed household, or a test rendering fixed rows, simply gets the table.
   */
  scenarios?: ScenarioSet;
  onScenariosChange?: (scenarios: ScenarioSet) => void;
  /** Every attainable filing age per person — `analysis.filingAgeOptions`. */
  filingAgeOptions?: FilingAgeChoice[][];
}

/** The months this person can file in during a given whole year of age. */
function monthsAvailable(options: FilingAgeChoice[], years: number): number[] {
  return options.filter((o) => o.years === years).map((o) => o.months);
}

/**
 * The centrepiece of the household tab: shows the client what the optimizer
 * rejected and by how much, not just what it picked. Rows carry real engine
 * numbers (`HouseholdStrategy` from `household.ts`) — nothing here is
 * illustrative. `filingAges`/`people` are variable-length so the same table
 * serves a single claimant (one age column) and a couple (two) without a
 * hardcoded shape, and the row count can legitimately be fewer than four —
 * `household.ts` already omits unattainable rows and folds a derived row into
 * another when they coincide.
 *
 * **Edit mode edits this table in place** rather than swapping in a separate
 * editor. The value cells become controls and two control columns appear, but
 * the money columns stay where they are and keep updating: the whole
 * reason to build a scenario is to see what it costs, and an editor that
 * hides the figures makes you guess at the one number you came for.
 *
 * The survivor-income column is married-only (`people.length === 2`), the
 * same test the single-claimant call site already satisfies by never having
 * a second person. `household.ts` sets `survivorIncome: null` for a single
 * claimant, so gating on `people.length` rather than reading the field is
 * what keeps the column hidden even if some future single-claimant row ever
 * carried a non-null value by mistake.
 *
 * It ALSO requires at least one row to carry a figure. When both people
 * reach their plan-to age in the same month `firstDeath` returns null — it
 * refuses to invent a survivor the household does not have — so every row's
 * `survivorIncome` is null and every cell renders an em dash. The caption
 * used to print its claims over that column of dashes; a column with nothing
 * in it is not a column, so both it and its caption go.
 */
export function StrategyComparisonTable({
  comparisons,
  allComparisons,
  people,
  survivorGap,
  dollarsMode = 'real',
  discountRateLabel,
  scenarios,
  onScenariosChange,
  filingAgeOptions,
}: StrategyComparisonTableProps) {
  const [editing, setEditing] = useState(false);
  /**
   * The row order to hold while editing, captured on entering edit mode.
   *
   * The table is sorted by filing age, which is right for reading it and
   * wrong for editing it: changing a scenario's age moves its row out from
   * under the control you are still holding. Freezing the order until Done
   * keeps the row where you left it; the sort re-applies the moment editing
   * ends, so the table a reader sees is always in age order.
   *
   * Null means "not editing, or not captured yet".
   */
  const [editOrder, setEditOrder] = useState<string[] | null>(null);

  const canEdit =
    scenarios !== undefined &&
    onScenariosChange !== undefined &&
    filingAgeOptions !== undefined &&
    filingAgeOptions.length === people.length &&
    filingAgeOptions.every((o) => o.length > 0);

  // Edit mode shows every row, hidden ones included; view mode shows only
  // what `household.ts` already filtered.
  const rawRows = editing ? (allComparisons ?? comparisons) : comparisons;

  // Captured when editing starts, and extended as rows are added so a second
  // added row cannot swap places with the first. Rows the analysis dropped
  // simply stop matching, which needs no cleanup.
  useEffect(() => {
    if (!editing) {
      setEditOrder(null);
      return;
    }
    const keys = rawRows.map((r) => r.key);
    setEditOrder((prev) => {
      if (prev === null) return keys;
      const added = keys.filter((k) => !prev.includes(k));
      return added.length === 0 ? prev : [...prev, ...added];
    });
    // `rawRows` is rebuilt on every render; keying the effect on its contents
    // rather than its identity is what stops this looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, rawRows.map((r) => r.key).join(',')]);

  const rows =
    editing && editOrder !== null
      ? [...rawRows].sort((a, b) => {
          const ia = editOrder.indexOf(a.key);
          const ib = editOrder.indexOf(b.key);
          // A key not yet in the captured order sorts last, in its own
          // arrival order, until the effect above adopts it.
          return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
        })
      : rawRows;
  const showSurvivorIncome = showSurvivorIncomeColumn(rows, people.length);
  const hiddenCount = (allComparisons ?? comparisons).filter((c) => c.hidden).length;

  function change(next: ScenarioSet) {
    onScenariosChange?.(next);
  }

  function setAge(rowKey: string, personIndex: number, next: FilingAgeChoice) {
    const current = (allComparisons ?? comparisons).find((c) => c.key === rowKey);
    if (current === undefined || scenarios === undefined) return;
    change(
      updateScenarioAges(
        scenarios,
        rowKey,
        current.filingAges.map((f, i) =>
          i === personIndex ? next : { years: f.years, months: f.months },
        ),
      ),
    );
  }

  return (
    <div className="table-wrap">
      <table data-testid="strategy-table" className={editing ? 'strategy-editing' : ''}>
        <thead>
          <tr>
            {editing && (
              <>
                <th className="cell-pick-head">Select</th>
                <th>
                  <span className="visually-hidden">Show on screen and in the report</span>
                </th>
              </>
            )}
            <th>Strategy</th>
            {people.map((p, i) => (
              <th key={p.id}>{personLabel(p.name, i)}</th>
            ))}
            <th>{HOUSEHOLD_VALUE_COLUMN_HEADER}</th>
            <th>vs. best</th>
            {showSurvivorIncome && <th>{SURVIVOR_INCOME_COLUMN_HEADER}</th>}
            {editing && (
              <th>
                <span className="visually-hidden">Remove</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const isCustom = scenarios?.rows.find((r) => r.id === s.key)?.scenario.kind === 'custom';
            return (
              <tr
                key={s.key}
                data-testid={`strategy-row-${s.key}`}
                className={[
                  s.isOptimal ? 'row-optimal' : '',
                  s.isSelected ? 'row-selected' : '',
                  s.hidden ? 'row-hidden' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {editing && (
                  <td className="cell-pick">
                    {/* A radio in a column of its own, rather than the
                        "Show this" button that used to hide inside the
                        Strategy cell. One control per row, always in the
                        same place, and its column header says what it does —
                        the button only appeared on rows that were neither
                        selected nor hidden, so the control an adviser was
                        looking for was missing from the row they were
                        looking at. */}
                    <input
                      type="radio"
                      name="strategy-selected"
                      className="row-pick"
                      checked={s.isSelected}
                      disabled={s.hidden}
                      aria-label={`Build the report on ${s.label}`}
                      data-testid={`scenario-use-${s.key}`}
                      onChange={() => change(selectScenario(scenarios!, s.key))}
                    />
                  </td>
                )}
                {editing && (
                  <td className="cell-eye">
                    {s.key === BEST_ROW_ID ? (
                      // Never hideable, for the same reason it is never
                      // removable: "vs. best" measures every other row
                      // against it.
                      <span className="visually-hidden">Optimal is always shown</span>
                    ) : (
                      <button
                        type="button"
                        className="row-eye"
                        aria-pressed={!s.hidden}
                        aria-label={`${s.hidden ? 'Show' : 'Hide'} ${s.label}`}
                        data-testid={`scenario-eye-${s.key}`}
                        onClick={() => change(toggleScenarioHidden(scenarios!, s.key))}
                      >
                        <EyeIcon open={!s.hidden} />
                      </button>
                    )}
                  </td>
                )}

                <td>
                  {editing && isCustom ? (
                    <input
                      type="text"
                      className="scenario-name"
                      value={s.label}
                      aria-label={`Name for ${s.label}`}
                      data-testid={`scenario-name-${s.key}`}
                      onChange={(e) => change(renameScenario(scenarios!, s.key, e.target.value))}
                    />
                  ) : (
                    s.label
                  )}
                  {s.isOptimal && <span className="badge">Best</span>}
                  {/* No badge for the selected row. `row-selected`'s rule and
                      tint already mark it, the card above it names the same
                      strategy in words, and a second badge beside "Best" was
                      two labels competing over one row. */}
                </td>

                {s.filingAges.map((filingAge, i) => {
                  if (!editing || !isCustom || !canEdit) {
                    return (
                      <td key={people[i].id} data-testid={`cell-age-${people[i].id}`}>
                        {filingAge.label}
                      </td>
                    );
                  }
                  const personOptions = filingAgeOptions[i];
                  const years = [...new Set(personOptions.map((o) => o.years))];
                  const months = monthsAvailable(personOptions, filingAge.years);
                  return (
                    <td key={people[i].id} data-testid={`cell-age-${people[i].id}`}>
                      <select
                        aria-label={`${s.label} — ${personLabel(people[i].name, i)} claiming age, years`}
                        data-testid={`scenario-years-${s.key}-${i}`}
                        value={filingAge.years}
                        onChange={(e) => {
                          const nextYears = Number(e.target.value);
                          // Snap to the earliest month still available in the
                          // chosen year rather than carrying the previous
                          // month across — see `firstMonthInYear`.
                          setAge(s.key, i, {
                            years: nextYears,
                            months: firstMonthInYear(monthsAvailable(personOptions, nextYears)),
                          });
                        }}
                      >
                        {years.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`${s.label} — ${personLabel(people[i].name, i)} claiming age, months`}
                        data-testid={`scenario-months-${s.key}-${i}`}
                        value={filingAge.months}
                        onChange={(e) =>
                          setAge(s.key, i, {
                            years: filingAge.years,
                            months: Number(e.target.value),
                          })
                        }
                      >
                        {months.map((m) => (
                          <option key={m} value={m}>
                            {m === 1 ? '1 mo' : `${m} mos`}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}

                {/* Named, not counted. Tests reached these two by `td` index
                    until the Select column shifted every one of them — a
                    column added to a table should not be able to break an
                    assertion about a figure in it. */}
                <td data-testid="cell-npv">{formatCurrency(s.expectedNpv)}</td>
                <td data-testid="cell-delta" className={s.deltaVsOptimal < 0 ? 'negative' : ''}>
                  {s.deltaVsOptimal === 0 ? '—' : formatCurrency(s.deltaVsOptimal)}
                </td>
                {showSurvivorIncome && (
                  <td data-testid={`cell-survivor-${s.key}`}>
                    {/* `== null` rather than `=== null`: a row an older, not-yet-
                        updated fixture built without the field is `undefined`,
                        not `null`, and must fall back the same way rather than
                        print `formatCurrency(undefined)`'s "NaN". */}
                    {s.survivorIncome == null ? '—' : formatCurrency(s.survivorIncome)}
                  </td>
                )}

                {editing && (
                  <td className="cell-remove">
                    {s.key === BEST_ROW_ID || !isCustom ? (
                      // Derived rows are removable only by hiding them: they
                      // are re-created from the household on every analysis,
                      // so "delete" would not stick.
                      <span className="visually-hidden">Hide this row instead</span>
                    ) : (
                      <button
                        type="button"
                        className="row-remove"
                        aria-label={`Remove ${s.label}`}
                        data-testid={`scenario-remove-${s.key}`}
                        onClick={() => change(removeScenario(scenarios!, s.key))}
                      >
                        ×
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {discountRateLabel !== undefined && (
        <p className="chart-caveat" data-testid="household-value-caption">
          {householdValueCaption(discountRateLabel)}
        </p>
      )}
      {showSurvivorIncome && (
        <p className="chart-caveat" data-testid="survivor-income-caption">
          {survivorIncomeCaption(rows, survivorGap, dollarsMode)}
        </p>
      )}

      {canEdit && (
        <div className={`strategy-toolbar`}>
          {/* Only while editing. Under the table, a standing "Scenarios"
              title would be a second heading for a block that already has
              one; the Edit button alone is enough to say what it does. */}
          {editing && <span className="strategy-toolbar-title">Editing scenarios</span>}
          {editing && hiddenCount > 0 && (
            <span className="strategy-toolbar-note" data-testid="hidden-count">
              {hiddenCount === 1 ? '1 hidden' : `${hiddenCount} hidden`}
            </span>
          )}
          {editing && (
            <>
              <button
                type="button"
                className="strategy-tool"
                data-testid="scenario-add"
                onClick={() =>
                  change(
                    addScenario(
                      scenarios,
                      (allComparisons ?? comparisons)
                        .find((c) => c.isSelected)!
                        .filingAges.map((f) => ({ years: f.years, months: f.months })),
                    ),
                  )
                }
              >
                + Add scenario
              </button>
              <button
                type="button"
                className="strategy-tool"
                data-testid="scenario-reset"
                onClick={() => change(resetScenarios())}
                disabled={isDefaultScenarioSet(scenarios)}
              >
                Reset
              </button>
            </>
          )}
          <button
            type="button"
            className={`strategy-tool${editing ? ' strategy-tool-done' : ''}`}
            data-testid="scenario-edit-toggle"
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      )}
    </div>
  );
}
