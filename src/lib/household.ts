import { baseSpousalBenefit, higherEarningsThan } from '$lib/benefit-calculator';
import { classifyEarnerDependent } from '$lib/strategy/calculations/earner-dependent';
import { MonthDate, type MonthDuration } from '$lib/month-time';
import type { Recipient } from '$lib/recipient';
import { roundCents } from './benefitMath';
import {
  householdPeriods,
  monthsInYear,
  type BandType,
  type BenefitBand,
  type SurvivorGap,
} from './benefitPeriods';
import { deceasedPia, type Deceased } from './deceased';
import { formatCurrency, personLabel } from './format';
import { firstDeath } from './incomeCliff';
import { analyzePerson, getFullRetirementAge, type Person, type PersonAnalysis } from './personAnalysis';
import { survivorClaimAlternative, type SurvivorClaimAlternative } from './survivorClaim';
import {
  createPiaRecipient,
  findStrategyByAges,
  formatFilingAge,
  rankedCoupleStrategies,
  rankedSingleStrategies,
  type FilingAgeDisplay,
  type RankedStrategy,
} from './ssaTools';
import {
  clampToAttainable,
  DEFAULT_SCENARIO_SET,
  filingAgeMonths,
  scenarioLabel,
  type FilingAgeChoice,
  type Scenario,
  type ScenarioSet,
} from './scenario';
import {
  bestWidowedOutcome,
  widowedBands,
  widowedOutcomeFor,
  widowedSearchRanges,
  type AlreadyClaimed,
  type WidowedInput,
  type WidowedOutcome,
} from './widowed';

export interface Assumptions {
  annualCola: number;
  discountRate: number;
}

export type Household =
  | { status: 'single'; people: [Person] }
  | { status: 'married'; people: [Person, Person] }
  /**
   * A claimant whose spouse has already died. Distinct from `married` rather
   * than a flag on it: `people: [Person, Person]` means "two LIVING claimants"
   * everywhere it is read, and making this its own variant means the type
   * checker finds every `switch` on status that needs updating instead of
   * leaving a silent fallthrough.
   */
  | {
      status: 'widowed';
      people: [Person];
      deceased: Deceased;
      alreadyClaimed: AlreadyClaimed;
    };

/**
 * Which display shape the screen and the PDF should render.
 *
 * Three shapes, not two. ONE claimant (a single page, no tab strip, no
 * household section), TWO (tabs on screen, a household page in print), and a
 * WIDOW(ER), who is one person but not one benefit: their income is their own
 * retirement benefit and a survivor benefit on someone else's record, claimed
 * on two independent dates.
 *
 * Both surfaces used to decide with a boolean `status === 'married'`, which
 * silently routed a widowed household down the one-claimant path — no compile
 * error, and the result was not merely degraded but WRONG: that path shows
 * the widow(er)'s own retirement benefit alone, never mentioning the survivor
 * benefit that is usually the larger half of their income, and states a
 * recommended monthly figure that can be a third of what the recommendation
 * actually pays. Worse, `analyzeWidowed` deliberately empties
 * `claimingOptions`, so the single-claimant path's `claimingOptions.find(...)`
 * for the age-62 and age-70 summary cards returns `undefined` and the panel
 * throws.
 *
 * Until Phase 3B-ii-b this function THREW for `'widowed'` rather than pick a
 * wrong shape. The throw is gone because there is now a shape to name, not
 * because the risk went away: a `switch` with a `never` arm still makes a
 * fourth status a compile error here.
 */
export function householdDisplayShape(
  status: Household['status'],
): 'oneClaimant' | 'twoClaimants' | 'widowed' {
  switch (status) {
    case 'single':
      return 'oneClaimant';
    case 'married':
      return 'twoClaimants';
    case 'widowed':
      return 'widowed';
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled household status: ${String(unhandled)}`);
    }
  }
}

/** Rows a widowed household can show. `optimal` is shared with the couple set. */
type WidowedStrategyKey = 'survivorFirst' | 'ownFirst' | 'bothEarliest' | 'optimal';

/**
 * A comparison row's identity.
 *
 * A plain string for a single or married household, because the rows are the
 * adviser's own scenario list and the ids come from `ScenarioRow.id` — the
 * four built-ins keep the literals `optimal`, `earliest`, `fra` and `latest`
 * they have always had, so every existing selector and assertion still finds
 * them, and added rows are `s1`, `s2`, and so on. A widowed household's rows
 * are still derived by the engine rather than chosen, so those keys stay a
 * closed set.
 */
export type StrategyKey = string | WidowedStrategyKey;

export interface HouseholdStrategy {
  key: StrategyKey;
  label: string;
  filingAges: FilingAgeDisplay[];
  expectedNpv: number;
  /**
   * Undiscounted lifetime dollars, in today's dollars, through the plan-to
   * age. Non-null ONLY for a widowed household, whose optimum is scored this
   * way rather than by mortality-weighted expected present value.
   *
   * Display layers must branch on this before naming the figure: calling a
   * lifetime sum an "expected present value" is exactly the shape of defect
   * this project has shipped repeatedly. Null means `expectedNpv` is the
   * figure and it really is an NPV.
   */
  lifetimeTotal: number | null;
  /**
   * The month the survivor benefit is claimed, and the survivor's age then.
   * Non-null ONLY for a widowed household, whose recommendation is two dates
   * rather than one: `filingAges` carries the person's own filing age, and
   * this carries the other half of the decision. Without it the
   * `survivorFirst` and `ownFirst` rows differ only by their label.
   *
   * Null for single and married rows, where there is no separate survivor
   * claim date to state — for a married household the survivor benefit's
   * start is not a decision variable at all (see `survivorClaim.ts`).
   *
   * Named `survivorClaimDate` rather than `survivorClaim`, deliberately, to
   * avoid colliding in name (though not in shape) with
   * `HouseholdAnalysis.survivorClaim` — the Phase 3A married-household
   * alternative, a different type entirely (`SurvivorClaimAlternative`, with
   * `claimIndex`/`baselineTotal`/`gain`/etc.) that stays `null` for a widowed
   * household. Two same-named nullable "survivor claim" fields on sibling
   * types, meaning different things, is exactly the kind of thing this
   * project's own copy defects have come from.
   */
  survivorClaimDate: { monthIndex: number; age: string } | null;
  deltaVsOptimal: number;
  isOptimal: boolean;
  /**
   * Whether THIS row is the one the rest of the analysis is built on.
   *
   * Distinct from `isOptimal`, and equal to it only while the scenario is
   * `best`. Exactly one row of a `comparisons` array carries it, and that row
   * is the one whose filing ages produced `periods`, `combinedTimeline`,
   * `spousalTopUp`, `survivorClaim`, `incomeCliff` and every figure either
   * surface prints outside the table itself.
   */
  isSelected: boolean;
  /**
   * Kept out of both rendered tables at the adviser's request. Always false
   * in `HouseholdAnalysis.comparisons`, which is already filtered — this flag
   * only means anything on `allComparisons`, where the editor reads it.
   */
  hidden: boolean;
  /**
   * Annual household income in the first full year after the first death,
   * under THIS strategy. Null for a single claimant, and for the edge cases
   * `withSurvivorIncome` documents.
   *
   * The column exists because lifetime PV cannot show this figure at all —
   * NOT because delaying always raises it. It does for many households, and
   * for those the caption says so; it does not for an older higher earner
   * with a much younger spouse, where "both delay to 70" leaves the survivor
   * unfiled in the year after the death and the figure is $0 against $36,480
   * under the optimum. `survivorIncomeRisesWithDelay` is the check, and the
   * caption branches on it rather than asserting either way.
   */
  survivorIncome: number | null;
}

export interface CombinedTimelinePoint {
  year: number;
  /** Keyed `${personId}:${type}` — the chart's stacked series. */
  bySeries: Record<string, number>;
  /** Per-person roll-up. The tooltip and the PDF summary both want a person's total. */
  byPersonId: Record<string, number>;
  total: number;
}

export interface HouseholdAnalysis {
  status: Household['status'];
  people: PersonAnalysis[];
  /**
   * The optimizer's own answer, always — never the reader's scenario. Kept
   * beside `selected` so the cost of deviating is a subtraction rather than a
   * second analysis, and so a display layer can always name what it is
   * being compared against.
   */
  optimal: HouseholdStrategy;
  /**
   * The strategy every other figure in this object was computed from.
   * Identical to `optimal` while the scenario is `best`, which is the default
   * and was the only possibility before scenarios existed.
   *
   * Read this — not `optimal` — for anything describing what is on screen.
   * `people[i].filingAge`, `periods`, `combinedTimeline`, `spousalTopUp`,
   * `survivorClaim` and `recommendation` all derive from it.
   */
  selected: HouseholdStrategy;
  /**
   * Whether `selected` is the optimizer's own pick. Not `selected.isOptimal`
   * re-spelled: a custom scenario that happens to name the optimal ages
   * resolves to the optimal row and is `true` here, which is the honest
   * answer — the reader is looking at the optimum, however they got there.
   */
  scenarioIsBest: boolean;
  /**
   * Every filing age this household could actually choose, per person, in
   * DISPLAY order and ascending. Taken from the engine's own ranked set
   * rather than derived as "62 through 70": the floor is the person's
   * current age (the optimizer returns nothing earlier), and for most people
   * the true earliest retirement filing age is 62 years 1 month, not 62.
   *
   * Empty per person for a widowed household, which does not choose from a
   * single-record filing-age set at all — see `analyzeWidowed`.
   */
  filingAgeOptions: FilingAgeChoice[][];
  /**
   * The rows both surfaces render — VISIBLE rows only. Every existing reader
   * (the caption helpers, the survivor-income column gate, the PDF table)
   * gets the right set by default rather than having to remember to filter.
   */
  comparisons: HouseholdStrategy[];
  /**
   * Every row including the hidden ones, in the same order. Only the scenario
   * EDITOR reads this: a hidden row still has to show its ages there, or
   * un-hiding it would be a blind click.
   */
  allComparisons: HouseholdStrategy[];
  combinedTimeline: CombinedTimelinePoint[];
  /**
   * The top-up accruing to the *lower earner*, claimed on the higher earner's
   * record. `lowerEarnerLabel` is carried alongside the amounts so display
   * layers can attribute them without re-deriving who the lower earner is —
   * re-deriving it in a component is exactly how the on-screen figure drifted
   * to being person-A-anchored while the PDF stayed lower-earner-anchored.
   */
  spousalTopUp?: {
    /** Unreduced entitlement, `max(0, higherPIA/2 − lowerPIA)`. No filing dates. */
    atFra: number;
    /** What is actually paid under the recommended strategy. */
    atRecommendedFilingAge: number;
    /**
     * The lower earner's age when the benefit begins, e.g. "68 years, 3
     * months". **Null when the engine emits no Spousal band at all** — there
     * is then no date to state, and every display layer must say so rather
     * than print a placeholder. Modelled as `null` rather than a sentinel
     * string precisely so the type system forces that decision at each call
     * site: a `'—'` sentinel chosen here once escaped into the PDF unguarded.
     *
     * A band with a `$0.00` amount is a different case and keeps its date:
     * the entitlement exists and does begin, it is just fully absorbed by the
     * lower earner's own delayed credits.
     */
    startsAtSpouseAge: string | null;
    /**
     * Null on an exact PIA tie. `higherEarningsThan` is a strict `>`, so on a
     * tie the engine's own classifier still has to pick a slot — but that
     * pick is positional (always the same array index), not a fact about
     * either person, and printing it would name whichever spouse happened to
     * be entered first. There genuinely is no lower earner for a household
     * with two equal PIAs, so this is modelled as an absence rather than an
     * arbitrary name, the same reasoning as `startsAtSpouseAge`.
     */
    lowerEarnerLabel: string | null;
  };
  /**
   * Every benefit the household receives, as dated bands straight from the
   * engine. The source of truth behind `combinedTimeline` and `spousalTopUp`
   * — both are derived from this rather than re-computed.
   */
  periods: BenefitBand[];
  /**
   * Set when the engine cannot model the survivor direction this household
   * would actually experience. Null when there is nothing to disclose.
   */
  survivorGap: SurvivorGap | null;
  /**
   * The best month the survivor could claim their OWN widow(er) benefit,
   * holding the recommendation's filing ages fixed — see `survivorClaim.ts`.
   * Null for a single claimant and for every household `survivorClaimAlternative`
   * itself declines to report on (see its own docstring for the full list).
   */
  survivorClaim: SurvivorClaimAlternative | null;
  /**
   * Each person's inclusive final month index — the month they reach their
   * plan-to age. NOT derivable from `periods`: a person who dies before
   * filing holds no band at all, so there is no band end to read their death
   * month off. (An earlier version of this note gave a different and simply
   * wrong reason — that the dual-entitlement split extends the DECEASED's
   * personal band to the survivor's death. It does not: `splitDualEntitlement`
   * carries forward `latestPersonalBand(bands, survivor.personId)`, the
   * survivor's OWN band, and the engine already ends the earner's personal
   * periods at `earnerFinalDate`, `strategy-calc.ts:104-110`.)
   */
  finalIndexByPersonId: Record<string, number>;
  recommendation: string;
  recommendationDetail: string;
  assumptions: Assumptions;
  asOf: Date;
  /**
   * Whether the deceased's PIA was recovered from a check amount rather than
   * known — a current check carries every COLA since filing, which the
   * engine's PIA does not, so the recovered figure is in that year's dollars.
   *
   * Null where there is no deceased record at all (single and married). A
   * display layer must label a `true` as an estimate rather than presenting it
   * as equivalent to a known PIA.
   */
  piaEstimated: boolean | null;
  /**
   * The deceased spouse's record, as the display layers need it. Non-null
   * ONLY for a widowed household.
   *
   * Carried on the analysis rather than re-read from the form by each
   * surface: the PDF has no access to form state at all, and the on-screen
   * card and the printed one must name the same PIA. The figure here is the
   * one the survivor benefit was actually computed from — including a PIA
   * recovered by bisection from a check amount, which is why `piaEstimated`
   * beside it is load-bearing rather than decorative.
   */
  deceased: DeceasedSummary | null;
}

/** What a display layer needs to state about the deceased. */
export interface DeceasedSummary {
  birthYear: number;
  /** 1-12. */
  birthMonth: number;
  deathYear: number;
  /** 1-12. */
  deathMonth: number;
  /**
   * The PIA the survivor benefit was computed from — known, or recovered from
   * a check amount. `HouseholdAnalysis.piaEstimated` says which.
   */
  piaMonthly: number;
  /**
   * When they filed, or null if they died without filing. Null is not the
   * same as "unknown": `deceasedContext` treats an unfiled death as filing at
   * the death date for the engine's purposes, and a display layer must say
   * "they had not filed" rather than print that substituted date as a fact.
   */
  filed: { year: number; month: number } | null;
}

/**
 * Widowed rows get their own labels rather than a third arm on the derived
 * scenario labels in `scenario.ts`: the
 * two statuses name different decisions, and forcing every couple key to carry
 * a widowed label it can never use would invite one being written.
 *
 * A FUNCTION of the row's own outcome, not a constant map. The constants it
 * replaced ("Survivor benefit first, own at 70", "Own benefit first, survivor
 * at FRA") named ages the row does not necessarily carry: `ranges.own[1]` is
 * age 70 only while `alreadyClaimed.ownSince` is null, and `ranges.survivor[1]`
 * is survivor-FRA only while `survivorSince` is null and survivor-FRA has not
 * already passed. With `ownSince = Jan 2030` the app printed a row labelled
 * "…own at 70" whose own filing age was "65 years, 7 months".
 *
 * `bothEarliest` states no age because it needs none, and it is the one row
 * whose wording stays true unconditionally: whenever either axis is collapsed
 * by `alreadyClaimed`, its (S, F) pair is identical to `survivorFirst`'s or
 * `ownFirst`'s and `analyzeWidowed`'s pair-dedupe drops it before it is ever
 * labelled.
 */
function widowedLabel(key: WidowedStrategyKey, outcome: WidowedOutcome): string {
  switch (key) {
    case 'survivorFirst':
      return `Survivor benefit first, own at ${outcome.ownFilingAge}`;
    case 'ownFirst':
      return `Own benefit first, survivor at ${outcome.survivorClaimAge}`;
    case 'bothEarliest':
      return 'Both as early as possible';
    case 'optimal':
      return 'Optimal';
  }
}

/**
 * Every filing age the engine will actually accept for each person, ascending.
 *
 * Read off `ranked` rather than derived from 62..70: the optimizer's own set
 * already encodes both the floor (a person past 62 cannot file at 62) and the
 * fact that retirement filing usually starts at 62 years 1 month. Building
 * the picker's options from any other source is how it comes to offer an age
 * that resolves to something else.
 *
 * Slot-indexed, so the returned arrays are in whatever order `ranked` is in —
 * ENGINE order for a couple. Callers map to display order themselves.
 */
function filingAgeOptionsFrom(ranked: RankedStrategy[]): FilingAgeChoice[][] {
  if (ranked.length === 0) return [];
  const perSlot: Map<number, FilingAgeChoice>[] = ranked[0].filingAges.map(() => new Map());
  for (const strategy of ranked) {
    strategy.filingAges.forEach((age, slot) => {
      const key = age.years * 12 + age.months;
      if (!perSlot[slot].has(key)) perSlot[slot].set(key, { years: age.years, months: age.months });
    });
  }
  return perSlot.map((options) =>
    [...options.values()].sort((a, b) => filingAgeMonths(a) - filingAgeMonths(b)),
  );
}

const agesOf = (strategy: RankedStrategy): FilingAgeChoice[] =>
  strategy.filingAges.map((f) => ({ years: f.years, months: f.months }));

const agesKey = (ages: readonly FilingAgeChoice[]) => ages.map(filingAgeMonths).join(',');

/**
 * One scenario's filing ages, or null when this household cannot reach them.
 *
 * The derived kinds are looked up exactly, and a miss means the row is
 * genuinely unattainable — a household where one person is already 64 has no
 * "both claim at 62" — so it is dropped from the table rather than shown with
 * substituted figures. Custom ages are CLAMPED instead of dropped, because a
 * row the adviser typed going quietly missing is worse than one that shifts
 * to the nearest reachable age and says so in the picker.
 *
 * `ages` on a custom scenario arrives in display order; `toEngineAges` is the
 * caller's own display→engine mapping, passed in rather than re-derived here
 * so this function never has to know which household ordering it is inside.
 */
function resolveScenario(
  ranked: RankedStrategy[],
  optimalStrategy: RankedStrategy,
  enginePeople: Person[],
  scenario: Scenario,
  toEngineAges: (ages: FilingAgeChoice[]) => FilingAgeChoice[],
): RankedStrategy | null {
  switch (scenario.kind) {
    case 'best':
      return optimalStrategy;
    case 'earliest':
      return findStrategyByAges(
        ranked,
        enginePeople.map(() => ({ years: 62, months: 0 })),
      );
    case 'latest':
      return findStrategyByAges(
        ranked,
        enginePeople.map(() => ({ years: 70, months: 0 })),
      );
    case 'fra':
      return findStrategyByAges(
        ranked,
        enginePeople.map((p) => {
          const fra = getFullRetirementAge(p.birthYear);
          return { years: fra.years, months: fra.months };
        }),
      );
    case 'custom': {
      if (scenario.ages.length !== enginePeople.length) return null;
      const options = filingAgeOptionsFrom(ranked);
      if (options.length !== scenario.ages.length) return null;
      const wanted = toEngineAges(scenario.ages);
      const clamped: FilingAgeChoice[] = [];
      for (let slot = 0; slot < wanted.length; slot++) {
        const choice = clampToAttainable(options[slot], wanted[slot]);
        if (choice === null) return null;
        clamped.push(choice);
      }
      return findStrategyByAges(ranked, clamped);
    }
  }
}

/**
 * Turns the adviser's scenario list into comparison rows.
 *
 * One row per scenario, in filing-age order rather than list order: the table
 * reads earliest to latest on both surfaces, and that ordering is a function
 * of the strategies rather than of which person was typed into the form
 * first. (The sidebar keeps the adviser's own order — that is the editing
 * surface, and it does not have to agree.)
 *
 * Two rules on which rows survive:
 *
 *  - A DERIVED row whose ages another row already carries is folded away.
 *    "Both claim at FRA" and "Optimal" naming the same pair is noise, and
 *    printing it twice is what this fold has always prevented.
 *  - A CUSTOM row is never folded, even against an identical one. It exists
 *    because the adviser added it, it carries their own name for it, and it
 *    is visible and deletable in the sidebar. Silently dropping a row someone
 *    typed is a worse failure than showing two rows that agree.
 *
 * A folded row that happened to be selected hands its selection to the row it
 * folded into, so the analysis stays built on the ages the adviser chose
 * rather than falling back to the optimum with nothing saying so.
 */
function buildComparisons(
  ranked: RankedStrategy[],
  optimalStrategy: RankedStrategy,
  scenarios: ScenarioSet,
  enginePeople: Person[],
  status: Household['status'],
  toEngineAges: (ages: FilingAgeChoice[]) => FilingAgeChoice[],
): {
  optimal: HouseholdStrategy;
  selected: HouseholdStrategy;
  comparisons: HouseholdStrategy[];
  allComparisons: HouseholdStrategy[];
} {
  const isMarried = status === 'married';
  const optimalKey = agesKey(agesOf(optimalStrategy));

  interface Entry {
    id: string;
    label: string;
    strategy: RankedStrategy;
    derived: boolean;
    hidden: boolean;
  }

  const entries: Entry[] = [];
  const seenDerived = new Map<string, string>(); // ages → id of the row that won
  let selectedId = scenarios.selectedId;

  for (const row of scenarios.rows) {
    const strategy = resolveScenario(
      ranked,
      optimalStrategy,
      enginePeople,
      row.scenario,
      toEngineAges,
    );
    if (strategy === null) {
      // Unattainable named row, or a scenario shaped for a different
      // household. If it was the selected one, the selection falls back to
      // the optimum below.
      continue;
    }
    const derived = row.scenario.kind !== 'custom';
    const key = agesKey(agesOf(strategy));
    if (derived) {
      const winner = seenDerived.get(key);
      if (winner !== undefined) {
        if (selectedId === row.id) selectedId = winner;
        continue;
      }
      seenDerived.set(key, row.id);
    }
    entries.push({
      id: row.id,
      label: scenarioLabel(row, isMarried),
      strategy,
      derived,
      hidden: row.hidden === true,
    });
  }

  if (entries.length === 0) {
    throw new Error('No scenario in this list is attainable for this household');
  }

  // Exactly one row wears the Best badge and anchors every delta. The FIRST
  // row matching the optimum's ages takes it, which is the built-in Optimal
  // row whenever it is present — a custom row the adviser happened to set to
  // the optimum's ages sits beside it rather than competing for the badge.
  const optimalEntryId = entries.find((e) => agesKey(agesOf(e.strategy)) === optimalKey)?.id;

  // The selected row may have been dropped as unattainable, or the id may be
  // stale, or it may be hidden — `selectScenario`/`toggleScenarioHidden` keep
  // those two apart, but a hand-built set or an old share link need not.
  // Falling back to the optimum keeps `selected` meaningful and visible, and
  // `scenarioIsBest` then reports the truth of what is shown.
  if (!entries.some((e) => e.id === selectedId && !e.hidden)) {
    selectedId = optimalEntryId ?? entries.find((e) => !e.hidden)?.id ?? entries[0].id;
  }

  const rows: HouseholdStrategy[] = entries.map((entry) => ({
    key: entry.id,
    label: entry.label,
    filingAges: entry.strategy.filingAges,
    expectedNpv: entry.strategy.expectedNpv,
    lifetimeTotal: null,
    survivorClaimDate: null,
    deltaVsOptimal:
      Math.round((entry.strategy.expectedNpv - optimalStrategy.expectedNpv) * 100) / 100,
    isOptimal: entry.id === optimalEntryId,
    isSelected: entry.id === selectedId,
    hidden: entry.hidden,
    // Filled in by `withSurvivorIncome` once bands exist to compute it from —
    // `buildComparisons` runs before this household's `householdPeriods` call.
    survivorIncome: null,
  }));

  // Present ascending by filing age so the table reads earliest to latest.
  //
  // Sorted on a SYMMETRIC key — the earliest filing age in the row, then the
  // latest — rather than on `filingAges[0]`, one particular person's slot.
  // Person A's slot is not a property of the strategy: for Dan/Sarah the rows
  // came back `fra, latest, optimal` entered one way and `optimal, fra,
  // latest` entered the other, moving the row that carries the "Best" badge.
  // Both keys are order-independent by construction (min and max over the
  // same set). The list index breaks a tie between two rows with identical
  // ages, so a custom row and the built-in it duplicates keep a stable
  // relative order rather than depending on the sort's stability.
  const rowKey = (s: HouseholdStrategy, index: number) => {
    const ages = s.filingAges.map((f) => f.decimalYears);
    return { first: Math.min(...ages), last: Math.max(...ages), index };
  };
  const ordered = rows
    .map((row, index) => ({ row, sort: rowKey(row, index) }))
    .sort(
      (a, b) =>
        a.sort.first - b.sort.first ||
        a.sort.last - b.sort.last ||
        a.sort.index - b.sort.index,
    )
    .map((e) => e.row);

  const optimal = ordered.find((r) => r.isOptimal);
  const selected = ordered.find((r) => r.isSelected);
  if (optimal === undefined || selected === undefined) {
    throw new Error('Comparison rows lost the optimal or selected strategy');
  }
  return {
    optimal,
    selected,
    comparisons: ordered.filter((r) => !r.hidden),
    allComparisons: ordered,
  };
}

/**
 * Attaches `survivorIncome` to each comparison row: household income in the
 * first full year after the first death, computed under THAT row's own
 * filing ages — a fresh `householdPeriods`/`buildCombinedTimeline` pair per
 * row, not the optimal strategy's bands re-read for every row. Null for a
 * single claimant (`rawPeople.length !== 2`) and for the same edge case
 * `incomeCliff` returns null for: the first death falling outside a row's own
 * modeled timeline.
 *
 * `selectedBands` is the married branch's own `householdPeriods` call, already
 * in scope by the time this runs (needed there regardless, for
 * `combinedTimeline`/`spousalTopUp`/`periods`) — reused for the SELECTED row
 * rather than recomputed, since the selected row's filing ages are exactly the
 * ones that produced it. Every other row still gets its own fresh call, since
 * only the selected row's bands are already in scope.
 *
 * Keyed on `isSelected`, not `isOptimal`. The two coincide only while the
 * scenario is `best`; under any other scenario `selectedBands` belongs to the
 * chosen ages, and handing them to the optimal row would have printed the
 * scenario's survivor income on the optimum's line — a real figure attributed
 * to the wrong strategy, in the one column an adviser reads to compare them.
 *
 * The death year is computed once, via `firstDeath` — the same arithmetic
 * `incomeCliff` uses, reused rather than re-derived. The death months are
 * fixed by each person's plan-to age and do not vary by filing strategy, even
 * though the bands and totals around them do.
 */
function withSurvivorIncome(
  comparisons: HouseholdStrategy[],
  rawPeople: Person[],
  recipients: Recipient[],
  labels: string[],
  finalIndexByPersonId: Record<string, number>,
  peopleAnalysis: PersonAnalysis[],
  selectedBands: BenefitBand[],
): HouseholdStrategy[] {
  if (rawPeople.length !== 2) return comparisons.map((c) => ({ ...c, survivorIncome: null }));

  const death = firstDeath([rawPeople[0].id, rawPeople[1].id], finalIndexByPersonId);
  if (death === null) return comparisons.map((c) => ({ ...c, survivorIncome: null }));

  return comparisons.map((c) => {
    const bands = c.isSelected
      ? selectedBands
      : householdPeriods(
          rawPeople,
          recipients,
          c.filingAges.map((f) => f.monthDuration),
          labels,
        ).bands;
    const timeline = buildCombinedTimeline(bands, peopleAnalysis);
    const point = timeline.find((p) => p.year === death.deathYear + 1);
    return { ...c, survivorIncome: point ? point.total : null };
  });
}

function createRecipientFor(person: Person) {
  return createPiaRecipient(person.birthYear, person.birthMonth, person.piaMonthly, person.gender);
}

/**
 * The month a person reaches their plan-to age, on the same absolute month
 * index the bands use. Pure input arithmetic — birth month plus plan-to years
 * — not a benefit rule, and it orders identically to the engine's own
 * `finalDate` because every recipient this app builds shares one birth day
 * (`DEFAULT_BIRTH_DAY`), so no SSA day-of-month adjustment can separate two
 * people whose year and month agree.
 */
function projectedFinalMonth(person: Person): number {
  return (person.birthYear + person.lifeExpectancy) * 12 + person.birthMonth;
}

/**
 * Orders the two people for the ENGINE, on their own attributes alone.
 *
 * The engine is order-dependent on an exact PIA tie and the app cannot fix
 * that from outside: `classifyEarnerDependent` (`earner-dependent.ts:15-28`)
 * asks `higherEarningsThan`, a strict `>`, and falls through to a fixed
 * positional default — array slot 1 becomes the earner — whenever neither
 * side wins. That default reaches the engine through BOTH
 * `rankedCoupleStrategies` and `strategySumPeriodsCouple`, so on a tie the
 * typing order decided the recommended filing ages, whether a Survivor
 * period existed at all, and therefore the chart and the income cliff. The
 * measured case: two PIA-2200 spouses came back "Dan 63y9m / Sarah 70" one
 * way round and "Dan 70 / Sarah 62y1m" the other, with a $1,179/mo survivor
 * band in one and none in the other.
 *
 * So the pair is canonicalized once, here, before it enters the engine, and
 * the results are mapped back to display order. Every key is an attribute of
 * the household, never a slot:
 *
 *  1. PIA descending. This is the only key that fires for a household with a
 *     real higher earner, and it agrees with the engine's own classifier
 *     rather than overriding it — the classifier finds the higher earner
 *     wherever they sit.
 *  2. Projected final month descending — the person the household's own
 *     plan-to inputs say outlives the other goes into slot 0. On a PIA tie
 *     slot 0 is the engine's dependent, and the dependent is the only slot
 *     the engine ever pays a survivor benefit to (`strategy-calc.ts:104`), so
 *     this is the arrangement in which the projected survivor can actually
 *     receive one. It is a choice about which of two engine-admissible
 *     framings to show, not a benefit rule: the engine computes every amount
 *     either way.
 *  3. Birth date descending, then gender, then name — pure determinism, for
 *     households the first two keys cannot separate. Gender is in the chain
 *     because the optimizer weights by gender-specific life tables, so two
 *     otherwise-identical people are still not interchangeable to it. Name is
 *     last and is the only key the engine cannot see; it exists so a
 *     household identical in every engine input still renders the same way
 *     round each time.
 *
 * `id` is deliberately absent: ids are assigned by entry position ('a' then
 * 'b'), so ordering on one would reintroduce exactly the dependence this
 * removes.
 */
function compareForEngine(a: Person, b: Person): number {
  return (
    b.piaMonthly - a.piaMonthly ||
    projectedFinalMonth(b) - projectedFinalMonth(a) ||
    (b.birthYear * 12 + b.birthMonth - (a.birthYear * 12 + a.birthMonth)) ||
    a.gender.localeCompare(b.gender) ||
    (a.name ?? '').localeCompare(b.name ?? '')
  );
}

/**
 * Whether the survivor-income column (and its caption) belongs on the page at
 * all. Both surfaces call this rather than each spelling the test out, for
 * the same reason the sentences themselves are centralized: the screen table
 * and the PDF table are twins, and a gate hand-maintained in two files is how
 * they drift.
 *
 * Married-only, since a single claimant has no survivor — `household.ts` sets
 * `survivorIncome: null` there, and testing `peopleCount` as well means a
 * stray non-null value on a single-claimant row could not reveal the column.
 * And at least one row must actually carry a figure: when both people reach
 * their plan-to age in the same month `firstDeath` returns null for every
 * row, every cell renders an em dash, and a caption asserting anything about
 * those figures is asserting it over nothing.
 */
export function showSurvivorIncomeColumn(
  comparisons: HouseholdStrategy[],
  peopleCount: number,
): boolean {
  return peopleCount === 2 && comparisons.some((c) => c.survivorIncome != null);
}

/**
 * True when the survivor-income column rises with filing age for THIS
 * household — the claim the column's caption used to assert unconditionally.
 *
 * It is false for an ordinary household, not a contrived one: an older higher
 * earner with a much younger spouse (Dan b. 1958 PIA 2400 plan-to 78, Sarah
 * b. 1968 PIA 1200 plan-to 90) is paid $36,480 to the survivor under the
 * optimal strategy and **$0** under "both delay to 70", because under that
 * row the survivor has not filed by the year after the death and nothing has
 * started. `survivorGap` is null there, so no gap branch covered it either.
 *
 * "Delaying" is read COMPONENT-WISE: row R delays row S when every person
 * files at least as late in R as in S. That is the only reading under which
 * the claim is well defined. A single "total delay" number (the two ages
 * summed) mixes the two people and ranks strategies that are not comparable
 * at all — Dan and Sarah's own optimum (Dan 70 / Sarah 62y1m, $35,712) sums
 * to LESS than their FRA row (67/67, $28,800) while paying the survivor more,
 * because this figure tracks the first-to-die's filing age rather than the
 * household's total delay. Component-wise those two rows are simply
 * incomparable, 70/70 genuinely delays both of them, and it pays at least as
 * much as either.
 *
 * So: every comparable pair must be non-decreasing, and at least one pair
 * must strictly increase. A flat column (every row $0 — the
 * survivor-under-60 case) is therefore not "rising", and neither is a column
 * with no comparable pair in it. Rows with no figure are skipped rather than
 * counted as zero: a missing figure is not a low one.
 *
 * Comparing `filingAges[i]` across rows is slot-based, which is safe here and
 * only here — every row of one analysis holds the same person in slot i, so
 * swapping entry order permutes all rows alike and the relation is unchanged.
 */
export function survivorIncomeRisesWithDelay(comparisons: HouseholdStrategy[]): boolean {
  const rows = comparisons.filter(
    (c): c is HouseholdStrategy & { survivorIncome: number } => c.survivorIncome != null,
  );

  const delays = (later: HouseholdStrategy, earlier: HouseholdStrategy) =>
    later.filingAges.length === earlier.filingAges.length &&
    later.filingAges.every((f, i) => f.decimalYears >= earlier.filingAges[i].decimalYears);

  let sawIncrease = false;
  for (const later of rows) {
    for (const earlier of rows) {
      if (later === earlier || !delays(later, earlier)) continue;
      if (later.survivorIncome < earlier.survivorIncome) return false;
      if (later.survivorIncome > earlier.survivorIncome) sawIncrease = true;
    }
  }
  return sawIncrease;
}

/** The absolute month index convention `BenefitBand` uses, back to a MonthDate. */
export function monthDateAt(index: number): MonthDate {
  return MonthDate.initFromYearsMonths({
    years: Math.floor(index / 12),
    months: index % 12,
  });
}

/**
 * Household income per calendar year under the recommended strategy.
 *
 * Every figure is the engine's: each band contributes
 * `monthsInYear × monthlyAmount`, so a filing year, a death year and a
 * mid-year survivor step-up all carry their true number of payments rather
 * than a flat twelve. The bands carry no COLA and no consumer applies one, so
 * these are constant (real) dollars. (The previous comment here claimed the
 * chart layer applied the COLA slider; `HouseholdPanel` passes the timeline
 * straight through, so it never did.)
 *
 * This is a CALENDAR-YEAR sum, not an annual rate, and it is deliberately
 * left that way: `incomeCliff` and `survivorIncome` below both read only full
 * calendar years either side of a death, where a rate and a sum agree, so the
 * precision here costs them nothing. A version of this function briefly
 * credited the full annual rate to every year a band merely touched (to fix
 * the on-screen chart's ramps) — that duplicated a mid-year handover into
 * BOTH the outgoing and incoming band's full rate for the year they shared,
 * spiking a household above anything it ever actually received. The chart no
 * longer reads this function at all; it builds its own MONTHLY series from
 * the raw bands (`buildMonthlyIncomeSeries` below), where a month has exactly
 * the bands active that month and nothing can double up. This function is
 * back to exactly what it was before that attempt, for the readers that were
 * never part of the problem.
 *
 * `bySeries` keys each figure `${personId}:${type}` — the PDF's stacked
 * bars. `byPersonId` is derived from it by summing each person's series, so
 * the two cannot disagree.
 */
function buildCombinedTimeline(
  bands: BenefitBand[],
  people: PersonAnalysis[],
): CombinedTimelinePoint[] {
  if (bands.length === 0) return [];

  const start = Math.floor(Math.min(...bands.map((b) => b.startIndex)) / 12);
  const end = Math.floor(Math.max(...bands.map((b) => b.endIndex)) / 12);

  const points: CombinedTimelinePoint[] = [];
  for (let year = start; year <= end; year++) {
    // Seeded from `people` so every person keys into every year, including
    // years they are paid nothing — the chart stacks on a stable key set.
    const byPersonId: Record<string, number> = {};
    for (const p of people) byPersonId[p.person.id] = 0;

    const bySeries: Record<string, number> = {};
    for (const band of bands) {
      const amount = monthsInYear(band, year) * band.monthlyAmount;
      const seriesKey = `${band.personId}:${band.type}`;
      bySeries[seriesKey] = (bySeries[seriesKey] ?? 0) + amount;
    }

    for (const [seriesKey, amount] of Object.entries(bySeries)) {
      bySeries[seriesKey] = roundCents(amount);
      const personId = seriesKey.slice(0, seriesKey.lastIndexOf(':'));
      byPersonId[personId] = (byPersonId[personId] ?? 0) + bySeries[seriesKey];
    }

    let total = 0;
    for (const id of Object.keys(byPersonId)) {
      byPersonId[id] = roundCents(byPersonId[id]);
      total += byPersonId[id];
    }
    points.push({ year, bySeries, byPersonId, total: roundCents(total) });
  }
  return points;
}

export interface MonthlyIncomePoint extends CombinedTimelinePoint {
  /** Absolute month index — the same convention `BenefitBand.startIndex` uses. */
  monthIndex: number;
}

/**
 * Household income at MONTHLY resolution — the chart's own series, entirely
 * separate from `buildCombinedTimeline`'s calendar-year sums above (which
 * `incomeCliff` and `survivorIncome` still read, unchanged).
 *
 * A calendar year cannot represent a mid-year handover without distorting
 * something: prorating a partial year draws it as a ramp (what the user
 * objected to — Task 8's first attempt), and crediting the FULL annual rate
 * to every year a band merely touches double-counts a transition year,
 * because the outgoing band and the incoming band can each hold a nonzero
 * share of the same calendar year without ever being paid in the same month
 * (Task 8's second attempt — a household could show more income the year of
 * a death than it ever actually received). A month has neither problem: it
 * either falls inside a band or it doesn't, so at most one band of a given
 * type can be active for a given person in a given month, and no month can
 * ever sum two bands that were never both live at once. Every band renders
 * flat at its own annual rate (`monthlyAmount * 12`) for exactly the months
 * it pays, with a single clean step where one month's set of active bands
 * differs from the next.
 *
 * `bySeries`/`byPersonId`/`total` follow the exact same keys and roll-up
 * `buildCombinedTimeline` uses, so `visibleBenefitSeries` below (and
 * `benefitSeriesLabel`/`seriesColor` beyond this module) work on either
 * output unchanged — `MonthlyIncomePoint` is a `CombinedTimelinePoint` plus
 * `monthIndex`, not a parallel shape.
 */
export function buildMonthlyIncomeSeries(
  bands: BenefitBand[],
  people: Person[],
): MonthlyIncomePoint[] {
  if (bands.length === 0) return [];

  const start = Math.min(...bands.map((b) => b.startIndex));
  const end = Math.max(...bands.map((b) => b.endIndex));

  const points: MonthlyIncomePoint[] = [];
  for (let monthIndex = start; monthIndex <= end; monthIndex++) {
    // Seeded from `people` so every person keys into every month, including
    // months they are paid nothing — the chart stacks on a stable key set.
    const byPersonId: Record<string, number> = {};
    for (const p of people) byPersonId[p.id] = 0;

    const bySeries: Record<string, number> = {};
    for (const band of bands) {
      if (monthIndex < band.startIndex || monthIndex > band.endIndex) continue;
      const seriesKey = `${band.personId}:${band.type}`;
      bySeries[seriesKey] = (bySeries[seriesKey] ?? 0) + band.monthlyAmount * 12;
    }

    for (const [seriesKey, amount] of Object.entries(bySeries)) {
      bySeries[seriesKey] = roundCents(amount);
      const personId = seriesKey.slice(0, seriesKey.lastIndexOf(':'));
      byPersonId[personId] = (byPersonId[personId] ?? 0) + bySeries[seriesKey];
    }

    let total = 0;
    for (const id of Object.keys(byPersonId)) {
      byPersonId[id] = roundCents(byPersonId[id]);
      total += byPersonId[id];
    }
    points.push({
      monthIndex,
      year: Math.floor(monthIndex / 12),
      bySeries,
      byPersonId,
      total: roundCents(total),
    });
  }
  return points;
}

export interface VisibleBenefitSeries {
  /** `${personId}:${type}` — matches `CombinedTimelinePoint.bySeries`'s keys. */
  key: string;
  personId: string;
  /** The person's position in the `people` array passed in — for colour and label. */
  personIndex: number;
  type: BandType;
}

const BAND_TYPE_ORDER: Record<BandType, number> = { personal: 0, spousal: 1, survivor: 2 };

/**
 * The distinct benefit series actually present in a timeline, in stacking and
 * legend order — each person's own band first, then spousal, then survivor —
 * with any series that is zero at every point dropped.
 *
 * Both `CombinedIncomeChart` (screen) and `CombinedIncomeBars` (PDF) call
 * this rather than each deriving their own list, so a `$0.00` spousal band
 * (the engine emits one when a DRC-inflated personal benefit already exceeds
 * the combined cap — see `spousalFiguresFrom` above) disappears from both
 * surfaces identically instead of one of them drifting into rendering an
 * invisible band with a legend entry.
 */
export function visibleBenefitSeries(
  timeline: CombinedTimelinePoint[],
  people: Person[],
): VisibleBenefitSeries[] {
  const personIndexById = new Map<string, number>();
  people.forEach((p, i) => {
    personIndexById.set(p.id, i);
  });

  const seen = new Map<string, { personId: string; type: BandType }>();
  for (const point of timeline) {
    for (const key of Object.keys(point.bySeries)) {
      if (seen.has(key)) continue;
      const idx = key.lastIndexOf(':');
      seen.set(key, { personId: key.slice(0, idx), type: key.slice(idx + 1) as BandType });
    }
  }

  const defs: VisibleBenefitSeries[] = [];
  for (const [key, { personId, type }] of seen) {
    const isAllZero = timeline.every((point) => (point.bySeries[key] ?? 0) === 0);
    if (isAllZero) continue;
    // A `bySeries` key naming someone absent from `people` indicates the two
    // arguments are inconsistent with each other — a caller bug, not a data
    // shape to degrade gracefully on. Defaulting to person 0 used to draw
    // this series in person 0's colour under person 0's name: a wrong label
    // with no visible error, the worst failure shape on this project. Throw
    // instead, so it surfaces as a crash a caller can trace, not a chart that
    // quietly lies about whose money is whose.
    const personIndex = personIndexById.get(personId);
    if (personIndex === undefined) {
      throw new Error(
        `visibleBenefitSeries: series "${key}" names person "${personId}", who is not in ` +
          `the "people" array passed in`,
      );
    }
    defs.push({ key, personId, personIndex, type });
  }

  defs.sort(
    (a, b) => a.personIndex - b.personIndex || BAND_TYPE_ORDER[a.type] - BAND_TYPE_ORDER[b.type],
  );
  return defs;
}

/**
 * The spousal figures, read off the engine's Spousal band.
 *
 * The engine emits at most one Spousal period per household
 * (`strategy-calc.ts:145-162`), and it pushes that period on date validity
 * alone — so the band can carry $0.00 when a delayed-credit-inflated personal
 * benefit already exceeds the combined 50%-of-PIA cap. That band is kept, not
 * filtered: the entitlement genuinely exists and genuinely starts on that
 * date, and $0.00 is what is payable. Reporting the start alongside a $0
 * amount is also what the previous hand-rebuilt `spousalTopUp` did.
 *
 * When there is no band at all `startsAtSpouseAge` is null. That covers more
 * than the zero-entitlement case: `strategy-calc.ts:158` pushes the period
 * only when `endDate >= startDate`, so a lower earner who dies before the
 * higher earner files is eligible — `atFra` is positive — and still bandless.
 * Absence is modelled on the type rather than as a display glyph so no caller
 * can print it by accident.
 */
function spousalFiguresFrom(
  bands: BenefitBand[],
  recipientById: Record<string, Recipient>,
  higher: Recipient,
  lower: Recipient,
  lowerEarnerLabel: string | null,
): NonNullable<HouseholdAnalysis['spousalTopUp']> {
  const band = bands
    .filter((b) => b.type === 'spousal')
    .reduce<BenefitBand | undefined>(
      (first, b) => (first === undefined || b.startIndex < first.startIndex ? b : first),
      undefined,
    );

  return {
    // Unreduced reference figure — deliberately has no filing dates in it.
    atFra: roundCents(baseSpousalBenefit(higher, lower).value()),
    atRecommendedFilingAge: band?.monthlyAmount ?? 0,
    // Aged against the band's OWN recipient rather than against whoever this
    // module picked as the lower earner. `higher`/`lower` are now classified
    // via the engine's own `classifyEarnerDependent`, so the two cannot
    // disagree — but reading the date off the band's own `personId` keeps
    // this figure correct independent of that classification too.
    startsAtSpouseAge:
      band === undefined
        ? null
        : formatFilingAge(
            recipientById[band.personId].birthdate.ageAtSsaDate(monthDateAt(band.startIndex)),
          ).label,
    lowerEarnerLabel,
  };
}

/**
 * The sentence under the joint recommendation, on both surfaces.
 *
 * Lives here rather than in `methodologyCopy.ts` with the rest of this
 * branch's copy, deliberately: `methodologyCopy` already imports
 * `survivorIncomeRisesWithDelay` from this module, so moving this sentence
 * there would make the two modules import each other at runtime. A circular
 * module dependency is a worse defect than a sentence living one file away
 * from its siblings. Both call sites read `analysis.recommendationDetail`
 * rather than building a sentence, so the "hand-retyped in two files" failure
 * this project keeps hitting is not in play either.
 *
 * On an exact PIA tie the unqualified version overclaims. `higherEarningsThan`
 * is false both ways, so the engine can model either spouse as the dependent,
 * and the two models do not have to agree: on a same-age equal-PIA couple the
 * model this app does not show scored $288 (0.04%) higher. Calling this figure
 * "the maximum" would state as a fact something that is only true within the
 * framing `compareForEngine` picked. The tie branch therefore names the
 * framing and stops short of ranking the two — which is also the only wording
 * that stays true for a tie household whose alternative framing happens to be
 * identical, and this function does not know which kind it has without running
 * the optimizer twice, which is explicitly not what this app does.
 */
function coupleRecommendationDetail(
  isPiaTie: boolean,
  expectedNpv: number,
  labels: readonly [string, string],
  ages: readonly [string, string],
): string {
  if (isPiaTie) {
    return (
      `Both spouses have the same PIA, so neither is the engine's higher earner and it can ` +
      `model either one as the dependent. Under the model shown here, the best household ` +
      `value is ${formatCurrency(expectedNpv)}, with ${labels[0]} filing at ` +
      `age ${ages[0]} and ${labels[1]} at age ${ages[1]}. The other model is equally ` +
      `admissible and need not give the same ages or the same value.`
    );
  }

  return (
    `The couple optimizer maximizes the household's value at ${formatCurrency(expectedNpv)} ` +
    `when ${labels[0]} files at age ${ages[0]} and ${labels[1]} files at age ${ages[1]}, ` +
    `assuming each lives to the plan-to age set for them.`
  );
}

/**
 * The sentence under the card when the reader has chosen the filing ages
 * themselves rather than taking the optimizer's.
 *
 * One function for both surfaces and both statuses, for the same reason
 * `coupleRecommendationDetail` above is one function: this sentence states a
 * dollar shortfall against a named alternative, and a second hand-maintained
 * copy is how the two surfaces come to quote different figures for the same
 * household.
 *
 * The exact-tie branch is not defensive padding. A couple's optimizer returns
 * expected present values rounded to the cent, and distinct filing-age pairs
 * do land on the same value; without the branch the app prints "$0 less than
 * the best available", which reads as an error rather than as the (true and
 * useful) statement that this scenario costs nothing.
 */
function selectedScenarioDetail(
  labels: readonly string[],
  ages: readonly string[],
  optimalAges: readonly string[],
  selectedNpv: number,
  optimalNpv: number,
): string {
  // One phrase for both household shapes. "Combined" is redundant beside
  // "household", and neither is an *expected* value any more — the optimizer
  // discounts one assumed future rather than averaging over mortality.
  const value = 'household value';
  const filings = labels.map((l, i) => `${l} at age ${ages[i]}`).join(' and ');
  const bestFilings = labels.map((l, i) => `${l} at age ${optimalAges[i]}`).join(' and ');
  const shortfall = Math.round((optimalNpv - selectedNpv) * 100) / 100;

  if (shortfall <= 0) {
    return (
      `Every figure here is computed with ${filings}. It is worth ` +
      `${formatCurrency(selectedNpv)} in ${value} — the same as the optimizer's own ` +
      `choice, ${bestFilings}, so this scenario costs nothing.`
    );
  }

  return (
    `Every figure here is computed with ${filings}, not the optimizer's choice. It is ` +
    `worth ${formatCurrency(selectedNpv)} in ${value}, ${formatCurrency(shortfall)} less ` +
    `than the best available — ${bestFilings}, at ${formatCurrency(optimalNpv)}.`
  );
}

/**
 * A widow(er): one living claimant, two independent dates.
 *
 * Does not call the engine's strategy optimizer at all.
 * `strategySumPeriodsSingle` has no survivor concept, so ranking single-record
 * filing ages would score a stream that omits the survivor benefit entirely —
 * which is precisely the reason this status exists.
 */
async function analyzeWidowed(
  household: Extract<Household, { status: 'widowed' }>,
  assumptions: Assumptions,
  asOf: Date,
): Promise<HouseholdAnalysis> {
  const person = household.people[0];
  const label = personLabel(person.name, 0);
  const input: WidowedInput = {
    survivor: person,
    deceased: household.deceased,
    alreadyClaimed: household.alreadyClaimed,
    asOf,
  };

  const best = bestWidowedOutcome(input);
  const ranges = widowedSearchRanges(input);

  // The named rows, each a real (S, F) pair inside the searched ranges so
  // every row is attainable by construction.
  const named: { key: WidowedStrategyKey; pair: [number, number] }[] = [
    { key: 'survivorFirst', pair: [ranges.survivor[0], ranges.own[1]] },
    { key: 'ownFirst', pair: [ranges.survivor[1], ranges.own[0]] },
    { key: 'bothEarliest', pair: [ranges.survivor[0], ranges.own[0]] },
  ];

  const bands = widowedBands(input, best);

  // The month the LATER of the two recommended dates falls: once both benefits
  // are running, the amount stops changing. The bands stack to
  // `max(own, survivor)` by construction, so summing the bands covering that
  // month IS the engine's answer — no benefit rule is computed here.
  const steadyMonth = Math.max(best.survivorClaimIndex, best.ownFilingIndex);
  const steadyMonthly = roundCents(
    bands
      .filter((b) => b.startIndex <= steadyMonth && steadyMonth <= b.endIndex)
      .reduce((total, b) => total + b.monthlyAmount, 0),
  );

  // `analyzePerson` computes `claimingOptions`, `breakEvens` and
  // `monthlyAtFilingAge` from this person's OWN record alone. For a widow those
  // are not merely incomplete, they are misleading: her own benefit may be
  // smaller than the survivor benefit in every month she is alive, so a table
  // of "what you'd get claiming at 62 through 70" describes income she would
  // never receive, and a break-even between two of those ages compares two
  // irrelevant quantities. Measured: break-evens came out byte-identical
  // across every widowed golden fixture regardless of the deceased's PIA.
  //
  // Emptied HERE rather than guarded in each display component, so the
  // misleading section disappears by construction — `BreakEvenSection` already
  // renders nothing on an empty array. Every component remembering to check a
  // status is exactly the failure mode that put a survivor-blind break-even in
  // front of a widow in the first place.
  const own = analyzePerson(
    person,
    formatFilingAge(monthDurationBetween(person, best.ownFilingIndex)),
    assumptions.annualCola,
    asOf,
  );
  const people = [
    { ...own, claimingOptions: [], breakEvens: [], monthlyAtFilingAge: steadyMonthly },
  ];

  const toStrategy = (
    key: WidowedStrategyKey,
    outcome: WidowedOutcome,
    isOptimal: boolean,
  ): HouseholdStrategy => ({
    key,
    label: widowedLabel(key, outcome),
    filingAges: [formatFilingAge(monthDurationBetween(person, outcome.ownFilingIndex))],
    expectedNpv: outcome.lifetimeTotal,
    lifetimeTotal: outcome.lifetimeTotal,
    survivorClaimDate: { monthIndex: outcome.survivorClaimIndex, age: outcome.survivorClaimAge },
    deltaVsOptimal: roundCents(outcome.lifetimeTotal - best.lifetimeTotal),
    isOptimal,
    // A widowed household chooses two dates, not one filing age, so the
    // scenario picker has nothing to offer it and `analyzeWidowed` ignores
    // the scenario entirely — see `filingAgeOptions`. The selected row is
    // therefore always the optimum here, which is what this branch did
    // before scenarios existed.
    isSelected: isOptimal,
    // Nothing hides a widowed row: the scenario editor does not render for a
    // household whose rows the engine derives rather than the adviser.
    hidden: false,
    survivorIncome: null,
  });

  const optimal = toStrategy('optimal', best, true);
  const comparisons: HouseholdStrategy[] = [optimal];
  // Dedupe on the (S, F) pair itself, not just against the optimum: when a
  // range has collapsed to a single point (e.g. `alreadyClaimed.ownSince` is
  // set — `widowedSearchRanges` collapses `own` to `[f, f]`), two DIFFERENT
  // named rows can land on the identical pair without either matching the
  // optimum's pair. Folding only against the optimum let `survivorFirst` and
  // `bothEarliest` print as separate rows with identical filing ages and
  // identical `lifetimeTotal`, differing only in label.
  const seenPairs = new Set<string>([`${best.survivorClaimIndex},${best.ownFilingIndex}`]);
  for (const { key, pair } of named) {
    const pairKey = `${pair[0]},${pair[1]}`;
    if (seenPairs.has(pairKey)) continue; // Folded into an already-shown row.
    seenPairs.add(pairKey);
    comparisons.push(toStrategy(key, widowedOutcomeFor(input, pair[0], pair[1]), false));
  }

  // Read off `best.finalIndex` — the search's own final month — rather than
  // `Math.max(...bands.map((b) => b.endIndex))`: `widowedBands` omits a band
  // entirely whenever its amount rounds to zero or its start falls after the
  // final index, so `bands` can legitimately be empty (a $0 own PIA and $0
  // recovered deceased PIA; a death after the survivor's plan-to age), and
  // `Math.max` over an empty array is `-Infinity` — which `JSON.stringify`
  // silently turns into `null` rather than an obviously-wrong sentinel.
  const finalIndexByPersonId: Record<string, number> = {
    [person.id]: best.finalIndex,
  };

  return {
    status: 'widowed',
    people,
    optimal,
    selected: optimal,
    scenarioIsBest: true,
    filingAgeOptions: [[]],
    comparisons,
    allComparisons: comparisons,
    combinedTimeline: buildCombinedTimeline(bands, people),
    periods: bands,
    survivorGap: null,
    survivorClaim: null,
    finalIndexByPersonId,
    recommendation:
      `Claim the survivor benefit at age ${best.survivorClaimAge}, ` +
      `and file on ${label}'s own record at age ${best.ownFilingAge}`,
    recommendationDetail:
      `SSA pays the larger of the two benefits each month, and deemed filing does not apply ` +
      `to survivor benefits, so these two dates are independent. Claiming the survivor ` +
      `benefit at age ${best.survivorClaimAge} and filing on ${label}'s own record at age ` +
      `${best.ownFilingAge} pays ${formatCurrency(best.lifetimeTotal)} over ${label}'s ` +
      `lifetime — a straight sum of dollars in today's dollars, not a present value.`,
    assumptions,
    asOf,
    piaEstimated: best.piaEstimated,
    // The PIA the search actually used, not the raw form input — for a check
    // amount those differ, and the recovered figure is the one every survivor
    // figure on the page came from.
    deceased: {
      birthYear: household.deceased.birthYear,
      birthMonth: household.deceased.birthMonth,
      deathYear: household.deceased.deathYear,
      deathMonth: household.deceased.deathMonth,
      piaMonthly: deceasedPia(household.deceased).piaMonthly,
      // `checkAmount` always carries a filing date and `pia` may not; the
      // union's shared field is already `YearMonth | null`.
      filed: household.deceased.record.filed,
    },
  };
}

/** The survivor's age, as a duration, at an absolute month index. */
function monthDurationBetween(person: Person, monthIndex: number): MonthDuration {
  const recipient = createRecipientFor(person);
  return recipient.birthdate.ageAtSsaDate(monthDateAt(monthIndex));
}

/**
 * `scenarios` is the adviser's list of comparison rows and which one the
 * ENTIRE analysis is built on. Defaulting it to the built-in four with
 * Optimal selected is what keeps every existing caller — the golden fixtures,
 * the sweep, every test written before scenarios existed — producing exactly
 * what it produced before.
 */
export async function analyzeHousehold(
  household: Household,
  assumptions: Assumptions,
  asOf: Date = new Date(),
  scenarios: ScenarioSet = DEFAULT_SCENARIO_SET,
): Promise<HouseholdAnalysis> {
  if (household.status === 'married') {
    const [personA, personB] = household.people;

    // The single point the pair enters the engine. Everything from here to
    // the returned object runs in ENGINE order, and `reorder` maps two-element
    // arrays between the two orders. A two-element permutation is its own
    // inverse, so ONE array and ONE function serve both directions: engine
    // slot i holds display person `order[i]`, and display person i sits in
    // engine slot `order[i]`.
    const order: readonly [number, number] =
      compareForEngine(personA, personB) <= 0 ? [0, 1] : [1, 0];
    const reorder = <T>(pair: readonly T[]): [T, T] => [pair[order[0]], pair[order[1]]];

    const enginePeople = reorder(household.people);
    const [recipient0, recipient1] = enginePeople.map(createRecipientFor);

    // Plan-to ages in ENGINE slot order, like everything else in this block:
    // the optimizer weights each recipient by their OWN horizon, and pairing
    // person A's age with person B's recipient would silently swap which of
    // them the household's inputs say outlives the other.
    const ranked = rankedCoupleStrategies(
      recipient0,
      recipient1,
      assumptions.discountRate,
      [enginePeople[0].lifeExpectancy, enginePeople[1].lifeExpectancy],
      asOf,
    );
    if (ranked.length === 0) {
      throw new Error('No eligible couple filing strategies');
    }

    const { optimal, selected, allComparisons } = buildComparisons(
      ranked,
      ranked[0],
      scenarios,
      enginePeople,
      'married',
      // Custom ages arrive in display order; everything below this line runs
      // in engine order. `reorder` is its own inverse for a two-element
      // permutation, so this is the same mapping used everywhere else here.
      (ages) => reorder(ages),
    );

    // Display order from here on for anything a reader sees attached to a
    // person: filing-age columns, the recommendation sentence, `people`.
    // Read off `selected`, not `optimal` — under a chosen scenario these are
    // different pairs, and this is the one the reader is looking at.
    const displayFilingAges = reorder(selected.filingAges);
    const displayOptimalAges = reorder(optimal.filingAges);
    // What each spouse would choose ALONE, for the contrast the person tabs
    // draw. Same optimizer, same discount rate, same plan-to age, same `asOf`
    // — the only difference is that the other person is not there, which is
    // exactly the comparison an adviser is being shown.
    //
    // Cheap enough to do unconditionally now that the optimizer takes a fixed
    // horizon rather than fetching and weighting a mortality table.
    const people = household.people.map((person, i) => {
      const solo = rankedSingleStrategies(
        createRecipientFor(person),
        assumptions.discountRate,
        person.lifeExpectancy,
        asOf,
      );
      return analyzePerson(
        person,
        displayFilingAges[i],
        assumptions.annualCola,
        asOf,
        solo.length > 0 ? solo[0].filingAges[0] : null,
        // The OPTIMUM's age for this person, not the shown scenario's. These
        // differ the moment an adviser selects any other row.
        displayOptimalAges[i],
      );
    });

    // The top-up accrues to the lower earner, claimed on the higher earner's
    // record. Classified via the engine's own `classifyEarnerDependent`
    // (strict `>` on PIA) rather than a local comparison, so this module
    // cannot disagree with the engine about who is the higher earner.
    // `earnerIndex` is an ENGINE slot, like everything else in this block.
    const { earnerIndex } = classifyEarnerDependent([recipient0, recipient1]);
    const slot0IsHigher = earnerIndex === 0;
    const higher = slot0IsHigher ? recipient0 : recipient1;
    const lower = slot0IsHigher ? recipient1 : recipient0;
    const lowerIndex = slot0IsHigher ? 1 : 0;

    // On an exact PIA tie `classifyEarnerDependent` still has to return SOME
    // slot — `higherEarningsThan` is a strict `>`, so it falls through to a
    // fixed positional default (always index 1) rather than breaking
    // symmetrically. The slot is now filled by `compareForEngine` rather than
    // by typing order, so the engine's answer is at least stable for a given
    // household — but it is still a slot, not a fact about either person, and
    // there genuinely is no lower earner when the two PIAs are equal.
    // Checked directly (neither is higher-earning than the other) rather
    // than inferred from `earnerIndex`, so this doesn't depend on knowing
    // which direction the classifier's default happens to point.
    const isPiaTie =
      !higherEarningsThan(recipient0, recipient1) && !higherEarningsThan(recipient1, recipient0);

    // Display-order labels — the text a reader sees. Reordered into engine
    // slots for everything that indexes by slot, so the label text stays
    // attached to the person it names whichever slot they landed in.
    const displayLabels: [string, string] = [
      personLabel(personA.name, 0),
      personLabel(personB.name, 1),
    ];
    const engineLabels = reorder(displayLabels);

    const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
      enginePeople,
      [recipient0, recipient1],
      selected.filingAges.map((f) => f.monthDuration),
      engineLabels,
    );

    // Canonicalized (engine-order) arrays throughout — NOT `people`/
    // `displayLabels` — for the same reason `householdPeriods` just above
    // takes them: a household's best survivor claim month is a fact about
    // the household, and reading it off display-order arrays would make it
    // depend on which spouse happened to be typed first, exactly the
    // dependence Phase 2b-ii closed for everything else in this function.
    const survivorClaim = survivorClaimAlternative(
      enginePeople,
      [recipient0, recipient1],
      selected.filingAges.map((f) => f.monthDuration),
      bands,
      finalIndexByPersonId,
      survivorGap,
      engineLabels,
    );

    // Hidden rows go through `withSurvivorIncome` too, so the editor shows a
    // row's real survivor income before it is un-hidden rather than a dash
    // that appears to be a property of the row.
    const comparisonsWithSurvivor = withSurvivorIncome(
      allComparisons,
      enginePeople,
      [recipient0, recipient1],
      engineLabels,
      finalIndexByPersonId,
      people,
      bands,
    );
    // Back to display order for the two-element arrays a reader sees. Every
    // other field is keyed by `personId` and so needs no mapping.
    const displayRows = comparisonsWithSurvivor.map((c) => ({
      ...c,
      filingAges: reorder(c.filingAges),
    }));
    // `buildComparisons` builds exactly one row with each flag, so neither
    // lookup can miss. Throwing rather than falling back to a synthesized row
    // keeps that guarantee checkable: the fallback this replaces silently
    // paired the optimum's label with the SELECTED strategy's filing ages the
    // moment the two diverged.
    const optimalRow = displayRows.find((c) => c.isOptimal);
    const selectedRow = displayRows.find((c) => c.isSelected);
    if (optimalRow === undefined || selectedRow === undefined) {
      throw new Error('Comparison rows lost the optimal or selected strategy');
    }

    return {
      status: 'married',
      people,
      optimal: optimalRow,
      selected: selectedRow,
      scenarioIsBest: selectedRow.isOptimal,
      filingAgeOptions: reorder(filingAgeOptionsFrom(ranked)),
      comparisons: displayRows.filter((c) => !c.hidden),
      allComparisons: displayRows,
      combinedTimeline: buildCombinedTimeline(bands, people),
      periods: bands,
      survivorGap,
      survivorClaim,
      finalIndexByPersonId,
      spousalTopUp: spousalFiguresFrom(
        bands,
        { [enginePeople[0].id]: recipient0, [enginePeople[1].id]: recipient1 },
        higher,
        lower,
        isPiaTie ? null : engineLabels[lowerIndex],
      ),
      recommendation:
        `${displayLabels[0]} files at ${displayFilingAges[0].label} · ` +
        `${displayLabels[1]} files at ${displayFilingAges[1].label}`,
      recommendationDetail: selectedRow.isOptimal
        ? coupleRecommendationDetail(isPiaTie, optimal.expectedNpv, displayLabels, [
            displayFilingAges[0].label,
            displayFilingAges[1].label,
          ])
        : selectedScenarioDetail(
            displayLabels,
            [displayFilingAges[0].label, displayFilingAges[1].label],
            [displayOptimalAges[0].label, displayOptimalAges[1].label],
            selected.expectedNpv,
            optimal.expectedNpv,
          ),
      assumptions,
      asOf,
      piaEstimated: null,
      deceased: null,
    };
  }

  if (household.status === 'widowed') {
    return analyzeWidowed(household, assumptions, asOf);
  }

  const [person] = household.people;
  const recipient = createRecipientFor(person);
  const recipientRanked = rankedSingleStrategies(
    recipient,
    assumptions.discountRate,
    person.lifeExpectancy,
    asOf,
  );
  if (recipientRanked.length === 0) {
    throw new Error('No eligible filing ages for this person');
  }

  const { optimal, selected, allComparisons } = buildComparisons(
    recipientRanked,
    recipientRanked[0],
    scenarios,
    household.people,
    'single',
    // One person: display order and engine order are the same order.
    (ages) => ages,
  );

  const people = [
    analyzePerson(
      person,
      selected.filingAges[0],
      assumptions.annualCola,
      asOf,
      // A single claimant's solo answer IS the household's, so there is
      // nothing to contrast — but the optimum still differs from the shown
      // scenario whenever one has been chosen.
      null,
      optimal.filingAges[0],
    ),
  ];

  const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
    household.people,
    [recipient],
    [selected.filingAges[0].monthDuration],
    [personLabel(person.name, 0)],
  );

  // A single claimant has no "first death" to speak of — `withSurvivorIncome`
  // short-circuits on the one-person `rawPeople` array without calling
  // `householdPeriods` again, so this is just the null-filling branch, called
  // here rather than duplicated so both branches use the same rule.
  const comparisonsWithSurvivor = withSurvivorIncome(
    allComparisons,
    household.people,
    [recipient],
    [personLabel(person.name, 0)],
    finalIndexByPersonId,
    people,
    bands,
  );
  // See the married branch: exactly one row carries each flag, and a silent
  // fallback here would attach the wrong label to real figures.
  const optimalRow = comparisonsWithSurvivor.find((c) => c.isOptimal);
  const selectedRow = comparisonsWithSurvivor.find((c) => c.isSelected);
  if (optimalRow === undefined || selectedRow === undefined) {
    throw new Error('Comparison rows lost the optimal or selected strategy');
  }

  return {
    status: 'single',
    people,
    optimal: optimalRow,
    selected: selectedRow,
    scenarioIsBest: selectedRow.isOptimal,
    filingAgeOptions: filingAgeOptionsFrom(recipientRanked),
    comparisons: comparisonsWithSurvivor.filter((c) => !c.hidden),
    allComparisons: comparisonsWithSurvivor,
    combinedTimeline: buildCombinedTimeline(bands, people),
    periods: bands,
    survivorGap,
    survivorClaim: null,
    finalIndexByPersonId,
    recommendation: `Claim at age ${selected.filingAges[0].label}`,
    recommendationDetail: selectedRow.isOptimal
      ? `The optimizer recommends filing at age ${optimal.filingAges[0].label} ` +
        `(${formatCurrency(people[0].monthlyAtFilingAge)}/month) for the highest household ` +
        `value, ${formatCurrency(optimal.expectedNpv)}, assuming they live to age ` +
        `${person.lifeExpectancy}.`
      : selectedScenarioDetail(
          [personLabel(person.name, 0)],
          [selected.filingAges[0].label],
          [optimal.filingAges[0].label],
          selected.expectedNpv,
          optimal.expectedNpv,
        ),
    assumptions,
    asOf,
    piaEstimated: null,
    deceased: null,
  };
}
