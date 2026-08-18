import { useEffect } from 'react';
import { ABOUT_CARDS, ABOUT_INTRO, ENGINE_ATTRIBUTION } from '../lib/about';
import { BLS_CPI_URL, formatPercent, getCpiLast30Years } from '../lib/cpiHistory';
import { AppVersion } from './AppVersion';

interface AboutPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AboutPanel({ open, onClose }: AboutPanelProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const cpi = getCpiLast30Years();
  const linkIndex = ENGINE_ATTRIBUTION.body.indexOf(ENGINE_ATTRIBUTION.linkText);
  const linkEnd = linkIndex + ENGINE_ATTRIBUTION.linkText.length;
  const engineBodyBefore = ENGINE_ATTRIBUTION.body.slice(0, linkIndex);
  const engineBodyAfter = ENGINE_ATTRIBUTION.body.slice(linkEnd);

  return (
    <>
      <button
        type="button"
        className="drawer-backdrop drawer-backdrop-about"
        onClick={onClose}
        aria-label="Dismiss about panel"
      />

      <aside className="resources-panel is-open" aria-labelledby="about-title">
        <header className="resources-header">
          <div>
            <h2 id="about-title">About</h2>
            <p>How this tool works, and where its numbers come from.</p>
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
          <p>{ABOUT_INTRO}</p>

          <section className="resources-section">
            <h3>How This Works</h3>
            <div className="method-grid">
              {ABOUT_CARDS.map((card) => (
                <div key={card.title}>
                  <h4>{card.title}</h4>
                  <p>{card.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="resources-section">
            <h3>{ENGINE_ATTRIBUTION.title}</h3>
            <p>
              {engineBodyBefore}
              <a href={ENGINE_ATTRIBUTION.href} target="_blank" rel="noopener noreferrer">
                {ENGINE_ATTRIBUTION.linkText}
              </a>
              {engineBodyAfter}
            </p>
          </section>

          <div className="cpi-history">
            <h3>BLS CPI-U — Last 30 Years</h3>
            <p className="cpi-source">
              Annual inflation from the{' '}
              <a href={BLS_CPI_URL} target="_blank" rel="noopener noreferrer">
                U.S. Bureau of Labor Statistics CPI-U
              </a>{' '}
              ({cpi.startYear}–{cpi.endYear}, December-to-December).
            </p>

            <div className="cpi-stats">
              <div className="cpi-stat">
                <span className="cpi-stat-value">{formatPercent(cpi.arithmeticMean, 2)}</span>
                <span className="cpi-stat-label">30-yr average</span>
              </div>
              <div className="cpi-stat">
                <span className="cpi-stat-value">{formatPercent(cpi.geometricMean, 2)}</span>
                <span className="cpi-stat-label">Compound avg</span>
              </div>
              <div className="cpi-stat">
                <span className="cpi-stat-value">
                  {formatPercent(cpi.min, 1)} – {formatPercent(cpi.max, 1)}
                </span>
                <span className="cpi-stat-label">Range</span>
              </div>
            </div>

            <div className="cpi-table-wrap">
              <table className="cpi-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>CPI-U</th>
                    <th>Year</th>
                    <th>CPI-U</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Math.ceil(cpi.years.length / 2) }, (_, i) => {
                    const left = cpi.years[i];
                    const right = cpi.years[i + Math.ceil(cpi.years.length / 2)];
                    return (
                      <tr key={left.year}>
                        <td>{left.year}</td>
                        <td>{formatPercent(left.rate, 1)}</td>
                        <td>{right?.year ?? ''}</td>
                        <td>{right ? formatPercent(right.rate, 1) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <footer className="resources-footer">
          <AppVersion />
        </footer>
      </aside>
    </>
  );
}
