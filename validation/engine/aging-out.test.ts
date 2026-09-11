import { describe, expect, it } from 'vitest';
import { loadScenarios, type ScenarioPerson } from '../fixtures/scenarios';
import { ssaBirthMonth } from '../../src/lib/ssaTools';

const { scenarios } = loadScenarios();

/**
 * How much warning to give before a UI scenario stops working.
 *
 * Twelve months is enough to notice, decide, and replace a fixture without
 * anyone being blocked. The failure this prevents arrives with no warning at
 * all and does not say what happened.
 */
const WARN_MONTHS = 12;

/**
 * The month a person turns 70, as an absolute month index.
 *
 * SSA's attainment rule applies: someone born on the 1st turns 70 in the
 * previous month, which is the same one-month shift that decides their FRA
 * cohort. Getting this wrong by a month would make the guard fire late for
 * exactly the claimants the birth-day work exists for.
 */
function turns70(person: ScenarioPerson): number {
  const ssa = ssaBirthMonth(person.birthYear, person.birthMonth, person.birthDay ?? 15);
  return (ssa.year + 70) * 12 + (ssa.month - 1);
}

function monthIndexOf(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/**
 * Golden scenarios expire, and until now they did it silently.
 *
 * The Playwright suite drives the live app against the REAL wall-clock date,
 * not each scenario's pinned `asOf`. Once every person in a household is past
 * 70 the optimizer has no prospective filing age left, `analyzeIfComplete`
 * throws, and the app renders its "Analysis unavailable" path — so the
 * scenario's assertions fail with a message naming neither the date nor the
 * cause. `sample-hh4-married-1955-wide-age-gap` was switched off only AFTER
 * it broke that way, and the file carries hand-written AGING-OUT warnings
 * about the next one. Those warnings are comments; this is the enforcement.
 *
 * Deliberately wall-clock rather than a pinned date: a guard that reads a
 * fixed `asOf` would never fire, which is the whole defect it exists to
 * prevent. It is expected to fail one day — a year before anything breaks,
 * naming the scenario and the month.
 */
describe('golden scenarios that the UI suite drives', () => {
  const uiScenarios = scenarios.filter((s) => s.mode === 'full' && s.e2e.assertTable);

  it('has some to check, so a filter change cannot quietly empty this', () => {
    expect(uiScenarios.length).toBeGreaterThan(10);
  });

  it.each(uiScenarios.map((s) => [s.id, s] as const))(
    'still has a prospective filing age in %s',
    (_id, scenario) => {
      const now = monthIndexOf(new Date());
      // The EARLIEST person to turn 70, not the latest. `full` mode is valid
      // only while every person is under 70, because the optimizer needs a
      // prospective filing age for each of them — so the household expires
      // with its oldest member, not its youngest. Written as `Math.max`
      // first, which put `married-1958-widow-claims-late` sixteen years out
      // (its spouse is born 1974) and would have let the very scenario this
      // guard was written for break on schedule.
      const earliest = Math.min(...scenario.inputs.people.map(turns70));
      const monthsLeft = earliest - now;
      expect(
        monthsLeft,
        `Scenario "${scenario.id}" ages out of the Playwright UI suite in ${monthsLeft} ` +
          `month(s): its oldest person turns 70 then, after which the optimizer has no ` +
          `prospective filing age and the app renders "Analysis unavailable". ` +
          `Fix it BEFORE that date, by either (a) setting e2e.assertTable false for this ` +
          `scenario in validation/scripts/gen-fixtures.mjs and regenerating, which costs ` +
          `only the UI assertions and keeps every Vitest expectation running, or ` +
          `(b) replacing the household with a younger one that still reaches whatever ` +
          `branch this scenario was written for. This guard is wall-clock by design.`,
      ).toBeGreaterThan(WARN_MONTHS);
    },
  );
});
