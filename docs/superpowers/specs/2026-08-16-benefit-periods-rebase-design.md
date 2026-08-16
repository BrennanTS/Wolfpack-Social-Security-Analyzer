# Rebase the display onto the engine's benefit periods

- **Date:** 2026-08-16
- **Branch:** `feat/benefit-periods`
- **Status:** Approved for planning
- **Phase:** 2b. Depends on Phase 2a (per-person life expectancy), merged.

## Context

The vendored ssa.tools engine already computes the decomposition this app has been hand-rebuilding. `strategySumPeriodsCouple` (`src/vendor/ssa-tools/strategy/calculations/strategy-calc.ts:24`) returns typed, dated records:

```ts
class BenefitPeriod {
  startDate: MonthDate;   // inclusive
  endDate: MonthDate;     // inclusive
  amount: Money;
  recipientIndex: number;
  benefitType: BenefitType;   // Personal | Spousal | Survivor
}
```

The app calls the optimizer, keeps the filing ages, and throws the periods away. It then reconstructs a simplified model by hand — `spousalTopUp` in `src/lib/ssaTools.ts`, and a year-granular timeline in `buildCombinedTimeline` (`src/lib/household.ts:153`) that knows only "did this person file yet".

Every defect this project has found in the last two phases came from that reconstruction:

- the chart showing a survivor dropping to their own benefit,
- a spousal benefit beginning before the worker filed,
- a spousal reduction measured from the wrong date,
- a missing NRA-netting branch that fires in roughly a fifth of households.

Each was fixed by hand-implementing a rule the engine already had, correctly. This phase stops doing that.

## What the engine actually models

Read before designing against it, because two of its properties are load-bearing.

**Survivor benefits flow in one direction only.** `strategy-calc.ts:104` states it: *"Earner is simple as they will never have spousal or survivor benefits."* The engine classifies the higher-PIA person as the earner and only ever pays Survivor to the dependent. That is usually right — the higher earner's own benefit normally exceeds what they would inherit — but not always: a higher earner who claims at 62 against a spouse who delays to 70 can end up with the smaller benefit, and SSA would step them up.

**The periods carry no COLA.** `PersonalBenefitPeriods` (`recipient-personal-benefits.ts:40`) emits at most two periods per person — the delayed-January-bump period and the rest of life — each with a fixed amount. The engine handles time value through the discount rate, not through inflating the payment. **The periods are therefore already in constant dollars**, which is also what the combined household chart shows today.

## Design

### The periods become the single source of truth

A new module `src/lib/benefitPeriods.ts` sits between the engine and `household.ts`:

```
engine periods → normalize → dual-entitlement split → month-precise timeline → real | nominal
```

`spousalTopUp` and `spousalEntitlement` are **deleted** from `src/lib/ssaTools.ts`. The interim fix they represent has served its purpose.

Single claimants take the same path through `strategySumPeriodsSingle` (`strategy-calc.ts:846`), which returns Personal periods only. One code path, not two.

### Survivor renders as a top-up, not a replacement

SSA administers this as dual entitlement: a widow(er) entitled to both keeps their own retirement benefit and receives a survivor benefit equal to the *difference*. The total lands on the larger figure — which is why "greater of" is a fair shorthand — but the composition is own-benefit-plus-top-up.

The engine models it the other way. It truncates the personal period at `survivorStartDate − 1` and emits one Survivor period carrying the whole amount (`strategy-calc.ts:114-141`). Its total is right; its decomposition is the shorthand.

**The display layer performs the split**: the personal band continues at the amount it was already paying, and the survivor band becomes `survivorAmount − personalAmount`.

This is arithmetic on the engine's own output, never a re-derivation — the distinction that matters, because a re-derivation is exactly what this phase exists to delete. The personal benefit is fixed after filing, so carrying it forward is sound.

The engine's own eligibility test reads as a top-up test under this framing: `strategy-calc.ts:98` emits a survivor period only when the personal benefit is *less* than the survivor benefit. That is "the top-up is positive."

**Edge case that needs its own test:** when the two amounts are equal the top-up is zero, and the engine emits no survivor period at all. The display must not render an empty band or a zero-dollar legend entry.

### The unmodeled direction is detected, not computed

Where the higher earner is the survivor, the engine produces no step-up. We do not compute one — that would re-open the hand-built-supplement pattern, and the RIB-LIM interaction is where it gets subtle.

Instead we detect it. If the deceased's actual benefit exceeded the survivor's own, the engine's figure is known to be low, and the UI says so rather than printing it unqualified. This converts a silent wrong number into a stated limitation, which is the failure mode this project keeps meeting.

The check is a comparison of two figures already in hand. It adds no benefit rule.

### Charts: one band per benefit type

Up to four series — the earner's Personal, and the dependent's Personal, Spousal and Survivor. Color encodes the benefit type. Claim dates and the first death get reference markers, so the chart shows *when* each benefit was claimed alongside what it pays.

Spousal stacks on Personal; Survivor stacks on the continuing Personal per the split above. The three-part caveat currently on `CombinedIncomeChart` is deleted — all three omissions it discloses are gone.

### The timeline becomes month-precise

`buildCombinedTimeline` currently credits a person 12 monthly payments in every year at or after their filing year. The periods are month-precise, so the timeline can count actual payment months.

This **changes the first and last year of each person's contribution** in the combined chart — someone filing in September earns four payments that year, not twelve. That is a correction, and it is confined to the chart: no recommendation, break-even or lifetime total derives from this function.

### Real and nominal dollars

A toggle, defaulting to **real**.

Because the engine's periods carry no COLA, real is the engine's output unmodified and **nominal is the transform** — `annualCola` compounded forward from `asOf`. This is the reverse of the usual arrangement and it is the safer one: the honest view requires no arithmetic of ours, and the flattering view is the one that has to justify itself.

The PDF prints **real**, with the nominal figure for the first-death year stated in the methodology note. Print is the artifact that outlives the meeting, so it carries the honest-by-default view; the one nominal number clients ask about survives in prose.

### The comparison table gains survivor income

Each strategy row gains what the survivor receives annually, in the engine's supported death direction. Delaying doesn't only raise the household total while both are alive — it permanently raises the survivor's income, which is the actual argument for delaying and the number today's table cannot show.

### The income-cliff callout

Below the corrected chart: the household total in the year before the first death against the year after, the percentage drop, and the strategy's contribution to the survivor's income relative to claiming earliest.

## Delivery: two plans

One design, delivered in two plans. The seam is between the calculation and the display, and it exists so the fixture cross-check below lands on its own — before any chart work can muddy what a moved number means.

**2b-i — the calculation rebase.** `benefitPeriods.ts`, `household.ts` driving from periods, `spousalTopUp` and `spousalEntitlement` deleted. Display shapes unchanged, so the existing charts and PDF keep rendering from the same fields. Carries the whole invariant: no recommended filing age moves, and the hand-derived spousal fixtures are reproduced from the periods.

**2b-ii — the display.** Bands per benefit type, the income-cliff callout, the survivor-income column, the real/nominal toggle, and the copy and PDF changes that follow.

Success criteria 1–3 and 6 belong to 2b-i; 4, 5, 7, 8 and 9 to 2b-ii. Criterion 10 binds both.

## Architecture

| File | Responsibility |
|---|---|
| `src/lib/benefitPeriods.ts` | **Create.** Engine adapter: normalize, dual-entitlement split, gap detection |
| `src/lib/dollarsMode.ts` | **Create.** The real/nominal transform, pure |
| `src/lib/household.ts` | **Modify.** Drive from periods; `buildCombinedTimeline` becomes month-precise |
| `src/lib/ssaTools.ts` | **Modify.** Delete `spousalTopUp` and `spousalEntitlement` |
| `src/components/CombinedIncomeChart.tsx` | **Modify.** Series per benefit type; markers; caveat deleted |
| `src/components/IncomeCliffCallout.tsx` | **Create.** |
| `src/components/StrategyComparisonTable.tsx` | **Modify.** Survivor-income column |
| `src/components/methodologyCopy.ts`, `src/components/pdf/*` | **Modify.** Follow the new model |
| `src/lib/shareLink.ts` | **Modify.** `dollars` parameter |

`benefitPeriods.ts` stays pure and React-free, so the decomposition is unit-testable without rendering — the same shape as `shareLink.ts` and `format.ts`.

## The invariant

**No recommended filing age may change for any existing golden scenario.** The optimizer already runs on periods internally; this phase changes only what is displayed. A moved filing age means the rebase altered the calculation, which it must not.

Two cautions on relying on that:

1. `validation/engine/golden.test.ts:53-65` builds `Person` objects directly, bypassing `formState.toHousehold`. It exercises the engine path — which is the path that matters here — but it is not a whole-app guard.
2. Every person in `scenarios.json` carries `lifeExpectancy: 85`, so scenarios are less varied than their count suggests.

### The fixtures that must survive the deletion

Deleting `spousalTopUp` removes the source of the `spousalTopUpAtFilingAge` and `startsAtSpouseAge` fixture fields. They are **not** deleted with it. They must now be produced from the periods' Spousal band, and **must reproduce the same values** — those figures were hand-derived from SSA's published rules in the previous phase and confirmed against the engine.

This is the phase's strongest single test. If the periods-derived spousal figure disagrees with the hand-derived fixture, one of the two is wrong, and finding out which is worth more than the rest of the suite. **If they disagree, STOP and report.**

## Testing

**Unit — `benefitPeriods`:** the dual-entitlement split, including the equal-amounts case where the top-up is zero and no band should render; the gap detection firing when the higher earner survives with the smaller benefit, and staying silent otherwise; a single claimant producing Personal periods only; the zero-PIA dependent whose filing date the engine bumps to the earner's.

**Unit — `dollarsMode`:** real returns the input unchanged; nominal compounds `annualCola` from `asOf`; a zero COLA makes the two identical.

**Unit — timeline:** a person filing mid-year contributes that year's actual payment count, not twelve.

**Golden:** every recommended filing age unchanged; `spousalTopUpAtFilingAge` and `startsAtSpouseAge` reproduced from periods at their existing hand-derived values.

**Component:** the chart renders a band per benefit type and no band for a zero top-up; the cliff callout's before and after figures; the comparison table's survivor column; the toggle switching both.

**End-to-end:** the survivor step-up is visible in the chart for the recommended strategy — the bug that started this phase.

## Success criteria

1. `spousalTopUp` and `spousalEntitlement` no longer exist.
2. Every recommended filing age is unchanged across every golden scenario.
3. `spousalTopUpAtFilingAge` and `startsAtSpouseAge` are reproduced from the periods at their existing hand-derived values.
4. The chart shows a band per benefit type, with the survivor band stacked on a continuing personal band.
5. A zero survivor top-up renders no band and no legend entry.
6. Where the engine cannot model the survivor direction, the UI states the limitation instead of printing an unqualified figure.
7. The dollars toggle defaults to real, travels in the share link, and the PDF prints real with the nominal first-death figure in prose.
8. The comparison table shows survivor income per strategy.
9. The cliff callout states the before, after and percentage drop.
10. `npm run lint`, the unit and component suite, `npm run build` and the e2e suite all pass.

## Out of scope

**Widowed filing status** — Phase 3. The engine cannot represent a widow claiming at 60 or 61: the survivor start date is never earlier than the dependent's filing date, and filing dates are at least 62 (`docs/reference/ssa-tools-engine-audit.md` §6.3).

**Computing the reverse survivor direction.** Decided against; see above.

**The `>=` versus `>` tie-break** at audit §6.4, which is still open and will matter once we consume periods. It is a separate change with its own evidence to gather.

**Divorced-spouse, child, and disabled-adult-child benefits**, none of which the engine models.
