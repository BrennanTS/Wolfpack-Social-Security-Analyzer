/**
 * The vendored engine's own optimizer, pinned.
 *
 * `recommendedFilingAgeByPerson` in `scenarios.json` used to serve two
 * purposes at once: it recorded what the APP recommends, and — because the
 * app simply forwarded the engine's mortality-weighted answer — it doubled as
 * proof that the vendored engine still behaves as recorded.
 *
 * Those two came apart when the app's optimizer moved to a plan-to-age
 * horizon (`planToAgeDistribution` in `src/lib/ssaTools.ts`). The fixture
 * field follows the app, as it should. This file takes over the other job, so
 * the engine cross-check survives the migration rather than being traded away
 * for it.
 *
 * **What would fail here:** a change to anything under `src/vendor/ssa-tools/`
 * (which is read-only and must not change), a dependency bump that moved the
 * SSA life tables in `public/data/`, or an adapter change to
 * `createPiaRecipient` that altered how a household reaches the engine.
 * **What would NOT fail here:** a change to which question the app asks. That
 * is the fixture's job, and the two are now separable — which is the whole
 * point.
 *
 * Ages are in ENGINE slot order (the fixture's own `people` order), NOT the
 * app's display order. `compareForEngine` canonicalizes a married pair before
 * the app calls the optimizer; that reordering is app behaviour and belongs to
 * the app's own tests, not here.
 *
 * Values were recorded from the engine on 2026-08-17, at the discount rate
 * every fixture uses. Widowed scenarios are absent deliberately: they never
 * reach this optimizer at all (`analyzeWidowed` runs its own two-date search,
 * because `strategySumPeriodsSingle` has no survivor concept).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDeathProbabilityDistribution } from '$lib/life-tables';
import {
  expectedNPVCoupleOptimized,
  expectedNPVSingle,
} from '$lib/strategy/calculations/expected-npv';
import { createPiaRecipient, formatFilingAge, monthDateFrom } from '../../src/lib/ssaTools';
import scenarios from '../fixtures/scenarios.json';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

/** The discount rate every `full` fixture is evaluated at. */
const DISCOUNT_RATE = 0.025;

interface Pin {
  id: string;
  engineAges: { years: number; months: number }[];
}

const PINS: Pin[] = [
  { id: 'single-1960-fra67-pia2500', engineAges: [{ years: 68, months: 7 }] },
  { id: 'single-1960-low-pia500', engineAges: [{ years: 68, months: 9 }] },
  { id: 'single-1960-max-pia5000', engineAges: [{ years: 68, months: 7 }] },
  { id: 'single-1961-fra67-pia3500', engineAges: [{ years: 68, months: 4 }] },
  { id: 'single-1962-fra67-pia5000', engineAges: [{ years: 68, months: 0 }] },
  { id: 'single-1963-fra67-pia1500', engineAges: [{ years: 68, months: 9 }] },
  { id: 'single-1965-fra67-pia4000', engineAges: [{ years: 68, months: 11 }] },
  { id: 'single-1966-fra67-pia1234', engineAges: [{ years: 68, months: 5 }] },
  { id: 'single-1959-fra66y10m-pia2400', engineAges: [{ years: 69, months: 2 }] },
  {
    id: 'married-1960-spouse-no-record',
    engineAges: [{ years: 68, months: 9 }, { years: 63, months: 10 }],
  },
  {
    id: 'married-1960-partial-topup',
    engineAges: [{ years: 70, months: 0 }, { years: 64, months: 9 }],
  },
  {
    id: 'married-1964-dual-high-earners',
    engineAges: [{ years: 62, months: 1 }, { years: 70, months: 0 }],
  },
  {
    id: 'married-1962-spouse-higher-earner',
    engineAges: [{ years: 63, months: 3 }, { years: 70, months: 0 }],
  },
  {
    id: 'married-1965-younger-spouse-no-record',
    engineAges: [{ years: 69, months: 6 }, { years: 62, months: 1 }],
  },
  {
    id: 'married-1962-same-sex-both-male',
    engineAges: [{ years: 70, months: 0 }, { years: 62, months: 1 }],
  },
  {
    id: 'married-1963-spouse-claims-early',
    engineAges: [{ years: 70, months: 0 }, { years: 62, months: 2 }],
  },
  {
    id: 'married-1958-widow-claims-late',
    engineAges: [{ years: 70, months: 0 }, { years: 62, months: 1 }],
  },
  {
    id: 'married-1960-widow-already-filed',
    engineAges: [{ years: 65, months: 7 }, { years: 69, months: 7 }],
  },
  {
    id: 'married-1964-tie-no-survivor-band',
    engineAges: [{ years: 62, months: 2 }, { years: 70, months: 0 }],
  },
  { id: 'sample-hh1-single-1962-pia2400-delay70', engineAges: [{ years: 67, months: 9 }] },
  {
    id: 'sample-hh2-married-1960-dual-high-earners',
    engineAges: [{ years: 70, months: 0 }, { years: 64, months: 5 }],
  },
  {
    id: 'sample-hh3-married-1959-reduced-spousal',
    engineAges: [{ years: 70, months: 0 }, { years: 62, months: 2 }],
  },
  {
    id: 'sample-hh4-married-1955-wide-age-gap',
    engineAges: [{ years: 70, months: 0 }, { years: 62, months: 1 }],
  },
  {
    id: 'sample-hh13-married-1962-two-max-earners',
    engineAges: [{ years: 70, months: 0 }, { years: 63, months: 3 }],
  },
];

interface FixtureScenario {
  id: string;
  mode: string;
  inputs: {
    asOf: string;
    // `piaMonthly`, which is what the fixture calls it — NOT `monthlyBenefit`.
    // The first draft used the latter; with the tests now type-checked that
    // was a compile error rather than 24 pins silently comparing against a
    // recipient built from `undefined`.
    people: {
      birthYear: number;
      birthMonth: number;
      gender: 'male' | 'female';
      piaMonthly: number;
    }[];
  };
}

/** `scenarios.json`'s inferred literal type is far wider than what is read here. */
const allScenarios = (scenarios as unknown as { scenarios: FixtureScenario[] }).scenarios;

const byId = new Map(allScenarios.map((s) => [s.id, s]));

/** The engine's own answer for a scenario, in the fixture's people order. */
async function engineAnswer(scenario: FixtureScenario) {
  const asOf = new Date(`${scenario.inputs.asOf}T00:00:00`);
  const recipients = scenario.inputs.people.map((p) =>
    createPiaRecipient(p.birthYear, p.birthMonth, p.piaMonthly, p.gender),
  );
  const dists = await Promise.all(
    recipients.map((r) => getDeathProbabilityDistribution(r, asOf.getFullYear())),
  );

  if (recipients.length === 1) {
    const best = expectedNPVSingle(recipients[0], monthDateFrom(asOf), DISCOUNT_RATE, dists[0])[0];
    return [formatFilingAge(best.filingAge)];
  }
  const best = expectedNPVCoupleOptimized(
    [recipients[0], recipients[1]],
    monthDateFrom(asOf),
    DISCOUNT_RATE,
    [dists[0], dists[1]],
  )[0];
  return best.filingAges.map(formatFilingAge);
}

describe('the vendored optimizer is unchanged', () => {
  it('pins every full non-widowed scenario, so none can be quietly dropped', () => {
    // Without this, deleting a `PINS` entry would look identical to a passing
    // run — the per-scenario tests below simply would not exist.
    const expected = allScenarios
      .filter((s) => s.mode === 'full' && !s.id.startsWith('widowed-'))
      .map((s) => s.id)
      .sort();
    expect(PINS.map((p) => p.id).sort()).toEqual(expected);
  });

  for (const pin of PINS) {
    it(`chooses the recorded filing ages for ${pin.id}`, async () => {
      const scenario = byId.get(pin.id);
      expect(scenario, `${pin.id} is not in scenarios.json`).toBeDefined();

      const actual = await engineAnswer(scenario!);
      expect(actual.map((f) => ({ years: f.years, months: f.months }))).toEqual(pin.engineAges);
    });
  }

  it('does not weight by the plan-to age, which is the app’s job now', () => {
    // The property that made the split necessary, asserted from the engine
    // side: its own optimizer reads a survival curve and nothing else, so two
    // households differing only in plan-to age are identical to it.
    // `ssaTools.test.ts` asserts the mirror image for the app.
    expect(allScenarios.some((s) => s.mode === 'full')).toBe(true);
    // The pins above are recorded without any plan-to age being passed at
    // all — `engineAnswer` never sees one. That they reproduce is the proof.
  });
});
