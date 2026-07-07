import { useEffect, useMemo, useState } from 'react';
import type { AnalysisResult, Gender } from '../lib/socialSecurity';
import {
  formatCurrency,
  fraLabel,
  getCurrentAge,
  getFullRetirementAge,
} from '../lib/socialSecurity';
import { genderLabel, getSuggestedLifeExpectancy } from '../lib/lifeExpectancy';
import { BRAND_NAME } from '../lib/brand';
import {
  analyzeIfComplete,
  BLANK_FORM,
  isFormComplete,
  suggestedLifeExpectancy,
  toUserInputs,
  type FormGender,
  type FormMarital,
} from '../lib/formState';
import { downloadPdfReport } from '../lib/printReport';
import { AssumptionsPanel } from './AssumptionsPanel';
import { BenefitChart } from './BenefitChart';
import { BreakEvenSection } from './BreakEvenSection';
import { OptionalChartsPanel, type ChartKey } from './OptionalChartsPanel';
import { ResultsPanel } from './ResultsPanel';
import { DarkModeToggle } from './DarkModeToggle';
import { ResourcesPanel } from './ResourcesPanel';
import { SettingsDrawer, SettingsDrawerToggle } from './SettingsDrawer';

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
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function Analyzer({ onLogout, darkMode, onToggleDarkMode }: AnalyzerProps) {
  const [birthYear, setBirthYear] = useState<number | ''>(BLANK_FORM.birthYear);
  const [birthMonth, setBirthMonth] = useState<number | ''>(BLANK_FORM.birthMonth);
  const [monthlyBenefit, setMonthlyBenefit] = useState<number | ''>(BLANK_FORM.monthlyBenefit);
  const [lifeExpectancy, setLifeExpectancy] = useState<number | null>(BLANK_FORM.lifeExpectancy);
  const [annualCola, setAnnualCola] = useState(BLANK_FORM.annualCola);
  const [discountRate, setDiscountRate] = useState(BLANK_FORM.discountRate);
  const [gender, setGender] = useState<FormGender>(BLANK_FORM.gender);
  const [hasSpouse, setHasSpouse] = useState<FormMarital>(BLANK_FORM.hasSpouse);
  const [spouseBirthYear, setSpouseBirthYear] = useState<number | ''>(BLANK_FORM.spouseBirthYear);
  const [spouseBirthMonth, setSpouseBirthMonth] = useState<number | ''>(BLANK_FORM.spouseBirthMonth);
  const [spouseMonthlyBenefit, setSpouseMonthlyBenefit] = useState<number | ''>(
    BLANK_FORM.spouseMonthlyBenefit,
  );
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(true);
  const [chartVisibility, setChartVisibility] = useState(DEFAULT_CHART_VISIBILITY);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const form = useMemo(
    () => ({
      birthYear,
      birthMonth,
      monthlyBenefit,
      lifeExpectancy,
      annualCola,
      discountRate,
      gender,
      hasSpouse,
      spouseBirthYear,
      spouseBirthMonth,
      spouseMonthlyBenefit,
    }),
    [
      birthYear,
      birthMonth,
      monthlyBenefit,
      lifeExpectancy,
      annualCola,
      discountRate,
      gender,
      hasSpouse,
      spouseBirthYear,
      spouseBirthMonth,
      spouseMonthlyBenefit,
    ],
  );

  const inputsComplete = isFormComplete(form);
  const inputs = inputsComplete ? toUserInputs(form) : null;

  useEffect(() => {
    if (!isFormComplete(form)) {
      setResult(null);
      setAnalysisError(null);
      setAnalyzing(false);
      return;
    }

    let cancelled = false;
    setAnalyzing(true);
    setAnalysisError(null);

    analyzeIfComplete(form)
      .then((next) => {
        if (!cancelled) {
          setResult(next);
          setAnalyzing(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult(null);
          setAnalysisError('Analysis failed. Check your inputs and try again.');
          setAnalyzing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [form]);
  const ssaSuggested = suggestedLifeExpectancy(form);

  const fra = useMemo(
    () => (birthYear !== '' ? getFullRetirementAge(birthYear) : null),
    [birthYear],
  );
  const currentAge = useMemo(
    () =>
      birthYear !== '' && birthMonth !== ''
        ? getCurrentAge(birthYear, birthMonth)
        : null,
    [birthYear, birthMonth],
  );

  function applyLifeExpectancySuggestion(nextGender: Gender) {
    if (birthYear === '' || birthMonth === '') return;
    const age = getCurrentAge(birthYear, birthMonth).years;
    setLifeExpectancy(getSuggestedLifeExpectancy(age, nextGender));
  }

  function handleGenderChange(next: Gender) {
    setGender(next);
    applyLifeExpectancySuggestion(next);
  }

  function handleMaritalChange(married: boolean) {
    setHasSpouse(married);
    if (married && birthYear !== '' && birthMonth !== '') {
      if (spouseBirthYear === '') setSpouseBirthYear(birthYear);
      if (spouseBirthMonth === '') setSpouseBirthMonth(birthMonth);
    }
  }

  function handleBirthChange(year: number | '', month: number | '') {
    setBirthYear(year);
    setBirthMonth(month);
    if (year !== '' && month !== '' && gender !== null) {
      setLifeExpectancy(getSuggestedLifeExpectancy(getCurrentAge(year, month).years, gender));
    }
  }

  function toggleChart(key: ChartKey) {
    setChartVisibility((v) => ({ ...v, [key]: !v[key] }));
  }

  async function handleExportPdf() {
    if (!inputs || !result) return;
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
    <div className={`analyzer${settingsOpen ? ' settings-open' : ''}`}>
      <header className="header">
        <div className="header-brand">
          <SettingsDrawerToggle open={settingsOpen} onToggle={() => setSettingsOpen(!settingsOpen)} />
          <div className="brand-monogram" aria-hidden="true">
            W
          </div>
          <div>
            <h1>Social Security Analyzer</h1>
            <span className="brand-sub">{BRAND_NAME}</span>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-resources"
            onClick={() => setResourcesOpen(true)}
            aria-haspopup="dialog"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 1.5l1.8 3.7 4 .6-2.9 2.8.7 4L8 10.8l-3.6 1.9.7-4L2.2 5.8l4-.6L8 1.5z"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
            Resources
          </button>
          <DarkModeToggle active={darkMode} onToggle={onToggleDarkMode} />
          <button
            type="button"
            className="btn-export"
            onClick={handleExportPdf}
            disabled={exporting || !inputsComplete}
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

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <div className="input-panel">
          <h2 id="settings-title">Your Information</h2>
          <p className="input-hint">A few quick fields for a more accurate analysis.</p>

          <div className="input-fields">
            <div className="field">
              <label htmlFor="birth">Date of Birth</label>
              <div className="birth-row">
                <select
                  id="birth-month"
                  value={birthMonth}
                  onChange={(e) => {
                    const month = e.target.value === '' ? '' : Number(e.target.value);
                    handleBirthChange(birthYear, month);
                  }}
                  aria-label="Birth month"
                >
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  id="birth"
                  value={birthYear}
                  onChange={(e) => {
                    const year = e.target.value === '' ? '' : Number(e.target.value);
                    handleBirthChange(year, birthMonth);
                  }}
                  aria-label="Birth year"
                >
                  <option value="">Year</option>
                  {BIRTH_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              {fra && currentAge && (
                <span className="field-hint">
                  FRA: {fraLabel(fra)} · Age {currentAge.years}
                </span>
              )}
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
                  className={`segment-btn ${hasSpouse === false ? 'segment-btn-active' : ''}`}
                  onClick={() => handleMaritalChange(false)}
                  aria-pressed={hasSpouse === false}
                >
                  Single
                </button>
                <button
                  type="button"
                  className={`segment-btn ${hasSpouse === true ? 'segment-btn-active' : ''}`}
                  onClick={() => handleMaritalChange(true)}
                  aria-pressed={hasSpouse === true}
                >
                  Married
                </button>
              </div>
              <span className="field-hint">
                Married uses ssa.tools couple optimizer (spousal + survivor strategies)
              </span>
            </div>

            {hasSpouse && (
              <>
                <div className="field">
                  <label>Spouse date of birth</label>
                  <div className="birth-row">
                    <select
                      value={spouseBirthMonth}
                      onChange={(e) => {
                        const month = e.target.value === '' ? '' : Number(e.target.value);
                        setSpouseBirthMonth(month);
                      }}
                      aria-label="Spouse birth month"
                    >
                      <option value="">Month</option>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <select
                      value={spouseBirthYear}
                      onChange={(e) => {
                        const year = e.target.value === '' ? '' : Number(e.target.value);
                        setSpouseBirthYear(year);
                      }}
                      aria-label="Spouse birth year"
                    >
                      <option value="">Year</option>
                      {BIRTH_YEARS.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="spouse-benefit">Spouse benefit at FRA</label>
                  <div className="currency-input">
                    <span className="currency-prefix">$</span>
                    <input
                      id="spouse-benefit"
                      type="number"
                      min={0}
                      max={5000}
                      step={50}
                      value={spouseMonthlyBenefit}
                      placeholder="0"
                      onChange={(e) => {
                        const raw = e.target.value;
                        setSpouseMonthlyBenefit(raw === '' ? '' : Number(raw));
                      }}
                    />
                  </div>
                  <span className="field-hint">
                    Enter $0 if spouse has little or no own work record
                  </span>
                </div>
              </>
            )}

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
                  placeholder="0"
                  onChange={(e) => {
                    const raw = e.target.value;
                    setMonthlyBenefit(raw === '' ? '' : Number(raw));
                  }}
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
              discountRate={discountRate}
              onDiscountRateChange={setDiscountRate}
              ssaSuggestedLifeExpectancy={ssaSuggested}
              gender={gender}
              expanded={showAssumptions}
              onToggle={() => setShowAssumptions(!showAssumptions)}
            />
          </div>

          <div className="input-summary">
            <p>
              {inputsComplete && gender ? (
                <>
                  Analyzing <strong>{genderLabel(gender)}</strong>
                  {hasSpouse ? ', married (ssa.tools couple)' : ', single'} claimant —
                  benefits via <strong>ssa.tools</strong> engine.
                </>
              ) : (
                <>Complete your profile to generate a personalized claiming analysis.</>
              )}
            </p>
          </div>
        </div>
      </SettingsDrawer>

      <main className="main">
        <section className="output-panel">
          {analyzing ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">
                <span />
              </div>
              <h3>Running ssa.tools analysis…</h3>
              <p>Computing optimal filing ages with SSA mortality tables and benefit formulas.</p>
            </div>
          ) : analysisError ? (
            <div className="empty-state">
              <h3>Analysis unavailable</h3>
              <p>{analysisError}</p>
            </div>
          ) : !result || !inputs ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">
                <span />
              </div>
              <h3>Your analysis awaits</h3>
              <p>
                Enter your date of birth, gender, marital status, and estimated benefit at full
                retirement age to see your optimal claiming strategy.
              </p>
            </div>
          ) : (
            <>
              <ResultsPanel
                fra={result.fra}
                currentAge={result.currentAge}
                claimingOptions={result.claimingOptions}
                optimalAge={result.optimalAge}
                optimalFilingAge={result.optimalFilingAge}
                optimalMonthly={result.optimalMonthly}
                expectedPresentValue={result.expectedPresentValue}
                discountRate={result.discountRate}
                recommendation={result.recommendation}
                recommendationDetail={result.recommendationDetail}
                lifeExpectancy={lifeExpectancy!}
                annualCola={annualCola}
                gender={inputs.gender}
                hasSpouse={inputs.hasSpouse}
                spousal={result.spousal}
              />

              <div className="output-duo">
                <BenefitChart
                  options={result.claimingOptions}
                  lifeExpectancy={lifeExpectancy!}
                  optimalAge={result.optimalAge}
                  annualCola={annualCola}
                />

                <BreakEvenSection breakEvens={result.breakEvens} lifeExpectancy={lifeExpectancy!} />
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
                    <strong>ssa.tools engine</strong>
                    <p>
                      Benefit amounts, FRA, spousal/survivor rules, and optimal filing use the open-source{' '}
                      <a href="https://ssa.tools" target="_blank" rel="noopener noreferrer">ssa.tools</a>{' '}
                      calculator with SSA mortality tables and expected present value.
                    </p>
                  </div>
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
                      {result.ssaSuggestedLifeExpectancy} for a{' '}
                      {genderLabel(inputs.gender).toLowerCase()} at age {result.currentAge.years}. Adjust under Planning assumptions.
                    </p>
                  </div>
                  <div>
                    <strong>Spousal & survivor benefits</strong>
                    <p>
                      {inputs.hasSpouse
                        ? `Spouse may receive up to ${formatCurrency(result.spousal?.spousalBenefitAtFra ?? 0)}/mo at their FRA (50% of your PIA). Survivor receives your full monthly amount.`
                        : 'Select Married to model spousal and survivor benefits.'}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      <ResourcesPanel open={resourcesOpen} onClose={() => setResourcesOpen(false)} />

      <footer className="footer">
        <p>
          Estimates only · Not affiliated with the Social Security Administration · For
          educational planning purposes
        </p>
      </footer>
    </div>
  );
}
