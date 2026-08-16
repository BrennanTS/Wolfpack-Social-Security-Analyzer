/**
 * Narrative copy for the Analyzer's "How This Works" panel.
 *
 * Lives beside the components rather than in `lib/` because it is
 * presentation, not calculation — but in its own module rather than inside
 * `Analyzer.tsx` so it can be unit-tested without mounting the page (and so
 * the component file keeps exporting only components).
 */
import type { HouseholdAnalysis } from '../lib/household';
import { formatCurrencyPrecise } from '../lib/format';

type SpousalTopUp = NonNullable<HouseholdAnalysis['spousalTopUp']>;

/**
 * The one spousal sentence, shared by the on-screen methodology panel and
 * both PDF surfaces.
 *
 * It used to exist as three near-identical copies. They drifted: only the
 * screen copy ever grew the `atFra <= 0` branch, so when `startsAtSpouseAge`
 * became absent for a household with no entitlement, the PDF printed the
 * absence marker straight into the sentence — "beginning at age — — the later
 * of…" — for six of the eleven married golden scenarios. One function with
 * one set of branches is what stops that recurring.
 *
 * `subject` is how the sentence refers to the lower earner: their name on
 * screen, "the lower earner" in print, where no per-person context is
 * available. Pass it lowercase where it is not a proper noun — the returned
 * sentence capitalizes its own first letter, so the subject reads correctly
 * both at the start of the sentence and in the middle of it.
 *
 * The top-up is the amount by which half the higher earner's PIA exceeds the
 * lower earner's own — for $3,000/$1,000 that is $500, not $1,500. It is
 * never "50% of your PIA", which is what an earlier version claimed.
 */
export function spousalSummary(spousal: SpousalTopUp, subject: string): string {
  return capitalize(sentence(spousal, subject));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sentence(spousal: SpousalTopUp, subject: string): string {
  if (spousal.atFra <= 0) {
    return (
      `No top-up applies to this household — half of the higher earner's PIA does not ` +
      `exceed ${subject}'s own benefit.`
    );
  }

  // Absent whenever the engine emits no Spousal band. That is not only the
  // zero-entitlement case above: a lower earner who dies before the higher
  // earner files is eligible but never collects, so there is a positive
  // entitlement and no start date. Say that, rather than print a placeholder.
  const start =
    spousal.startsAtSpouseAge === null
      ? `, though it never begins under the recommended strategy — the other spouse does not ` +
        `file within ${subject}'s lifetime, and a spousal benefit cannot start before they do`
      : `, beginning at ${subject}'s age ${spousal.startsAtSpouseAge} — the later of ` +
        `${subject}'s own filing and the other spouse's, since a spousal benefit cannot ` +
        `start before the other spouse has filed`;

  return (
    `${subject}'s spousal top-up is ` +
    `${formatCurrencyPrecise(spousal.atRecommendedFilingAge)}/mo under the recommended ` +
    `strategy${start}. The unreduced amount at ${subject}'s own FRA is ` +
    `${formatCurrencyPrecise(spousal.atFra)}/mo.`
  );
}

/**
 * The "Spousal benefits" methodology copy for the Analyzer's "How This Works"
 * panel.
 *
 * Reads the household's own `spousalTopUp` — the amount that accrues to the
 * *lower earner*, named via `lowerEarnerLabel` — rather than recomputing a
 * person-A-anchored figure. An earlier version called the engine directly
 * from `Analyzer.tsx` and disagreed with the PDF whenever person B out-earned
 * person A, showing $0 on screen and a positive figure in print for the same
 * household.
 */
export function spousalMethodologyCopy(analysis: HouseholdAnalysis): string {
  const spousal = analysis.spousalTopUp;

  if (!spousal) {
    return (
      'Select Married to model the spousal top-up. Survivor benefits apply only to a ' +
      'couple.'
    );
  }

  return (
    'Married households are optimized jointly by ssa.tools, including the spousal top-up. ' +
    `${spousalSummary(spousal, spousal.lowerEarnerLabel)} Survivor benefits are included ` +
    'in the recommendation and in the combined income timeline.'
  );
}
