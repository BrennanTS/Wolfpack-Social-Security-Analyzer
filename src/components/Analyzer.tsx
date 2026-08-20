import { useEffect, useMemo, useState } from 'react';
import type { DollarsMode } from '../lib/dollarsMode';
import type { HouseholdAnalysis } from '../lib/household';
import { BRAND_NAME } from '../lib/brand';
import {
  analyzeIfComplete,
  longevityIfComplete,
  BLANK_FORM,
  isFormComplete,
  reseedLifeExpectancy,
  suggestedLifeExpectancyFor,
  type AnalyzerFormState,
  type PersonFormFields,
} from '../lib/formState';
import { personLabel } from '../lib/format';
import { DEFAULT_PLAN_TO_AGE } from '../lib/formBounds';
import { readPlanToAges, writePlanToAge } from '../lib/planToAgeStore';
import { downloadBetaPdfReport, downloadPdfReport } from '../lib/printReport';
import {
  buildClaimingRows,
  prefsFor,
  withPrefsFor,
  type ClaimingPrefsByPerson,
  type ClaimingRow,
} from '../lib/claimingRows';
import type { ScenarioSet } from '../lib/scenario';
import { fromShareParams } from '../lib/shareLink';
import {
  widowedErrors,
  type AlreadyClaimedFormFields,
  type DeceasedFormFields,
} from '../lib/widowedForm';
import { AboutPanel } from './AboutPanel';
import { MenuPanel } from './MenuPanel';
import { useReportTheme } from '../hooks/useReportTheme';
import { AssumptionsPanel } from './AssumptionsPanel';
import { DeceasedFields } from './DeceasedFields';
import { HouseholdView } from './HouseholdView';
import { DEFAULT_TARGET_RANGE, type TargetRange } from './ClaimingGridPanel';
import { PersonFields } from './PersonFields';
import { DarkModeToggle } from './DarkModeToggle';
import { ResourcesPanel } from './ResourcesPanel';
import { SettingsDrawer, SettingsDrawerToggle } from './SettingsDrawer';
import { CopyLinkButton } from './CopyLinkButton';
import { spousalMethodologyCopy } from './methodologyCopy';

interface AnalyzerProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function Analyzer({ darkMode, onToggleDarkMode }: AnalyzerProps) {
  // Parse once, before first paint. A lazy initializer rather than an effect:
  // an effect would paint the blank form first and then replace it, flickering
  // and briefly running an analysis on empty inputs. Reading `location.search`
  // is a read, so it's safe under StrictMode's double-invocation.
  const [initialForm] = useState(() => {
    if (typeof window === 'undefined') return BLANK_FORM;
    const params = new URLSearchParams(window.location.search);
    // A shared link wins outright — storage is not consulted at all. Two
    // people opening one link must see one analysis, and the plan-to age now
    // drives the recommendation. See `planToAgeStore`.
    if ([...params.keys()].length > 0) return fromShareParams(params);

    const remembered = readPlanToAges();
    return {
      ...BLANK_FORM,
      personA: { ...BLANK_FORM.personA, lifeExpectancy: remembered.a ?? DEFAULT_PLAN_TO_AGE },
      personB: { ...BLANK_FORM.personB, lifeExpectancy: remembered.b ?? DEFAULT_PLAN_TO_AGE },
    };
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
  const [scenarios, setScenarios] = useState<ScenarioSet>(initialForm.scenarios);
  // Which rows each person's benefit-by-claiming-age table shows. Display
  // state, NOT form state: it never reaches the engine, so it is deliberately
  // outside `form` and outside the analysis effect's dependencies — hiding a
  // row must not re-run the optimizer.
  const [claimingPrefs, setClaimingPrefs] = useState<ClaimingPrefsByPerson>({});
  // Held here, not in `ClaimingGridPanel`, so the exported report prints the
  // near-best region the adviser was looking at rather than the default.
  const [gridTarget, setGridTarget] = useState<TargetRange>(DEFAULT_TARGET_RANGE);
  const [exportingBeta, setExportingBeta] = useState(false);

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
  const [menuOpen, setMenuOpen] = useState(false);
  const { themeId, chooseTheme } = useReportTheme();
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
      scenarios,
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
      scenarios,
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
    // `scenarios` IS in this list, unlike `annualCola` and `dollarsMode`
    // above: it changes which filing ages the engine is asked about, so the
    // whole analysis genuinely has to re-run. A full married re-analysis is
    // ~35ms, so no debounce is needed for a dropdown change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personA, personB, maritalStatus, deceased, alreadyClaimed, discountRate, scenarios, asOf]);

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
      // Written here rather than in an effect over the value: this fires only
      // when the adviser MOVES the slider (or adopts the SSA suggestion),
      // never when a link merely showed them someone else's number.
      onChange: (v: number) => {
        writePlanToAge('a', v);
        setPersonA({ ...personA, lifeExpectancy: v });
      },
      ssaSuggested: suggestedLifeExpectancyFor(personA),
      gender: personA.gender,
    },
    ...(maritalStatus === 'married'
      ? [
          {
            label: personLabel(personB.name, 1),
            value: personB.lifeExpectancy,
            onChange: (v: number) => {
              writePlanToAge('b', v);
              setPersonB({ ...personB, lifeExpectancy: v });
            },
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

  // Built ONCE, here, and handed to both the screen and the PDF, so the two
  // surfaces cannot disagree about which rows a person's table has. Keyed by
  // person id rather than by slot, like everything else derived per person.
  const claimingRowsByPerson: Record<string, ClaimingRow[]> = {};
  for (const person of analysis?.people ?? []) {
    claimingRowsByPerson[person.person.id] = buildClaimingRows(
      person,
      prefsFor(claimingPrefs, person.person.id),
      asOf,
    );
  }

  async function handleExportPdf() {
    if (!analysis) return;
    setExportError(null);
    setExporting(true);
    try {
      await downloadPdfReport(analysis, claimingRowsByPerson, gridTarget, themeId);
    } catch {
      setExportError('PDF export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  /**
   * The beta report. Its longevity page needs the analysis re-run at other
   * plan-to ages, which is asynchronous and needs the form rather than the
   * finished analysis — so it is computed here, at export, rather than on
   * every keystroke. It costs about 50ms and nothing on screen depends on it.
   */
  async function handleExportBetaPdf() {
    if (!analysis) return;
    setExportError(null);
    setExportingBeta(true);
    try {
      const sensitivity = await longevityIfComplete(form, asOf);
      await downloadBetaPdfReport(analysis, claimingRowsByPerson, gridTarget, sensitivity, themeId);
    } catch {
      setExportError('Beta PDF export failed. Please try again.');
    } finally {
      setExportingBeta(false);
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
          {/* The beta report, alongside the one it may one day replace.
              Same analysis, same engine, a different document — so an
              adviser can hand a client either without the app changing
              underneath them. Styled identically to it: the two are
              alternatives, not a primary and a fallback. */}
          <button
            type="button"
            className="btn-export"
            data-testid="export-beta"
            onClick={handleExportBetaPdf}
            disabled={!analysis || exportingBeta}
          >
            {exportingBeta ? 'Generating…' : 'Export PDF (beta)'}
          </button>
          <CopyLinkButton form={form} disabled={!inputsComplete} />
          {exportError && <span className="export-error">{exportError}</span>}
          <button
            type="button"
            className="btn-menu"
            onClick={() => {
              setAboutOpen(false);
              setResourcesOpen(false);
              setMenuOpen(true);
            }}
            aria-haspopup="dialog"
            aria-label="Menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2.5 4h11M2.5 8h11M2.5 12h11"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
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
                Married optimizes both filing dates jointly. Widowed models the survivor
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

          {!inputsComplete && (
            <div className="input-summary">
              <p>Complete your profile to generate a personalized claiming analysis.</p>
            </div>
          )}
        </div>
      </SettingsDrawer>

      <main className="main">
        {/* `analyzing && !analysis` rather than `analyzing`: once there IS an
            analysis on screen, a re-run keeps it there rather than replacing
            the whole output with a spinner. A married re-analysis takes about
            35ms, so the spinner was a flash rather than information — and
            unmounting the output on every change reset any state living
            inside it. That is not cosmetic: the scenario editor's own
            open/closed state lives in the comparison table, so editing an age
            dropped the table straight back out of edit mode. The first
            analysis of a session still gets the full empty state, because
            then there is genuinely nothing to look at. */}
        <section className={`output-panel${analyzing ? ' output-panel-busy' : ''}`}>
          {analyzing && !analysis ? (
            <div className="empty-state" data-testid="analysis-loading">
              <div className="empty-state-icon" aria-hidden="true">
                <span />
              </div>
              <h3>Running analysis…</h3>
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
              <HouseholdView
                analysis={analysis}
                annualCola={annualCola}
                dollarsMode={dollarsMode}
                onDollarsModeChange={setDollarsMode}
                scenarios={scenarios}
                onScenariosChange={setScenarios}
                claimingRowsByPerson={claimingRowsByPerson}
                claimingPrefs={claimingPrefs}
                onClaimingPrefsChange={(personId, next) =>
                  setClaimingPrefs(withPrefsFor(claimingPrefs, personId, next))
                }
                gridTarget={gridTarget}
                onGridTargetChange={setGridTarget}
              />

              {/* A widow(er) has no spousal benefit and no living spouse to
                  have one on. `spousalMethodologyCopy` falls back to the
                  single-claimant note, which says survivor benefits are not
                  modeled — the opposite of what this report just showed. */}
              {analysis.status !== 'widowed' && (
              <div className="methodology">
                <h3>This household&rsquo;s spousal benefit</h3>
                <div className="method-grid">
                  <div>
                    {/* No card label here. "Spousal benefits" earned its place
                        when this was a five-card grid; as the only card under a
                        heading that already says "spousal benefit", it says the
                        same word twice in two lines. */}
                    <p data-testid="methodology-spousal">{spousalMethodologyCopy(analysis)}</p>
                  </div>
                </div>
              </div>
              )}
            </>
          )}
        </section>
      </main>

      <ResourcesPanel open={resourcesOpen} onClose={() => setResourcesOpen(false)} />
      <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <MenuPanel
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        themeId={themeId}
        onThemeChange={chooseTheme}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenResources={() => setResourcesOpen(true)}
      />

      <footer className="footer">
        <p>
          Estimates only · Not affiliated with the Social Security Administration · For
          educational planning purposes
        </p>
      </footer>
    </div>
  );
}
