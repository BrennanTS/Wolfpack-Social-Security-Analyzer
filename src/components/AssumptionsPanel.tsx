import {
  BLS_CPI_URL,
  CPI_DEFAULT_COLA,
  formatPercent,
  getCpiLast30Years,
} from '../lib/cpiHistory';
import type { Gender } from '../lib/socialSecurity';
import { genderLabel, SSA_LIFE_TABLE_URL } from '../lib/lifeExpectancy';

interface AssumptionsPanelProps {
  lifeExpectancy: number;
  onLifeExpectancyChange: (value: number) => void;
  annualCola: number;
  onAnnualColaChange: (value: number) => void;
  ssaSuggestedLifeExpectancy: number;
  gender: Gender;
  expanded: boolean;
  onToggle: () => void;
}

export function AssumptionsPanel({
  lifeExpectancy,
  onLifeExpectancyChange,
  annualCola,
  onAnnualColaChange,
  ssaSuggestedLifeExpectancy,
  gender,
  expanded,
  onToggle,
}: AssumptionsPanelProps) {
  const cpi = getCpiLast30Years();
  const usingDefault = Math.abs(annualCola - CPI_DEFAULT_COLA) < 0.05;

  return (
    <div className="assumptions-panel">
      <button
        type="button"
        className="advanced-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {expanded ? '− Hide' : '+ '} Planning assumptions
      </button>

      {expanded && (
        <div className="assumptions-body">
          <div className="field advanced-field">
            <label htmlFor="life">Life expectancy — plan to age {lifeExpectancy}</label>
            <input
              id="life"
              type="range"
              min={75}
              max={100}
              value={lifeExpectancy}
              onChange={(e) => onLifeExpectancyChange(Number(e.target.value))}
            />
            <div className="range-labels">
              <span>75</span>
              <span>100</span>
            </div>
            <div className="ssa-life-row">
              <span className="field-hint">
                SSA suggests age <strong>{ssaSuggestedLifeExpectancy}</strong> for{' '}
                {genderLabel(gender).toLowerCase()} (
                <a href={SSA_LIFE_TABLE_URL} target="_blank" rel="noopener noreferrer">
                  period life table
                </a>
                )
              </span>
              <button
                type="button"
                className="btn-reset-cola"
                onClick={() => onLifeExpectancyChange(ssaSuggestedLifeExpectancy)}
              >
                Use SSA age ({ssaSuggestedLifeExpectancy})
              </button>
            </div>
          </div>

          <div className="field advanced-field">
            <label htmlFor="cola">
              Annual COLA / inflation — {formatPercent(annualCola, 2)}
            </label>
            <input
              id="cola"
              type="range"
              min={0}
              max={8}
              step={0.1}
              value={annualCola}
              onChange={(e) => onAnnualColaChange(Number(e.target.value))}
            />
            <div className="range-labels">
              <span>0%</span>
              <span>8%</span>
            </div>
            <div className="cola-input-row">
              <input
                type="number"
                min={0}
                max={15}
                step={0.1}
                value={annualCola}
                onChange={(e) => onAnnualColaChange(Number(e.target.value) || 0)}
                aria-label="Annual COLA percentage"
              />
              <span>%</span>
              <button
                type="button"
                className="btn-reset-cola"
                onClick={() => onAnnualColaChange(CPI_DEFAULT_COLA)}
              >
                Use 30-yr CPI avg ({formatPercent(CPI_DEFAULT_COLA, 2)})
              </button>
            </div>
            <span className="field-hint">
              Applied to lifetime benefit totals (models SSA cost-of-living adjustments)
            </span>
          </div>

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

            {usingDefault && (
              <p className="cpi-active-note">
                Default COLA assumption matches the 30-year CPI-U arithmetic average.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
