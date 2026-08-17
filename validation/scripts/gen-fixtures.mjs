/**
 * Generates validation/fixtures/scenarios.json from an INDEPENDENT
 * implementation of SSA's published reduction/credit rules (NOT engine
 * output). The golden test then confirms the vendored ssa.tools engine agrees.
 *
 * Schema version 2 (Task 21): scenarios describe a household of one or two
 * `people[]` with a pinned `asOf` date, matching src/lib/household.ts's
 * `analyzeHousehold`. `asOf` is pinned per scenario so a cohort's eligibility
 * for the mortality-weighted optimizer ('full' mode) never drifts as real
 * time passes — see each spec's `asOf` below.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const CONVENTIONS =
  "expected.monthly = floor(round_to_cent(PIA * factor)) with whole-dollar PIA, matching the vendored ssa.tools engine (benefitAtAge: PIA.floorToDollar() x factor, then floorToDollar). Values are generated independently from SSA's published rules (gen-fixtures.mjs), not copied from the engine. Early-claim factor: 1 - (min(36,m)*5/900 + max(0,m-36)*5/1200); delayed credits: 1 + m*(2/3 of 1%) per month to age 70. percentOfPia = round(benefit/PIA*1000)/10. Break-evens assume annualCola=0 and are the first 0.1-year grid point where the later strategy's cumulative total catches up. Each scenario pins `asOf` (the date the household is evaluated as-of) so 'full'-mode eligibility and the optimizer's chosen filing ages are deterministic rather than drifting with wall-clock time. SPOUSAL (three fields). spousalTopUpAtFra = the unreduced entitlement max(0, higherPIA/2 - lowerPIA) — a dateless reference figure, never what anyone is actually paid; independently derivable, and what gen-fixtures.mjs computes. startsAtSpouseAge = the lower earner's age when the spousal benefit actually begins. A spousal benefit is payable only once the HIGHER earner has filed, so it begins at max(higher earner's filing date, lower earner's filing date) — filing on your own record earlier does not start it. spousalTopUpAtFilingAge = the entitlement reduced by SSA's early-filing schedule (25/36 of 1% per month for the first 36 months, then 5/12 of 1% per month beyond) measured from that START against the lower earner's OWN FRA — not from their own filing age, which is the defect fixed on branch fix/spousal-start-date. A start at or after their FRA is unreduced, since delayed credits never apply to spousal benefits. Both startsAtSpouseAge and spousalTopUpAtFilingAge depend on the mortality-weighted couple optimizer's chosen filing ages (given the scenario's pinned `asOf`), so gen-fixtures.mjs cannot derive them and instead preserves the hand-derived value already on record for each scenario id (see each scenario's description for the derivation) rather than silently dropping or reverting it. FILING AGES. optimalAgeRangeByPerson is a permissive [62,70] sanity window and cannot detect a moved filing age, since that is the entire legal range. recommendedFilingAgeByPerson pins what the optimizer ACTUALLY chose, per person, as {years, months}; it is null for 'factorsOnly' scenarios, which never run the optimizer. Unlike every other expected value in this file it is ENGINE-RECORDED rather than hand-derived — the optimizer weights expected NPV by empirical SSA/CDC life tables, which has no published closed form — and gen-fixtures.mjs preserves it per scenario id exactly as it preserves the two optimizer-dependent spousal fields. Never re-record one of these to make the golden suite pass: a moved filing age is the regression the field exists to catch. SURVIVOR CLAIM ALTERNATIVE. survivorClaim = { claimAge, gain } | null, from survivorClaimAlternative (src/lib/survivorClaim.ts): the survivor's age at the best month to claim their OWN survivor benefit (SSA pays a widow(er) from age 60 independently of their own filing date, which the vendored engine does not model — it ties the survivor's benefit to their own filing date) and the lifetime gain over what the app displays today, holding the optimizer's recommended filing ages fixed. null wherever no alternative applies, which is every one of this file's original 30 scenarios — by two different routes, only one of which is about the search. 19 of the 30 are null STRUCTURALLY, whatever their inputs: 10 single 'full' scenarios (survivorClaimAlternative returns null on its own two-people guard — there is no 'both people' to give a plan-to age to) and 9 'factorsOnly' scenarios (which never run the pipeline at all). The other 11 are married 'full', and theirs are the only nulls the search itself produced: they all give both people a plan-to age of 85, which makes the survivor-start behaviour bit-exact across all 61,823 filing-age combinations the optimizer considers for THOSE 11 (docs/reference/survivor-start-impact.md §3 — both the bit-exactness and that combination count scope to the 11, not to all 30). So the golden suite was blind to this until MARRIED scenarios with differing plan-to ages were added; a single-claimant scenario with varied life expectancies would record null however it was built, and could never reach the search. Exactly like recommendedFilingAgeByPerson, this is ENGINE-RECORDED, not hand-derived — the search is over the optimizer's own chosen filing ages, which have no published closed form — and gen-fixtures.mjs preserves it per scenario id (including an explicit null, which is itself a valid recorded answer, not an unrecorded one) rather than deriving or re-deriving it. Only applies to married 'full' scenarios; single claimants and 'factorsOnly' scenarios are independently null. Never re-record one of these to make the golden suite pass either: a moved claim age or gain is the regression the field exists to catch. Only the person(s) covered by monthlyByClaimAgeByPerson/percentOfPiaByClaimAgeByPerson/optimalAgeRangeByPerson are asserted per-claim-age; an unasserted person (e.g. a spouse with no earnings record) is not checked for monotonicity. Most married scenarios cover only the first person (historically called the 'worker'); a scenario opts its second person in too by setting spec.assertPersonB in gen-fixtures.mjs, which appends that person's own table to all three arrays (breakEvensByPerson stays first-person-only everywhere). MODE: 'full' runs the complete analyzeHousehold pipeline and the Playwright UI suite; only valid while every person in the household is under 70 as of `asOf` (the optimizer needs a prospective filing age for each). 'factorsOnly' validates the deterministic factor math (FRA, monthly, %PIA, break-evens) without the optimizer and never ages out.";

// spousalTopUpAtFilingAge depends on the mortality-weighted couple
// optimizer's output (and, since Task 21, on the scenario's pinned asOf), so
// — unlike every other expected value in this file — it cannot be derived
// independently of the engine. Rather than silently dropping or zeroing it
// (which would erase hand-derived values recorded in scenarios.json, the
// exact defect this preservation step exists to prevent), carry forward
// whatever value is already on record for a given scenario id. When the
// unreduced top-up is <= 0 the reduced value is trivially 0 regardless of
// filing age (spousalTopUp always returns 0 in that case), so that case IS
// independently derivable and doesn't need preserving. A new married
// scenario with a positive top-up that has never been hand-derived is a real
// gap: fail loudly instead of writing a plausible-looking placeholder.
const fixturesPath = new URL('../fixtures/scenarios.json', import.meta.url);
// startsAtSpouseAge is preserved for exactly the same reason: the benefit
// starts at max(worker filing date, spouse filing date), and both of those
// come from the optimizer.
const previousSpousalTopUpAtFilingAge = new Map();
const previousStartsAtSpouseAge = new Map();
// recommendedFilingAgeByPerson is preserved for the same reason again, with
// one difference worth stating plainly: it is ENGINE-RECORDED, not
// hand-derived. The optimizer's chosen ages come from mortality-weighted
// expected NPV over empirical SSA/CDC life tables, which has no published
// closed form to re-derive from. Recording them is nonetheless correct here —
// without them the suite's only filing-age assertion is
// optimalAgeRangeByPerson, pinned to the entire legal [62, 70] window, so
// running the golden suite could not detect a moved filing age at all.
const previousRecommendedFilingAgeByPerson = new Map();
// survivorClaim is preserved for the same reason again, and its map needs one
// extra wrinkle the others don't: `null` is itself a legitimate recorded
// value (most households have no reachable alternative), not merely "not yet
// recorded". A truthiness/shape check like the three maps above would treat
// every already-recorded null the same as never-recorded and throw on it
// forever, so this checks for the KEY's presence on `expected` instead of the
// value's shape.
const previousSurvivorClaim = new Map();
if (existsSync(fixturesPath)) {
  const previous = JSON.parse(readFileSync(fixturesPath, 'utf8'));
  for (const s of previous.scenarios ?? []) {
    if (typeof s.expected?.spousalTopUpAtFilingAge === 'number') {
      previousSpousalTopUpAtFilingAge.set(s.id, s.expected.spousalTopUpAtFilingAge);
    }
    if (typeof s.expected?.startsAtSpouseAge === 'string') {
      previousStartsAtSpouseAge.set(s.id, s.expected.startsAtSpouseAge);
    }
    if (Array.isArray(s.expected?.recommendedFilingAgeByPerson)) {
      previousRecommendedFilingAgeByPerson.set(s.id, s.expected.recommendedFilingAgeByPerson);
    }
    if (s.expected && Object.prototype.hasOwnProperty.call(s.expected, 'survivorClaim')) {
      previousSurvivorClaim.set(s.id, s.expected.survivorClaim);
    }
  }
}

const TOLERANCES = { monthlyUsd: 1, percentOfPia: 0.1, breakEvenYears: 0.1, crosscheckUsd: 1 };

// Default asOf for every scenario unless the spec overrides it (currently
// only sample household 4, which needs an earlier asOf to keep its 1955
// cohort under 70 for the 'full'-mode optimizer).
const DEFAULT_AS_OF = '2026-01-15';

function fraMonths(y) {
  if (y <= 1954) return 66 * 12;
  if (y >= 1960) return 67 * 12;
  return { 1955: 794, 1956: 796, 1957: 798, 1958: 800, 1959: 802 }[y];
}
function fraParts(y) {
  const m = fraMonths(y);
  return { years: Math.floor(m / 12), months: m % 12 };
}
function fraLabel(y) {
  const { years, months } = fraParts(y);
  return months === 0 ? `${years}` : `${years} years, ${months} months`;
}
function factor(birthYear, claimAge) {
  const delta = claimAge * 12 - fraMonths(birthYear); // <0 early, >0 delayed
  if (delta < 0) {
    const e = -delta;
    return 1 - (Math.min(e, 36) * 5) / 900 - (Math.max(0, e - 36) * 5) / 1200;
  }
  return 1 + (delta * 2) / 300;
}
function monthly(pia, birthYear, claimAge) {
  return Math.floor(Math.round(pia * factor(birthYear, claimAge) * 100) / 100);
}
function percentOfPia(benefit, pia) {
  return Math.round((benefit / pia) * 1000) / 10;
}

// Replicates cumulativeBenefits (cola 0) and breakEvenAge from benefitMath.ts.
function cumulative(m, claimAge, throughAge) {
  const years = Math.max(0, throughAge - claimAge);
  return Math.round(m * years * 12 * 100) / 100;
}
function breakEvenAge(earlierAge, earlierM, laterAge, laterM) {
  for (let t = laterAge * 10; t <= 1200; t++) {
    const age = t / 10;
    if (cumulative(laterM, laterAge, age) >= cumulative(earlierM, earlierAge, age)) {
      return Math.round(age * 10) / 10;
    }
  }
  return null;
}

const AGES = [62, 63, 64, 65, 66, 67, 68, 69, 70];
const PAIRS = [[62, 67], [62, 70], [67, 70]];

function build(spec) {
  const monthlyByClaimAge = {};
  const percentOfPiaByClaimAge = {};
  for (const age of AGES) {
    const b = monthly(spec.pia, spec.birthYear, age);
    monthlyByClaimAge[age] = b;
    percentOfPiaByClaimAge[age] = percentOfPia(b, spec.pia);
  }
  const breakEvens = PAIRS.map(([e, l]) => ({
    earlierAge: e,
    laterAge: l,
    breakEvenAge: breakEvenAge(e, monthlyByClaimAge[e], l, monthlyByClaimAge[l]),
  }));

  // Most married specs only assert the worker's (people[0]) own claiming
  // table — historically the only person exercised by the golden test's
  // per-person assertion loops. spec.assertPersonB opts a scenario into also
  // asserting the spouse's (people[1]) own table, closing that coverage gap
  // for scenarios that need it (see married-1962-same-sex-both-male and
  // married-1963-spouse-claims-early below).
  let monthlyByClaimAgeByPerson = [monthlyByClaimAge];
  let percentOfPiaByClaimAgeByPerson = [percentOfPiaByClaimAge];
  let optimalAgeRangeByPerson = [[62, 70]];
  if (spec.assertPersonB) {
    const spouseMonthlyByClaimAge = {};
    const spousePercentOfPiaByClaimAge = {};
    for (const age of AGES) {
      const b = monthly(spec.spousePia ?? 0, spec.spouseBirthYear, age);
      spouseMonthlyByClaimAge[age] = b;
      spousePercentOfPiaByClaimAge[age] = percentOfPia(b, spec.spousePia ?? 0);
    }
    monthlyByClaimAgeByPerson = [monthlyByClaimAge, spouseMonthlyByClaimAge];
    percentOfPiaByClaimAgeByPerson = [percentOfPiaByClaimAge, spousePercentOfPiaByClaimAge];
    optimalAgeRangeByPerson = [[62, 70], [62, 70]];
  }

  const spousalTopUpAtFra =
    spec.hasSpouse ? Math.max(0, spec.pia / 2 - (spec.spousePia ?? 0)) : null;

  let spousalTopUpAtFilingAge = null;
  if (spec.hasSpouse) {
    if (spousalTopUpAtFra <= 0) {
      // Independently derivable: spousalTopUp returns 0 at any filing age
      // once the unreduced (at-FRA) top-up is non-positive.
      spousalTopUpAtFilingAge = 0;
    } else if (previousSpousalTopUpAtFilingAge.has(spec.id)) {
      spousalTopUpAtFilingAge = previousSpousalTopUpAtFilingAge.get(spec.id);
    } else {
      throw new Error(
        `spousalTopUpAtFilingAge for '${spec.id}' has a positive at-FRA top-up ` +
          '($' + spousalTopUpAtFra + ') but no prior hand-derived value on record in ' +
          'scenarios.json. This value depends on the mortality-weighted couple ' +
          "optimizer's chosen filing age (given this scenario's pinned asOf) and " +
          'cannot be computed independently — run analyzeHousehold() for this ' +
          "scenario, hand-derive the reduced top-up from the optimizer's lower-" +
          "earner filing age using the SSA early-filing schedule, record it " +
          "(with the derivation) in this scenario's description, and add it to " +
          'scenarios.json before re-running fixtures:gen.',
      );
    }
  }

  // The lower earner's age when the spousal benefit actually begins — the
  // later of the two filing dates. Only meaningful where a top-up is
  // actually payable; null elsewhere, and the golden suite skips it there.
  let startsAtSpouseAge = null;
  if (spec.hasSpouse && spousalTopUpAtFra > 0) {
    if (previousStartsAtSpouseAge.has(spec.id)) {
      startsAtSpouseAge = previousStartsAtSpouseAge.get(spec.id);
    } else {
      throw new Error(
        `startsAtSpouseAge for '${spec.id}' has a positive at-FRA top-up but no ` +
          'prior hand-derived value on record in scenarios.json. The start is ' +
          "max(worker filing date, lower-earner filing date) and both come from " +
          'the optimizer, so it cannot be computed independently here — run ' +
          'analyzeHousehold() for this scenario, hand-derive the lower earner\'s ' +
          "age at that date, record it (with the derivation) in this scenario's " +
          'description, and add it to scenarios.json before re-running fixtures:gen.',
      );
    }
  }

  // Only 'full'-mode scenarios run the optimizer at all; 'factorsOnly' ones
  // exercise the deterministic factor math and have no recommendation.
  let recommendedFilingAgeByPerson = null;
  if (spec.mode === 'full') {
    if (previousRecommendedFilingAgeByPerson.has(spec.id)) {
      recommendedFilingAgeByPerson = previousRecommendedFilingAgeByPerson.get(spec.id);
    } else {
      throw new Error(
        `recommendedFilingAgeByPerson for '${spec.id}' is missing from scenarios.json. ` +
          'This is an engine-recorded value, not a hand-derived one: the optimizer ' +
          'weights expected NPV by empirical SSA/CDC life tables, so there is no ' +
          'published rule to derive it from. Run analyzeHousehold() for this scenario ' +
          "with its pinned asOf, record each person's recommendedFilingAge as " +
          '{years, months} in scenarios.json, and re-run fixtures:gen. Never adjust an ' +
          'existing recorded value to make the golden suite pass — a moved filing age ' +
          'is the regression that field exists to catch.',
      );
    }
  }

  // survivorClaim, like recommendedFilingAgeByPerson, is an optimizer output
  // (survivorClaimAlternative searches over the optimizer's own chosen filing
  // ages) with no published closed form, so it cannot be derived here either
  // — it is preserved per scenario id, or the build fails loudly rather than
  // fabricate a plausible-looking null. Only married 'full' scenarios can
  // ever produce a non-null value; a single claimant has no survivor to claim
  // for, and 'factorsOnly' scenarios never run the optimizer at all, so both
  // are independently null without needing a recorded value.
  let survivorClaim = null;
  if (spec.mode === 'full' && spec.hasSpouse) {
    if (previousSurvivorClaim.has(spec.id)) {
      survivorClaim = previousSurvivorClaim.get(spec.id);
    } else {
      throw new Error(
        `survivorClaim for '${spec.id}' is missing from scenarios.json. This is an ` +
          'engine-recorded value, not a hand-derived one, exactly like ' +
          'recommendedFilingAgeByPerson: survivorClaimAlternative ' +
          "(src/lib/survivorClaim.ts) searches over the optimizer's own chosen filing " +
          'ages, which have no published closed form to re-derive from. Run ' +
          'analyzeHousehold() for this scenario with its pinned asOf, read ' +
          'result.survivorClaim, and record either null or {claimAge, gain} in ' +
          "scenarios.json before re-running fixtures:gen. Never adjust an existing " +
          'recorded value to make the golden suite pass — a moved claim age or gain ' +
          'is the regression this field exists to catch.',
      );
    }
  }

  const invariants = ['monthlyMonotonicIncreasing'];
  if (spec.mode === 'full') invariants.push('expectedPvPositive');
  if (spec.extraInvariants) invariants.push(...spec.extraInvariants);

  const people = [
    {
      birthYear: spec.birthYear,
      birthMonth: spec.birthMonth,
      gender: spec.gender,
      piaMonthly: spec.pia,
      lifeExpectancy: spec.life ?? 85,
    },
  ];
  if (spec.hasSpouse) {
    people.push({
      birthYear: spec.spouseBirthYear,
      birthMonth: spec.spouseBirthMonth,
      // Every married spec until now happened to describe an opposite-sex
      // couple, so defaulting to "not the worker's gender" was a convenient
      // shortcut. A scenario can override with spec.spouseGender when that
      // default is wrong (e.g. a same-sex couple) — the actual gender is
      // data, never derived from the worker's.
      gender: spec.spouseGender ?? (spec.gender === 'male' ? 'female' : 'male'),
      piaMonthly: spec.spousePia ?? 0,
      lifeExpectancy: spec.spouseLife ?? spec.life ?? 85,
    });
  }

  return {
    id: spec.id,
    description: spec.description,
    mode: spec.mode,
    inputs: {
      asOf: spec.asOf ?? DEFAULT_AS_OF,
      status: spec.hasSpouse ? 'married' : 'single',
      people,
      annualCola: 0,
      discountRate: 0.025,
    },
    expected: {
      fraByPerson: [{ ...fraParts(spec.birthYear), label: fraLabel(spec.birthYear) }],
      monthlyByClaimAgeByPerson,
      percentOfPiaByClaimAgeByPerson,
      breakEvensByPerson: [breakEvens],
      spousalTopUpAtFra,
      spousalTopUpAtFilingAge,
      startsAtSpouseAge,
      optimalAgeRangeByPerson,
      recommendedFilingAgeByPerson,
      survivorClaim,
      invariants,
    },
    // spec.uiTestable overrides the default derivation from `mode` for
    // scenarios that are engine-testable (their pinned `asOf` keeps them
    // 'full') but not UI-testable — the Playwright suite drives the real app
    // against the real wall-clock date, which it cannot pin, so a scenario
    // whose asOf is far enough in the past that its person(s) have since
    // aged past 70 will hit the app's "no prospective filing age" error
    // path in a live 2026+ run even though the Vitest engine suite (which
    // does pass the pinned asOf) still validates it correctly. Currently
    // only sample household 4 (see its spec below) needs this.
    e2e: {
      assertTable: spec.mode === 'full' && spec.uiTestable !== false,
      assertSummaryCards: spec.mode === 'full' && spec.uiTestable !== false,
    },
  };
}

// --- Scenario specs across the option space ---
const specs = [
  // FULL mode (FRA 67 cohort, born 1960-1966; exercises pipeline + UI) ---------
  { id: 'single-1960-fra67-pia2500', mode: 'full', birthYear: 1960, birthMonth: 6, gender: 'female', hasSpouse: false, pia: 2500,
    description: 'Born Jun 1960, FRA 67, PIA $2,500, female, single - canonical FRA-67 case (full until Jun 2030)' },
  { id: 'single-1960-low-pia500', mode: 'full', birthYear: 1960, birthMonth: 6, gender: 'female', hasSpouse: false, pia: 500,
    description: 'Born Jun 1960, FRA 67, PIA $500 (form minimum), single - low-benefit edge where dollar flooring shows' },
  { id: 'single-1960-max-pia5000', mode: 'full', birthYear: 1960, birthMonth: 6, gender: 'female', hasSpouse: false, pia: 5000,
    description: 'Born Jun 1960, FRA 67, PIA $5,000 (form maximum), single - high-benefit / max delayed credit' },
  { id: 'single-1961-fra67-pia3500', mode: 'full', birthYear: 1961, birthMonth: 9, gender: 'male', hasSpouse: false, pia: 3500,
    description: 'Born Sep 1961, FRA 67, PIA $3,500, male, single' },
  { id: 'single-1962-fra67-pia5000', mode: 'full', birthYear: 1962, birthMonth: 1, gender: 'male', hasSpouse: false, pia: 5000,
    description: 'Born Jan 1962, FRA 67, PIA $5,000 (max), male, single' },
  { id: 'single-1963-fra67-pia1500', mode: 'full', birthYear: 1963, birthMonth: 4, gender: 'female', hasSpouse: false, pia: 1500,
    description: 'Born Apr 1963, FRA 67, PIA $1,500, female, single - low-mid PIA' },
  { id: 'single-1965-fra67-pia4000', mode: 'full', birthYear: 1965, birthMonth: 2, gender: 'female', hasSpouse: false, pia: 4000,
    description: 'Born Feb 1965, FRA 67, PIA $4,000, single - live ssa.tools cross-check anchor (full until Feb 2035)' },
  { id: 'single-1966-fra67-pia1234', mode: 'full', birthYear: 1966, birthMonth: 8, gender: 'male', hasSpouse: false, pia: 1234,
    description: 'Born Aug 1966, FRA 67, PIA $1,234 (odd amount), male, single - stresses dime/dollar rounding' },
  { id: 'single-1959-fra66y10m-pia2400', mode: 'full', birthYear: 1959, birthMonth: 11, gender: 'female', hasSpouse: false, pia: 2400,
    description: 'Born Nov 1959, FRA 66y10m, PIA $2,400, female, single - non-integer FRA through the UI (ages out Nov 2029)' },

  // FULL mode married (spousal variations) -------------------------------------
  { id: 'married-1960-spouse-no-record', mode: 'full', birthYear: 1960, birthMonth: 6, gender: 'male', hasSpouse: true, pia: 2500,
    spouseBirthYear: 1962, spouseBirthMonth: 3, spousePia: 0,
    description: "Worker Jun 1960 male PIA $2,500; spouse Mar 1962 no record ($0). spousalTopUpAtFra: unreduced entitlement = max(0, 2500/2 - 0) = $1,250 — a dateless reference figure, not a payment. spousalTopUpAtFilingAge: with asOf pinned to 2026-01-15 the optimizer files the worker at 68y9m (Jun 1960 + 68y9m = Mar 2029) and the spouse at 63y10m (Mar 1962 + 63y10m = Jan 2026). A spousal benefit is payable only once the worker has filed, so it starts at max(Jan 2026, Mar 2029) = Mar 2029, when the spouse is Mar 2029 - Mar 1962 = exactly 67y0m (startsAtSpouseAge '67') — her own FRA. Months early = 0, and delayed credits never apply to spousal benefits, so the top-up is unreduced: $1,250.00. Was $927.08 while the reduction was wrongly measured from her own 63y10m filing (38 months early)." },
  { id: 'married-1960-partial-topup', mode: 'full', birthYear: 1960, birthMonth: 6, gender: 'male', hasSpouse: true, pia: 2500,
    spouseBirthYear: 1961, spouseBirthMonth: 5, spousePia: 1000,
    description: "Worker Jun 1960 PIA $2,500; spouse May 1961 own PIA $1,000. spousalTopUpAtFra: unreduced entitlement = max(0, 2500/2 - 1000) = $250 — a dateless reference figure. spousalTopUpAtFilingAge: with asOf pinned to 2026-01-15 the optimizer files the worker at 70 (Jun 1960 + 70y = Jun 2030) and the spouse at 64y9m (May 1961 + 64y9m = Feb 2026). The benefit starts at max(Feb 2026, Jun 2030) = Jun 2030, when the spouse is Jun 2030 - May 1961 = 69y1m (startsAtSpouseAge '69 years, 1 month') — past her FRA of 67, so months early = 0 and the top-up is unreduced: $250.00. Was $203.13 while the reduction was wrongly measured from her own 64y9m filing (27 months early)." },
  { id: 'married-1964-dual-high-earners', mode: 'full', birthYear: 1964, birthMonth: 7, gender: 'female', hasSpouse: true, pia: 3000,
    spouseBirthYear: 1964, spouseBirthMonth: 2, spousePia: 3000,
    description: 'Worker Jul 1964 F PIA $3,000; spouse Feb 1964 M PIA $3,000 - dual earners, no spousal top-up ($0)' },
  { id: 'married-1962-spouse-higher-earner', mode: 'full', birthYear: 1962, birthMonth: 10, gender: 'female', hasSpouse: true, pia: 2000,
    spouseBirthYear: 1960, spouseBirthMonth: 8, spousePia: 4000,
    description: 'Worker Oct 1962 F PIA $2,000; spouse Aug 1960 M PIA $4,000 - spouse is higher earner ($0 top-up on worker record)' },
  { id: 'married-1965-younger-spouse-no-record', mode: 'full', birthYear: 1965, birthMonth: 3, gender: 'male', hasSpouse: true, pia: 3600,
    spouseBirthYear: 1967, spouseBirthMonth: 9, spousePia: 0,
    description: "Worker Mar 1965 M PIA $3,600; younger spouse Sep 1967 no record ($0). spousalTopUpAtFra: unreduced entitlement = max(0, 3600/2 - 0) = $1,800 — a dateless reference figure. spousalTopUpAtFilingAge: the optimizer files the worker at 69y6m (Mar 1965 + 69y6m = Sep 2034) and the spouse at 62y1m (Sep 1967 + 62y1m = Oct 2029). The benefit starts at max(Oct 2029, Sep 2034) = Sep 2034, when the spouse is Sep 2034 - Sep 1967 = exactly 67y0m (startsAtSpouseAge '67') — her own FRA, so months early = 0 and the top-up is unreduced: $1,800.00. Was $1,177.50 while the reduction was wrongly measured from her own 62y1m filing (59 months early)." },
  { id: 'married-1962-same-sex-both-male', mode: 'full', birthYear: 1962, birthMonth: 4, gender: 'male', hasSpouse: true, pia: 3200,
    spouseGender: 'male', spouseBirthYear: 1964, spouseBirthMonth: 2, spousePia: 2100, assertPersonB: true,
    extraInvariants: ['genderSensitiveMortality'],
    description: "Same-sex couple, both male - regression fixture for the fixed spouse-gender defect (the app used to hardcode the spouse's gender as the opposite of the worker's, so a same-sex spouse silently got the wrong SSA cohort life table). Person A: Apr 1962 M PIA $3,200 (FRA 67y0m). Person B: Feb 1964 M PIA $2,100 (FRA 67y0m). Benefit factors are gender-independent and follow the standard FRA-67 schedule for both people - 62: 1-(36*5/900+24*5/1200)=70.0%; 63: 1-(36*5/900+12*5/1200)=75.0%; 64: 1-36*5/900=80.0%; 65: 1-24*5/900=86.667%; 66: 1-12*5/900=93.333%; 67: 100%; 68: 1+12*2/300=108%; 69: 1+24*2/300=116%; 70: 1+36*2/300=124%. Person A dollars (PIA 3200): 2240/2400/2560/2773/2986/3200/3456/3712/3968 for ages 62-70. Person B dollars (PIA 2100): 1470/1575/1680/1820/1960/2100/2268/2436/2604 (both asserted here for person A AND person B; breakEvensByPerson[1] is intentionally left unpopulated, matching the file's existing first-person-only convention for that field). spousalTopUpAtFra = max(0, 3200/2 - 2100) = max(0, -500) = $0 - both have full own records so no top-up applies (independently derivable; spousalTopUpAtFilingAge is trivially $0 too). IMPORTANT: none of the values above discriminate the gender-hardcoding defect this scenario is named for - the benefit tables, %PIA, and $0 top-ups are all gender-independent by construction, and optimalAgeRangeByPerson is pinned to the file's standard permissive [62,70] window (an optimizer output over empirical SSA/CDC life tables, not a published closed-form factor, so it isn't independently hand-derivable and a same-sex household's optimal ages can legitimately land anywhere in that window). The actual guard is the genderSensitiveMortality invariant asserted in golden.test.ts: it re-runs this exact household with person B's gender flipped to female and asserts the joint expectedNpv differs from the as-authored (both-male) run - if per-person gender ever stopped reaching the mortality tables, both runs would use the same table and produce an identical NPV. A throwaway probe confirmed the concrete numbers behind that check: correct (both male) expectedNpv = $849,555.49; simulated pre-fix bug (person B forced female) expectedNpv = $902,123.41 - a real, large difference from the wrong cohort life table alone. Note person B's recommended filing age (62y1m) happens to be unchanged between those two runs in this household, because it's pinned by an asOf eligibility floor rather than a genuine mortality trade-off here - which is exactly why optimalAgeRangeByPerson can't be the discriminator and expectedNpv must be. The regression also has dedicated unit coverage in src/lib/household.test.ts ('uses each person own gender for mortality, not an assumed opposite')." },
  { id: 'married-1963-spouse-claims-early', mode: 'full', birthYear: 1963, birthMonth: 1, gender: 'female', hasSpouse: true, pia: 3600,
    spouseBirthYear: 1966, spouseBirthMonth: 7, spousePia: 600, assertPersonB: true,
    extraInvariants: ['spousalTopUpReducedWhenClaimedEarly'],
    description: "Worker Jan 1963 F PIA $3,600 (FRA 67y0m); spouse Jul 1966 M own PIA $600 (FRA 67y0m). Regression fixture asserting the spousalTopUpReducedWhenClaimedEarly invariant: golden.test.ts requires the lower earner to file before their own FRA (failing the test outright if that precondition ever stops holding, rather than silently skipping the check) and then asserts the reduced top-up is strictly less than the unreduced one. Person A dollars (PIA 3600): 2520/2700/2880/3120/3360/3600/3888/4176/4464 for ages 62-70 (same FRA-67 factor schedule as every other 1960+ cohort in this file). Person B dollars (PIA 600): 420/450/480/520/560/600/648/696/744 (both asserted here for person A AND person B, closing the prior gap where only the first person's table was ever checked; breakEvensByPerson[1] is intentionally left unpopulated, matching the file's existing first-person-only convention - note person B's PIA divides evenly by 15 at every claim age, so this scenario doesn't happen to exercise the fractional-cent flooring path, but the values are correct as derived). spousalTopUpAtFra: unreduced entitlement = max(0, 3600/2 - 600) = $1,200 - a dateless reference figure, not a payment. spousalTopUpAtFilingAge: with asOf pinned to 2026-01-15 the optimizer files the worker at 70 (Jan 1963 + 70y = Jan 2033) and the spouse (the lower earner) at 62y2m (Jul 1966 + 62y2m = Sep 2028). A spousal benefit is payable only once the worker has filed, so it starts at max(Sep 2028, Jan 2033) = Jan 2033, when the spouse is Jan 2033 - Jul 1966 = 66y6m (startsAtSpouseAge '66 years, 6 months'). That is 6 months before his own FRA of 67y0m, all inside the first 36-month band: 6 * 25/36 of 1% = 4.1667%. Top-up = 1200 * (1 - 0.041667) = $1,150.00 - still strictly less than the $1,200 unreduced value, so the spousalTopUpReducedWhenClaimedEarly invariant continues to hold. Was $790.00 while the reduction was wrongly measured from his own 62y2m filing (58 months early)." },

  // FULL mode married, differing plan-to ages (Task 3, survivor-claim
  // alternative) ----------------------------------------------------------
  // Every married scenario above gives both people a plan-to age of 85. That
  // single shared choice makes the engine's survivor-start rule bit-exact
  // across all 61,823 filing-age combinations the optimizer considers across
  // them (docs/reference/survivor-start-impact.md §3): the golden suite
  // could not previously see the survivor-claim-alternative defect (or its
  // fix) at all. The two scenarios below are the first in this file where
  // the two people plan to different ages, specifically so survivorClaim can
  // land non-null on at least one of them.
  { id: 'married-1958-widow-claims-late', mode: 'full', birthYear: 1958, birthMonth: 2,
    gender: 'male', hasSpouse: true, pia: 2400, life: 78,
    spouseBirthYear: 1974, spouseBirthMonth: 5, spousePia: 1200, spouseLife: 92,
    description: "Worker Feb 1958 M PIA $2,400, plan-to 78; spouse May 1974 F PIA $1,200, plan-to 92 - 16 years younger, and the first pair in this file whose plan-to ages differ from each other (78 vs 92) and from the file's universal 85. spousalTopUpAtFra = max(0, 2400/2 - 1200) = $0, independently derivable - no hand-derived spousal fields needed here. With asOf pinned to 2026-01-15, the optimizer's RECOMMENDED filing ages (engine-recorded, same as every recommendedFilingAgeByPerson in this file) are worker 70y0m (Feb 1958 + 70y = Feb 2028) and spouse 62y1m (May 1974 + 62y1m = Jun 2036). The worker dies Feb 1958 + 78y = Feb 2036 - a few months BEFORE the spouse's own recommended filing date - so the engine pays her nothing in between and then starts a permanently early-reduced survivor benefit at her own filing (Jun 2036, 62y1m, well before her survivor-FRA of 67). survivorClaimAlternative finds that claiming the survivor benefit specifically at her survivor-FRA instead (unreduced, but later) beats that reduced-but-earlier amount over her plan-to-92 remaining lifetime. survivorClaim is ENGINE-RECORDED, exactly like recommendedFilingAgeByPerson - survivorClaimAlternative (src/lib/survivorClaim.ts) searches over the optimizer's own chosen filing ages and has no published closed form to derive from - and is recorded here as {claimAge: '67', gain: 89735} straight from analyzeHousehold's own output, never hand-computed. IMPLEMENTATION NOTE for whoever revisits this scenario: the task brief that specified this fixture gave the spouse's birth year as 1968 (matching survivorClaim.test.ts's dan/sarah unit fixture) rather than 1974. That parameter pair was verified against analyzeHousehold before recording anything here, and it returns survivorClaim: null - the unit fixture's gain ($79,040) comes from a HAND-PICKED filing-age pair ([70, 70]) that the real optimizer never recommends for that spouse (it actually recommends 62y1m, which lands her own filing well before the 1968-birth-year worker's Feb 2036 death, leaving nothing for a claim-month search to improve on - see survivorClaim.test.ts's own 'returns null when the survivor already claims early enough to gain nothing' case, which is exactly this shape). The spouse's birth year was moved to 1974 (and plan-to to 92) so this scenario reaches a real, non-null gain through the actual golden-fixture pipeline (the optimizer's real recommendation) rather than a strategy the app would never show. AGING-OUT WARNING (grep AGING-OUT, or 'Feb 2028'): this is now the EARLIEST-AGING uiTestable scenario in this file. The worker is born Feb 1958, so he turns 70 in FEBRUARY 2028. The Playwright golden-scenarios spec drives the live app against the real wall-clock date, not this scenario's pinned asOf of 2026-01-15, so from Feb 2028 onward the app has no prospective filing age left for him and analyzeIfComplete throws — the UI renders its 'Analysis unavailable' error path and this scenario's Playwright assertions fail with a message that names neither the date nor the cause. The Vitest engine suite is unaffected either way, because it passes asOf explicitly. sample-hh4-married-1955-wide-age-gap hit exactly this failure and was given uiTestable: false only AFTER it broke; this note exists so the next person does not have to rediscover the mechanism. REMEDY at that point: add uiTestable: false here (which costs only the UI assertions — every Vitest expectation above, survivorClaim included, keeps running), or replace this pair with a younger one that still reaches a non-null survivorClaim. Do NOT do it before Feb 2028: this is the only scenario in the file whose UI path exercises the survivor-claim note at all, and switching it off early discards live coverage that is still working." },
  { id: 'married-1960-widow-already-filed', mode: 'full', birthYear: 1960, birthMonth: 6,
    gender: 'female', hasSpouse: true, pia: 1500, life: 90,
    spouseBirthYear: 1966, spouseBirthMonth: 6, spousePia: 3000, spouseLife: 76,
    description: "The null case: a couple whose survivor has already filed for her own retirement long before the first death, so no claim month improves on what the engine already pays. Person A (the eventual survivor) Jun 1960 F PIA $1,500, plan-to 90; person B Jun 1966 M PIA $3,000, plan-to 76 - the higher earner, and younger, but dies FIRST because his shorter plan-to age lands his death (Jun 1966 + 76y = Jun 2042) years before hers (Jun 1960 + 90y = Jun 2050). Different plan-to ages per person (90 vs 76), like the scenario above and unlike any of the file's original 30. spousalTopUpAtFra = max(0, 3000/2 - 1500) = $0, independently derivable. recommendedFilingAgeByPerson (engine-recorded): person A 65y7m (Jun 1960 + 65y7m = Jan 2026, essentially this scenario's own pinned asOf) and person B 69y7m (Jun 1966 + 69y7m = Jan 2036). Person A's own retirement filing (Jan 2026) precedes person B's death (Jun 2042) by more than sixteen years - by the time she is widowed she is 82, has been collecting her own benefit for a decade and a half, and is decades past her own survivor-FRA. The engine's survivor start is max(death + 1, her own filing date) = max(Jul 2042, Jan 2026) = Jul 2042, which is already the earliest month SSA would ever allow (death + 1), so no alternative claim month can beat it and survivorClaimAlternative correctly returns null. Paired with married-1958-widow-claims-late above, this scenario proves the golden suite can now see BOTH outcomes of the search - not just that the field exists, but that it is null exactly when it should be." },

  // Sample cases from validation/samples/sample-cases.csv (expressible subset;
  // the rest need features the engine/UI does not model - see samples/README.md).
  // Note: dates use the CSV's month/year; the engine takes no birth DAY.
  { id: 'sample-hh1-single-1962-pia2400-delay70', mode: 'full', birthYear: 1962, birthMonth: 4, gender: 'male', hasSpouse: false, pia: 2400,
    description: 'Sample HH1: baseline single, born Apr 1962 M PIA $2,400, FRA 67 - clean delayed-credit math from FRA to 70' },
  { id: 'sample-hh2-married-1960-dual-high-earners', mode: 'full', birthYear: 1960, birthMonth: 2, gender: 'male', hasSpouse: true, pia: 3200,
    spouseBirthYear: 1961, spouseBirthMonth: 9, spousePia: 3000,
    description: 'Sample HH2: dual high earners, worker Feb 1960 M PIA $3,200; spouse Sep 1961 F PIA $3,000 - similar PIAs, no spousal top-up ($0)' },
  { id: 'sample-hh3-married-1959-reduced-spousal', mode: 'full', birthYear: 1959, birthMonth: 7, gender: 'female', hasSpouse: true, pia: 3600,
    spouseBirthYear: 1963, spouseBirthMonth: 11, spousePia: 700,
    description: "Sample HH3: large PIA gap, worker Jul 1959 F PIA $3,600 (FRA 66y10m); spouse Nov 1963 M own PIA $700 (FRA 67y0m) below 50% of worker PIA - routed to spousal. spousalTopUpAtFra: unreduced entitlement = max(0, 3600/2 - 700) = $1,100 - a dateless reference figure. spousalTopUpAtFilingAge: with asOf pinned to 2026-01-15 the optimizer files the worker at 70 (Jul 1959 + 70y = Jul 2029) and the spouse at 62y2m (Nov 1963 + 62y2m = Jan 2026). The benefit starts at max(Jan 2026, Jul 2029) = Jul 2029, when the spouse is Jul 2029 - Nov 1963 = 65y8m (startsAtSpouseAge '65 years, 8 months'). That is 16 months before his own FRA of 67y0m, all inside the first 36-month band: 16 * 25/36 of 1% = 11.1111%. Reduced entitlement = 1100 * (1 - 0.111111) = $977.7778, and SSA truncates a benefit amount to the whole dollar, so the payable top-up is floor($977.7778) = $977. The hand-derivation used to stop one step short of that floor and recorded $977.78, leaving a permanent $0.78 gap sitting inside the $1 tolerance — exactly where the next real divergence would have hidden. Both sides agree on the base ($1,100), the start (Jul 2029), whose FRA the reduction is measured against (the dependent's) and the reduction band; only the floor was missing. Was $724.17 while the reduction was wrongly measured from his own 62y2m filing (58 months early). Also incidentally pins the cross-person FRA dimension: the reduction is measured against the DEPENDENT's own FRA (spouse, Nov 1963 + 67y0m = Nov 2030), not the earner's (worker, Jul 1959 + 66y10m = May 2026). The benefit start of Jul 2029 falls before the dependent's FRA (Nov 2030), so it is reduced - but it falls after the earner's FRA (May 2026), so reading the earner's FRA here instead would wrongly report 0 months early and an unreduced $1,100." },
  { id: 'sample-hh4-married-1955-wide-age-gap', mode: 'full', asOf: '2024-01-15', uiTestable: false, birthYear: 1955, birthMonth: 3, gender: 'male', hasSpouse: true, pia: 2800,
    spouseBirthYear: 1968, spouseBirthMonth: 6, spousePia: 1900,
    description: "Sample HH4: wide age gap, worker Mar 1955 M PIA $2,800 (FRA 66y2m); spouse Jun 1968 F own PIA $1,900, 13 years younger. asOf pinned to 2024-01-15 so the worker (68, turning 69 in Mar 2024) is still under 70 and eligible for the 'full'-mode optimizer - as of any 2026+ asOf the worker is 71+ and the optimizer has no prospective filing age left, which is why this case was previously marked 'Aged out' in validation/samples/README.md. uiTestable: false (Task 23) because Playwright drives the real app against the real wall-clock date rather than this pinned asOf — by 2026-08 the worker has already aged past 70 in the live app, hitting its 'Analysis unavailable' error path (analyzeIfComplete throws when the optimizer has no prospective filing age), so the Playwright golden-scenarios suite skips this scenario's UI assertions while the Vitest engine suite (which passes the pinned asOf explicitly) keeps validating it. spousalTopUpAtFra: unreduced top-up = max(0, 2800/2 - 1900) = max(0, -500) = $0 - the spouse's own PIA already exceeds half the worker's, so no top-up applies (independently derivable; no hand-derivation needed for spousalTopUpAtFilingAge either, since a non-positive at-FRA top-up is trivially $0 at any filing age)." },
  { id: 'sample-hh13-married-1962-two-max-earners', mode: 'full', birthYear: 1962, birthMonth: 4, gender: 'male', hasSpouse: true, pia: 4000,
    spouseBirthYear: 1962, spouseBirthMonth: 10, spousePia: 3900,
    description: 'Sample HH13: two near-max earners, worker Apr 1962 M PIA $4,000; spouse Oct 1962 F PIA $3,900 - both delay; exercises the DRC ceiling at 70, no spousal top-up ($0)' },

  // factorsOnly mode (FRA-schedule + factor coverage, durable) -----------------
  { id: 'single-1943-fra66-pia2000', mode: 'factorsOnly', birthYear: 1943, birthMonth: 5, gender: 'male', hasSpouse: false, pia: 2000,
    description: 'Born May 1943, FRA 66, PIA $2,000, male - earliest full-8%-DRC / FRA-66 cohort' },
  { id: 'single-1950-fra66-pia1800', mode: 'factorsOnly', birthYear: 1950, birthMonth: 10, gender: 'male', hasSpouse: false, pia: 1800,
    description: 'Born Oct 1950, FRA 66, PIA $1,800, male' },
  { id: 'single-1953-fra66-pia4500', mode: 'factorsOnly', birthYear: 1953, birthMonth: 2, gender: 'female', hasSpouse: false, pia: 4500,
    description: 'Born Feb 1953, FRA 66, PIA $4,500, female - high PIA, FRA 66' },
  { id: 'single-1954-fra66-pia3000', mode: 'factorsOnly', birthYear: 1954, birthMonth: 9, gender: 'female', hasSpouse: false, pia: 3000,
    description: 'Born Sep 1954, FRA 66, PIA $3,000, female - last FRA-66 cohort' },
  { id: 'single-1954-fra66-pia1234', mode: 'factorsOnly', birthYear: 1954, birthMonth: 9, gender: 'male', hasSpouse: false, pia: 1234,
    description: 'Born Sep 1954, FRA 66, PIA $1,234 (odd) - rounding stress at FRA 66' },
  { id: 'single-1955-fra66y2m-pia2500', mode: 'factorsOnly', birthYear: 1955, birthMonth: 7, gender: 'male', hasSpouse: false, pia: 2500,
    description: 'Born Jul 1955, FRA 66y2m, PIA $2,500, male - first graduated-FRA cohort' },
  { id: 'single-1956-fra66y4m-pia2200', mode: 'factorsOnly', birthYear: 1956, birthMonth: 3, gender: 'female', hasSpouse: false, pia: 2200,
    description: 'Born Mar 1956, FRA 66y4m, PIA $2,200, female' },
  { id: 'single-1957-fra66y6m-pia2000', mode: 'factorsOnly', birthYear: 1957, birthMonth: 3, gender: 'male', hasSpouse: false, pia: 2000,
    description: 'Born Mar 1957, FRA 66y6m, PIA $2,000, male - 54-month max reduction' },
  { id: 'single-1958-fra66y8m-pia2800', mode: 'factorsOnly', birthYear: 1958, birthMonth: 12, gender: 'female', hasSpouse: false, pia: 2800,
    description: 'Born Dec 1958, FRA 66y8m, PIA $2,800, female' },
];

const scenarios = specs.map(build);
const out = { version: 2, conventions: CONVENTIONS, tolerances: TOLERANCES, scenarios };
writeFileSync(
  new URL('../fixtures/scenarios.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`Wrote ${scenarios.length} scenarios (${scenarios.filter((s) => s.mode === 'full').length} full, ${scenarios.filter((s) => s.mode === 'factorsOnly').length} factorsOnly).`);
