/**
 * Narrative copy for the Analyzer's "How This Works" panel.
 *
 * Lives beside the components rather than in `lib/` because it is
 * presentation, not calculation — but in its own module rather than inside
 * `Analyzer.tsx` so it can be unit-tested without mounting the page (and so
 * the component file keeps exporting only components).
 */
import type { BandType, SurvivorGap } from '../lib/benefitPeriods';
import { formatPercent } from '../lib/cpiHistory';
import type { DollarsMode } from '../lib/dollarsMode';
import {
  survivorIncomeRisesWithDelay,
  type HouseholdAnalysis,
  type HouseholdStrategy,
} from '../lib/household';
import type { IncomeCliff } from '../lib/incomeCliff';
import { formatCurrency, formatCurrencyPrecise } from '../lib/format';

type SpousalTopUp = NonNullable<HouseholdAnalysis['spousalTopUp']>;

/**
 * The short dollars-basis disclosure appended to a figure-bearing sentence
 * that has no unit statement of its own — `incomeCliffSentence` and
 * `survivorIncomeCaption` both show either real or nominal figures depending
 * on the same toggle, and neither said which until this was added.
 * `combinedIncomeCaption` states the same fact at greater length, in its own
 * words, since it is the chart's primary caption rather than an addendum —
 * this helper is not meant to replace that, only to give the two shorter
 * captions the identical underlying fact without hand-retyping it.
 */
function dollarsBasisClause(mode: DollarsMode): string {
  return mode === 'nominal'
    ? 'figures are in future (nominal) dollars, compounded forward using the assumed COLA'
    : 'figures are in today’s dollars, before any cost-of-living adjustment';
}

const BAND_TYPE_LABEL: Record<BandType, string> = {
  personal: 'own benefit',
  spousal: 'spousal',
  survivor: 'survivor',
};

/**
 * The legend label for one person's one benefit-type band — "Sarah —
 * spousal", "Dan — own benefit". Shared by the on-screen chart legend
 * (`CombinedIncomeChart`) and the PDF's combined-income bars
 * (`pdf/HouseholdSection`) so the two cannot drift, for the same reason
 * `combinedIncomeCaption` and `survivorGapNote` are centralized here: three
 * of five prior defects existed because a sentence was hand-maintained in
 * more than one file.
 */
export function benefitSeriesLabel(personName: string, type: BandType): string {
  return `${personName} — ${BAND_TYPE_LABEL[type]}`;
}

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
 *
 * Rewritten again once the chart stopped drawing one band per person and
 * started drawing one segment per person per benefit type: the original
 * wording ("each person's band is everything they are paid") described the
 * old one-band layout and became false the moment a person could hold up to
 * three segments beside each other — the segment labelled "own benefit" is
 * specifically NOT everything they are paid once a spousal or survivor
 * segment sits next to it. This is the sixth instance on this project of a
 * right number with wrong text beside it, and the lesson generalizes:
 * inherited copy is not neutral when the thing it describes has changed
 * underneath it. This version also states the one fact a reader needs to
 * parse the chart at all — that a survivor segment is the increment above
 * the personal band beneath it, not a replacement for it — since that is the
 * exact misconception this whole display phase exists to correct.
 *
 * `mode` decides two things, not one. The closing sentence is the obvious
 * one. The other is easy to miss: "that personal band keeps paying what it
 * already was" is a claim that the band's amount is CONSTANT over time — true
 * in real dollars (the engine's bands carry no COLA), but false the moment
 * nominal compounds one forward, since every band then grows year over year.
 * A reader checking the personal band either side of the death year in
 * nominal mode sees, say, $2,000 → $2,050, while an unbranched version of
 * this sentence would still say it "kept paying what it already was." The
 * structural claim the sentence exists to make — a survivor segment is an
 * increment on top of the personal band, not a replacement for it — is true
 * in both modes; only the "band stays flat" wording is mode-specific, so only
 * that clause branches. Defaults to `'real'` so every existing call site (and
 * every test written before the toggle existed) keeps reading the sentence
 * that was already correct for them. The print surface is the one caller
 * that always passes `'real'` explicitly, since it can't toggle.
 */
export function combinedIncomeCaption(
  gap: SurvivorGap | null | undefined,
  mode: DollarsMode = 'real',
): string {
  const included = gap
    ? 'their own benefit, plus any spousal segment'
    : 'their own benefit, plus any spousal or survivor segment';
  const survivorCaveat = gap
    ? ' No survivor segment is included for this household — see the note below.'
    : '';
  // Real: the band genuinely stays flat (the engine applies no COLA), so the
  // increment framing can say so. Nominal: the band keeps growing at the
  // assumed COLA on its own — exactly as it would with no survivor segment
  // present at all — and the survivor segment stacked on top is still only
  // the increase over THAT trajectory, not over a flat line.
  const bandContinuityClause =
    mode === 'nominal'
      ? 'that personal band keeps growing at the assumed COLA on its own, exactly as it ' +
        'would without the survivor segment, and the survivor segment stacked on top of it ' +
        'is only the increase over that.'
      : 'that personal band keeps paying what it already was, and the survivor segment ' +
        'stacked on top of it is only the increase.';
  // This is the other sentence in the caption that `mode` can falsify: the
  // engine's bands never carry a COLA, so "today's dollars" is true only
  // while nothing downstream of them has compounded one forward. The nominal
  // toggle does exactly that, so the sentence has to say so instead.
  const dollarsClause =
    mode === 'nominal'
      ? 'Amounts are in future (nominal) dollars — the engine’s own today’s-dollars figures, ' +
        'compounded forward using the assumed COLA — not today’s purchasing power.'
      : 'Amounts are in today’s dollars, before any cost-of-living adjustment.';
  // Typographic apostrophes, matching the `&rsquo;` the two duplicated copies
  // carried before extraction. This sentence prints beside copy that uses
  // them — the PDF disclaimer's "today’s dollars" is on the same page — so
  // ASCII here renders straight quotes next to curly ones.
  return (
    `Each person’s segments for the year sum to what they were actually paid — ${included} ` +
    '— counting only the months actually paid, so a filing year or a final year is ' +
    'shorter than a full one.' +
    survivorCaveat +
    ' A survivor segment is the increment above the personal band beneath it: ' +
    bandContinuityClause +
    ` ${dollarsClause}`
  );
}

/**
 * The couple half of the PDF's "Important Disclosures" block.
 *
 * Conditional for exactly the reason `combinedIncomeCaption` is. For a married
 * report the methodology appendix attaches to the household `<Page>`
 * (`ReportDocument.tsx:206-211`), so an unconditional "survivor benefits are
 * modeled" claim prints on the same physical page as the caption saying no
 * survivor benefit is included for this household and the note explaining why.
 * The unconditional version was introduced by the very fix wave that removed
 * the same contradiction from the caption.
 */
export function coupleModelingNote(gap: SurvivorGap | null | undefined): string {
  return gap
    ? 'The spousal top-up is modeled via the ssa.tools couple optimizer; the survivor ' +
        'benefit this household would actually receive is not — see the note on the ' +
        'household page.'
    : 'The spousal top-up and survivor benefits are both modeled via the ssa.tools couple ' +
        'optimizer.';
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
 * `subject` is `null` on an exact PIA tie (`household.ts`'s
 * `spousalTopUp.lowerEarnerLabel`) — there is no lower earner to name, and
 * naming one anyway would be positional, not factual: the engine's own
 * classifier still has to pick a slot on a tie, and it always picks the
 * same slot, so the printed name would depend only on which spouse was
 * entered first for a household unaffected by that order.
 *
 * The top-up is the amount by which half the higher earner's PIA exceeds the
 * lower earner's own — for $3,000/$1,000 that is $500, not $1,500. It is
 * never "50% of your PIA", which is what an earlier version claimed.
 */
export function spousalSummary(spousal: SpousalTopUp, subject: string | null): string {
  return capitalize(sentence(spousal, subject));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sentence(spousal: SpousalTopUp, subject: string | null): string {
  if (subject === null) {
    // Symmetric by construction: true of the household as a whole, with no
    // name interpolated, so it cannot read differently depending on entry
    // order. An exact PIA tie always yields a $0 entitlement (half of equal
    // PIAs cancels out), so there is no figure being suppressed here either.
    //
    // Says PIAs match, not records match: `isPiaTie` (`household.ts`) is an
    // exact PIA comparison, and two equal PIAs can come from very different
    // earnings histories — the test fixture for this branch pairs different
    // birth years and different genders with only the PIA forced equal. "PIA"
    // is stated explicitly rather than the vaguer "benefit" so this cannot be
    // misread as also claiming their eventual filing benefits are equal,
    // which early/delayed filing can make untrue even when PIAs tie exactly.
    return (
      `Both spouses have the same Primary Insurance Amount, so neither is the lower earner — ` +
      `there is no spousal top-up to claim on the other's record.`
    );
  }
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

/**
 * The income-cliff sentence — the one an adviser says out loud: what happens
 * to household income at the first death, in the numbers a client actually
 * sees on the chart. Shared by the on-screen callout (`IncomeCliffCallout`)
 * and `pdf/HouseholdSection` so, as with every other sentence in this module,
 * it cannot be hand-retyped into one surface and drift from the other.
 *
 * Deliberately does not assert "income falls": `dropPercent === 0` is
 * reachable whenever the survivor's own benefit plus any step-up equals or
 * exceeds the household's prior total, and stating a fall then would be
 * false. The two branches below are the only two truths available — either
 * it fell by some positive amount, or it did not — and both name both
 * figures either way, since the number is the point of the sentence.
 *
 * Says nothing about `survivorGap`: when the engine cannot model the
 * survivor direction a household would actually experience, the `after`
 * figure here is understated by exactly the amount `survivorGapNote`
 * describes. Callers render that note in the same callout rather than this
 * function growing a second clause about it — the wording already exists
 * once, in `survivorGapNote`, and duplicating it here is exactly the
 * hand-maintained-in-two-places pattern behind the prior defects on this
 * project.
 *
 * Deliberately says nothing about *how* the survivor's benefit is
 * determined ("steps up to the larger of the two", SSA's actual rule) —
 * that claim is true for most households but specifically false for a
 * `survivorGap` household, where `after` is the survivor's own smaller
 * benefit continuing unchanged because the engine did not model the step-up
 * in that direction. Asserting the mechanism here would be exactly this
 * project's recurring defect: a claim beside a number the number does not
 * support for every household shape. Naming the survivor and the two full
 * years' totals is the part that is true unconditionally.
 *
 * The closing clause is a household-composition fact ("is the only person
 * left"), never a payment fact ("is collecting"). `after === 0` is
 * genuinely reachable through the real pipeline — a much-younger survivor
 * who has neither filed on their own record nor reached the age a widow(er)
 * benefit can start yields a full $0 year right after the death — and
 * "once {survivor} is the only one still collecting" would print false
 * beside a number that just said $0. Confirmed against the engine with the
 * exact under-60 fixture `benefitPeriods.test.ts`/`methodologyCopy.test.ts`
 * already use (Avery b. Jun 1956 PIA $1,600 plan-to 76, Blake b. Jun 1976):
 * `incomeCliff` on that household returns `after: 0, dropPercent: 100`.
 *
 * `mode` names which dollars `before`/`after` are already in — this function
 * does no conversion of its own (the caller's `cliff` already carries
 * whichever mode's figures, via `HouseholdPanel`'s single transform point),
 * it only states the fact. Defaults to `'real'` so every call site written
 * before the toggle existed keeps its exact prior wording. Print passes
 * `'real'` explicitly (it always shows real figures) and adds
 * `nominalFirstDeathNote` as a separate, explicitly-nominal number alongside
 * — the two do not disagree, since this clause is stating the basis of the
 * figures already in the sentence, and that note is a distinct converted one.
 */
export function incomeCliffSentence(cliff: IncomeCliff, mode: DollarsMode = 'real'): string {
  const { deathYear, before, after, dropPercent, survivorLabel } = cliff;
  const change =
    dropPercent > 0
      ? `falls ${dropPercent.toFixed(1)}%, from ${formatCurrency(before)}/yr the year before to ` +
        `${formatCurrency(after)}/yr the year after`
      : `does not fall — ${formatCurrency(before)}/yr the year before, ` +
        `${formatCurrency(after)}/yr the year after`;

  return (
    `At the first death, projected for ${deathYear}, household income ${change}, once ` +
    `${survivorLabel} is the household's only remaining member. These ${dollarsBasisClause(mode)}.`
  );
}

/**
 * The nominal-dollar equivalent of the income cliff's `after` figure, stated
 * in prose for the print surface only — the one nominal number clients
 * actually ask about ("but what will that really be, the year it happens?"),
 * preserved in words since the PDF cannot offer the on-screen toggle.
 *
 * Takes `nominalAfter` already computed rather than computing it here: this
 * module states figures, it never derives one — `lib/dollarsMode.ts`'s
 * `toNominalAmount` does the compounding, at the exact calendar year
 * (`cliff.deathYear + 1`) `incomeCliffSentence`'s own `after` figure is
 * priced at, so the two sentences can never disagree about which year they
 * mean.
 */
export function nominalFirstDeathNote(
  cliff: IncomeCliff,
  nominalAfter: number,
  annualCola: number,
): string {
  return (
    `In future (nominal) dollars — compounding the assumed ${formatPercent(annualCola, 2)} COLA ` +
    `forward from today — that ${cliff.deathYear + 1} figure is approximately ` +
    `${formatCurrency(nominalAfter)}.`
  );
}

/**
 * The income-cliff section heading, shared by the on-screen callout and the
 * PDF so it is not a literal hand-typed in both files — the exact mechanism
 * behind three of this project's prior defects, and one this task itself
 * added a second instance of on first pass.
 */
export const INCOME_CLIFF_HEADING = 'Income at the First Death';

/**
 * The "Survivor income" column header on the strategy comparison table,
 * shared by the on-screen table and its PDF twin so the word is not
 * hand-retyped into each.
 */
export const SURVIVOR_INCOME_COLUMN_HEADER = 'Survivor income';

/**
 * The caption under the strategy table's survivor-income column — the figure
 * a single lifetime PV number cannot show at all: what each strategy leaves
 * the survivor with, year after year. Shared by the on-screen table and the
 * PDF's twin so the sentence cannot be hand-retyped into one and drift from
 * the other.
 *
 * The leading sentence states that the figure assumes the death direction
 * implied by each spouse's own life-expectancy input — direction-agnostic
 * and true for every household, since that is genuinely what `firstDeath`
 * uses to pick who dies first, independent of who earns more. It does NOT
 * name a specific direction ("the lower-earning spouse outliving the higher
 * earner"): which spouse survives, for a given household, falls out of
 * `finalIndexByPersonId`, not PIA, and a fixed household can have the
 * higher earner as the modeled survivor with no `survivorGap` at all —
 * `detectSurvivorGap` only flags the cases where the engine's own step-up
 * rule (`strategy-calc.ts:104`, paid only to the lower-PIA dependent) misses
 * a real shortfall. An earlier version of this sentence hardcoded "the
 * lower-earning spouse outliving the higher earner" as if that direction
 * were always what the figures assumed; it read false beside a column
 * computed for a household whose higher earner was the one projected to
 * survive.
 *
 * The delay claim is CHECKED, not asserted. It used to read "Delaying raises
 * this every year the survivor lives through it" with no branch at all in the
 * no-gap case — the common case — and it is false for an ordinary household:
 * Dan b. 1958 PIA 2400 plan-to 78 with Sarah b. 1968 PIA 1200 plan-to 90 pays
 * the survivor $36,480 under the optimum and $0 under "both delay to 70",
 * because under that row Sarah has not filed by the year after Dan's death.
 * `survivorGap` is null for that household, so no gap branch covered it. An
 * older higher earner with a much younger spouse is the archetype this
 * analysis exists for, so the sentence now reads the rows it sits under
 * (`survivorIncomeRisesWithDelay`) and states the composition fact instead
 * whenever the figures do not actually rise.
 *
 * **Known divergence, ruled ship-as-is — a Phase 3 item, not a bug to fix in
 * this sentence.** A $0 in this column is a MODEL artifact, not a planning
 * result. `strategy-calc.ts:71-77` starts the survivor benefit at
 * `max(month after the death, the survivor's OWN filing date)`, so a survivor
 * who has not filed is paid nothing; SSA pays a widow(er) from age 60
 * regardless of whether they have filed on their own record. In the household
 * above, Sarah is 69 in the year that reads $0. The composition sentence this
 * function emits ("a strategy under which the survivor's own benefit has not
 * started by then shows $0") is therefore an accurate description of THE
 * MODEL and is not a statement of SSA's rule — deliberately, since this module
 * states what the pipeline computed and never asserts a benefit rule. A Phase
 * 3 fix must decide between modelling the age-60 start (a benefit rule the app
 * would then own) and disclosing the divergence; changing only this sentence
 * would describe the model wrongly without making the figures right. See
 * `docs/reference/ssa-tools-engine-audit.md` §5.2 and §2.3.
 *
 * `comparisons` is the first parameter and required, deliberately: a caller
 * cannot render this caption without handing it the very figures it makes a
 * claim about. It is the rows AS DISPLAYED — the same objects the table
 * renders, already in whichever dollars `mode` names. Monotonicity survives
 * that transform (it scales every row by the same positive factor), so the
 * branch cannot disagree with the column beneath it.
 *
 * The remaining branches, mirroring `survivorGapNote`'s own reason for
 * having three: a single unbranched sentence was wrong for some reachable
 * household in each case.
 *
 *  - no row carries a figure: both surfaces hide the column and this caption
 *    entirely (identical final months make `firstDeath` null and every cell
 *    an em dash). The branch exists anyway so a caller that renders it
 *    regardless states an absence rather than asserting figures that are not
 *    on the page — and it appends no dollars-basis clause, since there are no
 *    dollars to describe.
 *  - `gap.survivorUnder60`: no widow(er) benefit is payable this young under
 *    ANY strategy, and the death month is the same for every row (see
 *    `withSurvivorIncome`'s doc). Note this branch no longer asserts "every
 *    strategy's figure is $0" — the rise check reads the actual figures, so
 *    the claim does not need restating from the guard.
 *  - `gap` set, not under 60: the understate claim is true — reused as a
 *    pointer to `survivorGapNote` (rendered once already: `CombinedIncomeChart`
 *    on screen, the gap note under "Combined Household Income" in print)
 *    rather than restating its figures here, which is exactly the duplication
 *    that note's own history exists to prevent.
 *
 * No branch names the survivor — `survivorGapNote` already does, and this
 * caption stays generic so the two do not need to agree on phrasing for the
 * same fact.
 *
 * `mode` adds one more thing every figure-bearing branch states: which
 * dollars the column is in. The column sits directly beside "Combined PV",
 * which stays in present-value dollars regardless of this toggle — a real
 * risk of two unmarked unit systems in one table, worse once nominal makes
 * the two columns diverge further apart. `HouseholdPanel` is the only caller
 * that ever passes `'nominal'`; print always passes `'real'` explicitly,
 * since it has no toggle.
 */
export function survivorIncomeCaption(
  comparisons: HouseholdStrategy[],
  gap: SurvivorGap | null | undefined,
  mode: DollarsMode = 'real',
): string {
  const base =
    "Household income in the first full year after the first spouse's death, under each " +
    "strategy, assuming the death direction implied by each spouse's own life-expectancy " +
    'input.';

  if (!comparisons.some((c) => c.survivorIncome != null)) {
    return `${base} No strategy in this table has a figure to show for it.`;
  }

  const basisClause =
    mode === 'nominal'
      ? ' This column is in future (nominal) dollars, compounded forward using the assumed ' +
        'COLA — unlike Combined PV beside it, which stays in present-value dollars regardless ' +
        'of this toggle.'
      : ' This column is in today’s dollars, before any cost-of-living adjustment.';

  // The claim, made only when the figures below actually support it.
  const riseClause = survivorIncomeRisesWithDelay(comparisons)
    ? 'Delaying raises this figure for this household, and the survivor keeps the higher ' +
      'amount for every year they outlive their spouse — the argument for delaying that the ' +
      'Combined PV column alone cannot show.'
    : 'For this household the figure is not simply larger for later filing: it turns on what ' +
      'the first spouse to die had filed for AND on whether the survivor has begun collecting ' +
      'by that year — a strategy under which the survivor’s own benefit has not started by ' +
      'then shows $0, nothing having started yet rather than anything having been reduced.';

  const gapClause = !gap
    ? ''
    : gap.survivorUnder60
      ? ' The survivor has not yet reached the age a widow(er) benefit can start — see the ' +
        'note below for what changes from age 60 onward.'
      : ' The ssa.tools engine does not model survivor benefits in this household’s ' +
        'direction, so these figures understate what the survivor would actually receive — ' +
        'see the note below.';

  return `${base} ${riseClause}${gapClause}${basisClause}`;
}
