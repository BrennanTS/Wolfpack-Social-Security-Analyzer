import { formatCurrency } from './format';
import { analyzePerson, getFullRetirementAge, type Person, type PersonAnalysis } from './personAnalysis';
import {
  createPiaRecipient,
  findStrategyByAges,
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

export async function analyzeHousehold(
  household: Household,
  assumptions: Assumptions,
  asOf: Date = new Date(),
): Promise<HouseholdAnalysis> {
  if (household.status === 'married') {
    throw new Error('Married households are implemented in Task 12');
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
    combinedTimeline: [],
    recommendation: `Claim at age ${optimal.filingAges[0].label}`,
    recommendationDetail:
      `ssa.tools recommends filing at age ${optimal.filingAges[0].label} ` +
      `(${formatCurrency(people[0].recommendedMonthly)}/month) for the highest expected ` +
      `present value, ${formatCurrency(optimal.expectedNpv)}.`,
    assumptions,
    asOf,
  };
}
