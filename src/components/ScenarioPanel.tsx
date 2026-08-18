import {
  addScenario,
  BEST_ROW_ID,
  filingAgeLabel,
  isDefaultScenarioSet,
  removeScenario,
  renameScenario,
  resetScenarios,
  scenarioLabel,
  selectScenario,
  updateScenarioAges,
  type FilingAgeChoice,
  type ScenarioSet,
} from '../lib/scenario';

interface ScenarioPanelProps {
  scenarios: ScenarioSet;
  onChange: (scenarios: ScenarioSet) => void;
  expanded: boolean;
  onToggle: () => void;
  /**
   * Display-order names for the household's people. Taken from the FORM, not
   * from the analysis, so the column headers are right while the adviser is
   * still typing and before any analysis exists.
   */
  personNames: string[];
  /**
   * Every attainable filing age per person — `analysis.filingAgeOptions`.
   * Null until an analysis exists. The rows still render then (the adviser
   * can see and name their scenarios); only the age selects are withheld,
   * because there is no honest set of ages to offer yet.
   */
  options: FilingAgeChoice[][] | null;
  /**
   * The ages each row actually RESOLVED to, keyed by row id — read off
   * `analysis.comparisons`. These are not always the ages a row stores:
   * `fra`, `earliest`, `latest` and `best` carry no ages at all until an
   * analysis derives them, and a custom row's ages may have been clamped.
   * Showing the stored value instead would print an age the report is not
   * built on.
   */
  resolvedAges: Record<string, FilingAgeChoice[]>;
  isMarried: boolean;
}

/** The months this person can file in during a given whole year of age. */
function monthsAvailable(options: FilingAgeChoice[], years: number): number[] {
  return options.filter((o) => o.years === years).map((o) => o.months);
}

function nearest(values: number[], want: number): number {
  return values.reduce(
    (best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best),
    values[0],
  );
}

/**
 * The adviser's list of claiming scenarios, in the sidebar above the planning
 * assumptions and collapsed by default.
 *
 * Every row here becomes a row of the comparison table on screen and in the
 * PDF, and the selected one drives the ENTIRE analysis — the charts, the
 * income cliff, the survivor note, each person's own page, and the exported
 * report. That is why it sits in the sidebar with the other inputs rather
 * than above the results it changes.
 *
 * Four built-in rows are always present. Their ages are DERIVED, not stored
 * (see `Scenario`), so they are shown as text rather than as selects: "Both
 * claim at FRA" is a different pair of ages for every couple, and offering an
 * age control on it would invite an edit that the next analysis would discard.
 * Editing one is still possible — changing an age converts that row into a
 * custom one, which is what `updateScenarioAges` does — but it is reached by
 * adding a row, not by quietly rewriting a built-in.
 *
 * Optimal cannot be deleted: every row's "vs. best" figure is measured
 * against it.
 */
export function ScenarioPanel({
  scenarios,
  onChange,
  expanded,
  onToggle,
  personNames,
  options,
  resolvedAges,
  isMarried,
}: ScenarioPanelProps) {
  const editable = options !== null && options.length === personNames.length;
  const atDefaults = isDefaultScenarioSet(scenarios);

  /** Seed a new row from whatever the selected row currently resolves to. */
  function handleAdd() {
    const seed = resolvedAges[scenarios.selectedId];
    if (!editable || seed === undefined || seed.length !== personNames.length) return;
    onChange(addScenario(scenarios, seed));
  }

  function handleAgeChange(id: string, personIndex: number, next: FilingAgeChoice) {
    const current = resolvedAges[id];
    if (current === undefined) return;
    onChange(
      updateScenarioAges(
        scenarios,
        id,
        current.map((age, i) => (i === personIndex ? next : age)),
      ),
    );
  }

  return (
    <div className="scenario-panel">
      <button type="button" className="advanced-toggle" onClick={onToggle} aria-expanded={expanded}>
        {expanded ? '− Hide' : '+ '} Claiming scenarios
      </button>

      {expanded && (
        <div className="scenario-body" data-testid="scenario-panel">
          <p className="field-hint">
            Every scenario becomes a row in the comparison table. The selected one drives the
            charts, the figures and the PDF.
          </p>

          <table className="scenario-table" data-testid="scenario-table">
            <thead>
              <tr>
                <th>
                  <span className="visually-hidden">Shown</span>
                </th>
                <th>Scenario</th>
                <th>
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {scenarios.rows.map((row) => {
                const ages = resolvedAges[row.id];
                const isCustom = row.scenario.kind === 'custom';
                return (
                  <tr
                    key={row.id}
                    data-testid={`scenario-row-${row.id}`}
                    className={row.id === scenarios.selectedId ? 'scenario-row-selected' : ''}
                  >
                    <td className="scenario-pick">
                      <input
                        type="radio"
                        name="scenario-selected"
                        checked={row.id === scenarios.selectedId}
                        onChange={() => onChange(selectScenario(scenarios, row.id))}
                        aria-label={`Show ${scenarioLabel(row, isMarried)}`}
                        data-testid={`scenario-select-${row.id}`}
                      />
                    </td>

                    <td>
                      {isCustom ? (
                        <input
                          type="text"
                          className="scenario-name"
                          value={row.label}
                          aria-label={`Name for ${row.label}`}
                          data-testid={`scenario-name-${row.id}`}
                          onChange={(e) =>
                            onChange(renameScenario(scenarios, row.id, e.target.value))
                          }
                        />
                      ) : (
                        <span className="scenario-label">{scenarioLabel(row, isMarried)}</span>
                      )}

                      {/* One line per person rather than a column each. The
                          settings drawer is ~250px wide and two people's
                          year-and-month controls do not fit across it — as
                          columns they overflowed by 178px, putting the whole
                          spouse column off-screen behind a scrollbar nobody
                          would find. Stacked, each person's controls still
                          line up down the list, because the name spans share
                          one width. */}
                      <div className="scenario-ages">
                        {personNames.map((name, i) => {
                          const age = ages?.[i];
                          if (age === undefined) {
                            // The analysis dropped this row: a household where
                            // someone is already 64 has no "both claim at 62".
                            // The row stays in the list — it becomes reachable
                            // again if the adviser corrects a birth year — but
                            // an em dash on its own reads as a bug, so it says
                            // why.
                            return (
                              <span
                                key={name || i}
                                className="scenario-age scenario-age-unreachable"
                                title={
                                  editable
                                    ? 'Out of reach for this household — someone is already past this age'
                                    : 'Available once the profile is complete'
                                }
                                data-testid={`scenario-unreachable-${row.id}-${i}`}
                              >
                                <span className="scenario-age-who">{name}</span>—
                              </span>
                            );
                          }
                          if (!isCustom || !editable) {
                            return (
                              <span key={name || i} className="scenario-age">
                                <span className="scenario-age-who">{name}</span>
                                {filingAgeLabel(age)}
                              </span>
                            );
                          }
                          const personOptions = options[i];
                          const years = [...new Set(personOptions.map((o) => o.years))];
                          const months = monthsAvailable(personOptions, age.years);
                          return (
                            <span key={name || i} className="scenario-age">
                              <span className="scenario-age-who">{name}</span>
                              <select
                                aria-label={`${row.label} — ${name} claiming age, years`}
                                data-testid={`scenario-years-${row.id}-${i}`}
                                value={age.years}
                                onChange={(e) => {
                                  const nextYears = Number(e.target.value);
                                  const available = monthsAvailable(personOptions, nextYears);
                                  handleAgeChange(row.id, i, {
                                    years: nextYears,
                                    months: nearest(available, age.months),
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
                                aria-label={`${row.label} — ${name} claiming age, months`}
                                data-testid={`scenario-months-${row.id}-${i}`}
                                value={age.months}
                                onChange={(e) =>
                                  handleAgeChange(row.id, i, {
                                    years: age.years,
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
                            </span>
                          );
                        })}
                      </div>
                    </td>

                    <td className="scenario-actions-cell">
                      {row.id === BEST_ROW_ID ? (
                        // Not merely disabled: the row every delta is measured
                        // against has no "remove" to offer, and a greyed
                        // button invites a click that does nothing.
                        <span className="visually-hidden">Optimal cannot be removed</span>
                      ) : (
                        <button
                          type="button"
                          className="scenario-remove"
                          aria-label={`Remove ${scenarioLabel(row, isMarried)}`}
                          data-testid={`scenario-remove-${row.id}`}
                          onClick={() => onChange(removeScenario(scenarios, row.id))}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="scenario-actions">
            <button
              type="button"
              className="scenario-add"
              data-testid="scenario-add"
              onClick={handleAdd}
              disabled={!editable || resolvedAges[scenarios.selectedId] === undefined}
            >
              + Add scenario
            </button>
            <button
              type="button"
              className="scenario-reset"
              data-testid="scenario-reset"
              onClick={() => onChange(resetScenarios())}
              disabled={atDefaults}
            >
              Reset to defaults
            </button>
          </div>

          {!editable && (
            <p className="field-hint" data-testid="scenario-not-ready">
              Complete the profile to add scenarios and change claiming ages.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
