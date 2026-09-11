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
import {
  chartsFor,
  toggleChart,
  withChartsFor,
  type ChartsByPerson,
} from '../lib/chartVisibility';
import { downloadPdfReport } from '../lib/printReport';
import {
  buildClaimingRows,
  prefsFor,
  withPrefsFor,
  type ClaimingPrefsByPerson,
  type ClaimingRow,
} from '../lib/claimingRows';
import type { ScenarioSet } from '../lib/scenario';
import { fromShareParams, readViewExtras, toViewParams } from '../lib/shareLink';
import { clearCurrentView, readCurrentView, writeCurrentView } from '../lib/currentView';
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
import { ConfirmDialog } from './ConfirmDialog';
import { namesFromParams, suggestedClientLabel } from '../lib/clientRecord';
import { AssumptionsPanel } from './AssumptionsPanel';
import { DeceasedFields } from './DeceasedFields';
import { HouseholdView } from './HouseholdView';
import { DEFAULT_TARGET_RANGE, type TargetRange } from './ClaimingGridPanel';
import {
  DEFAULT_SOLVENCY,
  solvencySensitivity,
  type SolvencyAssumption,
} from '../lib/solvency';
import { PersonFields } from './PersonFields';
import { DarkModeToggle } from './DarkModeToggle';
import { ResourcesPanel } from './ResourcesPanel';
import { ValidationPanel } from './ValidationPanel';
import { SettingsDrawer, SettingsDrawerToggle } from './SettingsDrawer';
import { CopyLinkButton } from './CopyLinkButton';
import { spousalMethodologyCopy } from './methodologyCopy';

interface AnalyzerProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

/**
 * What to call the household in a question about losing it.
 *
 * Their names where there are any, because that is what makes the question
 * answerable — "Priya has not been saved" is a fact about someone, where "the
 * household on screen" is a fact about the app.
 */
function describeHousehold(
  a: PersonFormFields,
  b: PersonFormFields,
  status: AnalyzerFormState['maritalStatus'],
): string {
  const names = [a.name.trim(), status === 'married' ? b.name.trim() : ''].filter(
    (name) => name !== '',
  );
  if (names.length === 0) return 'The household on screen';
  return names.join(' and ');
}

export function Analyzer({ darkMode, onToggleDarkMode }: AnalyzerProps) {
  // Parse once, before first paint. A lazy initializer rather than an effect:
  // an effect would paint the blank form first and then replace it, flickering
  // and briefly running an analysis on empty inputs. Reading `location.search`
  // is a read, so it's safe under StrictMode's double-invocation.
  /**
   * Where this session starts: a shared link, or the household this browser
   * was last showing.
   *
   * A link wins outright — two people opening one must see one analysis — and
   * only when there is none does the remembered view apply. That view exists
   * because the query string is stripped on arrival, which used to mean a
   * reload emptied the form; see `currentView` for what it stores.
   */
  const [initialParams] = useState(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    const fromUrl = new URLSearchParams(window.location.search);
    if ([...fromUrl.keys()].length > 0) return fromUrl;
    return new URLSearchParams(readCurrentView()?.params ?? '');
  });
  const [initialForm] = useState(() => {
    if (typeof window === 'undefined') return BLANK_FORM;
    const params = initialParams;
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
  const [claimingPrefs, setClaimingPrefs] = useState<ClaimingPrefsByPerson>(
    () => readViewExtras(initialParams).claimingPrefs,
  );
  // Which optional charts each person is showing. Held here rather than in
  // `PersonPanel`, where it used to live: an adviser who sets up two charts
  // for a meeting should still have them after a refresh, in a link they
  // copy, and in the client they save. Display state like the rows above, so
  // it stays outside `form` and outside the analysis effect.
  const [charts, setCharts] = useState<ChartsByPerson>(
    () => readViewExtras(initialParams).charts,
  );
  // Held here, not in `ClaimingGridPanel`, so the exported report prints the
  // near-best region the adviser was looking at rather than the default.
  const [gridTarget, setGridTarget] = useState<TargetRange>(
    () => readViewExtras(initialParams).gridTarget,
  );
  const [exportingReport, setExportingReport] = useState(false);
  /**
   * The benefit reduction the "what if benefits are reduced" page prices.
   *
   * The trustees' own projection until an adviser changes it. Not part of
   * `Assumptions`: it reaches no engine call, and putting it there would
   * re-run the optimizer on a number the optimizer cannot use.
   */
  const [solvency, setSolvency] = useState<SolvencyAssumption>(
    () => readViewExtras(initialParams).solvency ?? DEFAULT_SOLVENCY,
  );
  const savedClients = useSavedClients();
  const [clientsOpen, setClientsOpen] = useState(false);
  /**
   * The saved client on screen, if the view came from one.
   *
   * Held so "Save" can overwrite the record an adviser opened rather than
   * leaving them with two of the same household and no way to tell which is
   * current.
   */
  const [openClientId, setOpenClientId] = useState<string | null>(() => {
    // Only when the view came from storage: a link is somebody else's view,
    // and "Update open" must not point at a record it did not come from.
    if (typeof window === 'undefined') return null;
    if (window.location.search !== '') return null;
    return readCurrentView()?.openClientId ?? null;
  });

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
  const [validationOpen, setValidationOpen] = useState(false);
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
    setCharts(extras.charts);
    setGridTarget(extras.gridTarget);
    setSolvency(extras.solvency ?? DEFAULT_SOLVENCY);
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
   * Every strategy priced against the reduction, for the report block.
   *
   * Memoized on the analysis and the assumption: it rebuilds the bands for
   * every comparison row, which is the same work `withSurvivorIncome` does
   * and not work to repeat on a keystroke.
   */
  const solvencyPricing = useMemo(
    () => (analysis ? solvencySensitivity(analysis, solvency) : null),
    [analysis, solvency],
  );

  /**
   * Everything on screen that is not the form — shared and saved with it.
   *
   * The theme and layout ride along so a saved client reopens looking the way
   * it was presented, rather than in whatever was last used for someone else.
   */
  const viewExtras = useMemo(
    () => ({
      claimingPrefs,
      charts,
      gridTarget,
      solvency,
      themeId: reportThemes.selectedId,
      layoutId: reportLayouts.selectedId,
    }),
    [claimingPrefs, charts, gridTarget, solvency, reportThemes.selectedId, reportLayouts.selectedId],
  );

  /** The whole view as a query string — what is shared, saved and remembered. */
  const currentParams = useMemo(
    () => toViewParams(form, viewExtras).toString(),
    [form, viewExtras],
  );

  /**
   * Whether there is a household on screen at all.
   *
   * A date of birth, a benefit, a name or a marital status is enough — those
   * are the four things an adviser types first, and any of them means the
   * form is no longer the one the app opened with.
   */
  const hasHousehold =
    personA.birthYear !== '' ||
    personA.monthlyBenefit !== '' ||
    personA.name.trim() !== '' ||
    maritalStatus !== null;

  useEffect(() => {
    // Remembered on every edit rather than on a timer: the point is to
    // survive a refresh nobody planned, and the cost is one small write.
    //
    // An empty form is remembered as nothing rather than as a view of its
    // own. Written, it would be restored on the next visit in place of the
    // plan-to ages this browser had learned — the reader would get a blank
    // form with somebody's default horizon instead of their own.
    if (hasHousehold) writeCurrentView({ params: currentParams, openClientId });
    else clearCurrentView();
  }, [currentParams, openClientId, hasHousehold]);

  /**
   * Back to an empty form, for the next household.
   *
   * Necessary rather than a nicety: a refresh used to be how an adviser got
   * here, and remembering the view across one takes that away.
   */
  const [confirmNew, setConfirmNew] = useState(false);

  const startNewClient = useCallback(() => {
    setPersonA(BLANK_FORM.personA);
    setPersonB(BLANK_FORM.personB);
    setMaritalStatus(BLANK_FORM.maritalStatus);
    setDeceased(BLANK_FORM.deceased);
    setAlreadyClaimed(BLANK_FORM.alreadyClaimed);
    setAnnualCola(BLANK_FORM.annualCola);
    setDiscountRate(BLANK_FORM.discountRate);
    setDollarsMode(BLANK_FORM.dollarsMode);
    setScenarios(BLANK_FORM.scenarios);
    setClaimingPrefs({});
    setCharts({});
    setGridTarget(DEFAULT_TARGET_RANGE);
    setSolvency(DEFAULT_SOLVENCY);
    setOpenClientId(null);
    clearCurrentView();
    setConfirmNew(false);
  }, []);

  /**
   * Whether clearing would lose anything.
   *
   * False when the view came from a saved record and still matches it, which
   * is the case where a confirmation would be asking about nothing. A prompt
   * that appears every time gets clicked through without being read.
   */
  const openRecord = savedClients.clients.find((c) => c.id === openClientId);
  const unsavedChanges = openRecord === undefined || openRecord.params !== currentParams;

  /** Clear, or ask first — see `unsavedChanges` for when it asks. */
  const requestNewClient = useCallback(() => {
    if (!hasHousehold) return;
    if (!unsavedChanges) {
      startNewClient();
      return;
    }
    setConfirmNew(true);
  }, [hasHousehold, unsavedChanges, startNewClient]);

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
      await downloadPdfReport({
        analysis,
        claimingRowsByPerson,
        gridTarget,
        sensitivity,
        solvency: solvencyPricing,
        theme: reportThemes.theme,
        layout: reportLayouts.layout,
      });
    } catch {
      setExportError('PDF export failed. Please try again.');
    } finally {
      setExportingReport(false);
    }
  }

  /**
   * The header's real height, published as `--header-h`.
   *
   * The token was a constant, and the header is not: below 600px it wraps to
   * two rows and stands 98px rather than 64. Everything positioned against it
   * was therefore wrong on a phone — the settings drawer started 34px under
   * it, and `scroll-padding-top` left too little room, so tapping a household
   * tab scrolled it neatly beneath the header.
   *
   * Measured rather than guessed at a second breakpoint, because the height
   * depends on how the actions wrap, which depends on their text. The CSS
   * keeps 64px as its own value, so a browser without `ResizeObserver` and
   * the moment before this runs both get the desktop height.
   */
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const publish = () => {
      document.documentElement.style.setProperty(
        '--header-h',
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`analyzer${settingsOpen ? ' settings-open' : ''}`}>
      <header className="header" ref={headerRef}>
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
          {/* In the header rather than in the menu: this is the first thing an
              adviser reaches for when the next household walks in, and behind
              the menu button it was two clicks and a drawer away. The count
              is on the button so the drawer's line about it is not missed. */}
          <button
            type="button"
            className="btn-ghost btn-clients"
            onClick={() => setClientsOpen(true)}
            aria-haspopup="dialog"
          >
            Clients
            {savedClients.clients.length > 0 && (
              <span className="btn-count">{savedClients.clients.length}</span>
            )}
          </button>
          {/* The only export anywhere. An adviser reaching for "Export PDF"
              lands on the report the adviser's own layout describes. */}
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
          {/* Beside the heading rather than in a menu: this is where an
              adviser is looking when the next household walks in, and from
              the client list it is three clicks away. */}
          <div className="input-panel-head">
            <h2 id="settings-title">Your Information</h2>
            <button
              type="button"
              className="btn-new-client"
              onClick={requestNewClient}
              disabled={!hasHousehold}
              title={hasHousehold ? undefined : 'The form is already empty'}
            >
              New client
            </button>
          </div>
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
              solvency={solvency}
              onSolvencyChange={setSolvency}
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
                charts={charts}
                onChartToggle={(personId, key) =>
                  setCharts(
                    withChartsFor(charts, personId, toggleChart(chartsFor(charts, personId), key)),
                  )
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
      <ValidationPanel open={validationOpen} onClose={() => setValidationOpen(false)} />
      <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <MenuPanel
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
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
        onOpenValidation={() => setValidationOpen(true)}
        layouts={reportLayouts}
        shape={analysis ? householdDisplayShape(analysis.status) : undefined}
        onEditLayout={() => {
          // The drawer steps aside: the dialog is the same task with more
          // room, not a second thing open on top of the first.
          setMenuOpen(false);
          setLayoutEditorOpen(true);
          void longevityIfComplete(form, asOf).then(setPreviewSensitivity);
        }}
      />
      <ClientsDialog
        open={clientsOpen}
        onClose={() => setClientsOpen(false)}
        clients={savedClients}
        openClientId={openClientId}
        onNewClient={() => {
          // The dialog steps aside first: the question is about what is on
          // screen behind it, and two overlays deep is no way to read one.
          setClientsOpen(false);
          requestNewClient();
        }}
        canStartNew={hasHousehold}
        currentView={{
          params: currentParams,
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
      <ConfirmDialog
        open={confirmNew}
        title="Start a new client?"
        body={`${describeHousehold(personA, personB, maritalStatus)} ${
          openRecord === undefined
            ? 'has not been saved'
            : 'has changes that are not saved'
        }. Starting a new one clears the form.`}
        onCancel={() => setConfirmNew(false)}
        choices={[
          {
            label: 'Save, then start new',
            primary: true,
            onChoose: () => {
              const label = suggestedClientLabel({
                a: personA.name.trim() || undefined,
                b: maritalStatus === 'married' ? personB.name.trim() || undefined : undefined,
              });
              if (openRecord === undefined) {
                savedClients.save({ label, names: namesFromParams(currentParams), params: currentParams });
              } else {
                savedClients.update(openRecord.id, {
                  label: openRecord.label,
                  names: namesFromParams(currentParams),
                  params: currentParams,
                });
              }
              startNewClient();
            },
          },
          { label: 'Discard and start new', onChoose: startNewClient },
        ]}
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
                solvency: solvencyPricing,
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
                solvency: solvencyPricing,
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
