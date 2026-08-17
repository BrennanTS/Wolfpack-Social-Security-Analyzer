import type { DollarsMode } from '../lib/dollarsMode';
import type { HouseholdAnalysis } from '../lib/household';
import { survivorClaimNote } from './methodologyCopy';

interface SurvivorClaimNoteProps {
  analysis: HouseholdAnalysis;
  /**
   * Names, but never transforms, the mode the page is already in — the
   * `gain`/`baselineTotal`/`bestTotal` figures are real-dollars sums that
   * never move with this toggle (see `survivorClaimNote`'s own docstring for
   * why); this is passed through only so the note can decide whether it
   * needs to SAY so. Optional, defaulting to `'real'`, matching
   * `IncomeCliffCallout`'s own default so a caller that doesn't pass it gets
   * the sentence that was already correct before this prop existed.
   */
  dollarsMode?: DollarsMode;
}

/**
 * The survivor claim-date alternative, shown directly below the income-cliff
 * callout on screen (`HouseholdPanel`) and in the same position relative to
 * the cliff section in print (`pdf/HouseholdSection`) — both surfaces render
 * the identical string from `survivorClaimNote`, so the sentence cannot be
 * hand-retyped into one and drift from the other, and both get their render
 * decision from that same function rather than each testing
 * `analysis.survivorClaim` for null themselves.
 *
 * Renders nothing when `analysis.survivorClaim` is null — see
 * `survivorClaimAlternative` (`lib/survivorClaim.ts`) for the full list of
 * households that produces for.
 */
export function SurvivorClaimNote({ analysis, dollarsMode = 'real' }: SurvivorClaimNoteProps) {
  const note = survivorClaimNote(analysis.survivorClaim, dollarsMode);
  if (!note) return null;

  return (
    <div className="survivor-claim-note" data-testid="survivor-claim-note">
      <p>{note}</p>
    </div>
  );
}
