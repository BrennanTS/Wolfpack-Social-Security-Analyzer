import { formatCurrency, personLabel } from './format';
import { analyzePerson, getFullRetirementAge, type Person, type PersonAnalysis } from './personAnalysis';
import {
  createPiaRecipient,
  findStrategyByAges,
  rankedCoupleStrategies,
  rankedSingleStrategies,
  spousalTopUp,
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
}

export interface CombinedTimelinePoint {
  year: number;
  byPersonId: Record<string, number>;
  total: number;
}

export interface HouseholdAnalysis {
  status: Household['status'];
  people: PersonAnalysis[];
  optimal: HouseholdStrategy;
  comparisons: HouseholdStrategy[];
  combinedTimeline: CombinedTimelinePoint[];
  spousalTopUp?: { atFra: number; atRecommendedFilingAge: number };
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
    });
  }

  // Present ascending by filing age so the table reads earliest to latest,
  // with the optimal row in its natural position.
  const ordered = [...rows, optimal].sort(
    (a, b) => a.filingAges[0].decimalYears - b.filingAges[0].decimalYears,
  );
  return { optimal, comparisons: ordered };
}

function createRecipientFor(person: Person) {
  return createPiaRecipient(person.birthYear, person.birthMonth, person.piaMonthly, person.gender);
}

/**
 * Household income per calendar year under the recommended strategy.
 *
 * A person contributes 12 monthly payments in every year after they have
 * filed and are still within their planning horizon, so the series steps up
 * as the second person files. Amounts are nominal at the recommended benefit;
 * the COLA slider is illustrative and applied by the chart layer.
 */
function buildCombinedTimeline(people: PersonAnalysis[]): CombinedTimelinePoint[] {
  const filingYear = (p: PersonAnalysis) => p.person.birthYear + p.recommendedFilingAge.years;
  const finalYear = (p: PersonAnalysis) => p.person.birthYear + p.person.lifeExpectancy;

  const start = Math.min(...people.map(filingYear));
  const end = Math.max(...people.map(finalYear));

  const points: CombinedTimelinePoint[] = [];
  for (let year = start; year <= end; year++) {
    const byPersonId: Record<string, number> = {};
    let total = 0;
    for (const p of people) {
      const active = year >= filingYear(p) && year <= finalYear(p);
      const amount = active ? Math.round(p.recommendedMonthly * 12 * 100) / 100 : 0;
      byPersonId[p.person.id] = amount;
      total += amount;
    }
    points.push({ year, byPersonId, total: Math.round(total * 100) / 100 });
  }
  return points;
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

    return {
      status: 'married',
      people,
      optimal,
      comparisons,
      combinedTimeline: buildCombinedTimeline(people),
      spousalTopUp: {
        atFra: spousalTopUp(higher, lower, lower.normalRetirementAge()),
        atRecommendedFilingAge: spousalTopUp(
          higher,
          lower,
          optimal.filingAges[lowerIndex].monthDuration,
        ),
      },
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
  const recipientRanked = await rankedSingleStrategies(
    createRecipientFor(person),
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

  return {
    status: 'single',
    people,
    optimal,
    comparisons,
    combinedTimeline: buildCombinedTimeline(people),
    recommendation: `Claim at age ${optimal.filingAges[0].label}`,
    recommendationDetail:
      `ssa.tools recommends filing at age ${optimal.filingAges[0].label} ` +
      `(${formatCurrency(people[0].recommendedMonthly)}/month) for the highest expected ` +
      `present value, ${formatCurrency(optimal.expectedNpv)}.`,
    assumptions,
    asOf,
  };
}
