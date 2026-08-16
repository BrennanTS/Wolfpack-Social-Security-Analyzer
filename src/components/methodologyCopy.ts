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

/**
 * The "Spousal benefits" methodology copy.
 *
 * Reads the household's own `spousalTopUp` — the amount that accrues to the
 * *lower earner*, named via `lowerEarnerLabel` — rather than recomputing a
 * person-A-anchored figure. The previous version called the engine directly
 * from `Analyzer.tsx` and described the top-up as "50% of your PIA", which it
 * never is: it's the amount by which half the higher earner's PIA exceeds the
 * lower earner's own (for $3,000/$1,000 that is $500, not $1,500). It also
 * disagreed with the PDF whenever person B out-earned person A, showing $0 on
 * screen and a positive figure in print for the same household. Wording
 * mirrors `pdf/HouseholdSection.tsx` so the two can no longer diverge.
 */
export function spousalMethodologyCopy(analysis: HouseholdAnalysis): string {
  const survivorNote = 'Survivor benefits are not modeled in this version.';
  const spousal = analysis.spousalTopUp;

  if (!spousal) {
    return `Select Married to model the spousal top-up. ${survivorNote}`;
  }

  const lead =
    'Married households are optimized jointly by ssa.tools, including the spousal top-up.';

  if (spousal.atFra <= 0) {
    return (
      `${lead} No top-up applies to this household — half of the higher earner's PIA does not ` +
      `exceed ${spousal.lowerEarnerLabel}'s own benefit. ${survivorNote}`
    );
  }

  return (
    `${lead} ${spousal.lowerEarnerLabel}'s spousal top-up is ` +
    `${formatCurrencyPrecise(spousal.atRecommendedFilingAge)}/mo under the recommended ` +
    `strategy, beginning at ${spousal.lowerEarnerLabel}'s age ${spousal.startsAtSpouseAge} — a ` +
    `spousal benefit cannot start before the other spouse has filed. The unreduced amount at ` +
    `${spousal.lowerEarnerLabel}'s own FRA is ${formatCurrencyPrecise(spousal.atFra)}/mo. ${survivorNote}`
  );
}
