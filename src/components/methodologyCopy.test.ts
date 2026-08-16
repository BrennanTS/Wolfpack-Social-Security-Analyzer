import { describe, expect, it } from 'vitest';
import { spousalMethodologyCopy } from './methodologyCopy';
import type { HouseholdAnalysis } from '../lib/household';

/**
 * Only the fields `spousalMethodologyCopy` reads. The full HouseholdAnalysis
 * is an engine output; building one here would mean running the optimizer,
 * which this pure copy function has no business depending on.
 */
function analysisWith(spousalTopUp?: HouseholdAnalysis['spousalTopUp']): HouseholdAnalysis {
  return {
    status: spousalTopUp ? 'married' : 'single',
    spousalTopUp,
  } as HouseholdAnalysis;
}

describe('spousalMethodologyCopy', () => {
  it('prompts for a marital status when the household is single', () => {
    expect(spousalMethodologyCopy(analysisWith())).toContain('Select Married');
  });

  it('states both the reduced and unreduced amounts, attributed to the lower earner', () => {
    const copy = spousalMethodologyCopy(
      analysisWith({ atFra: 1200, atRecommendedFilingAge: 790, lowerEarnerLabel: 'Sarah' }),
    );
    expect(copy).toContain("Spousal top-up at Sarah's recommended filing age: $790.00/mo");
    expect(copy).toContain("Unreduced amount at that person's FRA: $1,200.00/mo");
  });

  it('never describes the top-up as 50% of the other person PIA', () => {
    // The top-up is max(0, higherPIA/2 - lowerPIA), so for a $3,000 / $1,000
    // household it is $500 while 50% of the PIA is $1,500 — the old copy
    // printed the first number under the second's label.
    const copy = spousalMethodologyCopy(
      analysisWith({ atFra: 500, atRecommendedFilingAge: 500, lowerEarnerLabel: 'You' }),
    );
    expect(copy).not.toContain('50%');
    expect(copy).toContain('$500.00/mo');
  });

  it('says plainly that no top-up applies rather than printing $0.00', () => {
    const copy = spousalMethodologyCopy(
      analysisWith({ atFra: 0, atRecommendedFilingAge: 0, lowerEarnerLabel: 'You' }),
    );
    expect(copy).toContain('No top-up applies');
    expect(copy).toContain("does not exceed You's own benefit");
  });

  it('always notes that survivor benefits are out of scope', () => {
    for (const analysis of [
      analysisWith(),
      analysisWith({ atFra: 0, atRecommendedFilingAge: 0, lowerEarnerLabel: 'You' }),
      analysisWith({ atFra: 250, atRecommendedFilingAge: 200, lowerEarnerLabel: 'Spouse' }),
    ]) {
      expect(spousalMethodologyCopy(analysis)).toContain(
        'Survivor benefits are not modeled in this version.',
      );
    }
  });
});
