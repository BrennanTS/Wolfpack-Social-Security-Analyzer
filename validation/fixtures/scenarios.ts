/**
 * Typed loader for the golden calculation fixtures.
 *
 * scenarios.json is the single source of truth for expected Social Security
 * values, hand-derived from SSA's published reduction/credit rules (see the
 * "conventions" field). It drives BOTH the Vitest engine suite
 * (validation/engine/golden.test.ts) and the Playwright UI suite
 * (validation/e2e/golden-scenarios.spec.ts) so expected values are never
 * duplicated.
 */
import { readFileSync } from 'node:fs';

export interface ScenarioInputs {
  birthYear: number;
  birthMonth: number;
  gender: 'female' | 'male';
  hasSpouse: boolean;
  monthlyBenefitAtFra: number;
  lifeExpectancy: number;
  annualCola: number;
  discountRate: number;
  spouseBirthYear?: number;
  spouseBirthMonth?: number;
  spouseMonthlyBenefitAtFra?: number;
}

export interface ExpectedBreakEven {
  earlierAge: number;
  laterAge: number;
  breakEvenAge: number;
}

export interface ScenarioExpected {
  fra: { years: number; months: number; label: string };
  monthlyByClaimAge: Record<string, number>;
  percentOfPiaByClaimAge: Record<string, number>;
  breakEvens: ExpectedBreakEven[];
  spousalBenefitAtFra: number | null;
  optimalAgeRange: [number, number];
  invariants: string[];
}

/**
 * 'full' runs the complete analyzeClaiming pipeline (optimizer, mortality
 * tables) and the Playwright UI suite — only valid while the cohort is under
 * 70, because the optimizer needs at least one prospective filing age.
 * 'factorsOnly' validates the deterministic benefit-factor math and never
 * ages out — used for older cohorts kept for FRA-schedule coverage.
 */
export type ScenarioMode = 'full' | 'factorsOnly';

export interface GoldenScenario {
  id: string;
  description: string;
  mode: ScenarioMode;
  inputs: ScenarioInputs;
  expected: ScenarioExpected;
  e2e: { assertTable: boolean; assertSummaryCards: boolean };
}

export interface GoldenFixtures {
  version: number;
  conventions: string;
  tolerances: {
    monthlyUsd: number;
    percentOfPia: number;
    breakEvenYears: number;
    crosscheckUsd: number;
  };
  scenarios: GoldenScenario[];
}

export function loadScenarios(): GoldenFixtures {
  const url = new URL('./scenarios.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as GoldenFixtures;
}
