import { useState } from 'react';
import type { PersonAnalysis } from '../lib/personAnalysis';
import { formatCurrency, formatCurrencyPrecise, fraLabel, personLabel } from '../lib/format';
import { scenarioEyebrow } from '../lib/scenario';
import { nearestWholeClaimAge } from '../lib/ssaTools';
import { computeBreakEvens } from '../lib/benefitMath';
import { DEFAULT_CHART_VISIBILITY, type ChartKey } from '../lib/chartVisibility';
import { BenefitChart } from './BenefitChart';
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
}

export function PersonPanel({ analysis, index, annualCola, isBest = true }: PersonPanelProps) {
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
  const selectedAge = nearestWholeClaimAge(filingAge.decimalYears);

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
  // and every age ahead of it. A row for 62 when they are 66 offers a choice
  // that has already gone by, and `isEligible` — which means "has already
  // reached this age" — labelled exactly those rows "Eligible", the opposite
  // of what a reader takes it to mean.
  const claimableOptions = claimingOptions.filter(
    (o) => o.age >= analysis.currentAge.years,
  );

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
              {claimableOptions.map((opt) => {
                const isRecommended = opt.age === selectedAge;
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

      {/* `BreakEvenSection` renders nothing when there are no pairs — a
          zero-PIA person has none, since two zero streams never cross. Drop to
          a single column in that case so the chart takes the full width rather
          than sitting beside a dead column. */}
      <div className={breakEvens.length === 0 ? 'output-duo output-duo-single' : 'output-duo'}>
        <BenefitChart
          options={claimingOptions}
          lifeExpectancy={analysis.person.lifeExpectancy}
          optimalAge={selectedAge}
          annualCola={annualCola}
        />

        <BreakEvenSection breakEvens={breakEvens} lifeExpectancy={analysis.person.lifeExpectancy} />
      </div>

      <OptionalChartsPanel
        claimingOptions={claimingOptions}
        optimalAge={selectedAge}
        lifeExpectancy={analysis.person.lifeExpectancy}
        annualCola={annualCola}
        visibility={chartVisibility}
        onToggle={toggleChart}
      />
    </div>
  );
}
