import { useEffect } from 'react';
import { RESOURCE_SECTIONS } from '../lib/resources';

interface ResourcesPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ResourcesPanel({ open, onClose }: ResourcesPanelProps) {
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
        className="drawer-backdrop drawer-backdrop-resources"
        onClick={onClose}
        aria-label="Close resources panel"
      />

      <aside className="resources-panel is-open" aria-labelledby="resources-title">
        <header className="resources-header">
          <div>
            <h2 id="resources-title">Resources</h2>
            <p>Official SSA tools, ssa.tools, and planning references.</p>
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
          {RESOURCE_SECTIONS.map((section) => (
            <section key={section.title} className="resources-section">
              <h3>{section.title}</h3>
              <ul className="resources-list">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} target="_blank" rel="noopener noreferrer">
                      <span className="resource-title">{link.title}</span>
                      <span className="resource-desc">{link.description}</span>
                      <span className="resource-external" aria-hidden="true">
                        ↗
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="resources-footer">
          <p>
            Links open in a new tab. This app is not affiliated with the Social Security
            Administration.
          </p>
        </footer>
      </aside>
    </>
  );
}
