# Widowed intake, and an honest analysis

- **Date:** 2026-08-17
- **Branch:** `feat/widowed-intake`
- **Status:** Approved for planning
- **Phase:** 3B-ii-a. Phase 3B-i (the widowed analysis, headless) is merged at `6ab7ea6`.
- **Next:** 3B-ii-b renders the widowed household on screen and in print, removes the display guard, and adds widowed households to the invariant sweep.

## Where this sits

3B-i built a correct two-date analysis for a widow(er) and deliberately stopped short of the UI. Nothing can reach it: `toHousehold` cannot produce a `widowed` household, and `householdDisplayShape` **throws** on one rather than let it render through the single-claimant path.

This phase builds the intake that produces a widowed household, and fixes the figures the analysis currently carries that would be misleading the moment anything renders them. The guard stays up throughout; 3B-ii-b takes it down.

The split exists so the correctness work lands separately from the UI work, mirroring 2b-i/2b-ii.

## Intake

### Marital status becomes three-way

`AnalyzerFormState.hasSpouse: boolean | null` becomes:

```ts
maritalStatus: 'single' | 'married' | 'widowed' | null;
```

`null` continues to mean "not yet chosen", which is what gates the analysis today. The segmented control gains a third button labelled **Widowed** — the term advisers use on intake, and short enough for the existing control.

### The deceased's record

Choosing Widowed reveals one new field group. Every field maps to something 3B-i's `Deceased` already consumes; nothing is collected that the model ignores.

| Field | Notes |
|---|---|
| Date of birth | Month + year, as for a living person. Drives their NRA and the delayed-credit cap. |
| Date of death | Month + year. |
| Record | Either **PIA at FRA** (the precise route) or **the monthly check, plus when they filed** (the common route). |
| Had they filed before death? | Only for the PIA route. "No" maps to `filed: null`, which 3B-i translates to `deceasedFilingDate = deceasedDeathDate` — the engine's own selector for the never-filed branch. The check-amount route implies they had filed. |

The check-amount route recovers a PIA by bisection over engine calls (3B-i's `deceasedPia`) and is **an estimate**: a current check carries every COLA since filing, which the engine's PIA does not. This phase carries that fact through to the analysis; 3B-ii-b labels it.

### Already-claimed benefits

Two optional dates on the survivor: the month she began the survivor benefit, and the month she began her own retirement benefit. Either, both, or neither.

These are **facts, not candidates** — a claimed date legitimately sits in the past, and 3B-i's search deliberately does not floor them to today. The form must not "help" by clamping them forward.

### Validation

Hard-block only what is impossible or would produce a meaningless answer:

- a death date before the deceased's birth date;
- a death date after today (widowed means it has happened);
- **the survivor-benefit** date at or before the death month; **either** already-claimed date before the survivor's birth;
- a check amount that corresponds to no real PIA — 3B-i's `deceasedPia` throws here, and the form must surface it as a field error rather than let it escape as a crash.

> **Amended 2026-08-17, after implementation — this list originally read "an already-claimed date at or before the death month, or before the survivor's birth", applying the death clamp to BOTH already-claimed dates, and that was wrong.** It would have blocked the most common widowed profile there is: a woman who filed on her OWN record at 62 and was widowed later. Her own retirement benefit is paid on her own record and has nothing to do with when her husband died, so a date before the death is an ordinary fact about her, not an impossibility. Under the original rule she was rejected outright — `isFormComplete` false, no analysis at all — under a field error naming a survivor benefit she had not claimed. Measured: form `ownSince = Aug 2020` against a death of `Mar 2024` produced `{"ownSince":"claimBeforeDeath"}`; the same household through `analyzeHousehold` succeeds and returns "claim the survivor benefit at age 67 years, 7 months, and file on Client's own record at age 62 years, 2 months" at $2,475/mo. 3B-i's own code says the same thing in two places: `widowed.ts`'s death clamp is scoped to the **survivor** axis (`survivorBenefit` throws on a date not strictly after the death), and `widowedSearchRanges` leaves `ownSince` deliberately unclamped. The implementation is right and this spec was wrong; the bullet above is amended to match, and `claimBeforeDeath` is scoped to `survivorSince` only. `claimBeforeBirth` stays on both — a claim before she was born is impossible either way.

Everything else is the adviser's judgment and is not second-guessed. In particular, an unusual-looking PIA is not blocked: SSA's maximum rises every year, and this project already learned not to hard-ceiling a benefit figure.

### Share links

The existing `m` parameter is kept and gains `m=w`. `m=1` and `m=0` continue to mean married and single, so **every link already in the wild keeps working unchanged** — that compatibility is the reason for extending the parameter rather than replacing it.

New parameters, written only for a widowed household: the deceased's birth and death months, their record (discriminated by which route was used), and the two already-claimed dates. Absent parameters read as absent, never as zero — the existing `readPerson` convention.

## Making the analysis honest

The half of this phase that is not UI, and the reason the split was worth taking.

### The survivor-blind person figures

`analyzePerson` gives every person a `claimingOptions` table, `breakEvens` and a `recommendedMonthly`, all computed from that person's own record. For a widow those are not merely incomplete, they are misleading: her own benefit may be smaller than the survivor benefit in every month she is alive, so a table of "what you'd get claiming at 62 through 70" describes income she would never actually receive, and a break-even between two of those ages compares two irrelevant quantities.

The final review of 3B-i confirmed this empirically — break-evens came out byte-identical across every widowed fixture regardless of the deceased's PIA — and Task 4's golden fixtures had begun pinning those figures as `expected`, which would have certified them as correct.

**Fix it in the data, not the display.** For a widowed household:

- `claimingOptions` is `[]`
- `breakEvens` is `[]`
- `recommendedMonthly` is what she is actually recommended to receive, **in the steady state** — the month the later of the two recommended dates falls, once both benefits are running and the amount stops changing. That is `max(own, survivor)` at that month, taken from the engine and never re-derived.

  The month matters and must be stated, because the two dates differ: a widow claiming the survivor benefit at 60 and her own at 70 receives the survivor amount alone for ten years first. `recommendedMonthly` is the steady-state figure for the same reason it is for a single claimant — it answers "what will I be getting" — and the band chart and comparison table carry the path to it. A display layer must not present it as income beginning on the earlier date.

Empty arrays rather than a new nullable type, because `BreakEvenSection` already renders nothing on an empty array. The misleading section then disappears **by construction** rather than by every display component remembering to check a status — which is the failure mode that put a survivor-blind break-even in front of a widow in the first place.

This is deliberately not a redesign of `benefitMath.ts`, the illustrative math path behind the per-claiming-age charts. That family is uncovered by the invariant sweep and survivor-blind by construction; rebuilding it for widowed households is out of scope here and does not block this phase, because empty inputs make it render nothing.

### `piaEstimated` needs a carrier

`deceasedContext` computes `piaEstimated` and every caller drops it, so the spec's requirement that a derived PIA be labelled an estimate has nothing to attach to. Carry it on `HouseholdAnalysis` (null for single and married, boolean for widowed). 3B-ii-b renders it.

### What stays broken, deliberately

`earliestFiling` permits an own-filing month up to six months before today for a claimant past their FRA, but the scoring window starts at today, so those back-payments go uncounted. This under-ranks retroactive filing; it can never invent a spuriously-past recommendation.

**Decision: leave the scoring as it is, and document it.** The consequence that follows into 3B-ii-b is that a recommendation may name an own-filing month already in the past, which is exactly what flooring the survivor axis was meant to prevent on the other side. 3B-ii-b's copy must say something honest about a past filing month rather than print a date as though it were a plan. Recorded here so that phase does not rediscover it.

## Architecture

| File | Responsibility |
|---|---|
| `src/lib/formState.ts` | **Modify.** `maritalStatus`, the deceased and already-claimed field groups, `toHousehold`'s widowed branch, and completeness. |
| `src/lib/widowedForm.ts` | **Create.** Validation rules for the deceased and already-claimed fields, pure and independently testable. Kept out of `formState.ts`, which is already the app's busiest module. |
| `src/lib/shareLink.ts` | **Modify.** `m=w` and the new parameters, with the legacy `m=1`/`m=0` reading unchanged. |
| `src/components/DeceasedFields.tsx` | **Create.** The field group. |
| `src/components/Analyzer.tsx` | **Modify.** The three-way control, and the state it threads. |
| `src/lib/household.ts` | **Modify.** Empty `claimingOptions`/`breakEvens` and a real `recommendedMonthly` for widowed; carry `piaEstimated`. |

## Testing

**Unit.** Each validation rule rejects exactly what it should and accepts the boundary. A widowed household round-trips through `toHousehold`. `analyzeHousehold` returns empty `claimingOptions`/`breakEvens` for widowed and a `recommendedMonthly` equal to the larger of the two benefits at the recommended dates.

**Share links.** A widowed form round-trips to a URL and back unchanged, including an absent already-claimed date. **A legacy `m=1` and `m=0` link still parses to married and single** — the compatibility this design rests on, asserted rather than assumed.

**Component.** The Widowed button reveals the deceased fields and hides them again; a blocked field shows its error; the form does not become complete until every required field is present.

**Guard against tests that cannot fail.** Every prior task on this feature shipped at least one assertion satisfied by any plausible implementation, each found by mutation. For each new test, check that a trivially wrong implementation fails it — in particular the "empty arrays for widowed" assertions, which are satisfied by an implementation that returns empty for *every* status.

## Success criteria

1. An adviser can enter a widow(er), her deceased spouse's record either way, and any already-claimed dates, and the form produces a `widowed` household.
2. A widowed analysis carries no survivor-blind figures: `claimingOptions` and `breakEvens` are empty, and `recommendedMonthly` is the income actually recommended.
3. `piaEstimated` reaches `HouseholdAnalysis`.
4. Legacy share links (`m=1`, `m=0`) parse exactly as before; a widowed link round-trips.
5. Impossible inputs are blocked with a field error; a check amount that maps to no real PIA is one of them.
6. `householdDisplayShape` still throws on widowed — this phase does not render one.
7. No single or married behaviour or fixture value changes.
8. `npm run lint`, `npx tsc -b`, the unit and component suites, `npm run build`, the e2e suite and `npm run sweep` all pass.

## Out of scope

**All widowed rendering** — screen, print, copy, and removing the display guard. That is 3B-ii-b, along with widowed households in the invariant sweep.

**Rebuilding `benefitMath.ts`** so the per-claiming-age charts include the survivor benefit. Empty inputs make them render nothing, which is correct for now.

**The `expectedNpv`-under-"Combined PV" mislabel**, which only becomes visible once a widowed analysis renders — 3B-ii-b.

**Type-checking the test suite.** `tsconfig.app.json` excludes `*.test.ts(x)` and `validation/` sits in no tsconfig, so no test file in this repo is type-checked. That is how a missing import survived a whole task. It is a repo-wide change with its own backlog and does not belong inside a feature phase.

**Remarriage, surviving divorced spouses, disabled-widow(er) benefits at 50, child-in-care benefits, GPO and WEP** — none modelled by the engine, all listed in the 3B spec.
