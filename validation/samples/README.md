# Sample cases (`sample-cases.csv`)

[`sample-cases.csv`](./sample-cases.csv) is a set of 20 real-world household
scenarios we would like the analyzer to handle. This file records which ones
are currently expressible as golden fixtures and which need product features
the engine or form does not have yet.

Last re-audited **2026-09-10**, after the birth-day input shipped. HH19 moved
from "not reachable" to added on that pass; HH5 and HH15 moved on the previous
one, when widowed-household support shipped.

## What the engine actually models

The app takes the **PIA (benefit at FRA) as a direct input** — it does not work
from an earnings record. For each person it takes a full **date of birth**
(day included, since SSA reads a 1 January birthday into the previous year's
FRA cohort), gender, PIA and a plan-to age, plus COLA / discount-rate
assumptions. Filing status is **Single, Married, or Widowed**.

From those inputs it models: the FRA schedule, the early-claim reduction and
delayed-retirement credits, the **spousal top-up** (`max(0, higherPIA/2 −
lowerPIA)`), break-evens, and the optimal filing age over each person's
plan-to horizon.

A **widowed** household additionally takes the deceased spouse's record —
their PIA (or the check amount they were receiving, from which the app
recovers a PIA by binary search over engine calls), when they filed, and when
they died — and searches the survivor's two independent claiming dates (when
to claim the survivor benefit, when to file on their own record). Survivor
amounts come from the engine's own typed benefit periods, and the engine
applies SSA's **widow(er)'s limit (RIB-LIM)**: the survivor benefit is the
greater of what the deceased was actually receiving and 82.5% of their PIA
(`src/vendor/ssa-tools/benefit-calculator.ts:484-497`).

Every fixture pins an `asOf` date so `full`-mode eligibility and the
optimizer's chosen filing ages are deterministic rather than drifting with
wall-clock time.

## Status of each case

| HH | Filing | What it tests | Status | Fixture id / note |
|----|--------|---------------|--------|-------------------|
| 1  | Single | Baseline single, delay to 70 | ✅ **Added** | `sample-hh1-single-1962-pia2400-delay70` |
| 2  | MFJ | Dual high earners, split strategy | ✅ **Added** (partial) | `sample-hh2-married-1960-dual-high-earners` — worker tables + $0 top-up asserted; *which spouse delays* is not a value we assert |
| 3  | MFJ | Reduced spousal top-up (own < 50% of higher PIA) | ✅ **Added** | `sample-hh3-married-1959-reduced-spousal` — top-up **$1,100**; worker FRA 66y10m |
| 4  | MFJ | Wide age gap, staggered claiming | ✅ **Added** | `sample-hh4-married-1955-wide-age-gap` — `asOf` pinned to 2024-01-15 (worker was 68, turning 69 in Mar 2024) so the optimizer has a prospective filing age; $0 top-up (spouse's own PIA exceeds half the worker's) |
| 5  | Widowed | Survivor, deceased claimed at FRA | ✅ **Added** | `sample-hh5-widowed-1961-deceased-filed-at-fra` — deceased filed at his FRA, so his benefit equalled his PIA and the RIB-LIM floor never binds: survivor is paid the full **$2,600**. Control half of the HH5/HH15 pair. |
| 6  | Single | Divorced-spouse benefit | ❌ **Not modeled** | No divorced-spouse logic |
| 7  | Single | Divorced survivor benefit | ❌ **Not modeled** | Survivor math now exists; still blocked by the **divorced** category alone (10-year marriage test, independence from the ex's claiming) |
| 8  | MFJ | Minor child + family maximum | ❌ **Not modeled** | No child benefit or family-max cap |
| 9  | MFJ | SSDI-to-retirement conversion | ❌ **Feature absent** | No SSDI/disability path. Reduces to a plain married retirement case (benefit = PIA at FRA), so the *conversion* behavior itself is untested. |
| 10 | MFJ | Restricted application, grandfathered | ❌ **Not modeled + aged out** | No restricted-application path; worker born 1953 is 73 now |
| 11 | MFJ | WEP/GPO repeal (zero offset) | ❌ **Feature absent** | No non-covered-pension input, no WEP/GPO. With the Fairness Act the offset is $0, so it reduces to a standard married case — but there's no offset to test. |
| 12 | Single | Earnings test, pre-FRA | ❌ **Not modeled** | No earnings input or retirement-earnings-test withholding |
| 13 | MFJ | Two max earners, delay to 70 (DRC ceiling) | ✅ **Added** | `sample-hh13-married-1962-two-max-earners` — exercises credits stopping at 70; $0 top-up |
| 14 | Single | Disabled adult child (DAC) | ❌ **Not modeled** | No DAC auxiliary benefit |
| 15 | Widowed | RIB-LIM survivor, deceased claimed early | ✅ **Added** | `sample-hh15-widowed-1961-riblim-deceased-filed-early` — deceased filed at 62 (reduced to $1,819), **below** 82.5% of PIA, so the floor binds and the survivor is paid **$2,145** — more than he ever received |
| 16 | MFJ | Deemed filing forced (post-1954) | ❌ **Feature absent** | Deemed-filing rule not modeled. The household's spousal top-up ($500 for the lower earner) is computable, but the deemed-filing *behavior* the case targets is not. |
| 17 | MFJ | Child-in-care spousal, unreduced | ❌ **Not modeled** | No child-in-care rule (unreduced spousal before FRA) |
| 18 | Single | Earnings test in the FRA year | ❌ **Not modeled** | No earnings test (higher exempt amount, 1-for-3, stop at FRA month) |
| 19 | Single | January 1/2 birthday boundary | ✅ **Added** (a pair) | `sample-hh19a-single-1960-jan1-prior-cohort` + `sample-hh19b-single-1960-jan2-own-cohort` — twins born one day apart. Jan 1 reads into the **1959** cohort (FRA **66y10m**); Jan 2 stays in 1960 (FRA **67**). The only fixtures not born on the 15th, and so the only golden coverage of the birth day. |
| 20 | MFJ | Survivor remarriage after 60 | ❌ **Not modeled** | Widowed status and survivor math now exist; still blocked by the **remarriage-after-60 rule** and survivor-on-a-former-spouse's-record alone |

Legend: ✅ added as a golden fixture (validated by the engine suite, and — where
the scenario is enterable through the form — the UI suite and the live
ssa.tools cross-check) · ❌ needs a product feature that does not exist yet.

## Coverage summary

- **8 of 20** added as fixtures: HH1, HH2, HH3, HH4, HH5, HH13, HH15, HH19 (see
  [`../scripts/gen-fixtures.mjs`](../scripts/gen-fixtures.mjs), regenerate with
  `npm run fixtures:gen`).
- **HH5 and HH15 are a matched pair.** Their only material difference is when
  the deceased filed, which is what the CSV means by "Direct contrast with
  HH 5". Same survivor PIA ($1,500), near-identical birth months (May vs Jun
  1961 — both FRA 67y0m, survivor-FRA 66y10m), same deceased PIA ($2,600) and
  death month (Mar 2023). HH5's deceased filed at FRA → survivor paid $2,600;
  HH15's filed at 62 → his own benefit was $1,819, below the 82.5% floor of
  $2,145, so the floor wins and the survivor is paid $2,145. The $125,895
  difference in recorded `lifetimeTotal` is exactly that $455/month over the
  ~23 years she collects, and is how the pair pins RIB-LIM. This is the golden
  corpus's only coverage of the floor binding versus not binding.
- HH3 is the first **married, non-integer-FRA** cross-check case; the live
  cross-check's worker-table picker was made robust for it (it now selects the
  worker's table by closest fit to the expected values instead of assuming
  "benefit at FRA == PIA").
- HH4 needs `asOf: "2024-01-15"` specifically, since the 1955 cohort ages out
  of the optimizer (turns 70) under the default `asOf` the other fixtures use.
- **HH19 is a pair, and has to be.** The whole case is that one day moves the
  FRA by ten months, which cannot be stated by a single fixture. Holding PIA
  ($2,400), gender, marital status and birth month fixed makes the difference
  attributable to the day and nothing else: at 62 the Jan-1 twin gets $1,700
  against his brother's $1,680, at FRA $2,432 against $2,400, at 70 $3,008
  against $2,976. Both twins are cross-checked against ssa.tools on their
  real days — see below.
- **HH20 is HH19's negative control.** Born 1 June 1962: day 1, but not
  January, so the attainment rule shifts the month without shifting the
  cohort. Its FRA stays 67 and every figure matches an ordinary mid-month
  1962 claimant's ($1,680 / $2,400 / $2,976, identical to HH1). That sameness
  is the assertion: it pins that the day-1 exception applies to January
  alone. HH19a on its own cannot tell "the rule stopped working" apart from
  "the rule fires on every 1st".
- **HH21 is the same cliff at a second FRA seam.** Born 1 January 1959, read
  as the 1958 cohort: FRA 66y8m, not the 66y10m its birth year suggests.
  HH19a pins the rule where the schedule stops moving and settles at 67;
  HH21 pins it where both cohorts are still climbing, which is where an
  off-by-one bracket would hide while HH19a still passed.
- The remaining 12 are out of scope for the current model.

### Why the widowed fixtures skip the UI suite

HH5 and HH15 carry `uiTestable: false` (which the generator emits as
`e2e.assertTable: false`), like the other widowed fixtures. The **app** has a
Widowed marital-status button, but the Playwright golden spec's form driver
(`validation/e2e/helpers/app.ts`) only clicks `Married` or `Single`, so there
is no way for it to enter a widowed household. Every Vitest expectation still
runs, and the survivor's own benefit table is still cross-checked against live
ssa.tools as a single worker. Teaching the form driver the widowed intake
would turn the UI assertions back on for four fixtures.

### How the live cross-check handles the birth day

`validation/crosscheck/ssatools-live.spec.ts` sends each fixture's **own**
birth day to ssa.tools, falling back to the **2nd** only for fixtures
recorded before the field existed. The day it sends has to be the 1st or the
2nd for the `62y 0m` row to exist at all — ssa.tools omits it for
later-in-month birthdays, because SSA pays a month only to someone 62
throughout it — and among those two the 2nd is the one that behaves like an
ordinary day.

It used to substitute the 2nd for *everybody*, which is value-preserving for
days 2-28 and *not* for the 1st, where SSA's day-before attainment rule moves
the claimant into a different FRA cohort. A `crosscheckable: false` flag
excluded the Jan-1 fixtures rather than send them a day that would have
quietly compared them against a different person. Sending the real day
removed the need for the flag, and the flag is gone.

The gain is not tidiness. Day 1 satisfies the whole-month rule too, so the
row is present either way — which means the one case the birth-day work
exists for is now confirmed against an independent implementation instead of
skipped. ssa.tools states it in as many words for `dob1=1960-01-01`: *"For
those born in 1959, normal retirement age is 66 years and 10 months."*

### A note on the engine-recorded values

Widowed fixtures record three values that cannot be hand-derived —
`recommendedOwnFilingAge`, `recommendedSurvivorClaimAge`, `lifetimeTotal` —
because `bestWidowedOutcome` searches two independent claiming dates with no
published closed form. `gen-fixtures.mjs` preserves them per scenario id and
**throws** rather than inventing them, so a new widowed scenario must be run
through the real `analyzeHousehold` pipeline first and its output recorded.
HH5 and HH15 were added that way. Never re-record one to make the suite pass:
a moved value is the regression the field exists to catch.

## What each gap would require

Grouped so a future feature unlocks several cases at once:

1. **Divorced benefits** (HH6, HH7): divorced-spouse and divorced-survivor
   categories (10-year marriage test, independence from the ex's own
   claiming). HH7's survivor half is already built — only the divorced
   category is missing.
2. **Remarriage** (HH20): the remarriage-after-60 rule and survivor benefits
   on a *former* spouse's record. The widowed status and survivor math this
   case also needs already exist.
3. **Family / child benefits** (HH8, HH14, HH17): dependent-child and
   disabled-adult-child auxiliary benefits, the family-maximum cap, and the
   child-in-care unreduced spousal rule.
4. **Earnings test** (HH12, HH18): an earnings input, pre-FRA 1-for-2
   withholding, the FRA-year 1-for-3 rule and higher exempt amount, and the ARF
   recomputation at FRA.
5. **WEP / GPO** (HH11): a non-covered-pension input and the offset math (now
   $0 under the Social Security Fairness Act — worth testing as an explicit
   zero).
6. **SSDI conversion** (HH9): an SSDI-benefit input that auto-converts to
   retirement at FRA with no early-claim reduction.
7. **Restricted application / deemed filing** (HH10, HH16): the pre-1954
   grandfathered restricted-application path and the post-1954 forced
   deemed-filing path.
