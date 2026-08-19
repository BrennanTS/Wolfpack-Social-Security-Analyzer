import { useState } from 'react';
import { formatCurrency, personLabel } from '../lib/format';
import type { HouseholdAnalysis } from '../lib/household';
import {
  cellsWithin,
  gridKey,
  gridRatio,
  percentOfBest,
  sameCellAges,
  type ClaimingGridCell,
} from '../lib/claimingGrid';
import { addScenario, filingAgeLabel, selectScenario, type ScenarioSet } from '../lib/scenario';

/** Default tolerance for the near-best region, in percent. */
export const DEFAULT_TARGET_PERCENT = 1;

interface Props {
  analysis: HouseholdAnalysis;
  scenarios?: ScenarioSet;
  onScenariosChange?: (scenarios: ScenarioSet) => void;
}

/**
 * The claiming-age grid: one square per pair of whole ages, shaded by what
 * the household gets, with the near-best region outlined.
 *
 * It answers a question the strategy table cannot. That table prices four
 * hand-picked strategies; this prices all eighty-one, and what it usually
 * shows is that the board is flat — twenty-three of them within 1% of the
 * optimum for the household this was built against. "Claim at 70" and "claim
 * at 68, which is when you actually want to retire" can be the same answer to
 * the nearest few hundred dollars, and only the grid says so.
 *
 * Its own tab rather than a section on the Household tab: it is an
 * exploration surface for a live conversation, not part of the report's
 * argument, and nothing in it prints.
 */
export function ClaimingGridPanel({ analysis, scenarios, onScenariosChange }: Props) {
  const [targetOn, setTargetOn] = useState(true);
  // A string, not a number: a number input bound to a number cannot hold the
  // intermediate states of typing ("", "1."), and coercing on every keystroke
  // makes the field fight the user. Parsed at the point of use.
  const [targetText, setTargetText] = useState(String(DEFAULT_TARGET_PERCENT));

  const grid = analysis.claimingGrid;
  if (grid === null) return null;

  const parsed = Number.parseFloat(targetText);
  const target = Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 100) : 0;
  const within = cellsWithin(grid, target);

  const names = analysis.people.map((p, i) => personLabel(p.person.name, i));
  const byKey = new Map(grid.cells.map((c) => [gridKey(c.years[0], c.years[1]), c]));
  const best = grid.cells.find((c) => c.value === grid.max);
  const selectedAges = analysis.selected.filingAges;

  const [yearsA, yearsB] = grid.years;
  // Rows run high-to-low so the vertical axis reads upward, the way an axis
  // is expected to; columns run low-to-high left-to-right.
  const rows = [...yearsB].reverse();

  const canSelect = scenarios !== undefined && onScenariosChange !== undefined;

  function chooseCell(cell: ClaimingGridCell) {
    if (!canSelect) return;
    // Add AND select. Everywhere else in the app adding a scenario is an act
    // of comparison and leaves the selection alone; here the click IS the
    // choice, and a cell that lit up nothing would read as a dead control.
    const next = addScenario(scenarios!, [cell.ages[0], cell.ages[1]]);
    onScenariosChange!(selectScenario(next, next.rows[next.rows.length - 1].id));
  }

  function cellLabel(cell: ClaimingGridCell): string {
    return `${names[0]} at ${filingAgeLabel(cell.ages[0])}, ${names[1]} at ${filingAgeLabel(
      cell.ages[1],
    )} — ${formatCurrency(cell.value)}, ${percentOfBest(grid!, cell.value).toFixed(1)}% of best`;
  }

  return (
    <section className="claim-grid-panel" data-testid="claiming-grid">
      <h3>Claiming age grid</h3>
      <p className="table-desc">
        Household value at every combination of whole claiming ages, darkest at the best.
        Each square is the best either of them can do filing somewhere inside those two
        years, so the darkest square is the optimizer&rsquo;s own answer.{' '}
        {canSelect && 'Click a square to build the whole report on it.'}
      </p>

      <div className="claim-grid-controls">
        <label className="claim-grid-toggle">
          <input
            type="checkbox"
            checked={targetOn}
            data-testid="target-range-toggle"
            onChange={(e) => setTargetOn(e.target.checked)}
          />
          Highlight near-best
        </label>
        <label className="claim-grid-tolerance">
          within
          <input
            type="number"
            min={0}
            max={25}
            step={0.5}
            value={targetText}
            disabled={!targetOn}
            aria-label="Near-best tolerance, percent of the best household value"
            data-testid="target-range-percent"
            onChange={(e) => setTargetText(e.target.value)}
          />
          % of best
        </label>
        {targetOn && (
          <span className="claim-grid-count" data-testid="target-range-count">
            {within.size} of {grid.cells.length} combinations qualify
          </span>
        )}
      </div>

      <div className="claim-grid-layout">
        <div className="claim-grid-wrap">
          {/* The y label sits BESIDE the table, rotated. Above it, it read as
              a header for the columns — which are the other person's ages. */}
          <div className="claim-grid-plot">
            <div className="claim-grid-axis-y">
              <span>{names[1]}&rsquo;s claiming age</span>
            </div>
            <table className="claim-grid" data-testid="claiming-grid-table">
            <caption className="visually-hidden">
              Household value by {names[0]}&rsquo;s claiming age against {names[1]}&rsquo;s
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">{names[1]}&rsquo;s claiming age</span>
                </th>
                {yearsA.map((year) => (
                  <th key={year} scope="col">
                    {year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((yb) => (
                <tr key={yb}>
                  <th scope="row">{yb}</th>
                  {yearsA.map((ya) => {
                    const cell = byKey.get(gridKey(ya, yb));
                    if (cell === undefined) {
                      return (
                        <td key={ya} className="claim-cell claim-cell-empty" aria-hidden="true" />
                      );
                    }
                    const isBest = cell === best;
                    const isSelected = sameCellAges(cell, selectedAges);
                    const isNear = targetOn && within.has(gridKey(ya, yb));
                    return (
                      <td key={ya} className="claim-cell-td">
                        <button
                          type="button"
                          className={[
                            'claim-cell',
                            isNear ? 'claim-cell-near' : '',
                            isBest ? 'claim-cell-best' : '',
                            isSelected ? 'claim-cell-selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={{ '--t': gridRatio(grid, cell.value) } as React.CSSProperties}
                          data-testid={`grid-cell-${ya}-${yb}`}
                          aria-pressed={isSelected}
                          disabled={!canSelect}
                          title={cellLabel(cell)}
                          onClick={() => chooseCell(cell)}
                        >
                          <span className="visually-hidden">{cellLabel(cell)}</span>
                          <span aria-hidden="true">
                            {percentOfBest(grid, cell.value).toFixed(1)}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          <div className="claim-grid-axis-x">{names[0]}&rsquo;s claiming age</div>

          <div className="claim-grid-legend">
            <span>Lower</span>
            <span className="claim-grid-ramp" aria-hidden="true" />
            <span>Higher</span>
            {targetOn && (
              <>
                <span className="claim-grid-swatch-near" aria-hidden="true" />
                <span>within {target}% of best</span>
              </>
            )}
          </div>
        </div>

        <aside className="claim-grid-side">
          <h4>Best combination</h4>
          <dl>
            <dt>Household value</dt>
            <dd data-testid="grid-best-value">{formatCurrency(grid.max)}</dd>
            {best && (
              <>
                <dt>{names[0]}</dt>
                <dd>{filingAgeLabel(best.ages[0])}</dd>
                <dt>{names[1]}</dt>
                <dd>{filingAgeLabel(best.ages[1])}</dd>
              </>
            )}
            <dt>Across the whole grid</dt>
            <dd>
              {formatCurrency(grid.min)} &ndash; {formatCurrency(grid.max)}
            </dd>
          </dl>
          <p className="claim-grid-note">
            Each square prints its share of the best. Every combination shown is one SSA
            would pay; the grid ranks them, it does not rule any of them out.
          </p>
        </aside>
      </div>
    </section>
  );
}
