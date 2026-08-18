import { useMemo } from 'react';
import { toNominalMonthly, type DollarsMode } from '../lib/dollarsMode';
import { formatCurrency, formatCurrencyPrecise, personLabel } from '../lib/format';
import { buildMonthlyIncomeSeries, type HouseholdAnalysis } from '../lib/household';
import { scenarioEyebrow } from '../lib/scenario';
import { CombinedIncomeChart } from './CombinedIncomeChart';
import {
  monthYear,
  piaEstimateNote,
  WIDOWED_COMPARISON_HEADING,
  WIDOWED_DECEASED_HEADING,
  WIDOWED_HEADERS,
  widowedIncomeCaption,
  widowedLifetimeCaption,
} from './widowedCopy';

interface WidowedPanelProps {
  analysis: HouseholdAnalysis;
  dollarsMode: DollarsMode;
  onDollarsModeChange: (mode: DollarsMode) => void;
}

/**
 * The whole surface a widow(er) sees. One person, two dates, no tab strip.
 *
 * Deliberately NOT `PersonPanel` with a status check. `analyzeWidowed` empties
 * `claimingOptions` and `breakEvens` because a table of "what your own record
 * pays at 62 through 70" describes income this person may never receive — the
 * survivor benefit can exceed their own in every month they live — and
 * `PersonPanel` is built entirely around those arrays. Routing a widow through
 * it did not degrade gracefully; it threw, on `claimingOptions.find(...)` for
 * the age-62 summary card.
 *
 * So this panel shows the four things that ARE the decision: what the two
 * dates are and what they pay together, the alternatives and what they cost,
 * the income over time, and the record the survivor benefit comes from. No
 * break-even (two irrelevant quantities), no claiming-age table, no
 * per-age charts.
 *
 * There is no scenario editor either. A widow(er)'s rows are two dates the
 * engine searches, not a filing age an adviser picks — `analyzeWidowed` sets
 * `filingAgeOptions` to `[[]]` and ignores the scenario entirely.
 */
export function WidowedPanel({
  analysis,
  dollarsMode,
  onDollarsModeChange,
}: WidowedPanelProps) {
  const [person] = analysis.people;
  const label = personLabel(person.person.name, 0);
  const { deceased, optimal } = analysis;

  const displayMonthlySeries = useMemo(() => {
    const monthly = buildMonthlyIncomeSeries(analysis.periods, [person.person]);
    return dollarsMode === 'nominal'
      ? toNominalMonthly(monthly, analysis.assumptions.annualCola, analysis.asOf.getFullYear())
      : monthly;
  }, [analysis, person, dollarsMode]);

  // The two bands at the steady state — own record, and the survivor
  // increment above it. Read off the engine's own periods rather than
  // recomputed: `monthlyAtFilingAge` is their sum, so a locally derived split
  // could disagree with the total printed beside it.
  const steadyMonth = Math.max(
    optimal.survivorClaimDate?.monthIndex ?? 0,
    ...analysis.periods.filter((b) => b.type === 'personal').map((b) => b.startIndex),
  );
  const active = analysis.periods.filter(
    (b) => b.startIndex <= steadyMonth && steadyMonth <= b.endIndex,
  );
  const ownMonthly = active
    .filter((b) => b.type === 'personal')
    .reduce((sum, b) => sum + b.monthlyAmount, 0);
  const survivorMonthly = active
    .filter((b) => b.type === 'survivor')
    .reduce((sum, b) => sum + b.monthlyAmount, 0);

  const estimateNote = deceased === null ? null : piaEstimateNote(deceased, analysis.piaEstimated === true);

  return (
    <div className="results">
      <div className="recommendation-card">
        <span className="rec-label">
          {label} — {scenarioEyebrow(analysis.scenarioIsBest)}
        </span>
        <h2 data-testid="recommendation-title">{analysis.recommendation}</h2>
        <p>{analysis.recommendationDetail}</p>

        {/* `rec-stats` first, so this inherits the card's named-grid
            placement — above 880px `.recommendation-card` lays out as
            label/title/body in one column and `stats` in the other, and an
            element with no `grid-area` auto-places outside the card
            entirely. `widowed-stats` only marks the third figure as the sum
            of the first two. */}
        <div className="rec-stats widowed-stats">
          <div>
            <span className="stat-value" data-testid="widowed-own-monthly">
              {formatCurrencyPrecise(ownMonthly)}
            </span>
            <span className="stat-label">
              Own record, from {optimal.filingAges[0].label}
            </span>
          </div>
          <div>
            <span className="stat-value" data-testid="widowed-survivor-monthly">
              {formatCurrencyPrecise(survivorMonthly)}
            </span>
            <span className="stat-label">
              Survivor increment, from {optimal.survivorClaimDate?.age ?? '—'}
            </span>
          </div>
          <div className="widowed-stat-total">
            <span className="stat-value" data-testid="widowed-total-monthly">
              {formatCurrencyPrecise(person.monthlyAtFilingAge)}
            </span>
            <span className="stat-label">Together, per month</span>
          </div>
        </div>

      </div>

      <div className="table-section">
        <h3>{WIDOWED_COMPARISON_HEADING}</h3>
        <div className="table-wrap">
          <table data-testid="widowed-strategy-table">
            <thead>
              <tr>
                <th>{WIDOWED_HEADERS.strategy}</th>
                <th>{WIDOWED_HEADERS.survivorAge}</th>
                <th>{WIDOWED_HEADERS.ownAge}</th>
                <th>{WIDOWED_HEADERS.lifetime}</th>
                <th>{WIDOWED_HEADERS.delta}</th>
              </tr>
            </thead>
            <tbody>
              {analysis.comparisons.map((row) => (
                <tr
                  key={row.key}
                  data-testid={`widowed-row-${row.key}`}
                  className={row.isOptimal ? 'row-optimal' : ''}
                >
                  <td>
                    {row.label}
                    {row.isOptimal && <span className="badge">Best</span>}
                  </td>
                  <td data-testid="cell-survivor-age">{row.survivorClaimDate?.age ?? '—'}</td>
                  <td data-testid="cell-own-age">{row.filingAges[0].label}</td>
                  <td data-testid="cell-lifetime">
                    {/* `lifetimeTotal`, not `expectedNpv`. They hold the same
                        number for a widowed row today, but only one of them
                        MEANS an undiscounted lifetime sum, and reading the
                        other under this header is how the two would drift. */}
                    {row.lifetimeTotal === null ? '—' : formatCurrency(row.lifetimeTotal)}
                  </td>
                  <td data-testid="cell-delta" className={row.deltaVsOptimal < 0 ? 'negative' : ''}>
                    {row.deltaVsOptimal === 0 ? '—' : formatCurrency(row.deltaVsOptimal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="chart-caveat" data-testid="widowed-lifetime-caption">
            {widowedLifetimeCaption(person.person.lifeExpectancy)}
          </p>
        </div>
      </div>

      <CombinedIncomeChart
        monthlySeries={displayMonthlySeries}
        people={[person.person]}
        dollarsMode={dollarsMode}
        onDollarsModeChange={onDollarsModeChange}
        caption={widowedIncomeCaption(dollarsMode)}
      />

      {deceased !== null && (
        <div className="table-section">
          <h3>{WIDOWED_DECEASED_HEADING}</h3>
          <div className="summary-grid">
            <div className="summary-card">
              <span className="summary-label">Date of birth</span>
              <span className="summary-value" data-testid="deceased-birth">
                {monthYear(deceased.birthYear, deceased.birthMonth)}
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Date of death</span>
              <span className="summary-value" data-testid="deceased-death">
                {monthYear(deceased.deathYear, deceased.deathMonth)}
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-label">
                {/* Two different facts, never one label for both: a benefit
                    someone was actually drawing is not the same as a record
                    nobody ever filed on. */}
                {deceased.filed ? 'Filed' : 'Had not filed'}
              </span>
              <span className="summary-value" data-testid="deceased-filed">
                {deceased.filed ? monthYear(deceased.filed.year, deceased.filed.month) : '—'}
              </span>
              <span className="summary-hint">
                {deceased.filed
                  ? `Benefit at full retirement age ${formatCurrencyPrecise(deceased.piaMonthly)}`
                  : `Benefit at full retirement age ${formatCurrencyPrecise(deceased.piaMonthly)}, unclaimed`}
              </span>
            </div>
          </div>
          {estimateNote !== null && (
            <p className="chart-caveat" data-testid="pia-estimate-note">
              {estimateNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
