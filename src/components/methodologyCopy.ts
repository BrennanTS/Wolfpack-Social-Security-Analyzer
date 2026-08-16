/**
 * Narrative copy for the Analyzer's "How This Works" panel.
 *
 * Lives beside the components rather than in `lib/` because it is
 * presentation, not calculation — but in its own module rather than inside
 * `Analyzer.tsx` so it can be unit-tested without mounting the page (and so
 * the component file keeps exporting only components).
 */
import type { SurvivorGap } from '../lib/benefitPeriods';
import type { HouseholdAnalysis } from '../lib/household';
import { formatCurrencyPrecise } from '../lib/format';

type SpousalTopUp = NonNullable<HouseholdAnalysis['spousalTopUp']>;

/**
 * The disclosure for the one survivor direction the engine does not model.
 *
 * `strategy-calc.ts:104` pays survivor benefits only to the lower-PIA
 * dependent, so when the *lower*-PIA spouse dies first no survivor period is
 * emitted for anyone. If the survivor is the one holding the smaller monthly
 * benefit, SSA would step them up and the chart does not.
 *
 * This is reachable, not theoretical: it needs the two benefits to be close
 * and the person with the *larger* benefit to die first, which happens when an
 * older spouse with a slightly lower PIA files late enough to out-earn the
 * younger one. A 1957/PIA-1500 and 1970/PIA-1600 couple produces it.
 *
 * Three branches, because a single sentence was wrong for four households out
 * of five. What the survivor is being paid *at the death* — not at the end of
 * their life — decides which one is true:
 *
 *  - no band that month: they have not filed, and the chart's zero is right
 *    until they do. Quote no amount.
 *  - under 60 that month: no widow(er) benefit is payable at all yet, so the
 *    chart's zero is right for those years too — the shortfall starts at 60.
 *  - otherwise: both figures are contemporaneous and the shortfall is
 *    immediate.
 *
 * Null when there is nothing to disclose, so callers render nothing.
 */
export function survivorGapNote(gap: SurvivorGap | null | undefined): string | null {
  // Undefined as well as null: a caller that has not been updated to pass the
  // field must render nothing, not throw.
  if (!gap) return null;

  const lead =
    `Survivor benefits are modeled only for the lower-earning spouse, so no step-up is ` +
    `shown for ${gap.survivorLabel}, who outlives a spouse receiving ` +
    `${formatCurrencyPrecise(gap.deceasedMonthly)}/mo at that death`;

  if (gap.survivorUnder60) {
    return (
      `${lead}. ${gap.survivorLabel} is under 60 then, so no widow(er) benefit is payable ` +
      `yet and the chart is right to show none — but SSA could pay one from age 60 onward, ` +
      `and none is shown.`
    );
  }

  if (gap.survivorOwnMonthly === null) {
    return (
      `${lead}. ${gap.survivorLabel} has not filed on their own record by then, so the chart ` +
      `shows them nothing from that death until their own benefit begins — SSA would pay a ` +
      `survivor benefit over those months.`
    );
  }

  return (
    `${lead} while receiving ${formatCurrencyPrecise(gap.survivorOwnMonthly)}/mo of their ` +
    `own. The figures shown for ${gap.survivorLabel} after that death are lower than SSA ` +
    `would pay.`
  );
}

/**
 * The caption under the combined-income chart, shared by the on-screen chart
 * and the PDF household page.
 *
 * It lived as a verbatim ~45-word duplicate in two component files, and both
 * copies asserted unconditionally that each band includes "any spousal or
 * survivor benefit". For a survivor-gap household that is false — and the gap
 * note rendered directly beneath said so, on both surfaces. One function with
 * one set of branches is what stops that, exactly as for `spousalSummary`.
 */
export function combinedIncomeCaption(gap: SurvivorGap | null | undefined): string {
  const included = gap
    ? 'their own benefit plus any spousal benefit'
    : 'their own benefit plus any spousal or survivor benefit';
  const survivorCaveat = gap
    ? ' No survivor benefit is included for this household — see the note below.'
    : '';
  return (
    `Each person's band is everything they are paid that year — ${included} — counting only ` +
    'the months actually paid, so a filing year or a final year is shorter than a full one.' +
    survivorCaveat +
    " Amounts are in today's dollars, before any cost-of-living adjustment."
  );
}

/**
 * The one single-claimant benefit sentence, shared by the on-screen panel and
 * both PDF surfaces.
 *
 * It existed as three independent variants, and all three said some form of
 * "survivor benefits apply only to a couple" / "not modeled for single
 * claimants". As a benefit rule the first is simply false: a survivor benefit
 * is paid precisely to someone who is no longer part of a couple, so a widowed
 * user who selects "Single" was told the benefit they may already be
 * collecting does not exist. What is true is narrower — this analysis models
 * one person's own earnings record, and both spousal and survivor benefits are
 * computed from a *spouse's* record, which a single-claimant household does
 * not supply.
 */
export const SINGLE_CLAIMANT_BENEFIT_NOTE =
  "Spousal and survivor benefits are both computed from a spouse's record, so neither is " +
  'modeled for a single claimant. SSA does pay survivor benefits to a widow(er) on a late ' +
  "spouse's record; this analysis covers only your own.";

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
    // "at their own FRA" is load-bearing, not decoration: `household.ts:262`
    // computes `atFra` from `baseSpousalBenefit`, which compares half the
    // higher earner's PIA against the lower earner's own *PIA*. A lower earner
    // filing at 62 is paid ~70% of that, so half the higher earner's PIA can
    // genuinely exceed what they receive while this sentence is still true.
    // Unqualified, the sentence denied that.
    return (
      `No top-up applies to this household — half of the higher earner's PIA does not ` +
      `exceed ${subject}'s own benefit at their own FRA.`
    );
  }

  // Absent whenever the engine emits no Spousal band, which has two distinct
  // causes. `strategy-calc.ts:145-158` runs the band from the later of the two
  // filing dates to `min(survivorStartDate − 1, dependentFinalDate)`, so it is
  // dropped either when the lower earner dies before that start OR when the
  // higher earner dies before the lower earner's own filing date. In the
  // second case the other spouse HAS filed and the lower earner is alive and
  // collecting survivor benefits, so naming a single cause is wrong half the
  // time. State the condition the engine actually tests — an empty overlap —
  // rather than guessing which side produced it.
  const start =
    spousal.startsAtSpouseAge === null
      ? `, though it never begins under the recommended strategy — a spousal benefit needs a ` +
        `month in which both spouses have filed and both are still living, and this strategy ` +
        `leaves none`
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
    return `Select Married to model the spousal top-up. ${SINGLE_CLAIMANT_BENEFIT_NOTE}`;
  }

  // The gap note replaces the blanket "survivor benefits are included" claim
  // rather than sitting alongside it: for these households they are not.
  const survivor =
    survivorGapNote(analysis.survivorGap) ??
    'Survivor benefits are included in the recommendation and in the combined income timeline.';

  return (
    'Married households are optimized jointly by ssa.tools, including the spousal top-up. ' +
    `${spousalSummary(spousal, spousal.lowerEarnerLabel)} ${survivor}`
  );
}
