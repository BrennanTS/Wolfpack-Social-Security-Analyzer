import { useEffect } from 'react';
import { blockAppliesTo, hiddenBlockIds, layoutBlockIds } from '../lib/reportLayout';
import { disclosureHasPlaceholder } from '../lib/reportTheme';
import type { useReportLayouts } from '../hooks/useReportLayouts';
import type { useReportThemes } from '../hooks/useReportThemes';
import type { HouseholdDisplayShape } from '../lib/household';
import { AppVersion } from './AppVersion';

/** One line naming the chosen layout and how much of it this household gets. */
function summarize(
  layout: ReturnType<typeof useReportLayouts>['layout'],
  shape?: HouseholdDisplayShape,
): string {
  const hiddenIds = new Set(hiddenBlockIds(layout));
  const shown = layoutBlockIds(layout).filter((id) => !hiddenIds.has(id));
  const printed = shape === undefined ? shown : shown.filter((id) => blockAppliesTo(id, shape));
  const hidden = hiddenIds.size;
  const skipped = shown.length - printed.length;
  const count = `${printed.length} section${printed.length === 1 ? '' : 's'}`;
  // Two different reasons a block is in the layout and not in the report, and
  // an adviser looking at a short report needs to know which one applies.
  const notes = [
    hidden > 0 ? `${hidden} hidden` : '',
    skipped > 0 ? `${skipped} not printed for this household` : '',
  ].filter(Boolean);
  return notes.length === 0
    ? `“${layout.name}”: ${count}.`
    : `“${layout.name}”: ${count}; ${notes.join(', ')}.`;
}

interface MenuPanelProps {
  open: boolean;
  onClose: () => void;
  themes: ReturnType<typeof useReportThemes>;
  /** Opens the theme editor, which needs the room the dialog has. */
  onEditTheme: () => void;
  onOpenAbout: () => void;
  onOpenResources: () => void;
  /** The worked households this analysis is tested against. */
  onOpenValidation: () => void;
  layouts: ReturnType<typeof useReportLayouts>;
  /** Opens the layout editor, which needs more room than this drawer has. */
  onEditLayout: () => void;
  /** The household on screen, so the editor can flag blocks it will skip. */
  shape?: HouseholdDisplayShape;
}

/**
 * The right-hand menu.
 *
 * The header had grown to seven controls of four different kinds — two
 * exports, a link copier, a mode toggle, two panels and a version string —
 * which left the two things an adviser actually reaches for competing with
 * five things they touch once a month. What moved in here is everything read
 * rarely; what stayed out is everything reached for during a meeting.
 *
 * The theme and the layout live here rather than beside the export buttons
 * because both are set once for a firm and then left alone. Sitting next to
 * Export they would read as per-export choices. The client list went the
 * other way for the same reason: it is opened between meetings, so it is in
 * the header where it can be reached without opening anything first.
 */
export function MenuPanel({
  open,
  onClose,
  themes,
  onEditTheme,
  onOpenAbout,
  onOpenResources,
  onOpenValidation,
  layouts,
  shape,
  onEditLayout,
}: MenuPanelProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="drawer-backdrop drawer-backdrop-menu"
        onClick={onClose}
        aria-label="Close menu"
      />

      {/* Named by `aria-label` rather than a heading: the two lines that were
          here told a reader who had just pressed the menu button that they had
          pressed the menu button, and cost the sections below them a screenful
          on a laptop. */}
      <aside className="resources-panel menu-panel is-open" aria-label="Menu">
        <header className="resources-header resources-header-bare">
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
            <h3>Reports</h3>
            {/* First, and above the theme: what the report CONTAINS is the
                choice an adviser revisits per household, and the colors it is
                printed in is the one they set for the firm and leave alone. */}
            <p className="menu-note">
              Sets what the exported PDF contains. {summarize(layouts.layout, shape)}
            </p>
            <button type="button" className="menu-action" onClick={onEditLayout}>
              Edit layout…
            </button>
          </section>

          <section className="resources-section">
            <h3>Theme</h3>
            {/* The picker sits here rather than only in the editor: switching
                between a firm's themes is one choice, and it was three clicks
                and a dialog deep. The swatches beside it are the only honest
                preview available — these are print colors, and the panel
                around them may be in dark mode. */}
            <div className="menu-theme-pick">
              <select
                id="menu-theme"
                className="menu-theme-select"
                aria-label="Report theme"
                value={themes.selectedId}
                onChange={(event) => themes.select(event.target.value)}
              >
                {themes.themes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <span className="theme-swatches" aria-hidden="true">
                <span className="theme-swatch" style={{ background: themes.theme.brand }} />
                <span className="theme-swatch" style={{ background: themes.theme.heatLo }} />
                <span className="theme-swatch" style={{ background: themes.theme.heatHi }} />
                <span className="theme-swatch" style={{ background: themes.theme.ink }} />
              </span>
            </div>
            {/* Named as affecting the report, not the app, because it does not
                touch the app — an adviser who picks Mono and sees the screen
                unchanged should find that unsurprising rather than broken. */}
            <p className="menu-note">
              Prints {themes.theme.firm}. Applies to the exported PDF; the app keeps its own
              appearance, including dark mode.
            </p>
            {/* The one thing the theme can be quietly wrong about. Said here,
                where an adviser looks before exporting, as well as in the
                editor where the text is. */}
            {disclosureHasPlaceholder(themes.theme.disclosure) && (
              <p className="menu-note menu-note-warning" role="status">
                The disclosures still carry the placeholder for your firm’s regulatory
                wording. It is left off the report until it is replaced.
              </p>
            )}
            <button type="button" className="menu-action" onClick={onEditTheme}>
              Edit theme…
            </button>
          </section>

          <section className="resources-section">
            <h3>Reference</h3>
            <div className="menu-links">
              <button
                type="button"
                className="menu-link"
                onClick={() => {
                  // The menu closes as the panel it opened takes its place:
                  // both render at the same fixed position and z-index, so
                  // leaving it open would stack them.
                  onClose();
                  onOpenAbout();
                }}
              >
                About this analysis
              </button>
              <button
                type="button"
                className="menu-link"
                onClick={() => {
                  onClose();
                  onOpenResources();
                }}
              >
                Resources
              </button>
              <button
                type="button"
                className="menu-link"
                onClick={() => {
                  onClose();
                  onOpenValidation();
                }}
              >
                How this is checked
              </button>
            </div>
          </section>
        </div>

        <footer className="menu-footer">
          <AppVersion />
        </footer>
      </aside>
    </>
  );
}
