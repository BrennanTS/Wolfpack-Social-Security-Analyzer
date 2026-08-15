/**
 * Engine-level golden-value validation.
 *
 * Runs every scenario in validation/fixtures/scenarios.json against the
 * calculation engine and asserts the outputs match values hand-derived from
 * SSA's published rules. If a value here disagrees with the engine,
 * re-derive it by hand before deciding which side is wrong — never copy
 * engine output into the fixtures.
 *
 * 'full' scenarios exercise analyzeClaiming() (the exact pipeline the UI
 * uses, including the mortality-weighted optimizer). 'factorsOnly' scenarios
 * exercise the deterministic benefit-factor math directly so cohorts older
 * than 70 — which the optimizer rejects — keep their FRA-schedule coverage.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  analyzeClaiming,
  computeBreakEvens,
  fraLabel,
  getFullRetirementAge,
  type ClaimingOption,
  type UserInputs,
} from '../../src/lib/socialSecurity';
import { createPiaRecipient, ssaMonthlyBenefitAtAge } from '../../src/lib/ssaTools';
import { loadScenarios, type GoldenScenario } from '../fixtures/scenarios';

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public',
);

const { tolerances, scenarios } = loadScenarios();
const fullScenarios = scenarios.filter((s) => s.mode === 'full');
const factorScenarios = scenarios.filter((s) => s.mode === 'factorsOnly');

// Serve the real mortality-table JSON from public/ so the async pipeline runs
// exactly as it does in the browser (same stub as src/lib/socialSecurity.test.ts).
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

function expectMonthlyMatches(
  scenario: GoldenScenario,
  actualByAge: Map<number, { monthly: number; percentOfPia: number }>,
) {
  for (const [age, expectedMonthly] of Object.entries(
    scenario.expected.monthlyByClaimAge,
  )) {
    const actual = actualByAge.get(Number(age));
    expect(actual, `benefit for claim age ${age}`).toBeDefined();
    expect(
      Math.abs(actual!.monthly - expectedMonthly),
      `age ${age}: engine $${actual!.monthly} vs SSA-rules $${expectedMonthly}`,
    ).toBeLessThanOrEqual(tolerances.monthlyUsd);
  }
  for (const [age, expectedPercent] of Object.entries(
    scenario.expected.percentOfPiaByClaimAge,
  )) {
    const actual = actualByAge.get(Number(age))!;
    expect(
      Math.abs(actual.percentOfPia - expectedPercent),
      `age ${age}: engine ${actual.percentOfPia}% vs SSA-rules ${expectedPercent}%`,
    ).toBeLessThanOrEqual(tolerances.percentOfPia);
  }
}

function expectBreakEvensMatch(
  scenario: GoldenScenario,
  actual: { earlierAge: number; laterAge: number; breakEvenAge: number }[],
) {
  for (const expectedPair of scenario.expected.breakEvens) {
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
  const run = () => analyzeClaiming(scenario.inputs as UserInputs);

  it('matches the SSA full retirement age schedule', async () => {
    const result = await run();
    expect(result.fra.years).toBe(scenario.expected.fra.years);
    expect(result.fra.months).toBe(scenario.expected.fra.months);
    expect(fraLabel(result.fra)).toBe(scenario.expected.fra.label);
  });

  it('matches hand-derived monthly benefits and %PIA at every claim age', async () => {
    const result = await run();
    const byAge = new Map(
      result.claimingOptions.map((o) => [
        o.age,
        { monthly: o.monthlyBenefit, percentOfPia: o.percentOfPia },
      ]),
    );
    expectMonthlyMatches(scenario, byAge);
  });

  it('matches hand-derived break-even ages (0% COLA)', async () => {
    const result = await run();
    expectBreakEvensMatch(scenario, result.breakEvens);
  });

  it('matches the expected spousal top-up at FRA', async () => {
    const result = await run();
    if (scenario.expected.spousalBenefitAtFra === null) {
      expect(result.spousal?.spousalBenefitAtFra ?? null).toBeNull();
    } else {
      expect(result.spousal).toBeDefined();
      expect(
        Math.abs(
          result.spousal!.spousalBenefitAtFra -
            scenario.expected.spousalBenefitAtFra,
        ),
      ).toBeLessThanOrEqual(tolerances.monthlyUsd);
    }
  });

  it("matches the expected spousal top-up at the optimizer's chosen filing age", async () => {
    const result = await run();
    if (scenario.expected.spousalTopUpAtFilingAge === null) {
      expect(result.spousal?.spousalTopUpAtFilingAge ?? null).toBeNull();
    } else {
      expect(result.spousal).toBeDefined();
      expect(
        Math.abs(
          result.spousal!.spousalTopUpAtFilingAge -
            scenario.expected.spousalTopUpAtFilingAge,
        ),
      ).toBeLessThanOrEqual(tolerances.monthlyUsd);
    }
  });

  it('satisfies structural invariants', async () => {
    const result = await run();

    const [minOptimal, maxOptimal] = scenario.expected.optimalAgeRange;
    expect(result.optimalAge).toBeGreaterThanOrEqual(minOptimal);
    expect(result.optimalAge).toBeLessThanOrEqual(maxOptimal);

    if (scenario.expected.invariants.includes('monthlyMonotonicIncreasing')) {
      const monthlies = result.claimingOptions.map((o) => o.monthlyBenefit);
      for (let i = 1; i < monthlies.length; i++) {
        expect(
          monthlies[i],
          `monthly benefit must increase with claim age (age ${result.claimingOptions[i].age})`,
        ).toBeGreaterThan(monthlies[i - 1]);
      }
    }

    if (scenario.expected.invariants.includes('expectedPvPositive')) {
      expect(result.expectedPresentValue).toBeGreaterThan(0);
    }
  });
});

describe.each(factorScenarios)('golden scenario (factors only): $id', (scenario) => {
  const recipient = () =>
    createPiaRecipient(
      scenario.inputs.birthYear,
      scenario.inputs.birthMonth,
      scenario.inputs.monthlyBenefitAtFra,
      scenario.inputs.gender,
    );

  const claimAges = Object.keys(scenario.expected.monthlyByClaimAge).map(Number);

  it('matches the SSA full retirement age schedule', () => {
    const fra = getFullRetirementAge(scenario.inputs.birthYear);
    expect(fra.years).toBe(scenario.expected.fra.years);
    expect(fra.months).toBe(scenario.expected.fra.months);
    expect(fraLabel(fra)).toBe(scenario.expected.fra.label);
  });

  it('matches hand-derived monthly benefits and %PIA at every claim age', () => {
    const r = recipient();
    const byAge = new Map(
      claimAges.map((age) => {
        const { benefit, percentOfPia } = ssaMonthlyBenefitAtAge(r, age);
        return [age, { monthly: benefit, percentOfPia }] as const;
      }),
    );
    expectMonthlyMatches(scenario, byAge);
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
    expectBreakEvensMatch(scenario, computeBreakEvens(options, 0));
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
