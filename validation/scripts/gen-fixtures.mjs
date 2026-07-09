/**
 * Generates validation/fixtures/scenarios.json from an INDEPENDENT
 * implementation of SSA's published reduction/credit rules (NOT engine
 * output). The golden test then confirms the vendored ssa.tools engine agrees.
 */
import { writeFileSync } from 'node:fs';

const CONVENTIONS =
  "expected.monthly = floor(round_to_cent(PIA * factor)) with whole-dollar PIA, matching the vendored ssa.tools engine (benefitAtAge: PIA.floorToDollar() x factor, then floorToDollar). Values are generated independently from SSA's published rules (gen-fixtures.mjs), not copied from the engine. Early-claim factor: 1 - (min(36,m)*5/900 + max(0,m-36)*5/1200); delayed credits: 1 + m*(2/3 of 1%) per month to age 70. percentOfPia = round(benefit/PIA*1000)/10. Break-evens assume annualCola=0 and are the first 0.1-year grid point where the later strategy's cumulative total catches up. spousalBenefitAtFra = max(0, workerPIA/2 - spousePIA) (the top-up the spouse receives on the worker's record). MODE: 'full' runs the complete analyzeClaiming pipeline and the Playwright UI suite; only valid while the cohort (and spouse) are under 70 (the optimizer needs a prospective filing age). 'factorsOnly' validates the deterministic factor math (FRA, monthly, %PIA, break-evens) without the optimizer and never ages out.";

const TOLERANCES = { monthlyUsd: 1, percentOfPia: 0.1, breakEvenYears: 0.1, crosscheckUsd: 1 };

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

// Replicates cumulativeBenefits (cola 0) and breakEvenAge from socialSecurity.ts.
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

  const spousal =
    spec.hasSpouse ? Math.max(0, spec.pia / 2 - (spec.spousePia ?? 0)) : null;

  const invariants = ['monthlyMonotonicIncreasing'];
  if (spec.mode === 'full') invariants.push('expectedPvPositive');

  const inputs = {
    birthYear: spec.birthYear,
    birthMonth: spec.birthMonth,
    gender: spec.gender,
    hasSpouse: spec.hasSpouse,
    monthlyBenefitAtFra: spec.pia,
    lifeExpectancy: spec.life ?? 85,
    annualCola: 0,
    discountRate: 0.025,
  };
  if (spec.hasSpouse) {
    inputs.spouseBirthYear = spec.spouseBirthYear;
    inputs.spouseBirthMonth = spec.spouseBirthMonth;
    inputs.spouseMonthlyBenefitAtFra = spec.spousePia ?? 0;
  }

  return {
    id: spec.id,
    description: spec.description,
    mode: spec.mode,
    inputs,
    expected: {
      fra: { ...fraParts(spec.birthYear), label: fraLabel(spec.birthYear) },
      monthlyByClaimAge,
      percentOfPiaByClaimAge,
      breakEvens,
      spousalBenefitAtFra: spousal,
      optimalAgeRange: [62, 70],
      invariants,
    },
    e2e: { assertTable: spec.mode === 'full', assertSummaryCards: spec.mode === 'full' },
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
    description: 'Worker Jun 1960 male PIA $2,500; spouse Mar 1962 no record ($0) - full 50% top-up ($1,250)' },
  { id: 'married-1960-partial-topup', mode: 'full', birthYear: 1960, birthMonth: 6, gender: 'male', hasSpouse: true, pia: 2500,
    spouseBirthYear: 1961, spouseBirthMonth: 5, spousePia: 1000,
    description: 'Worker Jun 1960 PIA $2,500; spouse May 1961 own PIA $1,000 - partial top-up (1250-1000=$250)' },
  { id: 'married-1964-dual-high-earners', mode: 'full', birthYear: 1964, birthMonth: 7, gender: 'female', hasSpouse: true, pia: 3000,
    spouseBirthYear: 1964, spouseBirthMonth: 2, spousePia: 3000,
    description: 'Worker Jul 1964 F PIA $3,000; spouse Feb 1964 M PIA $3,000 - dual earners, no spousal top-up ($0)' },
  { id: 'married-1962-spouse-higher-earner', mode: 'full', birthYear: 1962, birthMonth: 10, gender: 'female', hasSpouse: true, pia: 2000,
    spouseBirthYear: 1960, spouseBirthMonth: 8, spousePia: 4000,
    description: 'Worker Oct 1962 F PIA $2,000; spouse Aug 1960 M PIA $4,000 - spouse is higher earner ($0 top-up on worker record)' },
  { id: 'married-1965-younger-spouse-no-record', mode: 'full', birthYear: 1965, birthMonth: 3, gender: 'male', hasSpouse: true, pia: 3600,
    spouseBirthYear: 1967, spouseBirthMonth: 9, spousePia: 0,
    description: 'Worker Mar 1965 M PIA $3,600; younger spouse Sep 1967 no record ($0) - 50% top-up ($1,800)' },

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
    description: "Sample HH3: large PIA gap, worker Jul 1959 F PIA $3,600 (FRA 66y10m); spouse Nov 1963 M own PIA $700 below 50% of worker PIA - routed to spousal, top-up $1,100" },
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
const out = { version: 1, conventions: CONVENTIONS, tolerances: TOLERANCES, scenarios };
writeFileSync(
  new URL('../fixtures/scenarios.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`Wrote ${scenarios.length} scenarios (${scenarios.filter((s) => s.mode === 'full').length} full, ${scenarios.filter((s) => s.mode === 'factorsOnly').length} factorsOnly).`);
