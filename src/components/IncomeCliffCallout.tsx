import { incomeCliff } from '../lib/incomeCliff';
import type { HouseholdAnalysis } from '../lib/household';
import { incomeCliffSentence, survivorGapNote } from './methodologyCopy';

interface IncomeCliffCalloutProps {
  analysis: HouseholdAnalysis;
}

/**
 * The income-cliff callout: the sentence and the number an adviser says out
 * loud about what happens to household income at the first death. This is
 * the feature the whole benefit-periods display phase exists for — a
 * screenshot showed a survivor's household income collapsing to their own
 * benefit when in reality they inherit the larger of the two, and this
 * callout states that plainly next to the chart rather than leaving it to be
 * read off the shape of a line.
 *
 * Renders nothing for a single claimant, and nothing for a couple whose
 * first death falls outside the modeled timeline — `incomeCliff` returns
 * null either way, and there is no sentence to say.
 *
 * The sentence itself lives in `methodologyCopy.ts` (`incomeCliffSentence`)
 * so `pdf/HouseholdSection` can print the identical words rather than a
 * hand-retyped copy — the recurring defect on this project has always been a
 * sentence maintained in more than one file.
 */
export function IncomeCliffCallout({ analysis }: IncomeCliffCalloutProps) {
  const cliff = incomeCliff(analysis);
  if (!cliff) return null;

  const gapNote = survivorGapNote(analysis.survivorGap);

  return (
    <div className="income-cliff-callout" data-testid="income-cliff-callout">
      <h3>Income at the First Death</h3>
      <p data-testid="income-cliff-sentence">{incomeCliffSentence(cliff)}</p>
      {gapNote && (
        <p className="chart-caveat" data-testid="income-cliff-gap-note">
          {gapNote}
        </p>
      )}
    </div>
  );
}
