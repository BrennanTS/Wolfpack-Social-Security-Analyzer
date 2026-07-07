import type { BreakEvenPair } from '../lib/socialSecurity';

interface BreakEvenSectionProps {
  breakEvens: BreakEvenPair[];
  lifeExpectancy: number;
}

export function BreakEvenSection({ breakEvens, lifeExpectancy }: BreakEvenSectionProps) {
  if (breakEvens.length === 0) return null;

  return (
    <div className="breakeven-section">
      <h3>Break-Even Analysis</h3>
      <p className="table-desc">
        The age when a later claiming strategy catches up to an earlier one in total benefits
        received
      </p>
      <div className="breakeven-grid">
        {breakEvens.map((be) => {
          const beatsLater = lifeExpectancy >= be.breakEvenAge;
          return (
            <div key={`${be.earlierAge}-${be.laterAge}`} className="breakeven-card">
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
