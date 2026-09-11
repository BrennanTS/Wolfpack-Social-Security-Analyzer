import { useEffect, useState } from 'react';
import {
  checkOnSsaToolsUrl,
  scenarioCounts,
  VALIDATION_SCENARIOS,
  type ValidationScenario,
} from '../lib/validationSummary';
import { formatCurrencyPrecise } from '../lib/format';

interface ValidationPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * What this analysis is checked against, said to a non-technical reader.
 *
 * Three layers, because three different people ask: an adviser wants one
 * sentence they can repeat to a client, a careful client wants to see a
 * worked example, and a compliance reviewer wants to follow it to an
 * independent source. So the panel opens as a paragraph, expands to the
 * household list, and each household carries a link to ssa.tools built by the
 * same function the automated cross-check uses.
 *
 * Everything here is generated from the golden fixtures
 * (`lib/validationSummary`), never typed. The claim has to be one the
 * repository can support, and a sentence written by hand is exactly how this
 * app once came to tell readers something that had stopped being true.
 *
 * What it deliberately does NOT say: that the suite passed today, on this
 * machine. A static build cannot know that. It says which households are
 * pinned and to what — a fact about the project, checkable by anyone.
 */
export function ValidationPanel({ open, onClose }: ValidationPanelProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const counts = scenarioCounts();

  return (
    <>
      <button
        type="button"
        className="drawer-backdrop drawer-backdrop-resources"
        onClick={onClose}
        aria-label="Close validation panel"
      />

      <aside className="resources-panel is-open" aria-labelledby="validation-title">
        <header className="resources-header">
          <div>
            <h2 id="validation-title">How this is checked</h2>
            <p>The households this analysis is tested against, and how to verify one yourself.</p>
          </div>
          <button type="button" className="btn-panel-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="resources-body">
          <section className="resources-section">
            <h3>In short</h3>
            <p className="menu-note">
              This app checks its benefit figures against{' '}
              <strong>{counts.total} worked households</strong> every time it is built. Each one
              fixes a date of birth and a benefit amount, and records what Social Security&rsquo;s
              own rules produce for every claiming age from 62 to 70. The same households are
              also compared against <strong>ssa.tools</strong>, an independent open-source
              calculator, and the figures agree to the dollar.
            </p>
            <p className="menu-note">
              That covers {counts.single} single claimants, {counts.married} couples and{' '}
              {counts.widowed} widow(er)s, including the cases that are easy to get wrong: a
              birthday on the 1st of the month, which Social Security reads into the previous
              year, and every full-retirement-age bracket from 1943 onward.
            </p>
            <p className="menu-note menu-note-caveat">
              This describes the worked examples above, not your own figures. Your benefit is
              set by the Social Security Administration when you apply. Nothing here is
              affiliated with or endorsed by SSA.
            </p>
          </section>

          <section className="resources-section">
            <h3>The households</h3>
            <p className="menu-note">
              Each row is a test case. Follow the link to enter the same person into ssa.tools
              and compare — it opens with the figures already filled in.
            </p>
            <button
              type="button"
              className="menu-action"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
            >
              {expanded ? 'Hide the list' : `Show all ${counts.total}`}
            </button>
            {expanded && (
              <ul className="validation-list">
                {VALIDATION_SCENARIOS.map((scenario) => (
                  <ScenarioRow key={scenario.id} scenario={scenario} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

/** One worked household: who they are, what it pins, and where to check it. */
function ScenarioRow({ scenario }: { scenario: ValidationScenario }) {
  const [first] = scenario.people;
  return (
    <li className="validation-row">
      <span className="validation-label">{scenario.label}</span>
      <span className="validation-meta">
        Benefit at full retirement age {formatCurrencyPrecise(first.piaMonthly)} &middot; full
        retirement age {scenario.fra.join(' and ')}
      </span>
      <span className="validation-figures">
        {Object.entries(scenario.monthly).map(([age, amount]) => (
          <span key={age}>
            <span className="validation-age">at {age}</span>{' '}
            {formatCurrencyPrecise(amount)}/mo
          </span>
        ))}
      </span>
      <a
        className="validation-check"
        href={checkOnSsaToolsUrl(scenario)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Check on ssa.tools <span aria-hidden="true">&#8599;</span>
      </a>
    </li>
  );
}
