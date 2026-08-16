import { incomeCliff } from '../lib/incomeCliff';
import type { HouseholdAnalysis } from '../lib/household';
import { incomeCliffSentence, INCOME_CLIFF_HEADING } from './methodologyCopy';

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
 *
 * Deliberately does NOT re-render `survivorGapNote` here, even though
 * `analysis.survivorGap` being set means the `after` figure above is
 * understated. `CombinedIncomeChart` already prints that exact note
 * immediately above this callout (`HouseholdPanel` renders the chart, then
 * this component, in that order) — its caption literally says "see the note
 * below," pointing at it. An earlier version of this component rendered a
 * second copy of the same note directly beneath the sentence, so a
 * survivor-gap household showed the identical paragraph twice on one screen.
 * The disclosure belongs exactly once, at the chart it was written to
 * annotate; this callout relies on it being visible just above rather than
 * duplicating it.
 */
export function IncomeCliffCallout({ analysis }: IncomeCliffCalloutProps) {
  const cliff = incomeCliff(analysis);
  if (!cliff) return null;

  return (
    <div className="income-cliff-callout" data-testid="income-cliff-callout">
      <h3>{INCOME_CLIFF_HEADING}</h3>
      <p data-testid="income-cliff-sentence">{incomeCliffSentence(cliff)}</p>
    </div>
  );
}
