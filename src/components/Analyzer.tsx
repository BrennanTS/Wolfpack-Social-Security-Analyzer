import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DollarsMode } from '../lib/dollarsMode';
import { householdDisplayShape, type HouseholdAnalysis } from '../lib/household';
import type { LongevitySensitivity } from '../lib/longevity';
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
import { downloadLegacyPdfReport, downloadPdfReport } from '../lib/printReport';
import {
  buildClaimingRows,
  prefsFor,
  withPrefsFor,
  type ClaimingPrefsByPerson,
  type ClaimingRow,
} from '../lib/claimingRows';
import type { ScenarioSet } from '../lib/scenario';
import { fromShareParams, readViewExtras, toViewParams } from '../lib/shareLink';
import {
  widowedErrors,
  type AlreadyClaimedFormFields,
  type DeceasedFormFields,
} from '../lib/widowedForm';
import { AboutPanel } from './AboutPanel';
import { MenuPanel } from './MenuPanel';
import { LayoutEditorDialog } from './LayoutEditorDialog';
import { ThemeEditorDialog } from './ThemeEditorDialog';
import { useReportThemes } from '../hooks/useReportThemes';
import { useReportLayouts } from '../hooks/useReportLayouts';
import { useSavedClients } from '../hooks/useSavedClients';
import { ClientsDialog } from './ClientsDialog';
import { suggestedClientLabel } from '../lib/clientRecord';
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
  const [initialParams] = useState(() =>
    typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search),
  );
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
  const [exportingReport, setExportingReport] = useState(false);
  const savedClients = useSavedClients();
  const [clientsOpen, setClientsOpen] = useState(false);
  /**
   * The saved client on screen, if the view came from one.
   *
   * Held so "Save" can overwrite the record an adviser opened rather than
   * leaving them with two of the same household and no way to tell which is
   * current.
   */
  const [openClientId, setOpenClientId] = useState<string | null>(null);

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
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  /**
   * The longevity block's data, for the preview.
   *
   * Asynchronous and derived from the form rather than the analysis, so it
   * cannot be computed during a render. Fetched once when the editor opens —
   * not on every keystroke — and passed in so the preview shows the same
   * block the export will rather than silently omitting it.
   */
  const [previewSensitivity, setPreviewSensitivity] = useState<LongevitySensitivity | null>(null);
  const reportThemes = useReportThemes();
  const reportLayouts = useReportLayouts();
  const [showAssumptions, setShowAssumptions] = useState(true);
  const [exportingLegacy, setExportingLegacy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * The theme and layout a view was built with, if this browser has them.
   *
   * Checked rather than selected blind: an id minted for a custom theme in
   * one browser names nothing in another, and selecting it would leave the
   * picker showing a name for something that is not there.
   */
  const applySelections = useCallback(
    (extras: { themeId?: string; layoutId?: string }) => {
      if (extras.themeId !== undefined && reportThemes.themes.some((t) => t.id === extras.themeId)) {
        reportThemes.select(extras.themeId);
      }
      if (
        extras.layoutId !== undefined &&
        reportLayouts.layouts.some((l) => l.id === extras.layoutId)
      ) {
        reportLayouts.select(extras.layoutId);
      }
    },
    [reportThemes, reportLayouts],
  );

  // A link carries the theme and layout it was built with, the same as a
  // saved client does. Applied once, from the parameters captured before the
  // query string above was stripped.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    applySelections(readViewExtras(initialParams));
  }, [applySelections, initialParams]);

  /**
   * Put a saved view back on screen.
   *
   * Through the same parser a shared link goes through, so a stored record
   * written by an older version — or edited by hand — is validated on the way
   * in rather than trusted. Names are set separately: they are deliberately
   * absent from the query string, and they are the reason a saved client is
   * more than a link.
   */
  const applyView = useCallback((params: URLSearchParams) => {
    const next = fromShareParams(params);
    const extras = readViewExtras(params);
    setPersonA(next.personA);
    setPersonB(next.personB);
    setMaritalStatus(next.maritalStatus);
    setDeceased(next.deceased);
    setAlreadyClaimed(next.alreadyClaimed);
    setAnnualCola(next.annualCola);
    setDiscountRate(next.discountRate);
    setDollarsMode(next.dollarsMode);
    setScenarios(next.scenarios);
    setClaimingPrefs(extras.claimingPrefs);
    setGridTarget(extras.gridTarget);
    applySelections(extras);
  }, [applySelections]);

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
  /**
   * Everything on screen that is not the form — shared and saved with it.
   *
   * The theme and layout ride along so a saved client reopens looking the way
   * it was presented, rather than in whatever was last used for someone else.
   */
  const viewExtras = useMemo(
    () => ({
      claimingPrefs,
      gridTarget,
      themeId: reportThemes.selectedId,
      layoutId: reportLayouts.selectedId,
    }),
    [claimingPrefs, gridTarget, reportThemes.selectedId, reportLayouts.selectedId],
  );

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

    let canceled = false;
    setAnalyzing(true);
    setAnalysisError(null);

    analyzeIfComplete(form, asOf)
      .then((next) => {
        if (!canceled) {
          setAnalysis(next);
          setAnalyzing(false);
        }
      })
      .catch(() => {
        if (!canceled) {
          setAnalysis(null);
          setAnalysisError('Analysis failed. Check your inputs and try again.');
          setAnalyzing(false);
        }
      });

    return () => {
      canceled = true;
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

  /** The report as it printed before layouts, now reachable only from the menu. */
  async function handleExportLegacyPdf() {
    if (!analysis) return;
    setExportError(null);
    setExportingLegacy(true);
    try {
      await downloadLegacyPdfReport(analysis, claimingRowsByPerson, gridTarget, reportThemes.theme);
    } catch {
      setExportError('Legacy PDF export failed. Please try again.');
    } finally {
      setExportingLegacy(false);
    }
  }

  /**
   * The report. Its longevity block needs the analysis re-run at other
   * plan-to ages, which is asynchronous and needs the form rather than the
   * finished analysis — so it is computed here, at export, rather than on
   * every keystroke. It costs about 50ms and nothing on screen depends on it.
   */
  async function handleExportPdf() {
    if (!analysis) return;
    setExportError(null);
    setExportingReport(true);
    try {
      const sensitivity = await longevityIfComplete(form, asOf);
      await downloadPdfReport(
        analysis,
        claimingRowsByPerson,
        gridTarget,
        sensitivity,
        reportThemes.theme,
        reportLayouts.layout,
      );
    } catch {
      setExportError('PDF export failed. Please try again.');
    } finally {
      setExportingReport(false);
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
            {/* The firm's own name, which is part of the theme — an adviser
                who has set theirs should see it here as well as on the
                report they hand over. */}
            <span className="brand-sub">{reportThemes.theme.firm}</span>
          </div>
        </div>
        <div className="header-actions">
          <DarkModeToggle active={darkMode} onToggle={onToggleDarkMode} />
          {/* The only export in the header. The legacy report moved into the
              menu — it is on its way out, and an adviser reaching for
              "Export PDF" should land on the report the layout describes
              rather than choose between two buttons a few pixels apart. */}
          <button
            type="button"
            className="btn-export"
            data-testid="export-report"
            onClick={handleExportPdf}
            disabled={!analysis || exportingReport}
          >
            {exportingReport ? 'Generating…' : 'Export PDF'}
          </button>
          <CopyLinkButton
            form={form}
            extras={viewExtras}
            disabled={!inputsComplete}
          />
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
                Enter your date of birth, gender, marital status, and the monthly benefit on
                your Social Security statement to see when to claim.
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
        clientCount={savedClients.clients.length}
        onOpenClients={() => {
          setMenuOpen(false);
          setClientsOpen(true);
        }}
        themes={reportThemes}
        onEditTheme={() => {
          // The drawer steps aside, as it does for the layout editor: the
          // dialog is the same task with more room, not a second thing open
          // on top of the first.
          setMenuOpen(false);
          setThemeEditorOpen(true);
          void longevityIfComplete(form, asOf).then(setPreviewSensitivity);
        }}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenResources={() => setResourcesOpen(true)}
        layouts={reportLayouts}
        shape={analysis ? householdDisplayShape(analysis.status) : undefined}
        onEditLayout={() => {
          // The drawer steps aside: the dialog is the same task with more
          // room, not a second thing open on top of the first.
          setMenuOpen(false);
          setLayoutEditorOpen(true);
          void longevityIfComplete(form, asOf).then(setPreviewSensitivity);
        }}
        onExportLegacy={handleExportLegacyPdf}
        exportingLegacy={exportingLegacy}
        canExport={inputsComplete}
      />
      <ClientsDialog
        open={clientsOpen}
        onClose={() => setClientsOpen(false)}
        clients={savedClients}
        openClientId={openClientId}
        currentView={{
          params: toViewParams(form, viewExtras).toString(),
          suggestedLabel: suggestedClientLabel({
            a: personA.name.trim() || undefined,
            b: maritalStatus === 'married' ? personB.name.trim() || undefined : undefined,
          }),
          complete: inputsComplete,
        }}
        onOpenClient={(client) => {
          applyView(new URLSearchParams(client.params));
          setOpenClientId(client.id);
          setClientsOpen(false);
        }}
        onSaved={setOpenClientId}
      />
      <ThemeEditorDialog
        open={themeEditorOpen}
        onClose={() => setThemeEditorOpen(false)}
        themes={reportThemes}
        preview={
          analysis
            ? {
                analysis,
                claimingRowsByPerson,
                gridTarget,
                sensitivity: previewSensitivity,
                layout: reportLayouts.layout,
              }
            : undefined
        }
      />
      <LayoutEditorDialog
        open={layoutEditorOpen}
        onClose={() => setLayoutEditorOpen(false)}
        layouts={reportLayouts}
        shape={analysis ? householdDisplayShape(analysis.status) : undefined}
        preview={
          analysis
            ? {
                analysis,
                claimingRowsByPerson,
                gridTarget,
                sensitivity: previewSensitivity,
                theme: reportThemes.theme,
              }
            : undefined
        }
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
