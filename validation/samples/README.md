# Sample cases (`sample-cases.csv`)

[`sample-cases.csv`](./sample-cases.csv) is a set of 20 real-world household
scenarios we would like the analyzer to handle. This file records which ones
are currently expressible as golden fixtures and which need product features
the engine or form does not have yet.

## What the engine actually models

The app takes the **PIA (benefit at FRA) as a direct input** — it does not work
from an earnings record. Its inputs are birth **month + year** (no day), gender,
PIA, and, for a couple, the spouse's birth month/year + PIA, plus life
expectancy / COLA / discount-rate assumptions. Filing status is **Single or
Married only**.

From those inputs it models: the FRA schedule, the early-claim reduction and
delayed-retirement credits, the **spousal top-up** (`max(0, workerPIA/2 −
spousePIA)`), break-evens, and the mortality-weighted optimal-filing age. That
is the whole surface a fixture can assert against. (The vendored engine contains
more — a survivor-benefit routine and a Jan-1/2 birthday rule — but those are
either not surfaced through the app's inputs or are simplified in the app layer;
see the gaps below.)

## Status of each case

| HH | Filing | What it tests | Status | Fixture id / note |
|----|--------|---------------|--------|-------------------|
| 1  | Single | Baseline single, delay to 70 | ✅ **Added** | `sample-hh1-single-1962-pia2400-delay70` |
| 2  | MFJ | Dual high earners, split strategy | ✅ **Added** (partial) | `sample-hh2-married-1960-dual-high-earners` — worker tables + $0 top-up asserted; *which spouse delays* is not a value we assert |
| 3  | MFJ | Reduced spousal top-up (own < 50% of higher PIA) | ✅ **Added** | `sample-hh3-married-1959-reduced-spousal` — top-up **$1,100**; worker FRA 66y10m |
| 4  | MFJ | Wide age gap, staggered claiming | ✅ **Added** | `sample-hh4-married-1955-wide-age-gap` — `asOf` pinned to 2024-01-15 (worker was 68, turning 69 in Mar 2024) so the optimizer has a prospective filing age; $0 top-up (spouse's own PIA exceeds half the worker's) |
| 5  | Widowed | Survivor, deceased claimed at FRA | ❌ **Not modeled** | No widowed filing status; survivor benefit — see gaps |
| 6  | Single | Divorced-spouse benefit | ❌ **Not modeled** | No divorced-spouse logic |
| 7  | Single | Divorced survivor benefit | ❌ **Not modeled** | No divorced/survivor logic |
| 8  | MFJ | Minor child + family maximum | ❌ **Not modeled** | No child benefit or family-max cap |
| 9  | MFJ | SSDI-to-retirement conversion | ❌ **Feature absent** | No SSDI/disability path. Reduces to a plain married retirement case (benefit = PIA at FRA), so the *conversion* behavior itself is untested. |
| 10 | MFJ | Restricted application, grandfathered | ❌ **Not modeled + aged out** | No restricted-application path; worker born 1953 is 73 now |
| 11 | MFJ | WEP/GPO repeal (zero offset) | ❌ **Feature absent** | No non-covered-pension input, no WEP/GPO. With the Fairness Act the offset is $0, so it reduces to a standard married case — but there's no offset to test. |
| 12 | Single | Earnings test, pre-FRA | ❌ **Not modeled** | No earnings input or retirement-earnings-test withholding |
| 13 | MFJ | Two max earners, delay to 70 (DRC ceiling) | ✅ **Added** | `sample-hh13-married-1962-two-max-earners` — exercises credits stopping at 70; $0 top-up |
| 14 | Single | Disabled adult child (DAC) | ❌ **Not modeled** | No DAC auxiliary benefit |
| 15 | Widowed | RIB-LIM survivor, deceased claimed early | ❌ **Not modeled** | No widowed status; RIB-LIM cap not surfaced |
| 16 | MFJ | Deemed filing forced (post-1954) | ❌ **Feature absent** | Deemed-filing rule not modeled. The household's spousal top-up ($500 for the lower earner) is computable, but the deemed-filing *behavior* the case targets is not. |
| 17 | MFJ | Child-in-care spousal, unreduced | ❌ **Not modeled** | No child-in-care rule (unreduced spousal before FRA) |
| 18 | Single | Earnings test in the FRA year | ❌ **Not modeled** | No earnings test (higher exempt amount, 1-for-3, stop at FRA month) |
| 19 | Single | January 1/2 birthday boundary | ❌ **Not reachable** | The engine *does* model SSA's "attained the day before your birthday" rule (`src/vendor/ssa-tools/birthday.ts`), but the form collects only month + year and hardcodes the day to the 15th (`DEFAULT_BIRTH_DAY`, `src/lib/ssaTools.ts`), so no Jan-1 vs Jan-2 case can be produced. Needs a birth-day input. |
| 20 | MFJ | Survivor remarriage after 60 | ❌ **Not modeled** | No survivor-on-former-spouse or remarriage-cliff logic |

Legend: ✅ added as a golden fixture (validated by the engine + UI suites, and
the live ssa.tools cross-check) · ⚠️ blocked by an aged-out cohort · ❌ needs a
product feature that does not exist yet.

## Coverage summary

- **5 of 20** added as fixtures: HH1, HH2, HH3, HH4, HH13 (see
  [`../scripts/gen-fixtures.mjs`](../scripts/gen-fixtures.mjs), regenerate with
  `npm run fixtures:gen`).
- HH3 is the first **married, non-integer-FRA** cross-check case; the live
  cross-check's worker-table picker was made robust for it (it now selects the
  worker's table by closest fit to the expected values instead of assuming
  "benefit at FRA == PIA").
- Every fixture pins an `asOf` date (Task 21) so `full`-mode eligibility and
  the optimizer's chosen filing ages are deterministic. HH4 is the case this
  unlocked: it needs `asOf: "2024-01-15"` specifically, since the 1955 cohort
  ages out of the optimizer (turns 70) under the default `asOf` the other
  fixtures use.
- The remaining 15 are out of scope for the current PIA-in, single/married,
  retirement-only model.

## What each gap would require

Grouped so a future feature unlocks several cases at once:

1. **Survivor / widow benefits** (HH5, HH15, HH20): a "Widowed" filing status
   plus deceased-earner inputs (their PIA and how/when they claimed), the
   RIB-LIM cap, the separate survivor FRA, and the take-one-then-switch option.
   The vendored engine already has `survivorBenefit` (`benefit-calculator.ts`),
   but the app layer's `survivorByClaimAge` currently just echoes the worker's
   own benefit — it is not the engine's survivor calc — and there is no widowed
   input path. HH20 additionally needs the remarriage-after-60 rule.
2. **Divorced benefits** (HH6, HH7): divorced-spouse and divorced-survivor
   categories (10-year marriage test, independence from the ex's own claiming).
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
8. **Birth-day input** (HH19): collect the day of birth (or expose it in the
   fixture harness) so the engine's existing Jan-1/2 attainment rule can be
   exercised.
