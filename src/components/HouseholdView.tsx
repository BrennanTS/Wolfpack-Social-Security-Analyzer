import { useRef, useState, type KeyboardEvent } from 'react';
import type { DollarsMode } from '../lib/dollarsMode';
import { householdDisplayShape, type HouseholdAnalysis } from '../lib/household';
import { personLabel } from '../lib/format';
import {
  prefsFor,
  type ClaimingPrefsByPerson,
  type ClaimingRow,
  type ClaimingTablePrefs,
} from '../lib/claimingRows';
import type { ScenarioSet } from '../lib/scenario';
import { HouseholdPanel } from './HouseholdPanel';
import { PersonPanel } from './PersonPanel';
import { WidowedPanel } from './WidowedPanel';
import { ClaimingGridPanel, type TargetRange } from './ClaimingGridPanel';

interface HouseholdViewProps {
  analysis: HouseholdAnalysis;
  annualCola: number;
  /**
   * Passed straight through to `HouseholdPanel` — the toggle only exists on
   * the Household tab (the per-person tabs have no combined timeline to
   * toggle). Optional, defaulting to `'real'`, so every existing call site
   * (this component's own tests, written before the toggle existed) keeps
   * working unchanged.
   */
  dollarsMode?: DollarsMode;
  onDollarsModeChange?: (mode: DollarsMode) => void;
  /** Threaded to the comparison table, which is where scenarios are edited. */
  scenarios?: ScenarioSet;
  onScenariosChange?: (scenarios: ScenarioSet) => void;
  /** Each person's benefit-by-claiming-age rows, keyed by person id. */
  claimingRowsByPerson?: Record<string, ClaimingRow[]>;
  claimingPrefs?: ClaimingPrefsByPerson;
  onClaimingPrefsChange?: (personId: string, prefs: ClaimingTablePrefs) => void;
  /** The claiming grid's near-best region — shared so the PDF prints it. */
  gridTarget?: TargetRange;
  onGridTargetChange?: (target: TargetRange) => void;
}

interface TabDef {
  id: string;
  label: string;
}

/**
 * The tab strip a married household sees: Household, then one tab per
 * person, Household selected first. A single claimant never sees a one-tab
 * tab bar — `PersonPanel` renders directly with no `tablist` at all.
 *
 * Full WAI-ARIA tabs pattern: `role="tablist"/"tab"/"tabpanel"`,
 * `aria-selected`, `aria-controls`/`aria-labelledby` pairing, roving
 * tabindex (selected tab is the only one in the Tab order), and Left/Right
 * arrow keys move both selection and focus, wrapping at both ends. Only the
 * active panel is rendered, so exactly one `tabpanel` exists at a time.
 */
export function HouseholdView({
  analysis,
  annualCola,
  dollarsMode = 'real',
  onDollarsModeChange = () => {},
  scenarios,
  onScenariosChange,
  claimingRowsByPerson,
  claimingPrefs,
  onClaimingPrefsChange,
  gridTarget,
  onGridTargetChange,
}: HouseholdViewProps) {
  // Exhaustive rather than `=== 'married'`: a boolean test routed a widowed
  // household into the one-claimant branch below with no compile error and no
  // mention of the survivor benefit. See `householdDisplayShape`.
  const shape = householdDisplayShape(analysis.status);

  const tabs: TabDef[] =
    shape === 'twoClaimants'
      ? [
          { id: 'household', label: 'Household' },
          ...analysis.people.map((p, i) => ({
            id: p.person.id,
            label: personLabel(p.person.name, i),
          })),
          // Last, and only when there is a cross-product to show. A single
          // claimant's grid would be one axis, which is the
          // benefit-by-claiming-age table they already have.
          ...(analysis.claimingGrid ? [{ id: 'grid', label: 'Claiming grid' }] : []),
        ]
      : [];

  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /** The claiming-table props for one person, or none when nothing is wired. */
  function claimingProps(personIndex: number) {
    const personId = analysis.people[personIndex].person.id;
    if (claimingRowsByPerson === undefined || claimingPrefs === undefined) return {};
    return {
      claimingRows: claimingRowsByPerson[personId],
      claimingPrefs: prefsFor(claimingPrefs, personId),
      onClaimingPrefsChange: (next: ClaimingTablePrefs) =>
        onClaimingPrefsChange?.(personId, next),
      filingAgeOptions: analysis.filingAgeOptions[personIndex],
    };
  }

  // One person, but not one benefit — their own record and a survivor benefit
  // on someone else's, claimed on two independent dates. No tab strip: there
  // is one claimant, and the survivor benefit is not a second person.
  if (shape === 'widowed') {
    return (
      <WidowedPanel
        analysis={analysis}
        dollarsMode={dollarsMode}
        onDollarsModeChange={onDollarsModeChange}
      />
    );
  }

  if (shape === 'oneClaimant') {
    return (
      <PersonPanel
        analysis={analysis.people[0]}
        index={0}
        annualCola={annualCola}
        isBest={analysis.scenarioIsBest}
        {...claimingProps(0)}
      />
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next =
      e.key === 'ArrowRight' ? (active + 1) % tabs.length : (active - 1 + tabs.length) % tabs.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  const activeTab = tabs[active];

  return (
    <div className="household-view">
      <div role="tablist" aria-label="Household results" className="household-tabs">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`household-tab-${tab.id}`}
            aria-selected={i === active}
            aria-controls={`household-panel-${tab.id}`}
            tabIndex={i === active ? 0 : -1}
            className={`household-tab${i === active ? ' household-tab-active' : ''}`}
            onClick={() => setActive(i)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`household-panel-${activeTab.id}`}
        aria-labelledby={`household-tab-${activeTab.id}`}
        className="household-tabpanel"
      >
        {activeTab.id === 'grid' ? (
          <ClaimingGridPanel
            analysis={analysis}
            scenarios={scenarios}
            onScenariosChange={onScenariosChange}
            target={gridTarget}
            onTargetChange={onGridTargetChange}
          />
        ) : active === 0 ? (
          <HouseholdPanel
            analysis={analysis}
            annualCola={annualCola}
            dollarsMode={dollarsMode}
            onDollarsModeChange={onDollarsModeChange}
            scenarios={scenarios}
            onScenariosChange={onScenariosChange}
          />
        ) : (
          <PersonPanel
            analysis={analysis.people[active - 1]}
            index={(active - 1) as 0 | 1}
            annualCola={annualCola}
            isBest={analysis.scenarioIsBest}
            {...claimingProps(active - 1)}
          />
        )}
      </div>
    </div>
  );
}
