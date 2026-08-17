import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HouseholdAnalysis } from '../lib/household';
import { SurvivorClaimNote } from './SurvivorClaimNote';

describe('SurvivorClaimNote', () => {
  it('renders the note when there is an alternative', () => {
    render(
      <SurvivorClaimNote
        analysis={
          {
            survivorClaim: {
              claimIndex: 2036 * 12 + 4,
              claimAge: '68 years, 0 months',
              survivorLabel: 'Sarah',
              baselineTotal: 300_000,
              bestTotal: 435_700,
              gain: 135_700,
              baselineHasSurvivorBand: true,
            },
          } as unknown as HouseholdAnalysis
        }
      />,
    );
    expect(screen.getByTestId('survivor-claim-note')).toHaveTextContent(/135,700/);
  });

  it('renders nothing when there is none', () => {
    const { container } = render(
      <SurvivorClaimNote analysis={{ survivorClaim: null } as unknown as HouseholdAnalysis} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
