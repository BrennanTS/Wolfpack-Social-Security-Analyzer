import type { PersonAnalysis } from '../lib/personAnalysis';
import { formatCurrency, formatCurrencyPrecise, fraLabel, personLabel } from '../lib/format';
import { nearestWholeClaimAge } from '../lib/ssaTools';

interface PersonPanelProps {
  analysis: PersonAnalysis;
  index: 0 | 1;
  annualCola: number;
}

export function PersonPanel({ analysis, index, annualCola }: PersonPanelProps) {
  const { fra, claimingOptions, recommendedFilingAge, recommendedMonthly, ssaSuggestedLifeExpectancy } =
    analysis;
  const age62 = claimingOptions.find((o) => o.age === 62)!;
  const age70 = claimingOptions.find((o) => o.age === 70)!;
  // The optimizer's recommended filing age is frequently a non-whole-year
  // month (e.g. 64y5m), which never exactly matches a row — every row's
  // `age` is a whole year (62-70). Round to the nearest whole claiming age so
  // exactly one row is always marked, the same way the deleted ResultsPanel
  // did via `nearestWholeClaimAge`. A whole-year optimum rounds to itself.
  const recommendedAge = nearestWholeClaimAge(recommendedFilingAge.decimalYears);

  return (
    <div className="results">
      <div className="recommendation-card">
        <span className="rec-label">{personLabel(analysis.person.name, index)} — Recommended Strategy (ssa.tools)</span>
        <h2 data-testid="recommendation-title">{personLabel(analysis.person.name, index)}</h2>
        <div className="rec-stats">
          <div>
            <span className="stat-value" data-testid="stat-optimal-monthly">{formatCurrency(recommendedMonthly)}</span>
            <span className="stat-label">Monthly at age {recommendedFilingAge.label}</span>
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
        <p className="table-desc">
          Monthly benefit (ssa.tools) and lifetime total to age {ssaSuggestedLifeExpectancy} at 0% discount.
          Charts may use {annualCola}% COLA for illustration.
        </p>
        <div className="table-wrap">
          <table data-testid="benefit-table">
            <thead>
              <tr>
                <th>Age</th>
                <th>Monthly</th>
                <th>% of PIA</th>
                <th>Lifetime</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {claimingOptions.map((opt) => {
                const isRecommended = opt.age === recommendedAge;
                return (
                  <tr
                    key={opt.age}
                    data-testid={`claim-row-${opt.age}`}
                    className={[
                      isRecommended ? 'row-optimal' : '',
                      !opt.isEligible ? 'row-future' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <td>
                      <strong>{opt.age}</strong>
                      {isRecommended && <span className="badge">Best</span>}
                    </td>
                    <td data-testid="cell-monthly">{formatCurrencyPrecise(opt.monthlyBenefit)}</td>
                    <td data-testid="cell-percent">{opt.percentOfPia}%</td>
                    <td>{formatCurrency(opt.lifetimeBenefits)}</td>
                    <td>
                      {!opt.isEligible ? (
                        <span className="status-future">Future</span>
                      ) : isRecommended ? (
                        <span className="status-optimal">Optimal</span>
                      ) : (
                        <span className="status-eligible">Eligible</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
