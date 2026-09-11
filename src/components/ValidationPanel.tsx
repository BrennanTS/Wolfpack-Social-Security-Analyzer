import { useEffect, useState } from 'react';
import { scenarioCounts } from '../lib/validationSummary';
import { HouseholdsDialog } from './HouseholdsDialog';

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
 * independent source. So the panel is a paragraph, and the households behind
 * it open as a table in the middle of the screen, each carrying a link to
 * ssa.tools built by the same function the automated cross-check uses.
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
  const [householdsOpen, setHouseholdsOpen] = useState(false);

  useEffect(() => {
    // While the table is up it owns Escape. This panel is behind it, and one
    // press should close what the reader is looking at, not both.
    if (!open || householdsOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, householdsOpen]);

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
              Each one pins a date of birth and a benefit amount to what Social
              Security&rsquo;s own rules produce at each claiming age.
            </p>
            <button
              type="button"
              className="menu-action"
              onClick={() => setHouseholdsOpen(true)}
              aria-haspopup="dialog"
            >
              Show all {counts.total}
            </button>
          </section>
        </div>
      </aside>

      {/* Over the panel rather than in place of it: thirty-two rows need the
          width of the screen, and the paragraph that introduced them is worth
          still being there when the table closes. */}
      <HouseholdsDialog open={householdsOpen} onClose={() => setHouseholdsOpen(false)} />
    </>
  );
}
