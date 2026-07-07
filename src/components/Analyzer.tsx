import { useMemo, useState } from 'react';
import type { Gender, UserInputs } from '../lib/socialSecurity';
import {
  analyzeClaiming,
  DEFAULT_INPUTS,
  formatCurrency,
  fraLabel,
  getCurrentAge,
  getFullRetirementAge,
} from '../lib/socialSecurity';
import { genderLabel, getSuggestedLifeExpectancy } from '../lib/lifeExpectancy';
import { downloadPdfReport } from '../lib/printReport';
import { AssumptionsPanel } from './AssumptionsPanel';
import { BenefitChart } from './BenefitChart';
import { BreakEvenSection } from './BreakEvenSection';
import { OptionalChartsPanel, type ChartKey } from './OptionalChartsPanel';
import { ResultsPanel } from './ResultsPanel';
import { MigraineToggle } from './MigraineToggle';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEARS = Array.from({ length: 70 }, (_, i) => CURRENT_YEAR - 18 - i);

const DEFAULT_CHART_VISIBILITY: Record<ChartKey, boolean> = {
  monthlyBar: false,
  lifetimeBar: false,
  colaProjection: false,
  spousalSurvivor: false,
  lifetimeHeatmap: false,
  opportunityCost: false,
  monthlyRamp: false,
};

interface AnalyzerProps {
  onLogout: () => void;
  migraineMode: boolean;
  onToggleMigraineMode: () => void;
}

export function Analyzer({ onLogout, migraineMode, onToggleMigraineMode }: AnalyzerProps) {
  const [birthYear, setBirthYear] = useState(DEFAULT_INPUTS.birthYear);
  const [birthMonth, setBirthMonth] = useState(DEFAULT_INPUTS.birthMonth);
  const [monthlyBenefit, setMonthlyBenefit] = useState(DEFAULT_INPUTS.monthlyBenefitAtFra);
  const [lifeExpectancy, setLifeExpectancy] = useState(DEFAULT_INPUTS.lifeExpectancy);
  const [annualCola, setAnnualCola] = useState(DEFAULT_INPUTS.annualCola);
  const [gender, setGender] = useState<Gender>(DEFAULT_INPUTS.gender);
  const [hasSpouse, setHasSpouse] = useState(DEFAULT_INPUTS.hasSpouse);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [chartVisibility, setChartVisibility] = useState(DEFAULT_CHART_VISIBILITY);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const inputs: UserInputs = useMemo(
    () => ({
      birthYear,
      birthMonth,
      monthlyBenefitAtFra: monthlyBenefit,
      lifeExpectancy,
      annualCola,
      gender,
      hasSpouse,
    }),
    [birthYear, birthMonth, monthlyBenefit, lifeExpectancy, annualCola, gender, hasSpouse],
  );

  const result = useMemo(() => analyzeClaiming(inputs), [inputs]);
  const fra = useMemo(() => getFullRetirementAge(birthYear), [birthYear]);
  const currentAge = useMemo(
    () => getCurrentAge(birthYear, birthMonth),
    [birthYear, birthMonth],
  );

  function toggleChart(key: ChartKey) {
    setChartVisibility((v) => ({ ...v, [key]: !v[key] }));
  }

  function handleGenderChange(next: Gender) {
    setGender(next);
    setLifeExpectancy(
      getSuggestedLifeExpectancy(getCurrentAge(birthYear, birthMonth).years, next),
    );
  }

  async function handleExportPdf() {
    setExportError(null);
    setExporting(true);
    try {
      await downloadPdfReport(inputs, result);
    } catch {
      setExportError('PDF export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="analyzer">
      <header className="header">
        <div className="header-brand">
          <div className="brand-monogram" aria-hidden="true">
            W
          </div>
          <div>
            <h1>Social Security Analyzer</h1>
            <span className="brand-sub">Wolfpack Planning Team</span>
          </div>
        </div>
        <div className="header-actions">
          <MigraineToggle active={migraineMode} onToggle={onToggleMigraineMode} />
          <button
            type="button"
            className="btn-export"
            onClick={handleExportPdf}
            disabled={exporting}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 1h5l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path d="M9 1v3h3M5 8h6M5 10.5h4" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            {exporting ? 'Generating…' : 'Export PDF'}
          </button>
          {exportError && <span className="export-error">{exportError}</span>}
          <button type="button" className="btn-ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="main">
        <aside className="input-panel">
          <h2>Your Information</h2>
          <p className="input-hint">A few quick fields for a more accurate analysis.</p>

          <div className="input-fields">
          <div className="field">
            <label htmlFor="birth">Date of Birth</label>
            <div className="birth-row">
              <select
                id="birth-month"
                value={birthMonth}
                onChange={(e) => setBirthMonth(Number(e.target.value))}
                aria-label="Birth month"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                id="birth"
                value={birthYear}
                onChange={(e) => setBirthYear(Number(e.target.value))}
                aria-label="Birth year"
              >
                {BIRTH_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <span className="field-hint">FRA: {fraLabel(fra)} · Age {currentAge.years}</span>
          </div>

          <div className="field">
            <span className="field-label">Gender</span>
            <div className="segmented-control" role="group" aria-label="Gender">
              {(['female', 'male'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`segment-btn ${gender === g ? 'segment-btn-active' : ''}`}
                  onClick={() => handleGenderChange(g)}
                  aria-pressed={gender === g}
                >
                  {genderLabel(g)}
                </button>
              ))}
            </div>
            <span className="field-hint">
              Used for SSA life expectancy tables (period life table)
            </span>
          </div>

          <div className="field">
            <span className="field-label">Marital status</span>
            <div className="segmented-control" role="group" aria-label="Marital status">
              <button
                type="button"
                className={`segment-btn ${!hasSpouse ? 'segment-btn-active' : ''}`}
                onClick={() => setHasSpouse(false)}
                aria-pressed={!hasSpouse}
              >
                Single
              </button>
              <button
                type="button"
                className={`segment-btn ${hasSpouse ? 'segment-btn-active' : ''}`}
                onClick={() => setHasSpouse(true)}
                aria-pressed={hasSpouse}
              >
                Married
              </button>
            </div>
            <span className="field-hint">
              Married adds spousal (50% PIA) and survivor benefit projections
            </span>
          </div>

          <div className="field">
            <label htmlFor="benefit">Monthly Benefit at Full Retirement Age</label>
            <div className="currency-input">
              <span className="currency-prefix">$</span>
              <input
                id="benefit"
                type="number"
                min={500}
                max={5000}
                step={50}
                value={monthlyBenefit}
                onChange={(e) => setMonthlyBenefit(Number(e.target.value) || 0)}
              />
            </div>
            <span className="field-hint">
              From your SSA statement or mySocialSecurity.gov estimate
            </span>
          </div>

          <AssumptionsPanel
            lifeExpectancy={lifeExpectancy}
            onLifeExpectancyChange={setLifeExpectancy}
            annualCola={annualCola}
            onAnnualColaChange={setAnnualCola}
            ssaSuggestedLifeExpectancy={result.ssaSuggestedLifeExpectancy}
            gender={gender}
            expanded={showAssumptions}
            onToggle={() => setShowAssumptions(!showAssumptions)}
          />
          </div>

          <div className="input-summary">
            <p>
              Analyzing <strong>{genderLabel(gender)}</strong>
              {hasSpouse ? ', married' : ', single'} claimant — benefits ages{' '}
              <strong>62–70</strong> with SSA formulas.
            </p>
          </div>
        </aside>

        <section className="output-panel">
          <ResultsPanel
            fra={result.fra}
            currentAge={result.currentAge}
            claimingOptions={result.claimingOptions}
            optimalAge={result.optimalAge}
            recommendation={result.recommendation}
            recommendationDetail={result.recommendationDetail}
            lifeExpectancy={lifeExpectancy}
            annualCola={annualCola}
            gender={gender}
            hasSpouse={hasSpouse}
            spousal={result.spousal}
          />

          <div className="output-duo">
            <BenefitChart
              options={result.claimingOptions}
              lifeExpectancy={lifeExpectancy}
              optimalAge={result.optimalAge}
              annualCola={annualCola}
            />

            <BreakEvenSection breakEvens={result.breakEvens} lifeExpectancy={lifeExpectancy} />
          </div>

          <OptionalChartsPanel
            result={result}
            inputs={inputs}
            visibility={chartVisibility}
            onToggle={toggleChart}
          />

          <div className="methodology">
            <h3>How This Works</h3>
            <div className="method-grid">
              <div>
                <strong>Early claiming (before FRA)</strong>
                <p>
                  Benefits are reduced 5/9 of 1% per month for the first 36 months early, then
                  5/12 of 1% per month thereafter.
                </p>
              </div>
              <div>
                <strong>Delayed credits (after FRA)</strong>
                <p>
                  Benefits increase 2/3 of 1% per month (8% per year) until age 70.
                </p>
              </div>
              <div>
                <strong>Life expectancy by gender</strong>
                <p>
                  SSA 2021 period life table suggests planning to age{' '}
                  {result.ssaSuggestedLifeExpectancy} for a {genderLabel(gender).toLowerCase()} at
                  age {currentAge.years}. Adjust under Planning assumptions.
                </p>
              </div>
              <div>
                <strong>Spousal & survivor benefits</strong>
                <p>
                  {hasSpouse
                    ? `Spouse may receive up to ${formatCurrency(result.spousal?.spousalBenefitAtFra ?? 0)}/mo at their FRA (50% of your PIA). Survivor receives your full monthly amount.`
                    : 'Select Married to model spousal and survivor benefits.'}
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>
          Estimates only · Not affiliated with the Social Security Administration · For
          educational planning purposes
        </p>
      </footer>
    </div>
  );
}
