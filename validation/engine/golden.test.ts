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
// Widowed scenarios are 'full' mode (they run analyzeHousehold), but they
// return a differently-shaped HouseholdAnalysis — no spousalTopUp, no married-
// style survivorClaim alternative, and a two-date "optimal" row rather than
// one filing age per person — so they get their own describe block below
// rather than flowing through the married/single assertions in this one.
const fullScenarios = scenarios.filter((s) => s.mode === 'full' && s.inputs.status !== 'widowed');
const widowedScenarios = scenarios.filter((s) => s.inputs.status === 'widowed');
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
  if (inputs.status === 'married') {
    return { status: 'married', people: [people[0], people[1]] };
  }
  if (inputs.status === 'widowed') {
    if (!inputs.deceased || !inputs.alreadyClaimed) {
      throw new Error(
        `scenario has status 'widowed' but is missing deceased/alreadyClaimed inputs`,
      );
    }
    return {
      status: 'widowed',
      people: [people[0]],
      deceased: inputs.deceased,
      alreadyClaimed: inputs.alreadyClaimed,
    };
  }
  return { status: 'single', people: [people[0]] };
}

const run = (s: GoldenScenario) =>
  analyzeHousehold(
    toHousehold(s.inputs),
    { annualCola: s.inputs.annualCola, discountRate: s.inputs.discountRate },
    new Date(s.inputs.asOf),
  );

/**
 * Re-runs a married scenario with one person's gender flipped, holding
 * everything else (birthdate, PIA, asOf) fixed. Used only by the
 * genderSensitiveMortality invariant below, as a differential probe: the
 * mortality table is the one input that this doesn't hold constant, so if
 * the two runs' expectedNpv come out equal, per-person gender isn't
 * reaching the mortality tables at all — the exact shape of the "spouse
 * gender hardcoded as the opposite of the worker's" defect this guards.
 */
const runWithGenderFlipped = (s: GoldenScenario, personIndex: 0 | 1) => {
  const flippedInputs: ScenarioInputs = {
    ...s.inputs,
    people: s.inputs.people.map((p, i) => {
      if (i !== personIndex) return p;
      const flippedGender: 'female' | 'male' = p.gender === 'male' ? 'female' : 'male';
      return { ...p, gender: flippedGender };
    }),
  };
  return analyzeHousehold(
    toHousehold(flippedInputs),
    { annualCola: flippedInputs.annualCola, discountRate: flippedInputs.discountRate },
    new Date(flippedInputs.asOf),
  );
};

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

  it('starts the spousal benefit at the expected age', async () => {
    const result = await run(scenario);
    if (scenario.expected.startsAtSpouseAge === null) {
      // The fixture's null means "this household has no spousal start date".
      // For a single claimant there is no spousalTopUp at all; for a married
      // scenario the field is populated and must itself be null. Asserting
      // that exactly — rather than the old "not the empty string" — makes the
      // fixture's null load-bearing, and would have caught the '—' sentinel
      // that reached the PDF.
      if (!result.spousalTopUp) {
        expect(scenario.inputs.status).toBe('single');
      } else {
        expect(result.spousalTopUp.startsAtSpouseAge).toBeNull();
      }
    } else {
      expect(result.spousalTopUp).toBeDefined();
      expect(result.spousalTopUp!.startsAtSpouseAge).toBe(scenario.expected.startsAtSpouseAge);
    }
  });

  it("files each person at the optimizer's recorded recommended age", async () => {
    // The one assertion in this file that is engine-RECORDED rather than
    // hand-derived (see recommendedFilingAgeByPerson in scenarios.ts for why
    // that is correct here). It exists because `optimalAgeRangeByPerson` is
    // [62, 70] — the entire legal range — for all 21 full scenarios, so before
    // this the suite could not detect a moved filing age at all, and every
    // downstream figure it pins (the spousal start, the reduced top-up, the
    // whole benefit-period decomposition) is a function of these ages. (The
    // window is still [62, 70] for all 23 full scenarios; it was 21 before
    // the two differing-plan-to-age scenarios were added.)
    const expectedAges = scenario.expected.recommendedFilingAgeByPerson;
    expect(expectedAges, 'full-mode scenarios must record their filing ages').not.toBeNull();
    const result = await run(scenario);
    const actual = result.people.map((p) => ({
      years: p.filingAge.years,
      months: p.filingAge.months,
    }));
    expect(actual).toEqual(expectedAges);
  });

  it("matches the engine-recorded survivor-claim alternative", async () => {
    // Like recommendedFilingAgeByPerson (the test above), this is
    // ENGINE-RECORDED rather than hand-derived: survivorClaimAlternative
    // (src/lib/survivorClaim.ts) searches over the optimizer's own chosen
    // filing ages, which have no published closed form to re-derive from —
    // see survivorClaim in scenarios.ts and gen-fixtures.mjs's preserve-or-
    // throw handling of it.
    //
    // Every one of this file's original 30 scenarios records null here, by
    // two different routes — and only one of them is about the search:
    //
    //  - 19 of the 30 record null STRUCTURALLY, whatever their inputs. 10 are
    //    single 'full' scenarios, where `survivorClaimAlternative` returns
    //    null on its own `people.length !== 2` guard (there is no "both
    //    people" to give a plan-to age to), and 9 are 'factorsOnly', which
    //    never run the pipeline at all and are not even in `fullScenarios`
    //    above. Varying a life expectancy on one of these can never make it
    //    non-null; if you are adding a scenario to reach the search, it has
    //    to be a married one.
    //  - the remaining 11 are married 'full', and those are the only nulls
    //    the search actually produced. They all give both people a plan-to
    //    age of 85, which makes the survivor-start rule bit-exact across all
    //    61,823 filing-age combinations the optimizer considers for THEM (see
    //    docs/reference/survivor-start-impact.md §3 — both the bit-exactness
    //    and that combination count scope to these 11, not to all 30).
    //
    // So this assertion is non-vacuous only because later married scenarios
    // with differing plan-to ages were added specifically to reach a non-null
    // case.
    const result = await run(scenario);
    if (scenario.expected.survivorClaim === null) {
      expect(result.survivorClaim).toBeNull();
    } else {
      expect(result.survivorClaim).not.toBeNull();
      expect(result.survivorClaim!.claimAge).toBe(scenario.expected.survivorClaim.claimAge);
      expect(result.survivorClaim!.gain).toBe(scenario.expected.survivorClaim.gain);
    }
  });

  it('satisfies structural invariants', async () => {
    const result = await run(scenario);

    scenario.expected.optimalAgeRangeByPerson.forEach(([minOptimal, maxOptimal], i) => {
      const person = result.people[i];
      const optimalAge = nearestWholeClaimAge(person.filingAge.decimalYears);
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
        result.people[lowerIndex].filingAge.decimalYears <
        result.people[lowerIndex].fra.years + result.people[lowerIndex].fra.months / 12;
      // The precondition (lower earner files before their own FRA) is part
      // of what this fixture claims, not an optional branch — if the
      // optimizer ever stopped filing this person early, the invariant
      // must FAIL loudly rather than silently stop testing anything.
      expect(
        filedEarly,
        `expected the lower earner (people[${lowerIndex}]) to file before their own FRA for ` +
          `scenario '${scenario.id}' — the spousalTopUpReducedWhenClaimedEarly invariant only ` +
          'means something when that precondition holds; if the optimizer no longer files ' +
          'early here, re-derive spousalTopUpAtFilingAge or drop the invariant instead of ' +
          'letting this assertion silently stop testing anything',
      ).toBe(true);
      expect(result.spousalTopUp!.atRecommendedFilingAge).toBeLessThan(
        result.spousalTopUp!.atFra,
      );
    }

    if (scenario.expected.invariants.includes('genderSensitiveMortality')) {
      // This was a differential probe for the "spouse gender hardcoded as
      // the opposite of the worker's" defect: flipping one person's gender
      // had to CHANGE the joint value, because a different person was then
      // scored against a different cohort life table.
      //
      // The app's optimizer no longer reads a life table at all — its horizon
      // is each person's plan-to age (`planToAgeDistribution`). So the
      // property inverted: flipping a gender must now leave the answer
      // untouched, and anything else would mean a mortality assumption had
      // crept back in through a door nobody intended.
      //
      // The defect the old assertion guarded has not gone unwatched. Gender
      // still has to reach the right PERSON — it seeds each one's suggested
      // plan-to age — and the vendored engine's own gender-sensitive
      // behaviour is pinned in `vendored-optimizer.test.ts`, whose recorded
      // ages differ between the same-sex and mixed scenarios precisely
      // because that engine does read the tables.
      expect(result.optimal.expectedNpv).toBeGreaterThan(0);
      const flipped = await runWithGenderFlipped(scenario, 1);
      expect(flipped.optimal.expectedNpv).toBe(result.optimal.expectedNpv);
      expect(flipped.optimal.filingAges.map((f) => f.label)).toEqual(
        result.optimal.filingAges.map((f) => f.label),
      );
    }
  });

  it('decomposes every household into well-formed bands', async () => {
    const result = await run(scenario);
    for (const band of result.periods) {
      expect(band.endIndex).toBeGreaterThanOrEqual(band.startIndex);
      // A $0.00 Spousal band is legitimate, not a bug, and must not be
      // "fixed" back to > 0: eligibleForSpousalBenefit (benefit-calculator.ts)
      // tests the unreduced entitlement against the dependent's PIA, but
      // spousalBenefitOnDate re-tests against their DRC-inflated actual
      // benefit once they file past their own NRA, which can come out to
      // zero even though strategy-calc.ts:158 has already pushed the period
      // on date validity alone.
      expect(band.monthlyAmount).toBeGreaterThanOrEqual(0);
      expect(['personal', 'spousal', 'survivor']).toContain(band.type);
    }
    // A single claimant can only ever hold a personal benefit. The length
    // guard is not decoration: `every` is vacuously true on an empty array,
    // and an empty periods list is exactly what a broken pipeline would
    // produce without erroring (benefitPeriods.test.ts:30 guards the same
    // assertion the same way).
    if (scenario.inputs.status === 'single') {
      expect(result.periods.length).toBeGreaterThan(0);
      expect(result.periods.every((b) => b.type === 'personal')).toBe(true);
    }
    // Spousal and survivor never overlap: you cannot draw a spousal benefit
    // on a deceased spouse's record. Reachable here, not vacuous: 5 of the 11
    // married full-mode fixtures put the dependent (lower PIA) in the one
    // direction the engine models — surviving the earner — while also holding
    // a spousal entitlement, so those five produce both a spousal and a
    // survivor band for the same personId and the loop below actually
    // compares them. (The other six emit no spousal band at all: half the
    // higher earner's PIA does not exceed the lower earner's own.)
    const spousal = result.periods.filter((b) => b.type === 'spousal');
    const survivor = result.periods.filter((b) => b.type === 'survivor');
    for (const sp of spousal) {
      for (const sv of survivor) {
        if (sp.personId !== sv.personId) continue;
        expect(sp.endIndex).toBeLessThan(sv.startIndex);
      }
    }
  });
});

/**
 * Widowed scenarios (Phase 3B-i Task 4): the survivor is a single claimant
 * with a `deceased` and `alreadyClaimed`, and the household's "optimal" row
 * carries a two-date recommendation (own filing age, survivor claim age, plus
 * a straight-sum lifetimeTotal) rather than the married/single shape checked
 * above. Kept as its own describe block rather than folded into
 * `fullScenarios` above, deliberately: several of that block's assertions
 * (`spousalTopUp`, the married-only `survivorClaim` alternative) either don't
 * apply or would need an awkward `|| status === 'widowed'` bolted onto an
 * assertion that means something different for a widowed household.
 */
describe.each(widowedScenarios)('golden scenario (widowed): $id', (scenario) => {
  it('matches the SSA full retirement age schedule for the survivor', async () => {
    const result = await run(scenario);
    const expectedFra = scenario.expected.fraByPerson[0];
    const person = result.people[0];
    expect(person.fra.years).toBe(expectedFra.years);
    expect(person.fra.months).toBe(expectedFra.months);
    expect(fraLabel(person.fra)).toBe(expectedFra.label);
  });

  // DELIBERATELY ABSENT for widowed scenarios: the `monthlyByClaimAgeByPerson`
  // /`percentOfPiaByClaimAgeByPerson` assertion and the `breakEvensByPerson`
  // assertion that the single and married blocks above both carry.
  //
  // Those two figures come from `analyzePerson`, which computes them from the
  // widow(er)'s OWN record alone. For a widow they are not what she would be
  // paid at each claim age and not where she would break even, because SSA
  // pays her the LARGER of her own benefit and the survivor benefit each
  // month, and the survivor benefit is absent from both — verified identical
  // across every widowed fixture regardless of the deceased's PIA, which is
  // the tell.
  //
  // Redesigning `analyzePerson` to be survivor-aware is genuinely out of scope
  // here (it is the same hazard `analyzeWidowed` guards against for the
  // optimizer, reached through a different door). What must not happen is the
  // golden corpus CERTIFYING those figures as correct for a widow: a fixture
  // that pins a misleading number teaches the next reader it is the right one.
  // The fields are still recorded in scenarios.json — they are real facts
  // about her own record — they are simply not asserted as her benefits here.
  // Single and married behaviour is untouched.

  it('is a widowed household with no spousal top-up and no married-style survivor-claim alternative', async () => {
    // Both are structurally guaranteed for a widowed household (see
    // analyzeWidowed in src/lib/household.ts), not a function of this
    // scenario's inputs, so these are plain assertions rather than
    // engine-recorded values.
    const result = await run(scenario);
    expect(result.status).toBe('widowed');
    expect(result.spousalTopUp).toBeUndefined();
    expect(result.survivorGap).toBeNull();
    expect(result.survivorClaim).toBeNull();
  });

  it("recommends the engine-recorded own filing age, survivor claim age, and lifetime total", async () => {
    // ENGINE-RECORDED, exactly like recommendedFilingAgeByPerson for married/
    // single scenarios above: bestWidowedOutcome (src/lib/widowed.ts)
    // exhaustively searches the survivor's own filing date jointly with the
    // survivor-claim date, which has no published closed form to re-derive
    // from — see recommendedOwnFilingAge/recommendedSurvivorClaimAge/
    // lifetimeTotal in scenarios.ts and gen-fixtures.mjs's preserve-or-throw
    // handling of them. Never re-record one of these to make the golden
    // suite pass — a moved value is the regression these fields exist to
    // catch.
    expect(
      scenario.expected.recommendedOwnFilingAge,
      'widowed scenarios must record their own filing age',
    ).not.toBeNull();
    expect(
      scenario.expected.recommendedSurvivorClaimAge,
      'widowed scenarios must record their survivor claim age',
    ).not.toBeNull();
    expect(
      scenario.expected.lifetimeTotal,
      'widowed scenarios must record their lifetime total',
    ).not.toBeNull();

    const result = await run(scenario);
    expect(result.optimal.filingAges[0]?.label).toBe(scenario.expected.recommendedOwnFilingAge);
    expect(result.optimal.survivorClaimDate?.age).toBe(scenario.expected.recommendedSurvivorClaimAge);
    expect(result.optimal.lifetimeTotal).toBe(scenario.expected.lifetimeTotal);

    // recommendedFilingAgeByPerson (the field every other full-mode scenario
    // in this file also carries) must agree with recommendedOwnFilingAge:
    // both are read off the same person's the same recommended filing age,
    // just in two different representations ({years, months} vs the display
    // label), so a widowed scenario records both as a cross-check between them.
    const expectedAges = scenario.expected.recommendedFilingAgeByPerson;
    expect(expectedAges, 'widowed scenarios must also record recommendedFilingAgeByPerson').not.toBeNull();
    expect({
      years: result.people[0].filingAge.years,
      months: result.people[0].filingAge.months,
    }).toEqual(expectedAges![0]);
  });

  it('satisfies structural invariants', async () => {
    const result = await run(scenario);

    const [minOptimal, maxOptimal] = scenario.expected.optimalAgeRangeByPerson[0];
    const optimalAge = nearestWholeClaimAge(result.people[0].filingAge.decimalYears);
    expect(optimalAge).toBeGreaterThanOrEqual(minOptimal);
    expect(optimalAge).toBeLessThanOrEqual(maxOptimal);

    if (scenario.expected.invariants.includes('monthlyMonotonicIncreasing')) {
      const monthlies = result.people[0].claimingOptions.map((o) => o.monthlyBenefit);
      for (let i = 1; i < monthlies.length; i++) {
        expect(monthlies[i]).toBeGreaterThan(monthlies[i - 1]);
      }
    }

    if (scenario.expected.invariants.includes('expectedPvPositive')) {
      // For a widowed household expectedNpv IS lifetimeTotal (see
      // HouseholdStrategy.lifetimeTotal's docstring) — still a real dollar
      // figure that must be positive, not a coincidentally-reused zero.
      expect(result.optimal.expectedNpv).toBeGreaterThan(0);
    }
  });

  it('decomposes the household into well-formed personal/survivor bands', async () => {
    const result = await run(scenario);
    for (const band of result.periods) {
      expect(band.endIndex).toBeGreaterThanOrEqual(band.startIndex);
      expect(band.monthlyAmount).toBeGreaterThanOrEqual(0);
      // A widowed household can never hold a spousal band — there is no
      // living spouse to draw one on.
      expect(['personal', 'survivor']).toContain(band.type);
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
