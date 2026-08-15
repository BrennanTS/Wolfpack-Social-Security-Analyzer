# Couples support, Phase 1: household model, tabbed results, testing foundation

- **Date:** 2026-08-15
- **Branch:** `feat/couples-household`
- **Status:** Approved for planning
- **Phase:** 1 of 3

## Context

The analyzer already runs the ssa.tools couple optimizer for married clients, and
eight married golden fixtures pass. The gap is not the core optimization math. It
is that the domain model treats one person as the "worker" and the other as an
appendage, which produces four concrete defects, and that the results layer shows
only the worker, which makes the couple analysis unusable in a client meeting.

Current defects:

1. The spouse's gender is hardcoded as the opposite of the worker's
   (`socialSecurity.ts`), so the mortality table is wrong for same-sex couples.
2. `spousalBenefitAtFra` (`ssaTools.ts`) fabricates the spouse by cloning the
   worker's birthdate and evaluates only at FRA, ignoring the spouse's real age
   and the reduction for claiming a spousal benefit early.
3. `isFormComplete` does not require spouse fields when married; `toUserInputs`
   silently defaults spouse DOB to the worker's and spouse PIA to zero, so a
   partially filled form yields a plausible but fictional analysis.
4. `survivorByClaimAge` echoes the worker's own benefit, and the PDF asserts the
   survivor receives it in full. That is not the survivor rule.

Testing is strong on engine math (golden fixtures drive both a Vitest engine
suite and a Playwright UI suite from one source of truth) and absent everywhere
else: `formState`, `chartData`, `lifeExpectancy`, `cpiHistory` and `auth` have no
tests, no React component has a test, and validation runs only in a pre-commit
hook that `--no-verify` bypasses.

## Scope

**Phase 1 (this spec):** symmetric household domain model, the four corrections
above, a tabbed `Household | Person A | Person B` results view with a household
strategy comparison table and combined income chart, a split PDF report, and a
three-layer testing foundation with CI.

**Phase 2 (later spec):** real survivor math surfaced from the engine's
`survivorBenefit` (including the RIB-LIM cap) and the first-death income-cliff
view.

**Phase 3 (later spec):** a Widowed filing status with deceased-earner inputs,
the separate survivor FRA, and take-one-then-switch, reusing Phase 2's survivor
engine.

**Explicitly out of scope for all three phases:** divorced-spouse and
divorced-survivor benefits, child and family-maximum benefits, the retirement
earnings test, WEP/GPO, SSDI conversion, restricted application and deemed
filing, and birth-day-level inputs. These are documented in
`validation/samples/README.md` and would each need their own spec.

## Domain model

```ts
export type Gender = 'male' | 'female';

export interface Person {
  id: 'a' | 'b';          // stable key for tabs, chart series, fixtures
  name?: string;          // optional; falls back to "You" / "Spouse"
  birthYear: number;
  birthMonth: number;
  gender: Gender;         // per person
  piaMonthly: number;     // benefit at full retirement age
  lifeExpectancy: number;
}

export type Household =
  | { status: 'single';  people: [Person] }
  | { status: 'married'; people: [Person, Person] };

export interface Assumptions {
  annualCola: number;     // illustrative charts and break-evens only
  discountRate: number;
}
```

`Household` is a discriminated union so Phase 3 adds a `widowed` arm rather than
more boolean branching. Each `Person` carries their own gender and life
expectancy, which is what fixes defect 1.

Analysis results mirror the input shape:

```ts
export interface PersonAnalysis {
  person: Person;
  fra: FraResult;
  currentAge: { years: number; months: number };
  claimingOptions: ClaimingOption[];       // ages 62-70
  recommendedFilingAge: FilingAgeDisplay;
  recommendedMonthly: number;
  breakEvens: BreakEvenPair[];
  ssaSuggestedLifeExpectancy: number;
}

export interface HouseholdStrategy {
  key: string;                             // 'earliest' | 'fra' | 'latest' | 'optimal'
  label: string;                           // "Both claim at FRA"
  filingAges: FilingAgeDisplay[];          // one per person
  expectedNpv: number;
  deltaVsOptimal: number;                  // 0 for the optimal row
  isOptimal: boolean;
}

export interface HouseholdAnalysis {
  status: Household['status'];
  people: PersonAnalysis[];
  optimal: HouseholdStrategy;
  comparisons: HouseholdStrategy[];
  combinedTimeline: { year: number; byPersonId: Record<string, number>; total: number }[];
  spousalTopUp?: {                         // married only
    atFra: number;                         // top-up if the spousal benefit starts at FRA
    atRecommendedFilingAge: number;        // top-up under the recommended strategy
  };
  recommendation: string;
  recommendationDetail: string;
  assumptions: Assumptions;
  asOf: Date;
}
```

`HouseholdStrategy.filingAges` is a variable-length array so a single claimant
uses the same type and the same table component with one column.

## Module architecture

`src/lib/socialSecurity.ts` (475 lines, currently doing FRA math, claiming
tables, break-evens, recommendation prose and spousal logic) is removed and its
responsibilities split:

| Module | Responsibility |
|---|---|
| `ssaTools.ts` | Engine adapter over vendored ssa.tools (extended, see below) |
| `personAnalysis.ts` | One person: FRA, claiming table 62-70, break-evens |
| `household.ts` | Orchestration: strategies, comparisons, combined timeline, recommendation prose |
| `benefitMath.ts` | Pure helpers: `cumulativeBenefits`, `breakEvenAge`, `computeBreakEvens` |
| `format.ts` | `formatCurrency`, `formatCurrencyPrecise`, `fraLabel`, `formatAgeDisplay` |

`household.ts` is the only module that knows whether one person or two is being
analyzed. Existing tests move with the code they cover.

Data flow is one-directional: form state → `toHousehold()` → `analyzeHousehold()`
→ `HouseholdAnalysis` → components. Components receive analysis data as props and
never call the engine. This is a load-bearing decision: it is what lets component
tests run on fixture-derived props with no mocking.

## Calculation changes

### Corrections

- **Per-person gender** falls out of the model; no more opposite-gender
  assumption.
- **Spousal top-up** becomes a function of the real second `Recipient` at their
  actual filing age, including the early-claim reduction, replacing the
  clone-the-worker's-birthdate-and-evaluate-at-FRA approach.
- **Married validation** requires both people's DOB, gender and PIA before an
  analysis runs. No silent defaults. A married form missing spouse fields shows a
  validation message and produces no result.
- **Recommendation prose** describes the joint strategy rather than describing
  the worker and appending a spouse sentence.

### Additions

- **Strategy comparison.** `expectedNPVCoupleOptimized` already returns every
  filing-age combination sorted descending by expected NPV; the adapter currently
  discards everything except `results[0]`. A new adapter function returns the
  ranked list plus lookups by filing-age combination. Comparison rows are:

  | key | Married label | Single label |
  |---|---|---|
  | `earliest` | Both claim earliest (62) | Claim at 62 |
  | `fra` | Both claim at FRA | Claim at FRA |
  | `optimal` | Optimal | Optimal |
  | `latest` | Both delay to 70 | Claim at 70 |

  When the optimal strategy coincides with a named row, that row is marked
  `isOptimal` rather than duplicated. Rows that are no longer attainable given
  `asOf` (for example "both claim at 62" for a couple already past 62) are
  omitted, since the optimizer only returns filing ages at or after current age.

- **Combined income timeline.** Household income per year under the recommended
  strategy, stacked by person, for the `CombinedIncomeChart`.

### Survivor figures are removed in Phase 1

`survivorByClaimAge` and the PDF's "survivor receives the worker's full monthly
benefit" statement are deleted, not carried forward. Real survivor math arrives
in Phase 2. Shipping known-incorrect survivor numbers into a rebuilt UI is worse
than showing nothing.

### Reference date (`asOf`)

`analyzeHousehold` accepts an optional `asOf: Date` defaulting to the current
date, threaded through to every place that currently reaches for "now":
`MonthDate.initFromNow()` in `lifetimeNpvToAge`, `computeOptimalFilingSingle`
and `computeOptimalFilingCouple`, and `new Date()` in `isSsaClaimAgeEligible`.
All of these are in our adapter, not the vendored engine, so no vendor changes
are required.

This makes fixtures deterministic and fixes the aged-out-cohort problem in
`validation/samples/README.md`: sample household 4 (wide age gap) is currently
untestable only because its 1955 cohort has passed 70 in real time. With a pinned
reference date it becomes a valid fixture again.

## UI

`HouseholdView` owns the branch. With one person it renders `PersonPanel`
directly — a single claimant never sees a one-tab tab strip. With two it renders
the tab strip: `Household | <Person A> | <Person B>`.

New components:

- `HouseholdPanel` — recommendation card, `StrategyComparisonTable`,
  `CombinedIncomeChart`, household break-even
- `StrategyComparisonTable` — the comparison rows, optimal row highlighted
- `CombinedIncomeChart` — stacked-by-person household income

`PersonPanel` is today's `ResultsPanel` parameterized by person. The existing
per-person charts in `OptionalCharts.tsx` already take `claimingOptions` and
render per person inside `PersonPanel` without internal changes.

**Labels.** A single `personLabel(person, index)` helper resolves the optional
name to `"You"` / `"Spouse"` fallbacks. Tabs, chart legends, table headers and
PDF headings all call it, so the fallback rule exists once.

**Form.** Adds an optional name field and a required gender control per person,
and gates submission on complete data for both people when married.

**Accessibility.** Tabs use `role="tablist"` / `role="tab"` / `role="tabpanel"`,
`aria-selected`, and arrow-key navigation, matching the care the existing
segmented controls already take with `aria-pressed`.

**Not included:** persisting the active tab in the URL or storage.

## PDF

`PdfReportDocument.tsx` (1,109 lines, layout and styling and content
interleaved) splits into:

- `pdf/theme.ts` — shared stylesheet
- `pdf/HouseholdSection.tsx` — household strategy, comparison table, combined chart
- `pdf/PersonSection.tsx` — rendered once per person
- `pdf/ReportDocument.tsx` — thin composition

Print has no tabs, so the report linearizes: household section, then one person
section each. Content is equivalent to today's report apart from the removed
survivor claim and the added household material.

## Testing

### Layer 1 — unit (Vitest, node environment)

Covers `benefitMath`, `format`, `personAnalysis`, `household` (strategy
assembly, comparison lookups and dedupe, unattainable-row omission, timeline
construction), and the modules with no tests today: `formState` (validation
rules, `toHousehold` mapping, name fallback), `chartData`, `lifeExpectancy`,
`cpiHistory`, `auth`.

### Layer 2 — component (Vitest, jsdom environment)

New dev dependencies: `@testing-library/react`, `@testing-library/user-event`,
`jsdom`. A Vitest projects config keeps lib tests in the fast node environment so
only component tests pay for jsdom.

Covers what fixtures cannot reach: married validation refusing to submit without
spouse fields, loading and error states, tab switching and its ARIA wiring, name
fallback labels, the optimal row highlighted in the strategy table, and the
single-versus-married render branch. Tests feed fixture-derived props; no engine
mocking.

### Layer 3 — e2e (Playwright)

The golden scenario spec extends to assert per-person claiming tables and
household strategy values. A new interaction spec covers toggling
single↔married, tab switching, COLA and discount sliders triggering
recomputation, the settings drawer, dark mode, the password gate, and PDF export
producing a file. The PDF assertion is that the download occurs and the document
renders without throwing, not a pixel comparison.

The Playwright port becomes configurable via environment variable rather than
hardcoded to 4173, which collided with an unrelated local server during review.

### Fixtures

`validation/fixtures/scenarios.json` moves to a `people[]` shape mirroring the
domain model, with expected per-person tables and expected household strategies.
Existing single scenarios convert mechanically; married scenarios gain
second-person expectations. Every fixture gains an `asOf` date, which stops
scenarios aging out and revives sample household 4.

The existing rule holds: expected values stay hand-derived from SSA's published
rules and are never copied from engine output.

### CI

A GitHub Actions workflow runs lint, unit + component, then e2e with a cached
browser, on push and pull request. The pre-commit hook remains as fast local
feedback, but CI is the gate, since `--no-verify` bypasses the hook.

The live ssa.tools cross-check stays **on-demand only** (`npm run
crosscheck:ssatools`) and is not wired into CI on any schedule. It depends on a
third party's uptime, and running it automatically would both make our pipeline
flaky and put avoidable load on someone else's site.

No coverage percentage is set. The gate is the surfaces listed above; a
percentage target invites tests written to move the number.

## Success criteria

1. A married analysis with two same-sex people uses the correct mortality table
   for each. Monthly benefit amounts are gender-independent, so this is verified
   on the mortality-driven outputs: a same-sex fixture whose optimal filing ages
   and expected NPV differ from what the old opposite-gender assumption produced.
2. A married form missing any spouse field produces a validation message and no
   analysis, verified by a component test.
3. The spousal top-up reflects the spouse's real birthdate and filing age,
   verified by a fixture with a spouse claiming before FRA.
4. The Household tab shows a comparison table whose optimal row matches
   `analyzeHousehold().optimal` and whose other rows carry the engine's own NPV
   for those filing-age combinations.
5. No survivor figure appears anywhere in the UI or PDF.
6. The PDF contains a household section and one section per person.
7. Every fixture pins `asOf`, and sample household 4 is a passing fixture again.
8. `npm run lint`, unit + component tests, and e2e all pass in CI on a pull
   request.
9. `socialSecurity.ts` no longer exists, and every module this spec creates or
   splits — the five `src/lib` modules and the four `pdf/` modules — is under
   300 lines. Files untouched by this work (for example `OptionalCharts.tsx`)
   are out of scope for that limit.

## Risks

- **Import churn.** Removing `socialSecurity.ts` touches every component. Doing
  it as a mechanical move before behavior changes keeps the diff reviewable.
- **Fixture migration.** The scenarios file is the source of truth for two
  suites; a malformed migration breaks both. Migrating the schema and pinning
  `asOf` first, with no expected-value edits in the same commit, keeps a failure
  attributable.
- **Comparison-row availability.** For older cohorts several named rows are
  unattainable and the table can shrink to one or two rows. This is correct
  behavior, and the table needs to read sensibly when it happens.
