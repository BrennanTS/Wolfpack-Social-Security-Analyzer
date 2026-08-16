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
  "expected.monthly = floor(round_to_cent(PIA * factor)) with whole-dollar PIA, matching the vendored ssa.tools engine (benefitAtAge: PIA.floorToDollar() x factor, then floorToDollar). Values are generated independently from SSA's published rules (gen-fixtures.mjs), not copied from the engine. Early-claim factor: 1 - (min(36,m)*5/900 + max(0,m-36)*5/1200); delayed credits: 1 + m*(2/3 of 1%) per month to age 70. percentOfPia = round(benefit/PIA*1000)/10. Break-evens assume annualCola=0 and are the first 0.1-year grid point where the later strategy's cumulative total catches up. Each scenario pins `asOf` (the date the household is evaluated as-of) so 'full'-mode eligibility and the optimizer's chosen filing ages are deterministic rather than drifting with wall-clock time. SPOUSAL (two fields, both the amount by which half the higher earner's PIA exceeds the lower earner's own PIA, floored at $0): spousalTopUpAtFra = max(0, higherPIA/2 - lowerPIA), evaluated at the lower earner's own FRA where no early-filing reduction applies and delayed credits never apply to spousal benefits — independently derivable, and what gen-fixtures.mjs computes. spousalTopUpAtFilingAge = the same top-up reduced by SSA's early-filing schedule (25/36% per month for the first 36 months the lower earner files before their own FRA, then 5/12% per month beyond that) at the mortality-weighted couple optimizer's actual chosen filing age (given the scenario's pinned `asOf`), which is frequently before FRA; this depends on the optimizer, so gen-fixtures.mjs cannot derive it and instead preserves the hand-derived value already on record for each scenario id (see each scenario's description for the derivation) rather than silently dropping or reverting it. Only the person(s) covered by monthlyByClaimAgeByPerson/percentOfPiaByClaimAgeByPerson/optimalAgeRangeByPerson are asserted per-claim-age; an unasserted person (e.g. a spouse with no earnings record) is not checked for monotonicity. Most married scenarios cover only the first person (historically called the 'worker'); a scenario opts its second person in too by setting spec.assertPersonB in gen-fixtures.mjs, which appends that person's own table to all three arrays (breakEvensByPerson stays first-person-only everywhere). MODE: 'full' runs the complete analyzeHousehold pipeline and the Playwright UI suite; only valid while every person in the household is under 70 as of `asOf` (the optimizer needs a prospective filing age for each). 'factorsOnly' validates the deterministic factor math (FRA, monthly, %PIA, break-evens) without the optimizer and never ages out.";

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
const previousSpousalTopUpAtFilingAge = new Map();
if (existsSync(fixturesPath)) {
  const previous = JSON.parse(readFileSync(fixturesPath, 'utf8'));
  for (const s of previous.scenarios ?? []) {
    if (typeof s.expected?.spousalTopUpAtFilingAge === 'number') {
      previousSpousalTopUpAtFilingAge.set(s.id, s.expected.spousalTopUpAtFilingAge);
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
      optimalAgeRangeByPerson,
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
    description: "Worker Jun 1960 male PIA $2,500; spouse Mar 1962 no record ($0). spousalTopUpAtFra: unreduced top-up = 2500/2 - 0 = $1,250, evaluated at the spouse's own FRA of 67y0m. spousalTopUpAtFilingAge: with asOf pinned to 2026-01-15, the mortality-weighted couple optimizer files the spouse at 63y10m, 38 months before that FRA. Early-filing reduction: first 36 months at 25/36% (=25% flat) plus remaining 2 months at 5/12% = 25% + 2*5/12% = 25.8333%. Top-up = 1250 * (1 - 0.258333) = $927.08." },
  { id: 'married-1960-partial-topup', mode: 'full', birthYear: 1960, birthMonth: 6, gender: 'male', hasSpouse: true, pia: 2500,
    spouseBirthYear: 1961, spouseBirthMonth: 5, spousePia: 1000,
    description: "Worker Jun 1960 PIA $2,500; spouse May 1961 own PIA $1,000. spousalTopUpAtFra: unreduced top-up = 2500/2 - 1000 = $250, evaluated at the spouse's own FRA of 67y0m. spousalTopUpAtFilingAge: with asOf pinned to 2026-01-15, the couple optimizer files the spouse at 64y9m, 27 months before that FRA. Early-filing reduction (27 months, first-36-month band): 27 * 25/36% = 18.75%. Top-up = 250 * (1 - 0.1875) = $203.13." },
  { id: 'married-1964-dual-high-earners', mode: 'full', birthYear: 1964, birthMonth: 7, gender: 'female', hasSpouse: true, pia: 3000,
    spouseBirthYear: 1964, spouseBirthMonth: 2, spousePia: 3000,
    description: 'Worker Jul 1964 F PIA $3,000; spouse Feb 1964 M PIA $3,000 - dual earners, no spousal top-up ($0)' },
  { id: 'married-1962-spouse-higher-earner', mode: 'full', birthYear: 1962, birthMonth: 10, gender: 'female', hasSpouse: true, pia: 2000,
    spouseBirthYear: 1960, spouseBirthMonth: 8, spousePia: 4000,
    description: 'Worker Oct 1962 F PIA $2,000; spouse Aug 1960 M PIA $4,000 - spouse is higher earner ($0 top-up on worker record)' },
  { id: 'married-1965-younger-spouse-no-record', mode: 'full', birthYear: 1965, birthMonth: 3, gender: 'male', hasSpouse: true, pia: 3600,
    spouseBirthYear: 1967, spouseBirthMonth: 9, spousePia: 0,
    description: "Worker Mar 1965 M PIA $3,600; younger spouse Sep 1967 no record ($0). spousalTopUpAtFra: unreduced top-up = 3600/2 - 0 = $1,800, evaluated at the spouse's own FRA of 67y0m. spousalTopUpAtFilingAge: the couple optimizer files the spouse at 62y1m, 59 months before that FRA. Early-filing reduction: first 36 months at 25/36% (=25% flat) plus remaining 23 months at 5/12% = 25% + 23*5/12% = 34.5833%. Top-up = 1800 * (1 - 0.345833) = $1,177.50." },
  { id: 'married-1962-same-sex-both-male', mode: 'full', birthYear: 1962, birthMonth: 4, gender: 'male', hasSpouse: true, pia: 3200,
    spouseGender: 'male', spouseBirthYear: 1964, spouseBirthMonth: 2, spousePia: 2100, assertPersonB: true,
    extraInvariants: ['genderSensitiveMortality'],
    description: "Same-sex couple, both male - regression fixture for the fixed spouse-gender defect (the app used to hardcode the spouse's gender as the opposite of the worker's, so a same-sex spouse silently got the wrong SSA cohort life table). Person A: Apr 1962 M PIA $3,200 (FRA 67y0m). Person B: Feb 1964 M PIA $2,100 (FRA 67y0m). Benefit factors are gender-independent and follow the standard FRA-67 schedule for both people - 62: 1-(36*5/900+24*5/1200)=70.0%; 63: 1-(36*5/900+12*5/1200)=75.0%; 64: 1-36*5/900=80.0%; 65: 1-24*5/900=86.667%; 66: 1-12*5/900=93.333%; 67: 100%; 68: 1+12*2/300=108%; 69: 1+24*2/300=116%; 70: 1+36*2/300=124%. Person A dollars (PIA 3200): 2240/2400/2560/2773/2986/3200/3456/3712/3968 for ages 62-70. Person B dollars (PIA 2100): 1470/1575/1680/1820/1960/2100/2268/2436/2604 (both asserted here for person A AND person B; breakEvensByPerson[1] is intentionally left unpopulated, matching the file's existing first-person-only convention for that field). spousalTopUpAtFra = max(0, 3200/2 - 2100) = max(0, -500) = $0 - both have full own records so no top-up applies (independently derivable; spousalTopUpAtFilingAge is trivially $0 too). IMPORTANT: none of the values above discriminate the gender-hardcoding defect this scenario is named for - the benefit tables, %PIA, and $0 top-ups are all gender-independent by construction, and optimalAgeRangeByPerson is pinned to the file's standard permissive [62,70] window (an optimizer output over empirical SSA/CDC life tables, not a published closed-form factor, so it isn't independently hand-derivable and a same-sex household's optimal ages can legitimately land anywhere in that window). The actual guard is the genderSensitiveMortality invariant asserted in golden.test.ts: it re-runs this exact household with person B's gender flipped to female and asserts the joint expectedNpv differs from the as-authored (both-male) run - if per-person gender ever stopped reaching the mortality tables, both runs would use the same table and produce an identical NPV. A throwaway probe confirmed the concrete numbers behind that check: correct (both male) expectedNpv = $849,555.49; simulated pre-fix bug (person B forced female) expectedNpv = $902,123.41 - a real, large difference from the wrong cohort life table alone. Note person B's recommended filing age (62y1m) happens to be unchanged between those two runs in this household, because it's pinned by an asOf eligibility floor rather than a genuine mortality trade-off here - which is exactly why optimalAgeRangeByPerson can't be the discriminator and expectedNpv must be. The regression also has dedicated unit coverage in src/lib/household.test.ts ('uses each person own gender for mortality, not an assumed opposite')." },
  { id: 'married-1963-spouse-claims-early', mode: 'full', birthYear: 1963, birthMonth: 1, gender: 'female', hasSpouse: true, pia: 3600,
    spouseBirthYear: 1966, spouseBirthMonth: 7, spousePia: 600, assertPersonB: true,
    extraInvariants: ['spousalTopUpReducedWhenClaimedEarly'],
    description: "Worker Jan 1963 F PIA $3,600 (FRA 67y0m); spouse Jul 1966 M own PIA $600 (FRA 67y0m). Regression fixture asserting the spousalTopUpReducedWhenClaimedEarly invariant: golden.test.ts requires the lower earner to file before their own FRA (failing the test outright if that precondition ever stops holding, rather than silently skipping the check) and then asserts the reduced top-up is strictly less than the unreduced one. Person A dollars (PIA 3600): 2520/2700/2880/3120/3360/3600/3888/4176/4464 for ages 62-70 (same FRA-67 factor schedule as every other 1960+ cohort in this file). Person B dollars (PIA 600): 420/450/480/520/560/600/648/696/744 (both asserted here for person A AND person B, closing the prior gap where only the first person's table was ever checked; breakEvensByPerson[1] is intentionally left unpopulated, matching the file's existing first-person-only convention - note person B's PIA divides evenly by 15 at every claim age, so this scenario doesn't happen to exercise the fractional-cent flooring path, but the values are correct as derived). spousalTopUpAtFra: unreduced top-up = 3600/2 - 600 = $1,200, evaluated at the spouse's own FRA of 67y0m where no early-filing reduction applies. spousalTopUpAtFilingAge: with asOf pinned to 2026-01-15, the mortality-weighted couple optimizer files the spouse (the lower earner) at 62y2m, 58 months before that FRA - well before FRA, so the top-up must come in reduced. Early-filing reduction: first 36 months at 25/36% (=25% flat) plus remaining 22 months at 5/12% = 25% + 22*5/12% = 34.1667%. Top-up = 1200 * (1 - 0.341667) = $790.00, which is indeed less than the $1,200 unreduced value." },

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
    description: "Sample HH3: large PIA gap, worker Jul 1959 F PIA $3,600 (FRA 66y10m); spouse Nov 1963 M own PIA $700 (FRA 67y0m) below 50% of worker PIA - routed to spousal. spousalTopUpAtFra: unreduced top-up = 3600/2 - 700 = $1,100, evaluated at the spouse's own FRA. spousalTopUpAtFilingAge: with asOf pinned to 2026-01-15, the couple optimizer files the spouse at 62y2m, 58 months before that FRA. Early-filing reduction: first 36 months at 25/36% (=25% flat) plus remaining 22 months at 5/12% = 25% + 22*5/12% = 34.1667%. Top-up = 1100 * (1 - 0.341667) = $724.17." },
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
