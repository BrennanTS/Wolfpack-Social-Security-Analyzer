import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from './household';
import type { Person } from './personAnalysis';
import {
  addScenario,
  DEFAULT_SCENARIO_SET,
  filingAgeMonths,
  resetScenarios,
  selectScenario,
  type FilingAgeChoice,
  type ScenarioSet,
} from './scenario';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

const asOf = new Date(2026, 0, 15);
const assumptions = { annualCola: 2.5, discountRate: 0.025 };

const dan: Person = {
  id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
  gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
};
const sarah: Person = {
  id: 'b', name: 'Sarah', birthYear: 1964, birthMonth: 9,
  gender: 'female', piaMonthly: 1200, lifeExpectancy: 90,
};

const married: Household = { status: 'married', people: [dan, sarah] };
const single: Household = { status: 'single', people: [dan] };

const run = (household: Household, scenarios: ScenarioSet = DEFAULT_SCENARIO_SET) =>
  analyzeHousehold(household, assumptions, asOf, scenarios);

/** The default four, plus one custom row carrying `ages`, selected. */
const withCustom = (...ages: FilingAgeChoice[]) => addScenario(resetScenarios(), ages);

/** The ages of a strategy, as plain pairs — what a scenario is made of. */
const agesOf = (s: HouseholdAnalysis['selected']) =>
  s.filingAges.map((f) => ({ years: f.years, months: f.months }));

describe('no scenario', () => {
  it('is the optimizer’s own answer, exactly as before scenarios existed', async () => {
    const result = await run(married);
    expect(result.scenarioIsBest).toBe(true);
    expect(agesOf(result.selected)).toEqual(agesOf(result.optimal));
    expect(result.selected.isOptimal).toBe(true);
    expect(result.recommendationDetail).toContain('couple optimizer');
  });

  it('adds no extra comparison row', async () => {
    const result = await run(married);
    expect(result.comparisons.map((c) => c.key)).not.toContain('selected');
    expect(result.comparisons.filter((c) => c.isSelected)).toHaveLength(1);
  });

  it('shows the built-in rows this household can reach, and no others', async () => {
    const result = await run(married);
    // No `earliest`: Dan is 63 as of `asOf`, so 62/62 is not reachable and
    // `buildComparisons` drops it rather than substituting figures.
    expect(result.comparisons.map((c) => c.key).sort()).toEqual(['fra', 'latest', 'optimal']);
  });
});

describe('a chosen scenario', () => {
  // Deliberately not the optimum for this household, and reachable by both
  // people: Dan is 63 and Sarah 61 as of `asOf`.
  const both65 = withCustom({ years: 65, months: 0 }, { years: 65, months: 0 });

  it('drives the filing ages the analysis is built on', async () => {
    const result = await run(married, both65);
    expect(agesOf(result.selected)).toEqual([
      { years: 65, months: 0 },
      { years: 65, months: 0 },
    ]);
    expect(result.scenarioIsBest).toBe(false);
    expect(result.selected.isOptimal).toBe(false);
  });

  it('leaves `optimal` as the optimizer’s answer, not the chosen one', async () => {
    const best = await run(married);
    const chosen = await run(married, both65);
    expect(agesOf(chosen.optimal)).toEqual(agesOf(best.optimal));
    expect(chosen.optimal.expectedNpv).toBe(best.optimal.expectedNpv);
    expect(chosen.optimal.deltaVsOptimal).toBe(0);
  });

  it('moves every downstream figure, not just the table', async () => {
    const best = await run(married);
    const chosen = await run(married, both65);
    // The engine's own bands, and everything derived from them.
    expect(chosen.periods).not.toEqual(best.periods);
    expect(chosen.combinedTimeline).not.toEqual(best.combinedTimeline);
    // Each person's own page.
    expect(chosen.people.map((p) => p.filingAge.label)).toEqual(['65', '65']);
    expect(chosen.people[0].monthlyAtFilingAge).not.toBe(best.people[0].monthlyAtFilingAge);
  });

  it('scores below the optimum and says so in dollars', async () => {
    const chosen = await run(married, both65);
    expect(chosen.selected.expectedNpv).toBeLessThan(chosen.optimal.expectedNpv);
    expect(chosen.selected.deltaVsOptimal).toBeLessThan(0);
    expect(chosen.recommendationDetail).toContain("not the optimizer's choice");
    expect(chosen.recommendationDetail).toContain('less than the best available');
    // The card must not call a typed-in age a recommendation.
    expect(chosen.recommendationDetail).not.toContain('optimizer maximizes');
  });

  it('names the chosen ages in the headline, not the optimum’s', async () => {
    const chosen = await run(married, both65);
    expect(chosen.recommendation).toBe('Dan files at 65 · Sarah files at 65');
  });

  it('adds exactly one row for itself, marked shown and not best', async () => {
    const chosen = await run(married, both65);
    const rows = chosen.comparisons.filter((c) => c.isSelected);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(both65.selectedId);
    expect(rows[0].isOptimal).toBe(false);
    expect(chosen.comparisons.filter((c) => c.isOptimal)).toHaveLength(1);
    // One more row than the built-ins this household reaches.
    expect(chosen.comparisons).toHaveLength(4);
  });

  it('leaves the OPTIMAL row’s survivor income belonging to the optimum', async () => {
    // The regression this guards: `withSurvivorIncome` reuses one already-
    // computed set of bands for a single row. Keyed on `isOptimal` — as it was
    // before scenarios — the chosen scenario's bands were handed to the
    // optimum's row, printing the scenario's survivor income on the line an
    // adviser reads to compare against it.
    const best = await run(married);
    const chosen = await run(married, both65);
    const bestOptimalRow = best.comparisons.find((c) => c.isOptimal);
    const chosenOptimalRow = chosen.comparisons.find((c) => c.isOptimal);
    expect(chosenOptimalRow?.survivorIncome).toBe(bestOptimalRow?.survivorIncome);
    expect(chosenOptimalRow?.survivorIncome).not.toBe(chosen.selected.survivorIncome);
  });
});

describe('selecting one of the built-in rows', () => {
  it('builds the analysis on it without adding a row', async () => {
    const result = await run(married, selectScenario(resetScenarios(), 'fra'));
    expect(result.selected.key).toBe('fra');
    expect(result.scenarioIsBest).toBe(false);
    expect(result.comparisons).toHaveLength(3);
    expect(result.comparisons.filter((c) => c.isSelected)).toHaveLength(1);
    // Each person files at their own FRA, not at a shared age.
    expect(result.people.map((p) => p.filingAge.label)).toEqual(['67', '67']);
  });

  it('folds a built-in row whose ages another built-in already carries', async () => {
    // When the optimum IS 70/70, "Both delay to 70" and "Optimal" are the same
    // pair and only one row is printed. Chosen here by construction rather than
    // by hoping a household happens to hit it.
    const late = await run({
      status: 'married',
      people: [
        { ...dan, lifeExpectancy: 100 },
        { ...sarah, lifeExpectancy: 100 },
      ],
    });
    const at70 = late.comparisons.filter((c) =>
      c.filingAges.every((f) => f.years === 70 && f.months === 0),
    );
    expect(at70).toHaveLength(1);
  });

  it('keeps a custom row even when it duplicates a built-in, because someone typed it', async () => {
    const best = await run(married);
    const fra = best.comparisons.find((c) => c.key === 'fra');
    expect(fra, 'this household must reach an FRA row for the test to mean anything').toBeDefined();
    const set = addScenario(resetScenarios(), agesOf(fra!));
    const result = await run(married, set);
    expect(result.selected.key).toBe(set.selectedId);
    expect(result.comparisons).toHaveLength(4);
    // Same ages, both rows present, and the delta agrees.
    const twin = result.comparisons.find((c) => c.key === 'fra');
    expect(twin?.expectedNpv).toBe(result.selected.expectedNpv);
  });

  it('marks the built-in Optimal row rather than a custom twin of it', async () => {
    const best = await run(married);
    const result = await run(married, addScenario(resetScenarios(), agesOf(best.optimal)));
    // The custom row is selected and carries the optimum's ages, so it IS the
    // optimum — but the badge stays on the built-in row it duplicates.
    expect(result.comparisons.filter((c) => c.isOptimal)).toHaveLength(1);
    expect(result.comparisons.find((c) => c.isOptimal)?.key).toBe('optimal');
    expect(result.scenarioIsBest).toBe(false);
    expect(result.selected.deltaVsOptimal).toBe(0);
  });
});

describe('a scenario that has gone stale', () => {
  it('clamps an age below the floor and shows the clamped value', async () => {
    // Dan is 63 as of `asOf`; 62 is no longer his to choose.
    const result = await run(
      married,
      withCustom({ years: 62, months: 0 }, { years: 62, months: 0 }),
    );
    const [danAge] = agesOf(result.selected);
    expect(filingAgeMonths(danAge)).toBeGreaterThan(filingAgeMonths({ years: 62, months: 0 }));
    // And it is the FLOOR, not a fallback to the optimum.
    expect(danAge).toEqual(result.filingAgeOptions[0][0]);
  });

  it('clamps an age above the ceiling to 70', async () => {
    const result = await run(
      married,
      withCustom({ years: 99, months: 0 }, { years: 99, months: 0 }),
    );
    expect(agesOf(result.selected)).toEqual([
      { years: 70, months: 0 },
      { years: 70, months: 0 },
    ]);
  });

  it('drops a row built for a different household size and falls back to the optimum', async () => {
    // What is left behind by switching married → single mid-session: a
    // two-age row that pairs person A with a spouse who is no longer there.
    const set = withCustom({ years: 65, months: 0 }, { years: 65, months: 0 });
    const result = await run(single, set);
    expect(result.comparisons.map((c) => c.key)).not.toContain(set.selectedId);
    expect(result.scenarioIsBest).toBe(true);
    expect(agesOf(result.selected)).toEqual(agesOf(result.optimal));
  });

  it('drops an unattainable built-in row rather than substituting figures', async () => {
    // Dan is 63, so "both claim earliest (62)" is not reachable.
    const result = await run(married, selectScenario(resetScenarios(), 'earliest'));
    expect(result.comparisons.map((c) => c.key)).not.toContain('earliest');
    expect(result.scenarioIsBest).toBe(true);
  });
});

describe('filingAgeOptions', () => {
  it('offers one ascending, duplicate-free list per person', async () => {
    const result = await run(married);
    expect(result.filingAgeOptions).toHaveLength(2);
    for (const options of result.filingAgeOptions) {
      const months = options.map(filingAgeMonths);
      expect(months).toEqual([...months].sort((a, b) => a - b));
      expect(new Set(months).size).toBe(months.length);
    }
  });

  it('never offers an age already behind the person, nor one past 70', async () => {
    const result = await run(married);
    result.filingAgeOptions.forEach((options, i) => {
      const { years, months } = result.people[i].currentAge;
      const currentMonths = years * 12 + months;
      for (const option of options) {
        expect(filingAgeMonths(option)).toBeGreaterThanOrEqual(currentMonths);
        expect(filingAgeMonths(option)).toBeLessThanOrEqual(70 * 12);
      }
    });
  });

  it('is in display order — person A’s list first', async () => {
    const forward = await run({ status: 'married', people: [dan, sarah] });
    const swapped = await run({ status: 'married', people: [{ ...sarah, id: 'a' }, { ...dan, id: 'b' }] });
    // Dan is older, so his floor is later. Whichever slot he is typed into,
    // his options must come back in that slot.
    expect(forward.filingAgeOptions[0][0]).toEqual(swapped.filingAgeOptions[1][0]);
  });
});

describe('a single claimant', () => {
  it('takes a scenario too, and reports the shortfall for one person', async () => {
    const best = await run(single);
    const chosen = await run(single, withCustom({ years: 65, months: 0 }));
    expect(chosen.scenarioIsBest).toBe(false);
    expect(chosen.recommendation).toBe('Claim at age 65');
    expect(chosen.people[0].filingAge.label).toBe('65');
    expect(chosen.selected.expectedNpv).toBeLessThan(best.optimal.expectedNpv);
    // Singular wording — "combined" would be a second person this household
    // does not have.
    expect(chosen.recommendationDetail).toContain('expected present value');
    expect(chosen.recommendationDetail).not.toContain('combined expected present value');
  });
});
