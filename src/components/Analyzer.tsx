import { useEffect, useMemo, useState } from 'react';
import { genderLabel } from '../lib/lifeExpectancy';
import type { DollarsMode } from '../lib/dollarsMode';
import type { HouseholdAnalysis } from '../lib/household';
import { BRAND_NAME } from '../lib/brand';
import {
  analyzeIfComplete,
  BLANK_FORM,
  isFormComplete,
  reseedLifeExpectancy,
  suggestedLifeExpectancyFor,
  type AnalyzerFormState,
  type PersonFormFields,
} from '../lib/formState';
import { personLabel } from '../lib/format';
import { downloadPdfReport } from '../lib/printReport';
import { fromShareParams } from '../lib/shareLink';
import {
  widowedErrors,
  type AlreadyClaimedFormFields,
  type DeceasedFormFields,
} from '../lib/widowedForm';
import { AboutPanel } from './AboutPanel';
import { AssumptionsPanel } from './AssumptionsPanel';
import { DeceasedFields } from './DeceasedFields';
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
  const [maritalStatus, setMaritalStatus] = useState<AnalyzerFormState['maritalStatus']>(
    initialForm.maritalStatus,
  );
  const [deceased, setDeceased] = useState<DeceasedFormFields>(initialForm.deceased);
  const [alreadyClaimed, setAlreadyClaimed] = useState<AlreadyClaimedFormFields>(
    initialForm.alreadyClaimed,
  );
  const [annualCola, setAnnualCola] = useState(initialForm.annualCola);
  const [discountRate, setDiscountRate] = useState(initialForm.discountRate);
  const [dollarsMode, setDollarsMode] = useState<DollarsMode>(initialForm.dollarsMode);

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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const form = useMemo<AnalyzerFormState>(
    () => ({
      personA,
      personB,
      maritalStatus,
      deceased,
      alreadyClaimed,
      annualCola,
      discountRate,
      dollarsMode,
    }),
    [
      personA,
      personB,
      maritalStatus,
      deceased,
      alreadyClaimed,
      annualCola,
      discountRate,
      dollarsMode,
    ],
  );

  // ONE wall-clock read for this component, threaded through every
  // date-dependent call below. `isFormComplete` and `widowedErrors` each read
  // `new Date()` independently before this, so the completeness gate and the
  // errors on screen could disagree across a month boundary: a death date in
  // the current month is valid, the same date read a month earlier is not.
  // Memoised rather than recomputed per render so the two can never diverge
  // mid-render either.
  const asOf = useMemo(() => new Date(), []);

  const inputsComplete = isFormComplete(form, asOf);

  // The ssa.tools engine (benefits, optimal filing, expected PV) does not depend
  // on the chart-only COLA slider, so we intentionally exclude `annualCola` from
  // the dependencies below. On-screen break-even lines that DO use COLA are
  // recomputed cheaply from `analysis.people[0].claimingOptions` where they're
  // needed (see `HouseholdPanel`); the PDF export instead uses the analysis's
  // own baked-in `assumptions.annualCola`, since it's a point-in-time snapshot.
  // `dollarsMode` is excluded for the same reason: it's a pure display
  // transform (`lib/dollarsMode.ts`) applied on top of `analysis.combinedTimeline`
  // in `HouseholdPanel`, never sent to the engine.
  useEffect(() => {
    if (!isFormComplete(form, asOf)) {
      setAnalysis(null);
      setAnalysisError(null);
      setAnalyzing(false);
      return;
    }

    let cancelled = false;
    setAnalyzing(true);
    setAnalysisError(null);

    analyzeIfComplete(form, asOf)
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
  }, [personA, personB, maritalStatus, deceased, alreadyClaimed, discountRate, asOf]);

  // Re-seeds the suggested life expectancy only when the identity inputs
  // (date of birth, gender) actually changed — not on every edit to a
  // person's fields. Without this guard, an adviser-set life expectancy was
  // silently overwritten by an unrelated correction (e.g. fixing a benefit
  // amount or a name), moving every lifetime total with nothing on screen
  // saying so. Applies to both people; the bug predates this branch for
  // person A but is fixed here too rather than leaving an asymmetry.
  function handlePersonAChange(next: PersonFormFields) {
    setPersonA(reseedLifeExpectancy(personA, next));
  }

  function handlePersonBChange(next: PersonFormFields) {
    setPersonB(reseedLifeExpectancy(personB, next));
  }

  const lifeExpectancies = [
    {
      label: personLabel(personA.name, 0),
      value: personA.lifeExpectancy,
      onChange: (v: number) => setPersonA({ ...personA, lifeExpectancy: v }),
      ssaSuggested: suggestedLifeExpectancyFor(personA),
      gender: personA.gender,
    },
    ...(maritalStatus === 'married'
      ? [
          {
            label: personLabel(personB.name, 1),
            value: personB.lifeExpectancy,
            onChange: (v: number) => setPersonB({ ...personB, lifeExpectancy: v }),
            ssaSuggested: suggestedLifeExpectancyFor(personB),
            gender: personB.gender,
          },
        ]
      : []),
  ];

  function handleMaritalChange(status: 'single' | 'married' | 'widowed') {
    setMaritalStatus(status);
  }

  // `widowedErrors` needs a complete `{year, month}` for the survivor
  // (person A). Their birth fields may still be blank while the adviser is
  // typing, so this guards the call rather than passing a partial date —
  // no errors is the honest answer for an incomplete form, not a crash.
  const deceasedErrors =
    maritalStatus === 'widowed' && personA.birthYear !== '' && personA.birthMonth !== ''
      ? widowedErrors(
          deceased,
          alreadyClaimed,
          { year: personA.birthYear, month: personA.birthMonth },
          asOf,
        )
      : {};

  // `householdDisplayShape` (in `lib/household.ts`) still throws for a
  // widowed household — deliberately, until Phase 3B-ii-b builds its display.
  // This task makes that status reachable from the UI for the first time
  // (directly, and via a shared link Task 4 already taught to round-trip
  // `m=w`), so every surface that calls it must be checked BEFORE reaching
  // it, not after: `HouseholdView` (main output) and `ReportDocument` (PDF
  // export) both call it unconditionally. Gating on `analysis.status` rather
  // than `maritalStatus` covers the share-link route too — a link can set
  // `maritalStatus` to `'widowed'` and `analysis` still be null (analyzing)
  // or belong to a form the adviser has since edited back to single/married.
  const widowedAnalysisUnavailable = analysis?.status === 'widowed';

  async function handleExportPdf() {
    if (!analysis || analysis.status === 'widowed') return;
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
            onClick={() => setAboutOpen(true)}
            aria-haspopup="dialog"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 7v4.5M8 4.75v.75"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
              />
            </svg>
            About
          </button>
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
            disabled={exporting || !inputsComplete || widowedAnalysisUnavailable}
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
          <CopyLinkButton form={form} disabled={!inputsComplete || widowedAnalysisUnavailable} />
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
              <div
                className="segmented-control marital-status-control"
                role="group"
                aria-label="Marital status"
              >
                <button
                  type="button"
                  className={`segment-btn ${
                    maritalStatus === 'single' ? 'segment-btn-active' : ''
                  }`}
                  onClick={() => handleMaritalChange('single')}
                  aria-pressed={maritalStatus === 'single'}
                >
                  Single
                </button>
                <button
                  type="button"
                  className={`segment-btn ${
                    maritalStatus === 'married' ? 'segment-btn-active' : ''
                  }`}
                  onClick={() => handleMaritalChange('married')}
                  aria-pressed={maritalStatus === 'married'}
                >
                  Married
                </button>
                <button
                  type="button"
                  className={`segment-btn ${
                    maritalStatus === 'widowed' ? 'segment-btn-active' : ''
                  }`}
                  onClick={() => handleMaritalChange('widowed')}
                  aria-pressed={maritalStatus === 'widowed'}
                >
                  Widowed
                </button>
              </div>
              <span className="field-hint">
                Married uses the ssa.tools couple optimizer. Widowed models the survivor
                benefit and your own, claimed on separate dates.
              </span>
            </div>

            {maritalStatus === 'married' && (
              <PersonFields person={personB} index={1} onChange={handlePersonBChange} />
            )}

            {maritalStatus === 'widowed' && (
              <DeceasedFields
                deceased={deceased}
                alreadyClaimed={alreadyClaimed}
                errors={deceasedErrors}
                onDeceasedChange={setDeceased}
                onAlreadyClaimedChange={setAlreadyClaimed}
              />
            )}

            <AssumptionsPanel
              lifeExpectancies={lifeExpectancies}
              annualCola={annualCola}
              onAnnualColaChange={setAnnualCola}
              discountRate={discountRate}
              onDiscountRateChange={setDiscountRate}
              expanded={showAssumptions}
              onToggle={() => setShowAssumptions(!showAssumptions)}
            />
          </div>

          <div className="input-summary">
            <p>
              {inputsComplete && personA.gender ? (
                <>
                  Analyzing <strong>{genderLabel(personA.gender)}</strong>
                  {maritalStatus === 'married'
                    ? ', married (ssa.tools couple)'
                    : maritalStatus === 'widowed'
                      ? ', widowed (survivor + own)'
                      : ', single'}{' '}
                  claimant —
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
          ) : analysis.status === 'widowed' ? (
            // `HouseholdView` calls `householdDisplayShape`, which throws for
            // `'widowed'` on purpose (see `lib/household.ts`) — that guard is
            // not touched here. This branch is what keeps the throw from
            // reaching the user as a blank page: nothing about this household
            // is rendered, not a partial figure and not the single-claimant
            // view, until Phase 3B-ii-b builds the real display.
            <div className="empty-state" data-testid="widowed-analysis-unavailable">
              <div className="empty-state-icon" aria-hidden="true">
                <span />
              </div>
              <h3>Widowed analysis isn&rsquo;t available yet</h3>
              <p>
                This tool doesn&rsquo;t display widowed-household results yet. Nothing is shown
                here — not a partial figure, not your own-record-only view — until that screen
                ships.
              </p>
            </div>
          ) : (
            <>
              <HouseholdView
                analysis={analysis}
                annualCola={annualCola}
                dollarsMode={dollarsMode}
                onDollarsModeChange={setDollarsMode}
              />

              <div className="methodology">
                <h3>This household&rsquo;s spousal benefit</h3>
                <div className="method-grid">
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
      <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <footer className="footer">
        <p>
          Estimates only · Not affiliated with the Social Security Administration · For
          educational planning purposes
        </p>
      </footer>
    </div>
  );
}
