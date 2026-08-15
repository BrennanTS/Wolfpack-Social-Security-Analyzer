/**
 * Engine-level golden-value validation.
 *
 * Runs every scenario in validation/fixtures/scenarios.json against the
 * calculation engine and asserts the outputs match values hand-derived from
 * SSA's published rules. If a value here disagrees with the engine,
 * re-derive it by hand before deciding which side is wrong — never copy
 * engine output into the fixtures.
 *
 * 'full' scenarios exercise analyzeHousehold() (the exact pipeline the UI
 * uses, including the mortality-weighted optimizer). 'factorsOnly' scenarios
 * exercise the deterministic benefit-factor math directly so cohorts older
 * than 70 — which the optimizer rejects — keep their FRA-schedule coverage.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeBreakEvens, type ClaimingOption } from '../../src/lib/benefitMath';
import { analyzeHousehold, type Household } from '../../src/lib/household';
import { getFullRetirementAge } from '../../src/lib/personAnalysis';
import { fraLabel } from '../../src/lib/format';
import { createPiaRecipient, nearestWholeClaimAge, ssaMonthlyBenefitAtAge } from '../../src/lib/ssaTools';
import { loadScenarios, type GoldenScenario, type ScenarioInputs } from '../fixtures/scenarios';

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public',
);

const { tolerances, scenarios } = loadScenarios();
const fullScenarios = scenarios.filter((s) => s.mode === 'full');
const factorScenarios = scenarios.filter((s) => s.mode === 'factorsOnly');

// Serve the real mortality-table JSON from public/ so the async pipeline runs
// exactly as it does in the browser (same stub as src/lib/household.test.ts).
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const relative = String(url).replace(/^\//, '');
    const file = path.join(publicDir, relative);
    const contents = await readFile(file, 'utf8');
    return {
      ok: true,
      json: async () => JSON.parse(contents),
    } as Response;
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function toHousehold(inputs: ScenarioInputs): Household {
  const people = inputs.people.map((p, i) => ({
    id: (i === 0 ? 'a' : 'b') as 'a' | 'b',
    name: p.name,
    birthYear: p.birthYear,
    birthMonth: p.birthMonth,
    gender: p.gender,
    piaMonthly: p.piaMonthly,
    lifeExpectancy: p.lifeExpectancy,
  }));
  return inputs.status === 'married'
    ? { status: 'married', people: [people[0], people[1]] }
    : { status: 'single', people: [people[0]] };
}

const run = (s: GoldenScenario) =>
  analyzeHousehold(
    toHousehold(s.inputs),
    { annualCola: s.inputs.annualCola, discountRate: s.inputs.discountRate },
    new Date(s.inputs.asOf),
  );

function expectMonthlyMatches(
  expectedMonthlyByClaimAge: Record<string, number>,
  expectedPercentOfPiaByClaimAge: Record<string, number>,
  actualByAge: Map<number, { monthly: number; percentOfPia: number }>,
) {
  for (const [age, expectedMonthly] of Object.entries(expectedMonthlyByClaimAge)) {
    const actual = actualByAge.get(Number(age));
    expect(actual, `benefit for claim age ${age}`).toBeDefined();
    expect(
      Math.abs(actual!.monthly - expectedMonthly),
      `age ${age}: engine $${actual!.monthly} vs SSA-rules $${expectedMonthly}`,
    ).toBeLessThanOrEqual(tolerances.monthlyUsd);
  }
  for (const [age, expectedPercent] of Object.entries(expectedPercentOfPiaByClaimAge)) {
    const actual = actualByAge.get(Number(age))!;
    expect(
      Math.abs(actual.percentOfPia - expectedPercent),
      `age ${age}: engine ${actual.percentOfPia}% vs SSA-rules ${expectedPercent}%`,
    ).toBeLessThanOrEqual(tolerances.percentOfPia);
  }
}

function expectBreakEvensMatch(
  expectedBreakEvens: { earlierAge: number; laterAge: number; breakEvenAge: number }[],
  actual: { earlierAge: number; laterAge: number; breakEvenAge: number }[],
) {
  for (const expectedPair of expectedBreakEvens) {
    const pair = actual.find(
      (p) =>
        p.earlierAge === expectedPair.earlierAge &&
        p.laterAge === expectedPair.laterAge,
    );
    expect(
      pair,
      `break-even pair ${expectedPair.earlierAge} vs ${expectedPair.laterAge}`,
    ).toBeDefined();
    expect(
      Math.abs(pair!.breakEvenAge - expectedPair.breakEvenAge),
      `break-even ${expectedPair.earlierAge}v${expectedPair.laterAge}: engine ${pair!.breakEvenAge} vs hand-derived ${expectedPair.breakEvenAge}`,
    ).toBeLessThanOrEqual(tolerances.breakEvenYears);
  }
}

describe.each(fullScenarios)('golden scenario (full pipeline): $id', (scenario) => {
  it('matches the SSA full retirement age schedule for every person', async () => {
    const result = await run(scenario);
    scenario.expected.fraByPerson.forEach((expectedFra, i) => {
      const person = result.people[i];
      expect(person, `people[${i}]`).toBeDefined();
      expect(person.fra.years).toBe(expectedFra.years);
      expect(person.fra.months).toBe(expectedFra.months);
      expect(fraLabel(person.fra)).toBe(expectedFra.label);
    });
  });

  it('matches hand-derived monthly benefits and %PIA at every claim age, per person', async () => {
    const result = await run(scenario);
    scenario.expected.monthlyByClaimAgeByPerson.forEach((expectedMonthly, i) => {
      const person = result.people[i];
      const byAge = new Map(
        person.claimingOptions.map((o) => [
          o.age,
          { monthly: o.monthlyBenefit, percentOfPia: o.percentOfPia },
        ]),
      );
      expectMonthlyMatches(
        expectedMonthly,
        scenario.expected.percentOfPiaByClaimAgeByPerson[i],
        byAge,
      );
    });
  });

  it('matches hand-derived break-even ages (0% COLA), per person', async () => {
    const result = await run(scenario);
    scenario.expected.breakEvensByPerson.forEach((expectedBreakEvens, i) => {
      expectBreakEvensMatch(expectedBreakEvens, result.people[i].breakEvens);
    });
  });

  it('matches the expected spousal top-up at FRA', async () => {
    const result = await run(scenario);
    if (scenario.expected.spousalTopUpAtFra === null) {
      expect(result.spousalTopUp?.atFra ?? null).toBeNull();
    } else {
      expect(result.spousalTopUp).toBeDefined();
      expect(
        Math.abs(result.spousalTopUp!.atFra - scenario.expected.spousalTopUpAtFra),
      ).toBeLessThanOrEqual(tolerances.monthlyUsd);
    }
  });

  it("matches the expected spousal top-up at the optimizer's chosen filing age", async () => {
    const result = await run(scenario);
    if (scenario.expected.spousalTopUpAtFilingAge === null) {
      expect(result.spousalTopUp?.atRecommendedFilingAge ?? null).toBeNull();
    } else {
      expect(result.spousalTopUp).toBeDefined();
      expect(
        Math.abs(
          result.spousalTopUp!.atRecommendedFilingAge -
            scenario.expected.spousalTopUpAtFilingAge,
        ),
      ).toBeLessThanOrEqual(tolerances.monthlyUsd);
    }
  });

  it('satisfies structural invariants', async () => {
    const result = await run(scenario);

    scenario.expected.optimalAgeRangeByPerson.forEach(([minOptimal, maxOptimal], i) => {
      const person = result.people[i];
      const optimalAge = nearestWholeClaimAge(person.recommendedFilingAge.decimalYears);
      expect(optimalAge).toBeGreaterThanOrEqual(minOptimal);
      expect(optimalAge).toBeLessThanOrEqual(maxOptimal);
    });

    if (scenario.expected.invariants.includes('monthlyMonotonicIncreasing')) {
      // Only over the people the fixture actually asserts a benefit table
      // for — an unasserted person (e.g. a spouse with no earnings record,
      // PIA $0) legitimately has a flat, non-monotonic table.
      for (let i = 0; i < scenario.expected.monthlyByClaimAgeByPerson.length; i++) {
        const person = result.people[i];
        const monthlies = person.claimingOptions.map((o) => o.monthlyBenefit);
        for (let i = 1; i < monthlies.length; i++) {
          expect(
            monthlies[i],
            `monthly benefit must increase with claim age (age ${person.claimingOptions[i].age})`,
          ).toBeGreaterThan(monthlies[i - 1]);
        }
      }
    }

    if (scenario.expected.invariants.includes('expectedPvPositive')) {
      expect(result.optimal.expectedNpv).toBeGreaterThan(0);
    }

    if (scenario.expected.invariants.includes('spousalTopUpReducedWhenClaimedEarly')) {
      const lowerIndex =
        result.people[0].person.piaMonthly >= result.people[1].person.piaMonthly ? 1 : 0;
      const filedEarly =
        result.people[lowerIndex].recommendedFilingAge.decimalYears <
        result.people[lowerIndex].fra.years + result.people[lowerIndex].fra.months / 12;
      if (filedEarly) {
        expect(result.spousalTopUp!.atRecommendedFilingAge).toBeLessThan(
          result.spousalTopUp!.atFra,
        );
      }
    }
  });
});

describe.each(factorScenarios)('golden scenario (factors only): $id', (scenario) => {
  const person = scenario.inputs.people[0];
  const recipient = () =>
    createPiaRecipient(person.birthYear, person.birthMonth, person.piaMonthly, person.gender);

  const claimAges = Object.keys(scenario.expected.monthlyByClaimAgeByPerson[0]).map(Number);

  it('matches the SSA full retirement age schedule', () => {
    const fra = getFullRetirementAge(person.birthYear);
    const expectedFra = scenario.expected.fraByPerson[0];
    expect(fra.years).toBe(expectedFra.years);
    expect(fra.months).toBe(expectedFra.months);
    expect(fraLabel(fra)).toBe(expectedFra.label);
  });

  it('matches hand-derived monthly benefits and %PIA at every claim age', () => {
    const r = recipient();
    const byAge = new Map(
      claimAges.map((age) => {
        const { benefit, percentOfPia } = ssaMonthlyBenefitAtAge(r, age);
        return [age, { monthly: benefit, percentOfPia }] as const;
      }),
    );
    expectMonthlyMatches(
      scenario.expected.monthlyByClaimAgeByPerson[0],
      scenario.expected.percentOfPiaByClaimAgeByPerson[0],
      byAge,
    );
  });

  it('matches hand-derived break-even ages (0% COLA)', () => {
    const r = recipient();
    // Feed the engine's own monthly benefits through the same break-even
    // routine the app uses, so the whole chain is exercised end to end.
    const options: ClaimingOption[] = claimAges.map((age) => {
      const { benefit, percentOfPia, monthsFromFra } = ssaMonthlyBenefitAtAge(r, age);
      return {
        age,
        monthlyBenefit: benefit,
        percentOfPia,
        lifetimeBenefits: 0,
        yearsOfPayments: 0,
        isEligible: true,
        monthsFromFra,
      };
    });
    expectBreakEvensMatch(scenario.expected.breakEvensByPerson[0], computeBreakEvens(options, 0));
  });

  it('monthly benefit increases monotonically with claim age', () => {
    const r = recipient();
    const monthlies = claimAges
      .sort((a, b) => a - b)
      .map((age) => ssaMonthlyBenefitAtAge(r, age).benefit);
    for (let i = 1; i < monthlies.length; i++) {
      expect(monthlies[i]).toBeGreaterThan(monthlies[i - 1]);
    }
  });
});
