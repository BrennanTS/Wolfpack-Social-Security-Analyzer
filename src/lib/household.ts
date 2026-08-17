import { baseSpousalBenefit, higherEarningsThan } from '$lib/benefit-calculator';
import { classifyEarnerDependent } from '$lib/strategy/calculations/earner-dependent';
import { MonthDate } from '$lib/month-time';
import type { Recipient } from '$lib/recipient';
import { roundCents } from './benefitMath';
import {
  householdPeriods,
  monthsInYear,
  type BandType,
  type BenefitBand,
  type SurvivorGap,
} from './benefitPeriods';
import { formatCurrency, personLabel } from './format';
import { firstDeath } from './incomeCliff';
import { analyzePerson, getFullRetirementAge, type Person, type PersonAnalysis } from './personAnalysis';
import {
  createPiaRecipient,
  findStrategyByAges,
  formatFilingAge,
  rankedCoupleStrategies,
  rankedSingleStrategies,
  type FilingAgeDisplay,
  type RankedStrategy,
} from './ssaTools';

export interface Assumptions {
  annualCola: number;
  discountRate: number;
}

export type Household =
  | { status: 'single'; people: [Person] }
  | { status: 'married'; people: [Person, Person] };

export type StrategyKey = 'earliest' | 'fra' | 'optimal' | 'latest';

export interface HouseholdStrategy {
  key: StrategyKey;
  label: string;
  filingAges: FilingAgeDisplay[];
  expectedNpv: number;
  deltaVsOptimal: number;
  isOptimal: boolean;
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
  optimal: HouseholdStrategy;
  comparisons: HouseholdStrategy[];
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
}

const LABELS: Record<StrategyKey, { single: string; married: string }> = {
  earliest: { single: 'Claim at 62', married: 'Both claim earliest (62)' },
  fra: { single: 'Claim at FRA', married: 'Both claim at FRA' },
  optimal: { single: 'Optimal', married: 'Optimal' },
  latest: { single: 'Claim at 70', married: 'Both delay to 70' },
};

/**
 * Builds the comparison rows from the already-ranked strategy list.
 *
 * Rows whose filing ages are unattainable given `asOf` are omitted — the
 * optimizer only returns ages at or after each person's current age. When the
 * optimum coincides with a named row, that row is marked optimal rather than
 * duplicated.
 */
function buildComparisons(
  ranked: RankedStrategy[],
  optimalStrategy: RankedStrategy,
  people: Person[],
  status: Household['status'],
): { optimal: HouseholdStrategy; comparisons: HouseholdStrategy[] } {
  const namedAges: { key: StrategyKey; ages: { years: number; months: number }[] }[] = [
    { key: 'earliest', ages: people.map(() => ({ years: 62, months: 0 })) },
    {
      key: 'fra',
      ages: people.map((p) => {
        const fra = getFullRetirementAge(p.birthYear);
        return { years: fra.years, months: fra.months };
      }),
    },
    { key: 'latest', ages: people.map(() => ({ years: 70, months: 0 })) },
  ];

  const isOptimalAges = (ages: { years: number; months: number }[]) =>
    optimalStrategy.filingAges.every(
      (f, i) => f.years === ages[i].years && f.months === ages[i].months,
    );

  const key = status === 'married' ? 'married' : 'single';

  const optimal: HouseholdStrategy = {
    key: 'optimal',
    label: LABELS.optimal[key],
    filingAges: optimalStrategy.filingAges,
    expectedNpv: optimalStrategy.expectedNpv,
    deltaVsOptimal: 0,
    isOptimal: true,
    // Filled in by `withSurvivorIncome` once bands exist to compute it from —
    // `buildComparisons` runs before this household's `householdPeriods` call.
    survivorIncome: null,
  };

  const rows: HouseholdStrategy[] = [];
  for (const named of namedAges) {
    if (isOptimalAges(named.ages)) continue; // Folded into the optimal row.
    const match = findStrategyByAges(ranked, named.ages);
    if (!match) continue; // Unattainable given asOf.
    rows.push({
      key: named.key,
      label: LABELS[named.key][key],
      filingAges: match.filingAges,
      expectedNpv: match.expectedNpv,
      deltaVsOptimal: Math.round((match.expectedNpv - optimal.expectedNpv) * 100) / 100,
      isOptimal: false,
      survivorIncome: null,
    });
  }

  // Present ascending by filing age so the table reads earliest to latest,
  // with the optimal row in its natural position.
  //
  // Sorted on a SYMMETRIC key — the earliest filing age in the row, then the
  // latest — rather than on `filingAges[0]`, one particular person's slot.
  // Person A's slot is not a property of the strategy: for Dan/Sarah the rows
  // came back `fra, latest, optimal` entered one way and `optimal, fra,
  // latest` entered the other, moving the row that carries the "Best" badge.
  // Both keys are order-independent by construction (min and max over the
  // same set), so the row order is now a function of the strategies, not of
  // which person was typed first.
  const rowKey = (s: HouseholdStrategy) => {
    const ages = s.filingAges.map((f) => f.decimalYears);
    return { first: Math.min(...ages), last: Math.max(...ages) };
  };
  const ordered = [...rows, optimal].sort((a, b) => {
    const ka = rowKey(a);
    const kb = rowKey(b);
    return ka.first - kb.first || ka.last - kb.last;
  });
  return { optimal, comparisons: ordered };
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
 * `optimalBands` is the married branch's own `householdPeriods` call, already
 * in scope by the time this runs (needed there regardless, for
 * `combinedTimeline`/`spousalTopUp`/`periods`) — reused for the optimal row
 * rather than recomputed, since the optimal row's filing ages are exactly the
 * ones that produced it. Every other row still gets its own fresh call, since
 * only the optimal row's bands are already in scope.
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
  optimalBands: BenefitBand[],
): HouseholdStrategy[] {
  if (rawPeople.length !== 2) return comparisons.map((c) => ({ ...c, survivorIncome: null }));

  const death = firstDeath([rawPeople[0].id, rawPeople[1].id], finalIndexByPersonId);
  if (death === null) return comparisons.map((c) => ({ ...c, survivorIncome: null }));

  return comparisons.map((c) => {
    const bands = c.isOptimal
      ? optimalBands
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
function monthDateAt(index: number): MonthDate {
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
 * `bySeries` keys each figure `${personId}:${type}` — the chart's stacked
 * series. `byPersonId` is derived from it by summing each person's series, so
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

export async function analyzeHousehold(
  household: Household,
  assumptions: Assumptions,
  asOf: Date = new Date(),
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

    const ranked = await rankedCoupleStrategies(
      recipient0,
      recipient1,
      assumptions.discountRate,
      asOf,
    );
    if (ranked.length === 0) {
      throw new Error('No eligible couple filing strategies');
    }

    const { optimal, comparisons } = buildComparisons(ranked, ranked[0], enginePeople, 'married');

    // Display order from here on for anything a reader sees attached to a
    // person: filing-age columns, the recommendation sentence, `people`.
    const displayFilingAges = reorder(optimal.filingAges);
    const people = household.people.map((person, i) =>
      analyzePerson(person, displayFilingAges[i], assumptions.annualCola, asOf),
    );

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
      optimal.filingAges.map((f) => f.monthDuration),
      engineLabels,
    );

    const comparisonsWithSurvivor = withSurvivorIncome(
      comparisons,
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
    const optimalWithSurvivor = displayRows.find((c) => c.isOptimal) ?? {
      ...optimal,
      filingAges: displayFilingAges,
    };

    return {
      status: 'married',
      people,
      optimal: optimalWithSurvivor,
      comparisons: displayRows,
      combinedTimeline: buildCombinedTimeline(bands, people),
      periods: bands,
      survivorGap,
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
      recommendationDetail:
        `The ssa.tools couple optimizer maximizes combined expected present value at ` +
        `${formatCurrency(optimal.expectedNpv)} when ${displayLabels[0]} files at age ` +
        `${displayFilingAges[0].label} and ${displayLabels[1]} files at age ` +
        `${displayFilingAges[1].label}.`,
      assumptions,
      asOf,
    };
  }

  const [person] = household.people;
  const recipient = createRecipientFor(person);
  const recipientRanked = await rankedSingleStrategies(
    recipient,
    assumptions.discountRate,
    asOf,
  );
  if (recipientRanked.length === 0) {
    throw new Error('No eligible filing ages for this person');
  }

  const { optimal, comparisons } = buildComparisons(
    recipientRanked,
    recipientRanked[0],
    household.people,
    'single',
  );

  const people = [analyzePerson(person, optimal.filingAges[0], assumptions.annualCola, asOf)];

  const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
    household.people,
    [recipient],
    [optimal.filingAges[0].monthDuration],
    [personLabel(person.name, 0)],
  );

  // A single claimant has no "first death" to speak of — `withSurvivorIncome`
  // short-circuits on the one-person `rawPeople` array without calling
  // `householdPeriods` again, so this is just the null-filling branch, called
  // here rather than duplicated so both branches use the same rule.
  const comparisonsWithSurvivor = withSurvivorIncome(
    comparisons,
    household.people,
    [recipient],
    [personLabel(person.name, 0)],
    finalIndexByPersonId,
    people,
    bands,
  );
  const optimalWithSurvivor = comparisonsWithSurvivor.find((c) => c.isOptimal) ?? optimal;

  return {
    status: 'single',
    people,
    optimal: optimalWithSurvivor,
    comparisons: comparisonsWithSurvivor,
    combinedTimeline: buildCombinedTimeline(bands, people),
    periods: bands,
    survivorGap,
    finalIndexByPersonId,
    recommendation: `Claim at age ${optimal.filingAges[0].label}`,
    recommendationDetail:
      `ssa.tools recommends filing at age ${optimal.filingAges[0].label} ` +
      `(${formatCurrency(people[0].recommendedMonthly)}/month) for the highest expected ` +
      `present value, ${formatCurrency(optimal.expectedNpv)}.`,
    assumptions,
    asOf,
  };
}
