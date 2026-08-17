# Widowed as a marital status

- **Date:** 2026-08-17
- **Branch:** `feat/widowed-status`
- **Status:** Approved for planning
- **Phase:** 3B. Phase 3A (the survivor claim date shown as an alternative for a *married* household) is merged and unaffected by this.
- **Split:** two plans — **3B-i** computes the widowed analysis headlessly; **3B-ii** renders it on screen and in print, and adds the form and share-link parameters.

## The gap

The app models two marital statuses, `single` and `married`. A widow(er) walking into an adviser's office fits neither. Modelled as single, they lose the survivor benefit entirely — `strategySumPeriodsSingle` has no survivor concept at all. Modelled as married, the couple optimizer chooses a filing date for a person who has died.

There is no way to get a correct answer for this household today.

## What SSA actually allows

This phase rests on one rule, verified against SSA rather than recalled:

**Deemed filing does not apply to survivor benefits.** A widow(er) may claim the survivor benefit and let their own retirement benefit grow, or claim their own and switch to the survivor benefit later. SSA's own example: *"She starts her survivor benefit and only applies for surviving spouses benefits. She does not start her own retirement benefit, allowing it to grow. At age 70, she starts her own increased retirement benefit. The new law does not affect her because deemed filing does not apply to survivors spouses."*

If that rule were otherwise, this feature would collapse to a one-date problem. It is the load-bearing claim, and it is why the two dates below are genuinely independent.

The age floors are **asymmetric**, which shapes the whole search:

| | Earliest | Point past which waiting gains nothing |
|---|---|---|
| Survivor benefit | age **60** | survivor-FRA (a *different* table from retirement FRA — 66 to 67) |
| Own retirement | age **62** (62y1m in practice — entitlement needs a full month at 62) | age 70 |

Sources: [Filing Rules for Retirement and Spouses Benefits](https://www.ssa.gov/benefits/retirement/planner/claiming.html), [What you could get from Survivor benefits](https://www.ssa.gov/survivor/amount), [FRA for Survivor benefits](https://www.ssa.gov/survivor/full-retirement-age-survivor).

The vendored engine already models the separate survivor-FRA table and the 71.5%→100% reduction, so none of this is new benefit math in the app.

## What the engine gives us

`survivorBenefit(survivor, deceased, deceasedFilingDate, deceasedDeathDate, survivorFilingDate)` is **standalone** — it needs no couple optimizer. It handles all three deceased cases (died before NRA unfiled → the deceased's PIA; died after NRA unfiled → benefit as if filed at death, capped at 70; filed before death → RIB-LIM's `max(82.5% of PIA, actual benefit)`), and applies the survivor's own age reduction.

**To express "the deceased never filed", pass `deceasedFilingDate = deceasedDeathDate`.** The engine branches on `deceasedFilingDate >= deceasedDeathDate`, so this is the documented way to select the unfiled path — not an invented convention.

`survivorBenefit` **throws** if `survivorFilingDate <= deceasedDeathDate`, so every candidate month must be at least `death + 1`.

This holds the line drawn in Phase 2b-i and followed by 3A: **the engine owns amounts; the app owns dates and presentation.** The app supplies two dates and a `max()`, and computes no benefit rule.

## Why this is the only path that can have a two-date model

For a married couple, making the survivor claim month a decision variable requires `strats: [MonthDuration, MonthDuration]` to carry a second date, threading through four vendored, read-only files (`docs/reference/survivor-start-impact.md`). That work is still open and still worth up to $149,907.

For a widow(er) there is no couple grid at all. The space is `S × F` — roughly 85 × 97 ≈ **8,200 combinations**, searched exhaustively in milliseconds. The thing that is blocked for the married population is free for this one.

**This asymmetry is deliberate and should be stated wherever an adviser might notice it**: the widowed path optimizes two dates; the married path optimizes filing ages and shows the survivor claim date only as an alternative.

## Design

### Inputs

```ts
type Household =
  | { status: 'single'; people: [Person] }
  | { status: 'married'; people: [Person, Person] }
  | { status: 'widowed'; people: [Person]; deceased: Deceased };
```

A union member rather than a flag on `married`: `people: [Person, Person]` means "two living claimants" everywhere it is read, and making this a third variant means the type checker finds every `switch` on status that needs updating rather than leaving a silent fallthrough.

```ts
interface Deceased {
  birthYear: number;
  birthMonth: number;
  /** Month of death. Must be <= asOf: "widowed" means it has happened. */
  deathYear: number;
  deathMonth: number;
  record: DeceasedRecord;
}

type DeceasedRecord =
  /** Known PIA. The precise case. */
  | { kind: 'pia'; piaMonthly: number; filed: { year: number; month: number } | null }
  /** What the checks actually were, plus when they started. Estimated — see below. */
  | { kind: 'checkAmount'; monthlyAmount: number; filed: { year: number; month: number } };
```

`filed: null` means they died without filing, and maps to `deceasedFilingDate = deceasedDeathDate`.

**The check-amount fallback, and its honest limit.** An adviser usually knows *"he was getting $2,400 a month"*, not a PIA. `benefitOnDate` is monotonic in PIA, so the app recovers a PIA by **binary search over engine calls** — the same technique 3A used, and it keeps the app computing no rule of its own.

It is nonetheless an **estimate**, and must be labelled one on both surfaces. A current check includes every COLA since the deceased filed, so the recovered PIA is in that year's dollars rather than today's. For a recent death the error is small; for a death twenty years ago it is not. The UI states this; it does not present a derived PIA as equivalent to a known one.

### Already-claimed benefits

The common real-world case: a widow has been drawing the survivor benefit since 60 and wants to know when to switch.

```ts
interface AlreadyClaimed {
  survivorSince: { year: number; month: number } | null;
  ownSince: { year: number; month: number } | null;
}
```

This needs **no separate code path**. A claimed benefit fixes its date, collapsing that axis of the search to one value. Both null is the free two-date case; both set is a report with nothing left to decide, which the analysis still produces (it is a valid, and common, thing to want to see).

### The search

For candidate survivor-claim month `S` and own-filing month `F`:

- `S ∈ [max(deathMonth + 1, survivor's SSA age 60), survivor's survivorNormalRetirementDate()]`
- `F ∈ [earliestFiling(survivor, asOf), age 70]`

> **`F`'s lower bound comes from `earliestFiling(recipient, currentDate)`**, exported from `$lib/strategy/calculations/strategy-calc`, which already encodes the full-month-at-62 rule *and* the born-on-the-1st-or-2nd exception. **Never a hardcoded `{years: 62, months: 0}`.** That exact literal is why the `earliest` comparison row has never rendered for any household in the app's history — see `docs/reference/invariant-sweep.md` §Parked, finding 4. This phase must not add a second instance of it.
>
> Incidentally, `earliestFiling` is also the fix for that parked finding, whenever it is taken.

Each month `m` from `max(asOf, death + 1)` through the survivor's plan-to age pays:

```
own(m)      = F <= m ? benefitOnDate(survivor, F, m) : 0
survivor(m) = S <= m ? survivorBenefit(survivor, deceased, deceasedFilingDate, deathDate, S) : 0
paid(m)     = max(own(m), survivor(m))
```

SSA pays the larger of the two, never the sum. Score is the **straight sum of `paid(m)`, undiscounted, in today's dollars, through the plan-to age** — the same convention as the income-cliff callout and 3A's gain figure, so figures on one page can be read together.

**Known limitation, stated rather than hidden:** this is not mortality-weighted, so it differs in method from the married recommendation, which the engine scores by expected NPV. The married path's weighting comes from the engine and has no survivor-aware equivalent to reuse. Recorded as possible future work, not silently ignored.

### Bands, and why they stack

`periods` carries the same `BenefitBand` shape as every other household:

- a **Personal** band from `F` to the end, at the survivor's own amount;
- a **Survivor** band from `S` to the end, at `max(0, survivor(m) − own(m))`.

The two stack to exactly `max(own, survivor)`. Before `F` the own amount is zero, so the survivor band carries the whole payment; after `F`, if the own benefit is larger, the survivor band falls to zero and correctly disappears.

This is the same decomposition Phase 2b-i adopted after the user's own correction — *"his personal would continue all the way through, but the yellow section would sit on top of it"* — so the chart, the legend, `benefitSeriesLabel` and the PDF all work unchanged.

### Output

`HouseholdAnalysis` with `status: 'widowed'`, one entry in `people`, `periods` as above, and `comparisons` holding named strategies against the optimum:

| Key | Meaning |
|---|---|
| `survivorFirst` | Survivor benefit as early as allowed, own retirement at 70 |
| `ownFirst` | Own retirement as early as allowed, survivor benefit at survivor-FRA |
| `bothEarliest` | Both as early as allowed |
| `optimal` | The search winner |

`StrategyKey` gains these members. Rows whose dates coincide with the optimum fold into it, exactly as `buildComparisons` already does, and a row that is unreachable for a given household (both benefits already claimed) is omitted rather than shown empty.

`survivorGap`, `spousalTopUp` and `survivorClaim` are all `null`/absent for a widowed household: there is no spouse to top up, no unmodelled survivor direction, and the survivor claim date is now part of the recommendation rather than an alternative to it.

## Architecture

| File | Responsibility |
|---|---|
| `src/lib/widowed.ts` | **Create (3B-i).** The two-date search, the band construction, and the deceased-PIA recovery. Pure, no React. |
| `src/lib/household.ts` | **Modify (3B-i).** The `widowed` union member and its branch in `analyzeHousehold`. |
| `src/lib/ssaTools.ts` | **Modify (3B-i).** Thin adapters for `survivorBenefit` and the survivor's earliest/latest filing months. |
| `validation/scripts/gen-fixtures.mjs` | **Modify (3B-i).** Widowed scenarios. |
| `src/lib/formState.ts`, `src/lib/shareLink.ts` | **Modify (3B-ii).** Status, deceased fields, already-claimed fields, URL params. |
| `src/components/PersonFields.tsx` + a new `DeceasedFields.tsx` | **Modify/create (3B-ii).** |
| `src/components/methodologyCopy.ts` | **Modify (3B-ii).** Every widowed sentence, single-sourced, as on this project everywhere. |
| `src/components/pdf/*` | **Modify (3B-ii).** The widowed report. |
| `validation/sweep/households.ts` | **Modify (3B-ii).** Widowed households in the invariant sweep. |

## Testing

**Unit (3B-i).** Both directions of the switch produce the expected crossover month. The three deceased cases (unfiled before NRA, unfiled after NRA, filed before death) each select the branch the engine documents. A claimed benefit collapses its axis and the search still returns the best remaining date. `survivorBenefit` is never called with `S <= death`. The PIA recovery round-trips a known PIA to within a dollar.

**Every dollar figure must come from `survivorBenefit` or `benefitOnDate`.** A test that asserts an amount the app computed itself is asserting the wrong thing.

**Golden (3B-i).** New widowed scenarios, authored by searching with `find-candidates.sweep.ts` against the real pipeline rather than hand-picked — the lesson from 3A, where fixture parameters taken from a unit test's forced filing ages returned `null` in production.

**Guard against a test that cannot fail.** Four times on this project a test passed with the defect it existed to catch. Each search test must be checked against a stub returning the range's lower bound: if the stub passes, the assertion is structural, not real.

**Sweep (3B-ii).** Widowed households join `validation/sweep/`, so order independence, reconciliation, dollars-mode and the copy invariants cover them too.

## Success criteria

1. A widow(er) household produces a recommendation naming **two dates** — when to claim the survivor benefit and when to file on their own record — with the lifetime total each produces.
2. SSA's own worked example (survivor benefit at 60, own retirement at 70) is reachable and is recommended for the households where it is genuinely best.
3. A household with one benefit already claimed gets a recommendation for the remaining date, with no separate code path.
4. Every amount comes from `survivorBenefit()` or `benefitOnDate()`; the app computes no benefit rule.
5. A PIA derived from a check amount is labelled an estimate wherever it appears.
6. No existing single or married fixture value moves. This phase is purely additive to them.
7. `npm run lint`, the unit and component suites, `npm run build`, the e2e suite and `npm run sweep` all pass.

## Out of scope

**The two-date model for MARRIED households** — still blocked on the vendored `strats` type, still worth up to $149,907. This phase does not touch it, and the asymmetry is documented rather than quietly left for someone to trip over.

**Disabled-widow(er) benefits at 50, child-in-care survivor benefits, and the lump-sum death payment** — none are modelled by the engine.

**Remarriage rules.** Remarriage before 60 generally bars survivor benefits; after 60 it does not. The app does not ask, and therefore must not imply it has accounted for it.

**Surviving divorced spouses**, who qualify on a 10-year marriage. The arithmetic is identical, but the eligibility question is not, and the intake would need to ask it.

**Mortality-weighted scoring** for the widowed optimum — see the limitation stated under The search.

**Government Pension Offset and the Windfall Elimination Provision**, which the engine does not model and which bite hardest exactly on survivor benefits for public-sector widows.
