# The survivor claim date, shown as an alternative

- **Date:** 2026-08-16
- **Branch:** `feat/survivor-claim-alternative`
- **Status:** Approved for planning
- **Phase:** 3A. Phase 3B is widowed filing status as a marital status, and is separate.
- **Evidence:** `docs/reference/survivor-start-impact.md`

## The defect

`strategy-calc.ts:74-77` sets the survivor benefit's start to the later of the earner's death and **the survivor's own retirement filing date**. SSA pays a widow(er) from age 60 regardless of whether they have filed on their own record. So the engine shows nothing for every month between the death and that filing, and the strategy table's survivor-income column prints `$0` for **11.5%** of households in a 9,360-household sweep — most visibly on "both delay to 70", where the survivor is often well past 60.

The optimizer shares the defect, inlined at `expected-npv.ts:708`. It is vendored and read-only, so it cannot be corrected.

## Why the obvious fix is not the fix

Measured, not argued. Starting the survivor benefit at age 60 instead:

- **Lowers** lifetime household income in **400 of the 800** households it touches at the recommended filing ages, by up to **$48,532**, because `survivorBenefit` keys its 71.5%-to-100% reduction to the date it is given (`benefit-calculator.ts:510-536`). The start date *is* the amount.
- **Deletes the survivor period outright** in **308** households, costing up to **$292,092**. The reduced amount falls below the survivor's own benefit, and the engine's single applicability test (`strategy-calc.ts:92-100`) then emits no survivor period at all.

For one worked household the three models rank: two-date plan $1,217,704 > current engine $1,079,871 > **literal correction $1,056,140**. A start-date fix lands on the worst of the three.

**What recovers the money is letting the widow claim the survivor benefit and her own retirement benefit on separate dates**, paid the larger each month. That is worth up to **$149,907** more than the best plan the engine can express, and it removes every loss above rather than trading against them.

## What this phase builds, and what it does not

Building the two-date model properly means making the survivor's claim month a decision variable inside the optimizer. `strats: [MonthDuration, MonthDuration]` cannot carry it, and that type threads through `strategySumPeriodsCouple`, `optimalStrategyCouple`, `expectedNPVCouple` and `optimal-strategy-fast.ts` — all vendored. The search space grows by up to 85×.

**This phase does not do that.** It shows the adviser the plan the optimizer structurally cannot consider, with the number attached, and leaves the recommendation alone.

## Design

### What is computed

Hold the engine's recommended filing ages **fixed**. Vary one thing: the month the survivor claims the survivor benefit.

**The range runs from `max(earner death + 1, the survivor's SSA age 60)` to `max(earner death + 1, the survivor's survivor-FRA)`** — not up to the survivor's own filing date. The upper bound is survivor-FRA because that is where the reduction reaches 100%; claiming later gains nothing, and stopping at the own-filing date would exclude survivor-FRA whenever the survivor files before it, which is exactly the case where waiting is worth the most.

For each candidate month, compute the household's lifetime total under **dual entitlement** — each month the survivor is paid the larger of their own benefit and the survivor benefit. Take the best, and report:

- the claim month,
- the gain over the baseline.

**The baseline is what the app currently shows**: the engine's own periods at those same filing ages, which is the survivor benefit starting at the survivor's own filing date, or no survivor period at all where the engine's applicability test excludes one. Comparing against a re-composed engine total would flatter the result by crediting it with the dual-entitlement change rather than the claim-date change.

Both figures are **lifetime totals in today's dollars**, undiscounted — the same convention as the income-cliff callout directly above, so the two can be read together.

This is a one-dimensional search over at most ~85 months. It does **not** reopen the filing-age optimization, and it does not change the recommendation.

It should mostly land on the rule the engine's own applicability test implies — claim at 60 when the survivor's own benefit will later exceed the survivor benefit, so the reduction is a temporary bridge; claim at survivor-FRA when it will not, so no permanent reduction is locked in. The search is preferred over the rule because it handles the boundaries the rule gets wrong, and because it produces the figure rather than asserting it.

### Where the amounts come from

`survivorBenefit()` and `benefitOnDate()`, unchanged. The app supplies dates and the `max(own, survivor)` composition and nothing else — the line held since Phase 2b-i: the engine owns amounts, the app owns dates and presentation.

The measurement's harness already demonstrated this composition reproduces `strategySumPeriodsCouple` bit-identically across 20,736 configurations when given the engine's own start date, so the composition itself is not novel risk.

### Where it renders

Below the income-cliff callout, which already establishes the death year and is the same subject. It states the claim month, the gain, and that the recommendation above was chosen by an optimizer that cannot model a separate survivor claim date.

Both surfaces — screen and PDF — via one function in `methodologyCopy.ts`, as everything else on this project does.

### When it must say nothing

The gain is zero or negative — the survivor already claims early enough that nothing improves. There is no survivor period. The death direction is the one the engine cannot model (`survivorGap` is set). A single claimant. In each case the section does not render at all rather than rendering an empty or hedged version.

## Architecture

| File | Responsibility |
|---|---|
| `src/lib/survivorClaim.ts` | **Create.** The one-dimensional search and its result type. Pure, no React. |
| `src/lib/household.ts` | **Modify.** Carry the result on `HouseholdAnalysis`. |
| `src/components/SurvivorClaimNote.tsx` | **Create.** |
| `src/components/methodologyCopy.ts` | **Modify.** The sentence, single-sourced. |
| `src/components/pdf/HouseholdSection.tsx` | **Modify.** Same section in print. |
| `validation/fixtures/` | **Modify.** New scenarios only — see below. |

## Testing

**The existing fixtures are blind to this.** Every one of the 30 gives both people plan-to age 85, and the survivor-start correction is bit-exact across all 61,823 of their filing-age combinations. So no existing fixture value moves, and the suite as it stands cannot detect either the defect or the fix.

This phase therefore adds **new** scenarios with varied life expectancies and age gaps — the shape that makes the defect reachable. Additive, so nothing existing moves. Every expected value hand-derived from SSA's published rules and only then confirmed against the engine, as `gen-fixtures.mjs` already enforces for the spousal figures.

**Nothing existing moves at all.** The measurement listed three non-fixture assertions that would change — `household.test.ts:842`, `methodologyCopy.ts:542`, `methodologyCopy.test.ts:558` — but those were measured against the *literal correction*, which this phase rejects. This phase changes no displayed figure: it adds a section beside them. The `$0` and the sentence explaining it both stay exactly as they are, because they correctly describe what the engine models.

That makes this phase purely additive, which is the strongest safety property available here given the golden suite cannot see the underlying defect. If an existing assertion does move, that is a signal the phase has changed something it should not have — stop and report rather than updating it.

**Unit:** the search returns the earliest month when the survivor's own benefit later exceeds the survivor benefit, and survivor-FRA when it does not; a zero gain when the survivor already claims optimally; null for a single claimant and for a set `survivorGap`.

**Component:** the section renders with the claim month and gain; renders nothing in each of the four silent cases.

**Golden:** the new scenarios' claim months and gains, hand-derived.

## Success criteria

1. For a household where the survivor's own filing falls well after the first death, the app shows a claim month, a gain, and the statement that the optimizer cannot consider it.
2. Every **existing** scenario's recommended filing ages are unchanged — this phase does not re-optimize. New scenarios record theirs for the first time, so there is no baseline to hold; they are pinned like any other engine-recorded value.
3. No existing fixture value moves.
4. The section renders nothing when the gain is zero, when there is no survivor period, when `survivorGap` is set, and for a single claimant.
5. Every amount comes from `survivorBenefit()` or `benefitOnDate()`; the app computes no benefit rule.
6. New scenarios with varied life expectancies make the defect and the fix visible to the golden suite.
7. `npm run lint`, the unit and component suite, `npm run build` and the e2e suite all pass.

## Out of scope

**The two-date optimizer** — making the survivor claim month a decision variable, which needs the vendored `strats` type to carry it. This is the work that recovers the $149,907; this phase only reveals it. Its evidence base is already written.

**Phase 3B, widowed filing status as a marital status** — a claimant who is already a widow(er), with the deceased's record as input. `strategySumPeriodsSingle` has no survivor concept at all.

**The two vendored sites off the app's live paths** — `strategy-calc.ts:537-540` and `optimal-strategy-fast.ts:418` carry the same expression. Not reachable from this app, and the tree is read-only.

**Disabled-widow(er) benefits at 50, child-in-care survivor benefits, and the lump-sum death payment** — none modelled by the engine.
