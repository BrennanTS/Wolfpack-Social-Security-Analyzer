import { useState } from 'react';
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { DollarsMode } from '../lib/dollarsMode';
import { formatCurrency, personLabel } from '../lib/format';
import { showSurvivorIncomeColumn, type HouseholdStrategy } from '../lib/household';
import type { Person } from '../lib/personAnalysis';
import { SURVIVOR_INCOME_COLUMN_HEADER, survivorIncomeCaption } from './methodologyCopy';
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
   * The scenario list behind these rows. Editing is offered only when this
   * and `onScenariosChange` and `filingAgeOptions` are all present — a
   * widowed household, or a test rendering fixed rows, simply gets the table.
   */
  scenarios?: ScenarioSet;
  onScenariosChange?: (scenarios: ScenarioSet) => void;
  /** Every attainable filing age per person — `analysis.filingAgeOptions`. */
  filingAgeOptions?: FilingAgeChoice[][];
}

/**
 * Eye / eye-off, inline rather than from an icon font — this app ships no
 * icon set, and the header buttons already draw their own SVG the same way.
 *
 * Drawn rather than typed as `◉`/`⦸`, which is what these were first: the
 * filled circle reads as a selected radio button, and the row beside it
 * genuinely does have a "which row drives the report" choice on it, so the
 * two were competing for the same meaning.
 */
function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8S3.9 3.9 8 3.9 14.5 8 14.5 8 12.1 12.1 8 12.1 1.5 8 1.5 8z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.1" />
      {!open && <path d="M2.6 13.4 13.4 2.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />}
    </svg>
  );
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
 * Combined PV and "vs. best" stay where they are and keep updating: the whole
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
  scenarios,
  onScenariosChange,
  filingAgeOptions,
}: StrategyComparisonTableProps) {
  const [editing, setEditing] = useState(false);

  const canEdit =
    scenarios !== undefined &&
    onScenariosChange !== undefined &&
    filingAgeOptions !== undefined &&
    filingAgeOptions.length === people.length &&
    filingAgeOptions.every((o) => o.length > 0);

  // Edit mode shows every row, hidden ones included; view mode shows only
  // what `household.ts` already filtered.
  const rows = editing ? (allComparisons ?? comparisons) : comparisons;
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
      {canEdit && (
        <div className="strategy-toolbar">
          <span className="strategy-toolbar-title">
            {editing ? 'Editing scenarios' : 'Scenarios'}
          </span>
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

      <table data-testid="strategy-table" className={editing ? 'strategy-editing' : ''}>
        <thead>
          <tr>
            {editing && (
              <th>
                <span className="visually-hidden">Show on screen and in the report</span>
              </th>
            )}
            <th>Strategy</th>
            {people.map((p, i) => (
              <th key={p.id}>{personLabel(p.name, i)}</th>
            ))}
            <th>Combined PV</th>
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
                  {/* Only when it is NOT also the optimal row, which already
                      carries a badge — under the default scenario every row
                      would otherwise print "Best Shown" side by side. */}
                  {s.isSelected && !s.isOptimal && (
                    <span className="badge badge-shown" data-testid="badge-shown">
                      Shown
                    </span>
                  )}
                  {editing && !s.isSelected && !s.hidden && (
                    <button
                      type="button"
                      className="row-use"
                      data-testid={`scenario-use-${s.key}`}
                      onClick={() => change(selectScenario(scenarios!, s.key))}
                    >
                      Show this
                    </button>
                  )}
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

                <td>{formatCurrency(s.expectedNpv)}</td>
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

      {showSurvivorIncome && (
        <p className="chart-caveat" data-testid="survivor-income-caption">
          {survivorIncomeCaption(rows, survivorGap, dollarsMode)}
        </p>
      )}
    </div>
  );
}
