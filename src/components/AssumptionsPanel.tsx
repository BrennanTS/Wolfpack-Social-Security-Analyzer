import {
  BLS_CPI_URL,
  CPI_DEFAULT_COLA,
  formatPercent,
  getCpiLast30Years,
} from '../lib/cpiHistory';
import type { Gender } from '../lib/personAnalysis';
import { genderLabel, SSA_LIFE_TABLE_URL } from '../lib/lifeExpectancy';
import { DEFAULT_DISCOUNT_RATE } from '../lib/ssaTools';
import { COLA_BOUNDS, DISCOUNT_BOUNDS_PERCENT, LIFE_EXPECTANCY_BOUNDS } from '../lib/formBounds';

interface AssumptionsPanelProps {
  lifeExpectancy: number | null;
  onLifeExpectancyChange: (value: number) => void;
  annualCola: number;
  onAnnualColaChange: (value: number) => void;
  discountRate: number;
  onDiscountRateChange: (value: number) => void;
  ssaSuggestedLifeExpectancy: number | null;
  gender: Gender | null;
  expanded: boolean;
  onToggle: () => void;
}

export function AssumptionsPanel({
  lifeExpectancy,
  onLifeExpectancyChange,
  annualCola,
  onAnnualColaChange,
  discountRate,
  onDiscountRateChange,
  ssaSuggestedLifeExpectancy,
  gender,
  expanded,
  onToggle,
}: AssumptionsPanelProps) {
  const cpi = getCpiLast30Years();
  const usingDefaultCola = Math.abs(annualCola - CPI_DEFAULT_COLA) < 0.05;
  const usingDefaultDiscount = Math.abs(discountRate - DEFAULT_DISCOUNT_RATE) < 0.001;

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
            <label htmlFor="discount">
              Discount rate (ssa.tools) — {formatPercent(discountRate * 100, 2)}
            </label>
            <input
              id="discount"
              type="range"
              min={DISCOUNT_BOUNDS_PERCENT.min}
              max={DISCOUNT_BOUNDS_PERCENT.max}
              step={DISCOUNT_BOUNDS_PERCENT.step}
              value={discountRate * 100}
              onChange={(e) => onDiscountRateChange(Number(e.target.value) / 100)}
            />
            <div className="range-labels">
              <span>0%</span>
              <span>6%</span>
            </div>
            <span className="field-hint">
              Used for mortality-weighted optimal filing (ssa.tools expected NPV). Default 2.5%
              approximates long-term TIPS yield.
            </span>
            {usingDefaultDiscount && (
              <p className="cpi-active-note">Using ssa.tools default discount rate.</p>
            )}
          </div>

          <div className="field advanced-field">
            <label htmlFor="life">
              Life expectancy
              {lifeExpectancy !== null ? ` — plan to age ${lifeExpectancy}` : ''}
            </label>
            {lifeExpectancy !== null ? (
              <>
                <input
                  id="life"
                  type="range"
                  min={LIFE_EXPECTANCY_BOUNDS.min}
                  max={LIFE_EXPECTANCY_BOUNDS.max}
                  value={lifeExpectancy}
                  onChange={(e) => onLifeExpectancyChange(Number(e.target.value))}
                />
                <div className="range-labels">
                  <span>75</span>
                  <span>100</span>
                </div>
              </>
            ) : (
              <p className="field-hint assumptions-placeholder">
                Set date of birth and gender to enable life expectancy planning.
              </p>
            )}
            {ssaSuggestedLifeExpectancy !== null && gender !== null && (
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
            )}
          </div>

          <div className="field advanced-field">
            <label htmlFor="cola">
              Chart COLA assumption — {formatPercent(annualCola, 2)}
            </label>
            <input
              id="cola"
              type="range"
              min={COLA_BOUNDS.min}
              max={COLA_BOUNDS.max}
              step={COLA_BOUNDS.step}
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
              Benefit math uses SSA historical COLA tables (ssa.tools). This rate applies to
              illustrative cumulative charts only.
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

            {usingDefaultCola && (
              <p className="cpi-active-note">
                Chart COLA default matches the 30-year CPI-U arithmetic average.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
