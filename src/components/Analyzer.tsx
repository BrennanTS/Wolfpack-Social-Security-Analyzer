import { useEffect, useMemo, useState } from 'react';
import { genderLabel, getSuggestedLifeExpectancy } from '../lib/lifeExpectancy';
import { getCurrentAge } from '../lib/personAnalysis';
import type { HouseholdAnalysis } from '../lib/household';
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
import { fromShareParams } from '../lib/shareLink';
import { AssumptionsPanel } from './AssumptionsPanel';
import { HouseholdView } from './HouseholdView';
import { PersonFields } from './PersonFields';
import { DarkModeToggle } from './DarkModeToggle';
import { ResourcesPanel } from './ResourcesPanel';
import { SettingsDrawer, SettingsDrawerToggle } from './SettingsDrawer';
import { AppVersion } from './AppVersion';
import { CopyLinkButton } from './CopyLinkButton';
import { spousalMethodologyCopy } from './methodologyCopy';

interface AnalyzerProps {
  onLogout: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function Analyzer({ onLogout, darkMode, onToggleDarkMode }: AnalyzerProps) {
  // Parse once, before first paint. A lazy initializer rather than an effect:
  // an effect would paint the blank form first and then replace it, flickering
  // and briefly running an analysis on empty inputs. Reading `location.search`
  // is a read, so it's safe under StrictMode's double-invocation.
  const [initialForm] = useState(() => {
    if (typeof window === 'undefined') return BLANK_FORM;
    const params = new URLSearchParams(window.location.search);
    if ([...params.keys()].length === 0) return BLANK_FORM;
    return fromShareParams(params);
  });

  const [personA, setPersonA] = useState<PersonFormFields>(initialForm.personA);
  const [personB, setPersonB] = useState<PersonFormFields>(initialForm.personB);
  const [hasSpouse, setHasSpouse] = useState<boolean | null>(initialForm.hasSpouse);
  const [lifeExpectancy, setLifeExpectancy] = useState<number | null>(initialForm.lifeExpectancy);
  const [annualCola, setAnnualCola] = useState(initialForm.annualCola);
  const [discountRate, setDiscountRate] = useState(initialForm.discountRate);

  // Strip the query string separately, because this is a side effect and
  // StrictMode double-invokes state initializers. replaceState is idempotent,
  // so running it twice is harmless; parsing after a strip would not be.
  //
  // Stripping un-leaks nothing by itself — the recipient already has the URL —
  // but it keeps a client's date of birth and benefit out of the address bar
  // for the rest of a meeting, which is the realistic exposure here: a shared
  // screen or a glance over the shoulder. The cost is that a refresh clears
  // the form; that trade is deliberate.
  useEffect(() => {
    if (window.location.search !== '') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const [analysis, setAnalysis] = useState<HouseholdAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(true);
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
  // the dependencies below. On-screen break-even lines that DO use COLA are
  // recomputed cheaply from `analysis.people[0].claimingOptions` where they're
  // needed (see `HouseholdPanel`); the PDF export instead uses the analysis's
  // own baked-in `assumptions.annualCola`, since it's a point-in-time snapshot.
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

  const ssaSuggested = suggestedLifeExpectancy(form);

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

  async function handleExportPdf() {
    if (!analysis) return;
    setExportError(null);
    setExporting(true);
    try {
      await downloadPdfReport(analysis);
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
          <CopyLinkButton form={form} disabled={!inputsComplete} />
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
                Married uses ssa.tools couple optimizer (includes the spousal top-up)
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
          ) : !analysis ? (
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
              <HouseholdView analysis={analysis} annualCola={annualCola} />

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
                      {analysis.people[0].ssaSuggestedLifeExpectancy} for a{' '}
                      {genderLabel(analysis.people[0].person.gender).toLowerCase()} at age{' '}
                      {analysis.people[0].currentAge.years}. Adjust under Planning assumptions.
                    </p>
                  </div>
                  <div>
                    <strong>Spousal benefits</strong>
                    <p data-testid="methodology-spousal">{spousalMethodologyCopy(analysis)}</p>
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
