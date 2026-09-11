import summary from './validationSummary.json';
import { ssaToolsCalculatorUrl, type SsaToolsPerson } from './ssaToolsLink';

/**
 * What the app can honestly say about its own checking.
 *
 * A static build cannot run a test suite, so this renders an artifact
 * generated from the golden fixtures by
 * `validation/scripts/gen-validation-summary.mjs`. Generated, never typed:
 * this project has already shipped a panel that told readers something the
 * app could not check, and had to delete the sentence. `validationSummary.test.ts`
 * fails if this file and the fixtures disagree.
 *
 * What it is NOT: a claim that the suite passed on this machine, today. It
 * describes the households the project pins and what they are pinned to,
 * which is a fact about the repository rather than about a test run.
 */

export interface ValidationScenario {
  id: string;
  /** Plain language: "Married couple, born 6/15/1960". */
  label: string;
  status: 'single' | 'married' | 'widowed';
  people: SsaToolsPerson[];
  /** Each person's full retirement age, already formatted. */
  fra: string[];
  /** The first person's monthly benefit at three claiming ages. */
  monthly: Record<string, number>;
}

export const VALIDATION_SCENARIOS: ValidationScenario[] =
  summary.scenarios as ValidationScenario[];

/** The app version the fixtures were summarized from. */
export const VALIDATION_GENERATED_FROM: string = summary.generatedFrom;

/**
 * Where an adviser can check this household against ssa.tools.
 *
 * The same builder the cross-check suite uses, so the page that opens is the
 * page the suite diffed — not one that resembles it.
 */
export function checkOnSsaToolsUrl(scenario: ValidationScenario): string {
  return ssaToolsCalculatorUrl(scenario.people);
}

/** How many households are pinned, by household shape. */
export function scenarioCounts(): { total: number; single: number; married: number; widowed: number } {
  const counts = { total: VALIDATION_SCENARIOS.length, single: 0, married: 0, widowed: 0 };
  for (const s of VALIDATION_SCENARIOS) counts[s.status] += 1;
  return counts;
}
