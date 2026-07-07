import type {
  ClaimingOption,
  FraResult,
  Gender,
  SpousalAnalysis,
  FilingAgeDisplay,
} from '../lib/socialSecurity';
import {
  formatCurrency,
  formatCurrencyPrecise,
  fraLabel,
} from '../lib/socialSecurity';
import { formatPercent } from '../lib/cpiHistory';
import { genderLabel } from '../lib/lifeExpectancy';

interface ResultsPanelProps {
  fra: FraResult;
  currentAge: { years: number; months: number };
  claimingOptions: ClaimingOption[];
  optimalAge: number;
  optimalFilingAge: FilingAgeDisplay;
  optimalMonthly: number;
  expectedPresentValue: number;
  discountRate: number;
  recommendation: string;
  recommendationDetail: string;
  lifeExpectancy: number;
  annualCola: number;
  gender: Gender;
  hasSpouse: boolean;
  spousal?: SpousalAnalysis;
}

export function ResultsPanel({
  fra,
  claimingOptions,
  optimalAge,
  optimalFilingAge,
  optimalMonthly,
  expectedPresentValue,
  discountRate,
  recommendation,
  recommendationDetail,
  lifeExpectancy,
  annualCola,
  gender,
  hasSpouse,
  spousal,
}: ResultsPanelProps) {
  const optimal =
    claimingOptions.find((o) => o.age === optimalAge) ?? claimingOptions[0];
  const age62 = claimingOptions.find((o) => o.age === 62)!;
  const age70 = claimingOptions.find((o) => o.age === 70)!;

  return (
    <div className="results">
      <div className="recommendation-card">
        <span className="rec-label">Recommended Strategy (ssa.tools)</span>
        <h2>{recommendation}</h2>
        <p>{recommendationDetail}</p>
        <div className="rec-stats">
          <div>
            <span className="stat-value">{formatCurrency(optimalMonthly)}</span>
            <span className="stat-label">Monthly at age {optimalFilingAge.label}</span>
          </div>
          <div>
            <span className="stat-value">{formatCurrency(expectedPresentValue)}</span>
            <span className="stat-label">
              Expected PV ({formatPercent(discountRate * 100, 1)} discount)
            </span>
          </div>
          <div>
            <span className="stat-value">{optimal.percentOfPia}%</span>
            <span className="stat-label">Of full benefit</span>
          </div>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <span className="summary-label">Gender</span>
          <span className="summary-value">{genderLabel(gender)}</span>
          <span className="summary-hint">{hasSpouse ? 'Married' : 'Single'}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Your FRA</span>
          <span className="summary-value">{fraLabel(fra)}</span>
          <span className="summary-hint">Full Retirement Age</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Age 62 Benefit</span>
          <span className="summary-value">{formatCurrency(age62.monthlyBenefit)}</span>
          <span className="summary-hint">{age62.percentOfPia}% of PIA · earliest</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Age 70 Benefit</span>
          <span className="summary-value">{formatCurrency(age70.monthlyBenefit)}</span>
          <span className="summary-hint">{age70.percentOfPia}% of PIA · maximum</span>
        </div>
        {hasSpouse && spousal && (
          <div className="summary-card summary-card-wide">
            <span className="summary-label">Spousal at FRA</span>
            <span className="summary-value">{formatCurrency(spousal.spousalBenefitAtFra)}/mo</span>
            <span className="summary-hint">
              ssa.tools spousal top-up
              {spousal.spouseFilingAge
                ? ` · spouse files at ${spousal.spouseFilingAge.label}`
                : ''}
            </span>
          </div>
        )}
      </div>

      <div className="table-section">
        <h3>Benefit by Claiming Age</h3>
        <p className="table-desc">
          Monthly benefit (ssa.tools) and lifetime total to age {lifeExpectancy} at 0% discount.
          Charts may use {annualCola}% COLA for illustration.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Age</th>
                <th>Monthly</th>
                <th>% of PIA</th>
                <th>Lifetime</th>
                <th>vs. Optimal</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {claimingOptions.map((opt) => {
                const diff = opt.lifetimeBenefits - optimal.lifetimeBenefits;
                const isOptimal = opt.age === optimalAge;
                const isRecommended =
                  optimalFilingAge.years === opt.age && optimalFilingAge.months === 0;
                return (
                  <tr
                    key={opt.age}
                    className={[
                      isOptimal || isRecommended ? 'row-optimal' : '',
                      !opt.isEligible ? 'row-future' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <td>
                      <strong>{opt.age}</strong>
                      {(isOptimal || isRecommended) && <span className="badge">Best</span>}
                    </td>
                    <td>{formatCurrencyPrecise(opt.monthlyBenefit)}</td>
                    <td>{opt.percentOfPia}%</td>
                    <td>{formatCurrency(opt.lifetimeBenefits)}</td>
                    <td className={diff < 0 ? 'negative' : diff > 0 ? 'positive' : ''}>
                      {diff === 0 ? '—' : formatCurrency(diff)}
                    </td>
                    <td>
                      {!opt.isEligible ? (
                        <span className="status-future">Future</span>
                      ) : isOptimal || isRecommended ? (
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
