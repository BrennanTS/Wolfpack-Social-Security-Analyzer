import { useEffect } from 'react';
import { REPORT_THEMES } from '../lib/reportTheme';
import { AppVersion } from './AppVersion';

interface MenuPanelProps {
  open: boolean;
  onClose: () => void;
  themeId: string;
  onThemeChange: (id: string) => void;
  onOpenAbout: () => void;
  onOpenResources: () => void;
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
 * The theme picker lives here rather than beside the export buttons because
 * it is set once for a firm and then left alone. Sitting next to Export it
 * would read as a per-export choice.
 */
export function MenuPanel({
  open,
  onClose,
  themeId,
  onThemeChange,
  onOpenAbout,
  onOpenResources,
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

      <aside className="resources-panel menu-panel is-open" aria-labelledby="menu-title">
        <header className="resources-header">
          <div>
            <h2 id="menu-title">Menu</h2>
            <p>Report appearance and reference material.</p>
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
            <h3>Report theme</h3>
            {/* The colors the PDF is printed in. Named as affecting the
                report, not the app, because it does not touch the app — an
                adviser who picks Mono and sees the screen unchanged should
                find that unsurprising rather than broken. */}
            <p className="menu-note">
              Applies to the exported PDF. The app keeps its own appearance, including dark mode.
            </p>
            <div className="theme-choices" role="radiogroup" aria-label="Report theme">
              {REPORT_THEMES.map((theme) => {
                const selected = theme.id === themeId;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`theme-choice${selected ? ' is-selected' : ''}`}
                    onClick={() => onThemeChange(theme.id)}
                  >
                    <span className="theme-swatches" aria-hidden="true">
                      <span className="theme-swatch" style={{ background: theme.brand }} />
                      <span className="theme-swatch" style={{ background: theme.heatLo }} />
                      <span className="theme-swatch" style={{ background: theme.heatHi }} />
                      <span className="theme-swatch" style={{ background: theme.ink }} />
                    </span>
                    <span className="theme-choice-text">
                      <span className="theme-choice-name">{theme.name}</span>
                      <span className="theme-choice-blurb">{theme.blurb}</span>
                    </span>
                    <span className="theme-choice-tick" aria-hidden="true">
                      {selected ? (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M3.5 8.5l3 3 6-7"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
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
