import { baseSpousalBenefit } from '$lib/benefit-calculator';
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
   * under THIS strategy. Null for a single claimant. This is the argument for
   * delaying that lifetime PV cannot show: delaying raises the survivor's
   * income for every year they outlive their spouse.
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
    lowerEarnerLabel: string;
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
   * plan-to age. NOT derivable from `periods`: the dual-entitlement split
   * extends the deceased's personal band to the SURVIVOR's death, so the
   * band ends tell you nothing about when the first death happened.
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
  const ordered = [...rows, optimal].sort(
    (a, b) => a.filingAges[0].decimalYears - b.filingAges[0].decimalYears,
  );
  return { optimal, comparisons: ordered };
}

/**
 * Attaches `survivorIncome` to each comparison row: household income in the
 * first full year after the first death, computed under THAT row's own
 * filing ages — a fresh `householdPeriods`/`buildCombinedTimeline` pair per
 * row, not the optimal strategy's bands re-read. Null for a single claimant
 * (`rawPeople.length !== 2`) and for the same edge case `incomeCliff` returns
 * null for: the first death falling outside a row's own modeled timeline.
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
): HouseholdStrategy[] {
  if (rawPeople.length !== 2) return comparisons.map((c) => ({ ...c, survivorIncome: null }));

  const death = firstDeath([rawPeople[0].id, rawPeople[1].id], finalIndexByPersonId);
  if (death === null) return comparisons.map((c) => ({ ...c, survivorIncome: null }));

  return comparisons.map((c) => {
    const { bands } = householdPeriods(
      rawPeople,
      recipients,
      c.filingAges.map((f) => f.monthDuration),
      labels,
    );
    const timeline = buildCombinedTimeline(bands, peopleAnalysis);
    const point = timeline.find((p) => p.year === death.deathYear + 1);
    return { ...c, survivorIncome: point ? point.total : null };
  });
}

function createRecipientFor(person: Person) {
  return createPiaRecipient(person.birthYear, person.birthMonth, person.piaMonthly, person.gender);
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
  lowerEarnerLabel: string,
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
    // module picked as the lower earner. The engine classifies earner and
    // dependent with a strict PIA comparison and this module uses `>=`, so
    // the two disagree on an exact PIA tie; reading the recipient off the
    // band makes that disagreement unable to reach a date.
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
    const recipientA = createRecipientFor(personA);
    const recipientB = createRecipientFor(personB);

    const ranked = await rankedCoupleStrategies(
      recipientA,
      recipientB,
      assumptions.discountRate,
      asOf,
    );
    if (ranked.length === 0) {
      throw new Error('No eligible couple filing strategies');
    }

    const { optimal, comparisons } = buildComparisons(
      ranked,
      ranked[0],
      household.people,
      'married',
    );

    const people = household.people.map((person, i) =>
      analyzePerson(person, optimal.filingAges[i], assumptions.annualCola, asOf),
    );

    // The top-up accrues to the lower earner, claimed on the higher earner's
    // record. On a PIA tie, personA is treated as the higher earner — the
    // resulting top-up is 0 either way since half of equal PIAs cancels out.
    const aIsHigher = personA.piaMonthly >= personB.piaMonthly;
    const higher = aIsHigher ? recipientA : recipientB;
    const lower = aIsHigher ? recipientB : recipientA;
    const lowerIndex = aIsHigher ? 1 : 0;

    const labelA = personLabel(personA.name, 0);
    const labelB = personLabel(personB.name, 1);

    const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
      household.people,
      [recipientA, recipientB],
      optimal.filingAges.map((f) => f.monthDuration),
      [labelA, labelB],
    );

    const comparisonsWithSurvivor = withSurvivorIncome(
      comparisons,
      household.people,
      [recipientA, recipientB],
      [labelA, labelB],
      finalIndexByPersonId,
      people,
    );
    const optimalWithSurvivor = comparisonsWithSurvivor.find((c) => c.isOptimal) ?? optimal;

    return {
      status: 'married',
      people,
      optimal: optimalWithSurvivor,
      comparisons: comparisonsWithSurvivor,
      combinedTimeline: buildCombinedTimeline(bands, people),
      periods: bands,
      survivorGap,
      finalIndexByPersonId,
      spousalTopUp: spousalFiguresFrom(
        bands,
        { [personA.id]: recipientA, [personB.id]: recipientB },
        higher,
        lower,
        lowerIndex === 0 ? labelA : labelB,
      ),
      recommendation:
        `${labelA} files at ${optimal.filingAges[0].label} · ` +
        `${labelB} files at ${optimal.filingAges[1].label}`,
      recommendationDetail:
        `The ssa.tools couple optimizer maximizes combined expected present value at ` +
        `${formatCurrency(optimal.expectedNpv)} when ${labelA} files at age ` +
        `${optimal.filingAges[0].label} and ${labelB} files at age ` +
        `${optimal.filingAges[1].label}.`,
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
