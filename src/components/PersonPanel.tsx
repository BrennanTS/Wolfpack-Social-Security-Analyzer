import { useState } from 'react';
import type { PersonAnalysis } from '../lib/personAnalysis';
import {
  addClaimingRow,
  isDefaultClaimingPrefs,
  removeClaimingRow,
  resetClaimingPrefs,
  toggleClaimingRowHidden,
  visibleClaimingRows,
  type ClaimingRow,
  type ClaimingTablePrefs,
} from '../lib/claimingRows';
import { firstMonthInYear, type FilingAgeChoice } from '../lib/scenario';
import type { FilingAgeDisplay } from '../lib/ssaTools';
import { formatCurrency, formatCurrencyPrecise, fraLabel, personLabel } from '../lib/format';
import { scenarioEyebrow } from '../lib/scenario';
import { soloVsHouseholdNote } from './methodologyCopy';
import { nearestWholeClaimAge } from '../lib/ssaTools';
import { computeBreakEvens } from '../lib/benefitMath';
import { DEFAULT_CHART_VISIBILITY, type ChartKey } from '../lib/chartVisibility';
import { BenefitChart } from './BenefitChart';
import { EyeIcon } from './EyeIcon';
import { BreakEvenSection } from './BreakEvenSection';
import { OptionalChartsPanel } from './OptionalChartsPanel';

interface PersonPanelProps {
  analysis: PersonAnalysis;
  index: 0 | 1;
  annualCola: number;
  /**
   * Whether `analysis.filingAge` is the optimizer's own pick. Only the card's
   * eyebrow depends on it — every figure below is correct either way, but
   * calling an age the adviser typed in "Recommended" would not be. Defaults
   * to true, which is what every call site meant before scenarios existed.
   */
  isBest?: boolean;
  /**
   * The rows of the "Benefit by Claiming Age" table, hidden ones included and
   * flagged. Built once in `Analyzer` (`buildClaimingRows`) and handed to both
   * this component and the PDF's `PersonSection`, so the two cannot disagree
   * about which rows a person's table has.
   *
   * Optional: without it this falls back to the whole-year claiming options,
   * which is exactly what the table showed before it became editable.
   */
  claimingRows?: ClaimingRow[];
  claimingPrefs?: ClaimingTablePrefs;
  onClaimingPrefsChange?: (prefs: ClaimingTablePrefs) => void;
  /** Every attainable filing age for THIS person — `analysis.filingAgeOptions[i]`. */
  filingAgeOptions?: FilingAgeChoice[];
}

export function PersonPanel({
  analysis,
  index,
  annualCola,
  isBest = true,
  claimingRows,
  claimingPrefs,
  onClaimingPrefsChange,
  filingAgeOptions,
}: PersonPanelProps) {
  const { fra, claimingOptions, filingAge, monthlyAtFilingAge } = analysis;
  // The planning horizon the adviser actually set, not SSA's suggestion.
  // `ssaSuggestedLifeExpectancy` is only ever the slider's *default*; the two
  // diverge the moment the slider moves, and the Lifetime column below is
  // computed from `person.lifeExpectancy` (see `analyzePerson`). The PDF has
  // always cited `person.lifeExpectancy`, so citing the suggestion here made
  // screen and print disagree about what the same numbers mean.
  const { lifeExpectancy } = analysis.person;
  const age62 = claimingOptions.find((o) => o.age === 62)!;
  const age70 = claimingOptions.find((o) => o.age === 70)!;
  // The optimizer's recommended filing age is frequently a non-whole-year
  // month (e.g. 64y5m), which never exactly matches a row — every row's
  // `age` is a whole year (62-70). Round to the nearest whole claiming age so
  // exactly one row is always marked, the same way the deleted ResultsPanel
  // did via `nearestWholeClaimAge`. A whole-year optimum rounds to itself.
  // THREE ages, each answering a different question — see
  // `householdBestFilingAge`. `shownAge` is what every figure on this page is
  // built from and is what the charts below mark; `bestTogetherAge` is what
  // the optimizer chose for the household; `soloAge` is what this person
  // would choose alone.
  const shownAge = nearestWholeClaimAge(filingAge.decimalYears);
  const householdBest = analysis.householdBestFilingAge ?? filingAge;
  const bestTogetherAge = nearestWholeClaimAge(householdBest.decimalYears);
  // What this person would file at ALONE — null for a single claimant, where
  // it equals the household answer by construction. When the two differ the
  // table marks both, because the disagreement is the useful thing: a lower
  // earner with the longer horizon is often better off alone at 70 and
  // better off for the household at 66, since they inherit a survivor
  // benefit that delaying their own record cannot beat.
  // `== null`, not `=== null` — the same convention the strategy table uses
  // for `survivorIncome`, and for the same reason: an analysis built before
  // this field existed carries `undefined`, not `null`, and must take the
  // "nothing to contrast" path rather than throw on the property access.
  const soloAge =
    analysis.soloFilingAge == null
      ? null
      : nearestWholeClaimAge(analysis.soloFilingAge.decimalYears);
  // Only when there is a second answer to distinguish it from; otherwise the
  // qualifier implies a disagreement that is not there.
  const showBothBadges = soloAge !== null && soloAge !== bestTogetherAge;
  const shownDiffers = shownAge !== bestTogetherAge;

  // Live-COLA break-evens for this person, recomputed the same way
  // HouseholdPanel recomputes person A's (see that component's doc comment):
  // `annualCola` is deliberately excluded from the analysis effect's
  // dependencies, so the COLA slider must recompute this locally rather than
  // read a baked-in field. Before the couples refactor, every claimant saw a
  // Break-Even Analysis section (Analyzer.tsx's old `output-duo` block); the
  // refactor only wired it back up on the married Household tab, silently
  // dropping it for single claimants and for each married person's own tab.
  // Rendering it here restores that for everyone, single or married.
  // The table shows the decision still available: this person's current age
  // and every age ahead of it, plus any age the adviser added. A row for 62
  // when they are 66 offers a choice that has already gone by, and
  // `isEligible` — which means "has already reached this age" — labelled
  // exactly those rows "Eligible", the opposite of what a reader takes it to
  // mean. `buildClaimingRows` in `claimingRows.ts` applies that same rule;
  // the fallback here reproduces it for a call site that passes no rows.
  const rows: ClaimingRow[] =
    claimingRows ??
    claimingOptions
      .filter((o) => o.age >= analysis.currentAge.years)
      .map((o) => ({
        id: String(o.age),
        years: o.age,
        months: 0,
        label: String(o.age),
        monthlyBenefit: o.monthlyBenefit,
        percentOfPia: o.percentOfPia,
        lifetimeBenefits: o.lifetimeBenefits,
        isEligible: o.isEligible,
        added: false,
        hidden: false,
      }));

  const canEditRows =
    claimingPrefs !== undefined &&
    onClaimingPrefsChange !== undefined &&
    filingAgeOptions !== undefined &&
    filingAgeOptions.length > 0;
  const [editingRows, setEditingRows] = useState(false);
  // The age the Add control is pointing at. Seeded to this person's own
  // filing age so the commonest addition — "show me the exact age the
  // optimizer picked" — is one click.
  const [addYears, setAddYears] = useState(filingAge.years);
  const [addMonths, setAddMonths] = useState(filingAge.months);
  const addMonthOptions = (filingAgeOptions ?? [])
    .filter((o) => o.years === addYears)
    .map((o) => o.months);
  const shownRows = editingRows ? rows : visibleClaimingRows(rows);
  const hiddenRowCount = rows.filter((r) => r.hidden).length;

  /**
   * Which row carries a marker for a given age.
   *
   * An optimizer age is frequently a non-whole-year month (64y5m), which no
   * whole-year row matches — so the rule is: if the adviser has ADDED a row
   * sitting exactly on it, that row wins; otherwise the nearest whole year
   * does, and exactly one row is marked either way.
   *
   * Shared by all three markers rather than written per badge. Rewriting the
   * best-together badge without it silently dropped the exact-row case,
   * leaving an added row at the optimizer's own age unmarked.
   */
  const marks = (row: ClaimingRow, age: FilingAgeDisplay): boolean => {
    const exact = rows.some((r) => r.years === age.years && r.months === age.months);
    return exact
      ? row.years === age.years && row.months === age.months
      : row.months === 0 && row.years === nearestWholeClaimAge(age.decimalYears);
  };

  const breakEvens = computeBreakEvens(claimingOptions, annualCola);

  // Chart visibility is per-person state, not lifted to Analyzer/HouseholdView:
  // each person's charts are toggled independently, and since HouseholdView
  // only ever mounts the active tab's panel, this naturally resets to the
  // defaults when you navigate away from a person's tab and back (there's no
  // hidden panel to preserve state in — see HouseholdView's doc comment on
  // "only the active panel is rendered").
  const [chartVisibility, setChartVisibility] = useState(DEFAULT_CHART_VISIBILITY);
  function toggleChart(key: ChartKey) {
    setChartVisibility((v) => ({ ...v, [key]: !v[key] }));
  }

  return (
    <div className="results">
      <div className="recommendation-card">
        <span className="rec-label">
          {personLabel(analysis.person.name, index)} — {scenarioEyebrow(isBest)}
        </span>
        <h2 data-testid="recommendation-title">{personLabel(analysis.person.name, index)}</h2>
        <div className="rec-stats">
          <div>
            <span className="stat-value" data-testid="stat-optimal-monthly">{formatCurrency(monthlyAtFilingAge)}</span>
            <span className="stat-label">Monthly at age {filingAge.label}</span>
          </div>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <span className="summary-label">Your FRA</span>
          <span className="summary-value" data-testid="summary-fra">{fraLabel(fra)}</span>
          <span className="summary-hint">Full Retirement Age</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Age 62 Benefit</span>
          <span className="summary-value" data-testid="summary-age62">{formatCurrency(age62.monthlyBenefit)}</span>
          <span className="summary-hint">{age62.percentOfPia}% of PIA · earliest</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Age 70 Benefit</span>
          <span className="summary-value" data-testid="summary-age70">{formatCurrency(age70.monthlyBenefit)}</span>
          <span className="summary-hint">{age70.percentOfPia}% of PIA · maximum</span>
        </div>
      </div>

      <div className="table-section">
        <h3>Benefit by Claiming Age</h3>
        <p className="table-desc" data-testid="benefit-table-caption">
          Monthly benefit and lifetime total to age {lifeExpectancy} at 0% discount.
          Charts may use {annualCola}% COLA for illustration.
        </p>
        {(showBothBadges || shownDiffers) && (
          <p className="chart-caveat" data-testid="solo-vs-household">
            {soloVsHouseholdNote(
              personLabel(analysis.person.name, index),
              (analysis.householdBestFilingAge ?? filingAge).label,
              analysis.soloFilingAge?.label ?? null,
              shownDiffers ? filingAge.label : null,
            )}
          </p>
        )}
        <div className="table-wrap">
          <table data-testid="benefit-table" className={editingRows ? 'strategy-editing' : ''}>
            <thead>
              <tr>
                {editingRows && (
                  <th>
                    <span className="visually-hidden">Show on screen and in the report</span>
                  </th>
                )}
                <th>Age</th>
                <th>Monthly</th>
                <th>% of PIA</th>
                <th>Lifetime</th>
                <th>Status</th>
                {editingRows && (
                  <th>
                    <span className="visually-hidden">Remove</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row) => {
                // The optimizer's filing age is frequently a non-whole-year
                // month, which never exactly matches a whole-year row —
                // rounding to the nearest keeps exactly one row marked. An
                // added row at that exact age would otherwise go unmarked
                // while a whole year beside it wore the badge, so an exact
                // match wins over the rounded one.
                const isShown = marks(row, filingAge);
                const isBestTogether = marks(row, householdBest);
                return (
                  <tr
                    key={row.id}
                    data-testid={`claim-row-${row.id}`}
                    className={[
                      isBestTogether ? 'row-optimal' : '',
                      shownDiffers && isShown ? 'row-selected' : '',
                      !row.isEligible ? 'row-future' : '',
                      row.hidden ? 'row-hidden' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {editingRows && (
                      <td className="cell-eye">
                        <button
                          type="button"
                          className="row-eye"
                          aria-pressed={!row.hidden}
                          aria-label={`${row.hidden ? 'Show' : 'Hide'} age ${row.label}`}
                          data-testid={`claim-eye-${row.id}`}
                          onClick={() =>
                            onClaimingPrefsChange!(toggleClaimingRowHidden(claimingPrefs!, row.id))
                          }
                        >
                          <EyeIcon open={!row.hidden} />
                        </button>
                      </td>
                    )}
                    <td>
                      <strong>{row.label}</strong>
                      {/* The OPTIMIZER's answer, never the shown scenario's.
                          Wiring this to the shown age put "Best together" on
                          62 for a household whose optimum was 70. */}
                      {isBestTogether && (
                        <span className="badge" data-testid="badge-best">
                          {showBothBadges ? 'Best together' : 'Best'}
                        </span>
                      )}
                      {showBothBadges && row.months === 0 && row.years === soloAge && (
                        <span className="badge badge-solo" data-testid="badge-solo">
                          Best alone
                        </span>
                      )}
                      {/* What the page is actually built from, when that is
                          not the optimum. Without it the row every figure
                          comes from carries no mark at all. */}
                      {shownDiffers && isShown && (
                        <span className="badge badge-shown" data-testid="badge-shown">
                          Shown
                        </span>
                      )}
                    </td>
                    <td data-testid="cell-monthly">{formatCurrencyPrecise(row.monthlyBenefit)}</td>
                    <td data-testid="cell-percent">{row.percentOfPia}%</td>
                    <td>{formatCurrency(row.lifetimeBenefits)}</td>
                    <td>
                      {!row.isEligible ? (
                        <span className="status-future">Future</span>
                      ) : isShown ? (
                        <span className="status-optimal">Optimal</span>
                      ) : (
                        <span className="status-eligible">Eligible</span>
                      )}
                    </td>
                    {editingRows && (
                      <td className="cell-remove">
                        {row.added ? (
                          <button
                            type="button"
                            className="row-remove"
                            aria-label={`Remove age ${row.label}`}
                            data-testid={`claim-remove-${row.id}`}
                            onClick={() =>
                              onClaimingPrefsChange!(removeClaimingRow(claimingPrefs!, row.id))
                            }
                          >
                            ×
                          </button>
                        ) : (
                          // A built-in row is hidden, never removed: it is
                          // rebuilt from the person on every analysis, so a
                          // delete would not stick.
                          <span className="visually-hidden">Hide this row instead</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {canEditRows && (
            <div
              className={`strategy-toolbar${editingRows ? ' strategy-toolbar-editing' : ''}`}
            >
              {/* Only while editing, matching the comparison table: under the
                  table a standing title would be a second heading for a
                  section that already has one. */}
              {editingRows && <span className="strategy-toolbar-title">Editing ages</span>}
              {editingRows && hiddenRowCount > 0 && (
                <span className="strategy-toolbar-note" data-testid="claim-hidden-count">
                  {hiddenRowCount === 1 ? '1 hidden' : `${hiddenRowCount} hidden`}
                </span>
              )}
            {editingRows && (
              <>
                <select
                  className="claim-add-years"
                  aria-label="Add a claiming age, years"
                  data-testid="claim-add-years"
                  value={addYears}
                  onChange={(e) => {
                    const nextYears = Number(e.target.value);
                    setAddYears(nextYears);
                    setAddMonths(
                      firstMonthInYear(
                        (filingAgeOptions ?? [])
                          .filter((o) => o.years === nextYears)
                          .map((o) => o.months),
                      ),
                    );
                  }}
                >
                  {[...new Set(filingAgeOptions!.map((o) => o.years))].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <select
                  className="claim-add-months"
                  aria-label="Add a claiming age, months"
                  data-testid="claim-add-months"
                  value={addMonths}
                  onChange={(e) => setAddMonths(Number(e.target.value))}
                >
                  {addMonthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m === 1 ? '1 mo' : `${m} mos`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="strategy-tool"
                  data-testid="claim-add"
                  onClick={() =>
                    onClaimingPrefsChange!(
                      addClaimingRow(
                        claimingPrefs!,
                        { years: addYears, months: addMonths },
                        rows.map((r) => r.id),
                      ),
                    )
                  }
                >
                  Add age
                </button>
                <button
                  type="button"
                  className="strategy-tool"
                  data-testid="claim-reset"
                  onClick={() => onClaimingPrefsChange!(resetClaimingPrefs())}
                  disabled={isDefaultClaimingPrefs(claimingPrefs!)}
                >
                  Reset
                </button>
              </>
            )}
            <button
              type="button"
              className={`strategy-tool${editingRows ? ' strategy-tool-done' : ''}`}
              data-testid="claim-edit-toggle"
              aria-pressed={editingRows}
              onClick={() => setEditingRows(!editingRows)}
            >
              {editingRows ? 'Done' : 'Edit'}
            </button>
          </div>
        )}
        </div>
      </div>

      {/* `BreakEvenSection` renders nothing when there are no pairs — a
          zero-PIA person has none, since two zero streams never cross. Drop to
          a single column in that case so the chart takes the full width rather
          than sitting beside a dead column. */}
      <div className={breakEvens.length === 0 ? 'output-duo output-duo-single' : 'output-duo'}>
        <BenefitChart
          options={claimingOptions}
          lifeExpectancy={analysis.person.lifeExpectancy}
          optimalAge={shownAge}
          annualCola={annualCola}
        />

        <BreakEvenSection breakEvens={breakEvens} lifeExpectancy={analysis.person.lifeExpectancy} />
      </div>

      <OptionalChartsPanel
        claimingOptions={claimingOptions}
        optimalAge={shownAge}
        lifeExpectancy={analysis.person.lifeExpectancy}
        annualCola={annualCola}
        visibility={chartVisibility}
        onToggle={toggleChart}
      />
    </div>
  );
}
