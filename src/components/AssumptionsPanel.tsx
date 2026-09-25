import type { DollarsMode } from '../lib/dollarsMode';
import { BASIS_LABEL, basisOf, dollarsModeFor, type NamedBasis } from '../lib/reportBasis';
import { CPI_DEFAULT_COLA, formatPercent } from '../lib/cpiHistory';
import { DEFAULT_DISCOUNT_RATE } from '../lib/ssaTools';
import { clampToBounds, COLA_BOUNDS, DISCOUNT_BOUNDS_PERCENT } from '../lib/formBounds';
import {
  isTrusteesProjection,
  SOLVENCY_PAYABLE_BOUNDS,
  SOLVENCY_YEAR_BOUNDS,
  TRUSTEES_ASSUMPTION,
  TRUSTEES_PROJECTION,
  type SolvencyAssumption,
} from '../lib/solvency';

const BASES: NamedBasis[] = ['present', 'future'];

const BASIS_HINT: Record<NamedBasis, string> = {
  present:
    'Today’s money. Future payments are counted for less the further away they are, at ' +
    'the discount rate below. This is the default, and the honest answer to “what is this ' +
    'worth to us”.',
  future:
    'Dollars as they will actually be received, inflated by COLA and not discounted. ' +
    'Bigger numbers for the same benefits — and the way most other Social Security ' +
    'reports state a total, so this is the setting for putting ours beside one of theirs.',
};

interface AssumptionsPanelProps {
  /** The reduction the "what if benefits are reduced" report page prices. */
  solvency: SolvencyAssumption;
  onSolvencyChange: (value: SolvencyAssumption) => void;
  annualCola: number;
  onAnnualColaChange: (value: number) => void;
  discountRate: number;
  onDiscountRateChange: (value: number) => void;
  /**
   * The two controls the comparison preset drives. Passed in rather than
   * owned here so the preset can never disagree with the toggles it sets —
   * it reads its own state back off them (see `comparisonView` below).
   */
  dollarsMode: DollarsMode;
  onDollarsModeChange: (value: DollarsMode) => void;
  expanded: boolean;
  onToggle: () => void;
}

export function AssumptionsPanel({
  solvency,
  onSolvencyChange,
  annualCola,
  onAnnualColaChange,
  discountRate,
  onDiscountRateChange,
  dollarsMode,
  onDollarsModeChange,
  expanded,
  onToggle,
}: AssumptionsPanelProps) {
  const usingDefaultCola = Math.abs(annualCola - CPI_DEFAULT_COLA) < 0.05;
  const usingTrusteesProjection = isTrusteesProjection(solvency);
  const usingDefaultDiscount = Math.abs(discountRate - DEFAULT_DISCOUNT_RATE) < 0.001;
  /**
   * DERIVED, never stored — see `reportBasis.ts`, which owns the rule so the
   * layout presets can name a basis without importing this panel. It reads
   * one setting now, so there is no combination it cannot name.
   */
  const basis = basisOf(dollarsMode);

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
      {/* Readable with the panel shut. The reduction scenario changes what
          the report contains, and an adviser who cannot see that it is on
          is the failure this badge exists to prevent. */}
      {solvency.enabled && (
        <span className="assumptions-flag" data-testid="solvency-flag">
          Benefit reduction on
        </span>
      )}

      {expanded && (
        <div className="assumptions-body">
          <h4 className="assumptions-heading">Used in the recommendation</h4>
          <p className="assumptions-heading-note">
            This decides which filing ages the report recommends.
          </p>

          <div className="field advanced-field">
            <label htmlFor="discount">
              Discount rate: {formatPercent(discountRate * 100, 2)}
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
              Used to rank filing ages: each future payment counts this much less for every
              year away. Default 2.5% approximates long-term TIPS yield.
            </span>
            {usingDefaultDiscount && (
              <p className="cpi-active-note">Using the default discount rate.</p>
            )}
          </div>

          <h4 className="assumptions-heading">How figures are shown</h4>
          <p className="assumptions-heading-note">
            This changes what the numbers say, never what the report recommends.
          </p>

          {/* ONE control. It used to be two — this switch plus a separate
              Dollars toggle — and setting the dollars alone produced a pair
              neither name described, so this control showed nothing selected
              and the hint had to explain a state it could not display. The
              two are one setting because they were always describing one
              decision. See `reportBasis.ts`. */}
          <div className="field advanced-field">
            <span className="field-label">How figures are shown</span>
            <div className="segmented-control" role="group" aria-label="Report basis">
              {BASES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`segment-btn ${basis === option ? 'segment-btn-active' : ''}`}
                  data-testid={`report-basis-${option}`}
                  onClick={() => onDollarsModeChange(dollarsModeFor(option))}
                  aria-pressed={basis === option}
                >
                  {BASIS_LABEL[option]}
                </button>
              ))}
            </div>
            <span className="field-hint">{BASIS_HINT[basis]}</span>
            <span className="field-hint">
              It sets the whole report — every table, chart and total, on screen and in the
              PDF. It changes only how figures are stated: the recommended filing ages are
              the same either way.
            </span>
          </div>

          <h4 className="assumptions-heading">Used in the charts only</h4>
          <p className="assumptions-heading-note">
            This moves the illustrative charts. It does not move the recommendation.
          </p>

          <div className="field advanced-field">
            <label htmlFor="cola">
              Chart COLA assumption: {formatPercent(annualCola, 2)}
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
              {/* Bounds and clamping both come from COLA_BOUNDS, the same
                  source the slider above and the share-link parser read.
                  This field used to accept up to 15 and clamp nothing, so a
                  typed 12 entered state, passed the completeness gate, and
                  was written into a shared link as `cola=12` — which the
                  recipient's parser then rejected as out of bounds and
                  silently replaced with the CPI default. Sender and
                  recipient saw different cumulative and break-even charts
                  with nothing on screen saying so. */}
              <input
                type="number"
                min={COLA_BOUNDS.min}
                max={COLA_BOUNDS.max}
                step={COLA_BOUNDS.step}
                value={annualCola}
                onChange={(e) =>
                  onAnnualColaChange(clampToBounds(Number(e.target.value), COLA_BOUNDS))
                }
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
              Benefit math uses SSA historical COLA tables. This rate applies to
              illustrative cumulative charts only.
            </span>
            {usingDefaultCola && (
              <p className="cpi-active-note">
                Chart COLA default matches the 30-year CPI-U arithmetic average.
              </p>
            )}
          </div>

          <h4 className="assumptions-heading">Optional report scenario</h4>
          <p className="assumptions-heading-note">
            Off unless you switch it on. Nothing here reaches the recommendation or the
            charts.
          </p>

          {/* Only the report's "what if benefits are reduced" page reads
              these. They reach no engine call, which is why they sit here
              rather than in the analysis assumptions above. */}
          <div className={`field advanced-field${solvency.enabled ? ' is-scenario-on' : ''}`}>
            <label className="solvency-switch" htmlFor="solvency-on">
              <input
                id="solvency-on"
                type="checkbox"
                checked={solvency.enabled}
                onChange={(e) =>
                  onSolvencyChange(
                    e.target.checked
                      ? { ...solvency, enabled: true }
                      : { ...solvency, enabled: false },
                  )
                }
              />
              <span className="field-label">Price a benefit reduction</span>
            </label>
            <span className="field-hint">
              {solvency.enabled
                ? 'The report carries a “what if benefits are reduced” page, pricing every ' +
                  'plan twice. It is marked on the page itself as a scenario you switched on.'
                : 'Adds a “what if benefits are reduced” page to the report, pricing every ' +
                  'plan twice. Nothing is added while this is off.'}
            </span>

            {solvency.enabled && (
              <>
                {/* A labeled grid rather than a sentence across one line:
                    the drawer is about 230px wide, and "From 2032 pay 78 %"
                    wrapped into fragments that read as separate controls. */}
                <div className="solvency-fields">
                  <label htmlFor="solvency-year">Reduced from</label>
                  <input
                    id="solvency-year"
                    type="number"
                    min={SOLVENCY_YEAR_BOUNDS.min}
                    max={SOLVENCY_YEAR_BOUNDS.max}
                    step={1}
                    value={solvency.fromYear}
                    onChange={(e) =>
                      onSolvencyChange({
                        ...solvency,
                        fromYear: clampToBounds(Number(e.target.value), SOLVENCY_YEAR_BOUNDS),
                      })
                    }
                  />
                  <label htmlFor="solvency-payable">Percent payable</label>
                  <span className="solvency-percent">
                    <input
                      id="solvency-payable"
                      type="number"
                      min={SOLVENCY_PAYABLE_BOUNDS.min}
                      max={SOLVENCY_PAYABLE_BOUNDS.max}
                      step={1}
                      value={solvency.payablePercent}
                      onChange={(e) =>
                        onSolvencyChange({
                          ...solvency,
                          payablePercent: clampToBounds(
                            Number(e.target.value),
                            SOLVENCY_PAYABLE_BOUNDS,
                          ),
                        })
                      }
                    />
                    %
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-reset-cola solvency-reset"
                  onClick={() => onSolvencyChange(TRUSTEES_ASSUMPTION)}
                  disabled={usingTrusteesProjection}
                >
                  Use the trustees’ projection
                </button>
                <span className="field-hint">
                  {usingTrusteesProjection
                    ? `The ${TRUSTEES_PROJECTION.report}’s own projection for the fund that ` +
                      'pays retirement and survivor benefits. The report page attributes it ' +
                      'to them.'
                    : 'Your own assumption. The report page says so, and does not attribute ' +
                      'it to the trustees.'}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
