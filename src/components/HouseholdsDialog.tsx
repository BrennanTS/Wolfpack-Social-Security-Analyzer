import { useEffect, useRef } from 'react';
import {
  checkOnSsaToolsUrl,
  claimAges,
  VALIDATION_SCENARIOS,
  type ValidationScenario,
} from '../lib/validationSummary';
import { formatCurrency } from '../lib/format';
import { usePageScrollLock } from '../hooks/usePageScrollLock';

interface HouseholdsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The worked households, as a table.
 *
 * This was a stack of cards in the 440px reference drawer, where every
 * household needed four wrapped lines and thirty-two of them could not be
 * compared with each other at all — which is the only thing a reader of this
 * list is doing. A table across the middle of the screen puts the claiming
 * ages in columns, so a reader can run down one and see the reduction and the
 * credit behave.
 *
 * Figures are whole dollars: six columns of `.00` on thirty-two rows is a lot
 * of ink spent saying nothing, and every pinned figure is a whole dollar
 * anyway. `validationSummary.test.ts` fails if one stops being — rounding a
 * figure that HAS cents would print a number that does not match the
 * ssa.tools page the link beside it opens.
 *
 * The claiming-age columns are read from the data rather than written here:
 * the summary is generated from the golden fixtures, and a panel that names
 * ages the fixtures no longer pin is exactly the failure this file's source
 * (`lib/validationSummary`) exists to prevent.
 */
export function HouseholdsDialog({ open, onClose }: HouseholdsDialogProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Stopped here rather than left to bubble: the panel that opened this
        // dialog is still behind it and listens for Escape too, and one press
        // closing both would take the reader two steps back.
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  usePageScrollLock(open);

  if (!open) return null;

  const ages = claimAges();

  return (
    <>
      <button
        type="button"
        className="drawer-backdrop drawer-backdrop-dialog"
        onClick={onClose}
        aria-label="Close the household list"
      />
      <div
        className="layout-dialog households-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="households-dialog-title"
        ref={panel}
        tabIndex={-1}
      >
        <header className="layout-dialog-header">
          <div>
            <h2 id="households-dialog-title">Worked households</h2>
            <p>
              Every household this app checks its benefit figures against. Monthly figures are
              for the first person named. Follow a link to enter the same person into ssa.tools
              and compare: it opens with the figures already filled in.
            </p>
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

        <div className="households-body">
          <table className="households-table">
            <thead>
              <tr>
                <th scope="col">Household</th>
                <th scope="col">Benefit at full retirement age</th>
                <th scope="col">Full retirement age</th>
                {ages.map((age) => (
                  <th scope="col" className="households-figure" key={age}>
                    At {age}
                  </th>
                ))}
                <th scope="col">
                  <span className="visually-hidden">Check on ssa.tools</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {VALIDATION_SCENARIOS.map((scenario) => (
                <ScenarioRow key={scenario.id} scenario={scenario} ages={ages} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** One worked household: who they are, what it pins, and where to check it. */
function ScenarioRow({ scenario, ages }: { scenario: ValidationScenario; ages: number[] }) {
  return (
    <tr>
      <th scope="row">{scenario.label}</th>
      {/* Both people, for a couple. Two married households pin the same first
          earner and differ only in the second, so naming one would print two
          rows identical in every column. */}
      <td>{scenario.people.map((p) => formatCurrency(p.piaMonthly)).join(' and ')}</td>
      <td>{scenario.fra.join(' and ')}</td>
      {ages.map((age) => {
        const amount = scenario.monthly[String(age)];
        return (
          <td className="households-figure" key={age}>
            {amount === undefined ? 'not pinned' : `${formatCurrency(amount)}/mo`}
          </td>
        );
      })}
      <td>
        <a
          className="validation-check"
          href={checkOnSsaToolsUrl(scenario)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Check on ssa.tools <span aria-hidden="true">&#8599;</span>
        </a>
      </td>
    </tr>
  );
}
