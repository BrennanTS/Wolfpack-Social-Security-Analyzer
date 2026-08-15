import type { BreakEvenPair } from '../lib/benefitMath';

interface BreakEvenSectionProps {
  breakEvens: BreakEvenPair[];
  lifeExpectancy: number;
}

export function BreakEvenSection({ breakEvens, lifeExpectancy }: BreakEvenSectionProps) {
  if (breakEvens.length === 0) return null;

  return (
    <div className="breakeven-section chart-container">
      <h3>Break-Even Analysis</h3>
      <p className="table-desc">
        The age when a later claiming strategy catches up to an earlier one in total benefits
        received
      </p>
      <div className="breakeven-grid">
        {breakEvens.map((be) => {
          const beatsLater = lifeExpectancy >= be.breakEvenAge;
          const testId = `break-even-${be.earlierAge}-${be.laterAge}`;
          return (
            <div key={`${be.earlierAge}-${be.laterAge}`} className="breakeven-card" data-testid={testId}>
              <div className="be-ages">
                <span>Age {be.earlierAge}</span>
                <span className="be-arrow">→</span>
                <span>Age {be.laterAge}</span>
              </div>
              <div className="be-age-value">{be.breakEvenAge}</div>
              <p className="be-label">Break-even age</p>
              <p className={`be-verdict ${beatsLater ? 'favors-later' : 'favors-earlier'}`}>
                {beatsLater
                  ? `Delaying to ${be.laterAge} wins — you live past break-even`
                  : `Claiming at ${be.earlierAge} wins — you don't reach break-even`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
