import { useEffect, useMemo, useState } from 'react';
import type { AnalysisResult, SpousalAnalysis, UserInputs } from '../lib/socialSecurity';
import { computeBreakEvens, type BreakEvenPair } from '../lib/benefitMath';
import { genderLabel, getSuggestedLifeExpectancy } from '../lib/lifeExpectancy';
import { getCurrentAge, type Gender } from '../lib/personAnalysis';
import type { HouseholdAnalysis } from '../lib/household';
import { createPiaRecipient, nearestWholeClaimAge, spousalTopUp } from '../lib/ssaTools';
import { formatCurrency } from '../lib/format';
import { BRAND_NAME } from '../lib/brand';
import {
  analyzeIfComplete,
  BLANK_FORM,
  isFormComplete,
  suggestedLifeExpectancy,
  type AnalyzerFormState,
  type PersonFormFields,
} from '../lib/formState';
import { downloadPdfReport } from '../lib/printReport';
import { AssumptionsPanel } from './AssumptionsPanel';
import { BenefitChart } from './BenefitChart';
import { BreakEvenSection } from './BreakEvenSection';
import { OptionalChartsPanel, type ChartKey } from './OptionalChartsPanel';
import { PersonFields } from './PersonFields';
import { ResultsPanel } from './ResultsPanel';
import { DarkModeToggle } from './DarkModeToggle';
import { ResourcesPanel } from './ResourcesPanel';
import { SettingsDrawer, SettingsDrawerToggle } from './SettingsDrawer';
import { AppVersion } from './AppVersion';

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

/**
 * The spousal top-up A's spouse receives based on A's PIA — always computed
 * directly from person A and person B rather than reused from the
 * household's `spousalTopUp` (which accrues to whichever person has the
 * lower PIA). `ResultsPanel` frames this card as "your spouse's benefit," so
 * it must stay anchored to A regardless of who earns more.
 */
function buildLegacySpousal(analysis: HouseholdAnalysis): SpousalAnalysis | undefined {
  if (analysis.status !== 'married') return undefined;
  const [a, b] = analysis.people;
  const recipientA = createPiaRecipient(
    a.person.birthYear,
    a.person.birthMonth,
    a.person.piaMonthly,
    a.person.gender,
  );
  const recipientB = createPiaRecipient(
    b.person.birthYear,
    b.person.birthMonth,
    b.person.piaMonthly,
    b.person.gender,
  );

  return {
    spousalBenefitAtFra: spousalTopUp(recipientA, recipientB, recipientB.normalRetirementAge()),
    spousalTopUpAtFilingAge: spousalTopUp(
      recipientA,
      recipientB,
      b.recommendedFilingAge.monthDuration,
    ),
    // A surviving spouse inherits A's own benefit, so the survivor amount at
    // each claiming age is just A's benefit at that age.
    survivorByClaimAge: a.claimingOptions.map((o) => ({
      age: o.age,
      survivorMonthly: o.monthlyBenefit,
    })),
    spouseFilingAge: b.recommendedFilingAge,
  };
}

/**
 * Adapts a `HouseholdAnalysis` to the single-person `AnalysisResult` shape
 * the existing results components (`ResultsPanel`, `OptionalChartsPanel`,
 * the PDF report) still expect. This is deliberately a thin data adapter,
 * not new UI — Task 19 replaces these components with a household-aware
 * view built directly on `HouseholdAnalysis`.
 */
function buildLegacyResult(analysis: HouseholdAnalysis, breakEvens: BreakEvenPair[]): AnalysisResult {
  const [personA] = analysis.people;
  const optimalAge = nearestWholeClaimAge(personA.recommendedFilingAge.decimalYears);
  const optimalOption =
    personA.claimingOptions.find((o) => o.age === optimalAge) ?? personA.claimingOptions[0];

  return {
    fra: personA.fra,
    currentAge: personA.currentAge,
    pia: personA.person.piaMonthly,
    claimingOptions: personA.claimingOptions,
    optimalAge,
    optimalFilingAge: personA.recommendedFilingAge,
    optimalMonthly: personA.recommendedMonthly,
    optimalLifetime: optimalOption.lifetimeBenefits,
    expectedPresentValue: analysis.optimal.expectedNpv,
    discountRate: analysis.assumptions.discountRate,
    breakEvens,
    recommendation: analysis.recommendation,
    recommendationDetail: analysis.recommendationDetail,
    ssaSuggestedLifeExpectancy: personA.ssaSuggestedLifeExpectancy,
    spousal: buildLegacySpousal(analysis),
  };
}

function buildLegacyInputs(form: AnalyzerFormState): UserInputs {
  const hasSpouse = !!form.hasSpouse;
  return {
    birthYear: form.personA.birthYear as number,
    birthMonth: form.personA.birthMonth as number,
    monthlyBenefitAtFra: form.personA.monthlyBenefit as number,
    lifeExpectancy: form.lifeExpectancy as number,
    annualCola: form.annualCola,
    gender: form.personA.gender as Gender,
    hasSpouse,
    discountRate: form.discountRate,
    spouseBirthYear: hasSpouse ? (form.personB.birthYear as number) : undefined,
    spouseBirthMonth: hasSpouse ? (form.personB.birthMonth as number) : undefined,
    spouseMonthlyBenefitAtFra: hasSpouse ? (form.personB.monthlyBenefit as number) : undefined,
  };
}

export function Analyzer({ onLogout, darkMode, onToggleDarkMode }: AnalyzerProps) {
  const [personA, setPersonA] = useState<PersonFormFields>(BLANK_FORM.personA);
  const [personB, setPersonB] = useState<PersonFormFields>(BLANK_FORM.personB);
  const [hasSpouse, setHasSpouse] = useState<boolean | null>(BLANK_FORM.hasSpouse);
  const [lifeExpectancy, setLifeExpectancy] = useState<number | null>(BLANK_FORM.lifeExpectancy);
  const [annualCola, setAnnualCola] = useState(BLANK_FORM.annualCola);
  const [discountRate, setDiscountRate] = useState(BLANK_FORM.discountRate);
  const [analysis, setAnalysis] = useState<HouseholdAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(true);
  const [chartVisibility, setChartVisibility] = useState(DEFAULT_CHART_VISIBILITY);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const form = useMemo<AnalyzerFormState>(
    () => ({
      personA,
      personB,
      hasSpouse,
      lifeExpectancy,
      annualCola,
      discountRate,
    }),
    [personA, personB, hasSpouse, lifeExpectancy, annualCola, discountRate],
  );

  const inputsComplete = isFormComplete(form);

  // The ssa.tools engine (benefits, optimal filing, expected PV) does not depend
  // on the chart-only COLA slider, so we intentionally exclude `annualCola` from
  // the dependencies below. Break-even lines that DO use COLA are recomputed
  // cheaply on the client via the `breakEvens` memo further down.
  useEffect(() => {
    if (!isFormComplete(form)) {
      setAnalysis(null);
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
          setAnalysis(next);
          setAnalyzing(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAnalysis(null);
          setAnalysisError('Analysis failed. Check your inputs and try again.');
          setAnalyzing(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personA, personB, hasSpouse, lifeExpectancy, discountRate]);

  // Illustrative break-even ages depend on the flat COLA assumption; recompute
  // them locally so moving the COLA slider updates instantly without re-running
  // the full mortality-weighted analysis.
  const breakEvens = useMemo(
    () => (analysis ? computeBreakEvens(analysis.people[0].claimingOptions, annualCola) : []),
    [analysis, annualCola],
  );
  const ssaSuggested = suggestedLifeExpectancy(form);

  const legacyResult = useMemo(
    () => (analysis ? buildLegacyResult(analysis, breakEvens) : null),
    [analysis, breakEvens],
  );
  const legacyInputs = useMemo(
    () => (inputsComplete ? buildLegacyInputs(form) : null),
    [inputsComplete, form],
  );

  function handlePersonAChange(next: PersonFormFields) {
    setPersonA(next);
    if (next.birthYear !== '' && next.birthMonth !== '' && next.gender !== null) {
      const age = getCurrentAge(next.birthYear, next.birthMonth).years;
      setLifeExpectancy(getSuggestedLifeExpectancy(age, next.gender));
    }
  }

  function handleMaritalChange(married: boolean) {
    setHasSpouse(married);
  }

  function toggleChart(key: ChartKey) {
    setChartVisibility((v) => ({ ...v, [key]: !v[key] }));
  }

  async function handleExportPdf() {
    if (!legacyInputs || !legacyResult) return;
    setExportError(null);
    setExporting(true);
    try {
      await downloadPdfReport(legacyInputs, legacyResult);
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
          <AppVersion />
        </div>
      </header>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <div className="input-panel">
          <h2 id="settings-title">Your Information</h2>
          <p className="input-hint">A few quick fields for a more accurate analysis.</p>

          <div className="input-fields">
            <PersonFields person={personA} index={0} onChange={handlePersonAChange} />

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

            {hasSpouse && <PersonFields person={personB} index={1} onChange={setPersonB} />}

            <AssumptionsPanel
              lifeExpectancy={lifeExpectancy}
              onLifeExpectancyChange={setLifeExpectancy}
              annualCola={annualCola}
              onAnnualColaChange={setAnnualCola}
              discountRate={discountRate}
              onDiscountRateChange={setDiscountRate}
              ssaSuggestedLifeExpectancy={ssaSuggested}
              gender={personA.gender}
              expanded={showAssumptions}
              onToggle={() => setShowAssumptions(!showAssumptions)}
            />
          </div>

          <div className="input-summary">
            <p>
              {inputsComplete && personA.gender ? (
                <>
                  Analyzing <strong>{genderLabel(personA.gender)}</strong>
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
            <div className="empty-state" data-testid="analysis-loading">
              <div className="empty-state-icon" aria-hidden="true">
                <span />
              </div>
              <h3>Running ssa.tools analysis…</h3>
              <p>Computing optimal filing ages with SSA mortality tables and benefit formulas.</p>
            </div>
          ) : analysisError ? (
            <div className="empty-state" data-testid="analysis-error">
              <h3>Analysis unavailable</h3>
              <p>{analysisError}</p>
            </div>
          ) : !legacyResult || !legacyInputs ? (
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
                fra={legacyResult.fra}
                currentAge={legacyResult.currentAge}
                claimingOptions={legacyResult.claimingOptions}
                optimalAge={legacyResult.optimalAge}
                optimalFilingAge={legacyResult.optimalFilingAge}
                optimalMonthly={legacyResult.optimalMonthly}
                expectedPresentValue={legacyResult.expectedPresentValue}
                discountRate={legacyResult.discountRate}
                recommendation={legacyResult.recommendation}
                recommendationDetail={legacyResult.recommendationDetail}
                lifeExpectancy={lifeExpectancy!}
                annualCola={annualCola}
                gender={legacyInputs.gender}
                hasSpouse={legacyInputs.hasSpouse}
                spousal={legacyResult.spousal}
              />

              <div className="output-duo">
                <BenefitChart
                  options={legacyResult.claimingOptions}
                  lifeExpectancy={lifeExpectancy!}
                  optimalAge={legacyResult.optimalAge}
                  annualCola={annualCola}
                />

                <BreakEvenSection breakEvens={breakEvens} lifeExpectancy={lifeExpectancy!} />
              </div>

              <OptionalChartsPanel
                result={legacyResult}
                inputs={legacyInputs}
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
                      {legacyResult.ssaSuggestedLifeExpectancy} for a{' '}
                      {genderLabel(legacyInputs.gender).toLowerCase()} at age {legacyResult.currentAge.years}. Adjust under Planning assumptions.
                    </p>
                  </div>
                  <div>
                    <strong>Spousal & survivor benefits</strong>
                    <p>
                      {legacyInputs.hasSpouse
                        ? `Spouse may receive up to ${formatCurrency(legacyResult.spousal?.spousalBenefitAtFra ?? 0)}/mo at their FRA (50% of your PIA). Survivor receives your full monthly amount.`
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
