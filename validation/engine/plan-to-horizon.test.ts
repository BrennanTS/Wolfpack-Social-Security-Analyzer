/**
 * The engine's own answer at each person's plan-to age, pinned.
 *
 * `recommendedFilingAgeByPerson` in `scenarios.json` recorded exactly this
 * until 2026-09-24: the app forwarded the engine's top-ranked strategy, so
 * the fixture field doubled as proof that the adapter (`rankedSingleStrategies`,
 * `rankedCoupleStrategies`, `planToAgeDistribution`) still reached the engine
 * the way it was recorded.
 *
 * Those came apart when the app started ranking on the figure it prints
 * (`rankOnPrintedValue` in `src/lib/household.ts`) rather than on the
 * engine's `expectedNpv`, which prices six months past each plan-to age. The
 * fixture field follows the app, as it should; this file takes over the
 * engine half, so the cross-check survives the re-record rather than being
 * traded away for it. Every value below equals the fixture's recorded value
 * from before that change: 28 of 28, checked when this file was written.
 *
 * The same split `vendored-optimizer.test.ts` made in August for the
 * mortality-weighted optimizer, one layer up: that file pins the engine on
 * SSA life tables, this one pins it on the plan-to-age horizon the app uses.
 *
 * **What would fail here:** a change under `src/vendor/ssa-tools/`, or to the
 * adapter in `src/lib/ssaTools.ts` that feeds it. **What would NOT fail
 * here:** a change to how the app chooses among the engine's candidates.
 *
 * Ages are in the fixture's own `people` order, passed to the adapter as-is.
 * Widowed scenarios are absent: they never reach this optimizer.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createPiaRecipient,
  rankedCoupleStrategies,
  rankedSingleStrategies,
} from '../../src/lib/ssaTools';
import scenarios from '../fixtures/scenarios.json';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

interface Pin {
  id: string;
  engineAges: { years: number; months: number }[];
}

const PINS: Pin[] = [
  { id: 'single-1960-fra67-pia2500', engineAges: [{ years: 68, months: 7 }] },
  { id: 'single-1960-low-pia500', engineAges: [{ years: 68, months: 6 }] },
  { id: 'single-1960-max-pia5000', engineAges: [{ years: 68, months: 7 }] },
  { id: 'single-1961-fra67-pia3500', engineAges: [{ years: 68, months: 4 }] },
  { id: 'single-1962-fra67-pia5000', engineAges: [{ years: 68, months: 0 }] },
  { id: 'single-1963-fra67-pia1500', engineAges: [{ years: 68, months: 9 }] },
  { id: 'single-1965-fra67-pia4000', engineAges: [{ years: 68, months: 11 }] },
  { id: 'single-1966-fra67-pia1234', engineAges: [{ years: 68, months: 6 }] },
  { id: 'single-1959-fra66y10m-pia2400', engineAges: [{ years: 68, months: 2 }] },
  { id: 'married-1960-spouse-no-record', engineAges: [{ years: 68, months: 9 }, { years: 63, months: 10 }] },
  { id: 'married-1960-partial-topup', engineAges: [{ years: 68, months: 6 }, { years: 67, months: 6 }] },
  { id: 'married-1964-dual-high-earners', engineAges: [{ years: 68, months: 6 }, { years: 68, months: 11 }] },
  { id: 'married-1962-spouse-higher-earner', engineAges: [{ years: 66, months: 3 }, { years: 69, months: 5 }] },
  { id: 'married-1965-younger-spouse-no-record', engineAges: [{ years: 69, months: 6 }, { years: 62, months: 1 }] },
  { id: 'married-1962-same-sex-both-male', engineAges: [{ years: 68, months: 9 }, { years: 66, months: 3 }] },
  { id: 'married-1963-spouse-claims-early', engineAges: [{ years: 70, months: 0 }, { years: 65, months: 6 }] },
  { id: 'married-1958-widow-claims-late', engineAges: [{ years: 70, months: 0 }, { years: 62, months: 1 }] },
  { id: 'married-1960-widow-already-filed', engineAges: [{ years: 65, months: 9 }, { years: 62, months: 1 }] },
  { id: 'married-1964-tie-no-survivor-band', engineAges: [{ years: 68, months: 1 }, { years: 70, months: 0 }] },
  { id: 'sample-hh19a-single-1960-jan1-prior-cohort', engineAges: [{ years: 68, months: 1 }] },
  { id: 'sample-hh19b-single-1960-jan2-own-cohort', engineAges: [{ years: 68, months: 0 }] },
  { id: 'sample-hh20-single-1962-jun1-cohort-unchanged', engineAges: [{ years: 68, months: 8 }] },
  { id: 'sample-hh21-single-1959-jan1-prior-cohort', engineAges: [{ years: 68, months: 1 }] },
  { id: 'sample-hh1-single-1962-pia2400-delay70', engineAges: [{ years: 68, months: 9 }] },
  { id: 'sample-hh2-married-1960-dual-high-earners', engineAges: [{ years: 68, months: 11 }, { years: 67, months: 4 }] },
  { id: 'sample-hh3-married-1959-reduced-spousal', engineAges: [{ years: 70, months: 0 }, { years: 66, months: 3 }] },
  { id: 'sample-hh4-married-1955-wide-age-gap', engineAges: [{ years: 70, months: 0 }, { years: 62, months: 1 }] },
  { id: 'sample-hh13-married-1962-two-max-earners', engineAges: [{ years: 68, months: 9 }, { years: 68, months: 3 }] },
];

interface FixtureScenario {
  id: string;
  mode: string;
  inputs: {
    asOf: string;
    status: 'single' | 'married' | 'widowed';
    discountRate: number;
    people: {
      birthYear: number;
      birthMonth: number;
      /** Absent means the 15th, as in `golden.test.ts`. */
      birthDay?: number;
      gender: 'male' | 'female';
      piaMonthly: number;
      lifeExpectancy: number;
    }[];
  };
}

const allScenarios = (scenarios as unknown as { scenarios: FixtureScenario[] }).scenarios;
const byId = new Map(allScenarios.map((s) => [s.id, s]));

/** The adapter's top-ranked strategy for a scenario, in the fixture's people order. */
function engineAnswer(scenario: FixtureScenario) {
  const { people, discountRate } = scenario.inputs;
  const asOf = new Date(`${scenario.inputs.asOf}T00:00:00`);
  const recipients = people.map((p) =>
    createPiaRecipient(p.birthYear, p.birthMonth, p.birthDay ?? 15, p.piaMonthly, p.gender),
  );
  const best =
    recipients.length === 1
      ? rankedSingleStrategies(recipients[0], discountRate, people[0].lifeExpectancy, asOf)[0]
      : rankedCoupleStrategies(
          recipients[0],
          recipients[1],
          discountRate,
          [people[0].lifeExpectancy, people[1].lifeExpectancy],
          asOf,
        )[0];
  return best.filingAges.map(({ years, months }) => ({ years, months }));
}

describe("the engine's plan-to-age answer is unchanged", () => {
  it('pins every full non-widowed scenario, so none can be quietly dropped', () => {
    const expected = allScenarios
      .filter((s) => s.mode === 'full' && s.inputs.status !== 'widowed')
      .map((s) => s.id)
      .sort();
    expect(PINS.map((p) => p.id).sort()).toEqual(expected);
  });

  for (const pin of PINS) {
    it(`ranks the recorded filing ages first for ${pin.id}`, () => {
      const scenario = byId.get(pin.id);
      expect(scenario, `${pin.id} is not in scenarios.json`).toBeDefined();
      expect(engineAnswer(scenario!)).toEqual(pin.engineAges);
    });
  }
});
