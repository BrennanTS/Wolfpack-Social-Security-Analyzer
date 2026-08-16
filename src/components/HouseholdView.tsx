import { useRef, useState, type KeyboardEvent } from 'react';
import type { DollarsMode } from '../lib/dollarsMode';
import type { HouseholdAnalysis } from '../lib/household';
import { personLabel } from '../lib/format';
import { HouseholdPanel } from './HouseholdPanel';
import { PersonPanel } from './PersonPanel';

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
}: HouseholdViewProps) {
  const tabs: TabDef[] =
    analysis.status === 'married'
      ? [
          { id: 'household', label: 'Household' },
          ...analysis.people.map((p, i) => ({
            id: p.person.id,
            label: personLabel(p.person.name, i),
          })),
        ]
      : [];

  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (analysis.status !== 'married') {
    return <PersonPanel analysis={analysis.people[0]} index={0} annualCola={annualCola} />;
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
        {active === 0 ? (
          <HouseholdPanel
            analysis={analysis}
            annualCola={annualCola}
            dollarsMode={dollarsMode}
            onDollarsModeChange={onDollarsModeChange}
          />
        ) : (
          <PersonPanel
            analysis={analysis.people[active - 1]}
            index={(active - 1) as 0 | 1}
            annualCola={annualCola}
          />
        )}
      </div>
    </div>
  );
}
