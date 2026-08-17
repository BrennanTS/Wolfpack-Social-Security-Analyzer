# The cross-surface invariant sweep

- **Date:** 2026-08-17
- **Branch:** `chore/invariant-sweep`
- **Spec:** `docs/superpowers/specs/2026-08-17-invariant-sweep-design.md`
- **Harness:** `validation/sweep/`

## Why this exists

Across five shipped branches this project produced **zero arithmetic defects and sixteen copy defects**, four tests that structurally could not fail, and three separate encounters with golden-suite blindness. Every one of those was caught by a human reading a screenshot or a reviewer reading a diff. **None was caught by the test suite.**

That is a shape, not bad luck. The suite asserts *the field that was just touched*, across thirty fixtures that share a shape — all thirty give both people plan-to age 85, which makes whole behaviours bit-exact and therefore invisible. `order-independence-runs-deep` states the lesson: **test a property over the whole output, not over the field you just touched.**

This sweep is the other half of the suite: properties asserted over the entire analysis, across thousands of generated households instead of thirty hand-written ones.

## Running it

```bash
npm run sweep
```

It is **not** part of `npm test` or the pre-commit hook — it walks thousands of households through the mortality-weighted optimizer and takes minutes, not seconds. `SWEEP_COUNT` sets the household count (defaults vary per file).

To find a household that reaches a particular branch — the reliable way to author a golden fixture:

```bash
SWEEP_FIND=survivor-no-band SWEEP_COUNT=6000 npm run sweep
```

## The generator

`validation/sweep/households.ts` is seeded and total: `householdAt(index)` yields the same household on any machine, forever, so every finding reproduces from its index alone. It deliberately leaves the golden corpus's shape:

- **life expectancies differ between spouses** (72–95, not a universal 85) — the blindness that hid the Phase 3A defect;
- **PIAs repeat**, so exact ties occur — the shape that exposed the engine's positional tie resolution;
- **age gaps run to 18 years**, and PIA 0 is in the pool.

`id` is a slot, `name` is the human. That distinction is what makes the order-independence comparison meaningful, and `harness.ts`'s `canonicalize` re-keys every id-keyed structure by human before comparing.

## Can the sweep fail?

`self-check.sweep.ts` exists because four times on this project a test passed with the defect it existed to catch. It perturbs a real analysis in each place the comparison is supposed to cover — a filing age, a band amount, a timeline total, an expected NPV, a survivor-income figure — and requires the comparison to notice each one. It also asserts the *converse*: an untouched re-analysis reports no difference, and a swap alone is not a difference.

If any of those stops failing, `canonicalize` has stopped looking at that part of the analysis.

---

## Findings — fixed

### 1. "62 years, 1 months" (fixed, committed)

Four sites interpolated a bare plural — `formatFilingAge` (`ssaTools.ts:67`), `fraLabel` and `formatAgeDisplay` (`format.ts`), and the PDF's current-age row (`pdf/PersonSection.tsx:88`) — so any age with exactly one month printed **"1 months"**.

This is not an exotic input. SSA entitlement requires a full month at 62, which makes **62y1m the earliest anyone can claim** and one of the most frequently recommended filing ages the app prints. It reached the strategy table's filing-age column, the spousal sentence on screen, and the same sentence twice in the PDF.

**Scale:** 750 hits across 2,000 generated households (× 2 dollars modes × 3 rendering sites).

**Fix:** one `yearsMonthsLabel(years, months)` in `format.ts`, used by all four sites. A golden fixture and three component tests had **pinned the defective string**; the underlying age is unchanged (69y1m), only its spelling.

---

## Findings — parked

Each of these has exactly one thing left to decide, and the decision is yours. Nothing below was changed.

### 2. The PDF prints the same spousal paragraph twice, on one page

`pdf/HouseholdSection.tsx:267` renders `spousalSummary(spousal, …)`, and the methodology appendix renders `spousalSummary(spousal, …)` with the **identical arguments** at `pdf/ReportDocument.tsx:153`. For a married report `ReportDocument` places that appendix **on the household page itself** — its own docstring says so explicitly ("this block and the combined-income caption share one physical `<Page>`").

So a client receives a page carrying, verbatim:

> The lower earner's spousal top-up is $1,500.00/mo under the recommended strategy, beginning at the lower earner's age 66 years, 10 months — the later of the lower earner's own filing and the other spouse's, since a spousal benefit cannot start before the other spouse has filed. The unreduced amount at the lower earner's own FRA is $1,500.00/mo.

…twice.

**Why it wasn't fixed autonomously:** which of the two to drop is a page-design call. **Recommendation:** drop it from the appendix. The household section states it in context beside the figures it describes; the appendix entry is a methodology stub that now says nothing the reader hasn't just read. Keep the appendix's "Spousal Benefit" title with the *rule* rather than this household's numbers.

### 3. The screen prints the survivor-gap note twice

`spousalMethodologyCopy` **embeds** `survivorGapNote` (`methodologyCopy.ts:527`), and `CombinedIncomeChart` renders `survivorGapNote` directly (`CombinedIncomeChart.tsx:105`). `Analyzer.tsx` renders `HouseholdView` and the "How This Works" panel as siblings on one scrolling page, so both land in front of one reader.

There is precedent for the fix: `IncomeCliffCallout` carries a comment saying it "deliberately does NOT re-render `survivorGapNote`" for exactly this reason. That decision was made for the callout and not extended to the methodology panel.

**Recommendation:** apply the same rule — the chart owns the gap note; `spousalMethodologyCopy` keeps its blanket survivor sentence and drops the embedded gap note.

### 4. The "earliest" comparison row has never rendered, for any household

Confirmed empirically for the first time: across **2,000 households (1,500 of them married)**, the strategy table reached only `fra`, `latest` and `optimal`. `earliest` was reached by none.

**Root cause, confirmed:** `buildComparisons` (`household.ts:170`) asks `findStrategyByAges` for exactly `{years: 62, months: 0}`. SSA entitlement needs a full month at 62, so the engine's grid starts each person at 62y1m, the lookup misses, and `if (!match) continue` drops the row silently.

**The fix is available and engine-derived.** `expectedNPVCoupleOptimized` returns a complete cross-product grid from each person's own earliest filing month (`expected-npv.ts:641-643`), so the componentwise minimum over `ranked` is always an attainable row — no new benefit rule in the app, which is the line this project holds.

**Why it wasn't fixed autonomously:** `household.test.ts:783` carries a deliberate tripwire asserting `earliest` is `undefined`, whose comment says the day the row starts appearing, a human should decide that is safe rather than have a guard "quietly start to fire for the first time with no one having decided that was safe." That is an explicit request for a human decision, and it is respected. The sweep now carries the same tripwire at scale.

**Recommendation:** take the fix. It adds a row that was always intended, changes no existing figure, and does not touch the recommendation.

---

## What passed

Negative results are the point of a sweep, and these are strong ones.

| Invariant | Scale | Result |
|---|---|---|
| Entry order does not change the analysis | 4,000 households (3,000 married), whole-object comparison | **0 failures** |
| Timeline totals equal their own parts | 1,500 households, per year | **0 failures** |
| Monthly series matches the bands live each month | 1,500 households, per month | **0 failures** |
| Income cliff reads the timeline it claims to read | 1,500 households, incl. the stated percentage | **0 failures** |
| Strategy table: one optimum, no row above it, deltas consistent | 1,500 households, every row | **0 failures** |
| Nominal differs from real by exactly the deflator | 1,500 households, keys and order preserved | **0 failures** |
| `toNominalAmount` agrees with `toNominal` | 1,500 households, per year | **0 failures** |
| No sentinel or empty substitution in rendered copy | 2,000 households × 2 modes, after fix 1 | **0 failures** |

Full run: **17 tests across 4 sweep files, all passing, 1,500 households, ~131s.**

Order independence holding over the *whole* analysis across 3,000 married households is the result worth noting. It took three attempts to achieve, and the first two passed their tests. This is the first evidence that covers the timeline, periods, cliff, filing ages and every rendered label at once.

The arithmetic results are consistent with the project's history: **the numbers have never been the problem.**

## Corpus expansion

One golden scenario was added, **`married-1964-tie-no-survivor-band`** — found by `find-candidates.sweep.ts`, not hand-picked. It pins three branches the original thirty could not reach, in one household:

- an **exact PIA tie** with *differing* plan-to ages (85 vs 88) — `married-1964-dual-high-earners` is also a tie, but both its people plan to 85, so it cannot reach the two below;
- **`startsAtSpouseAge: null`** — a spousal entitlement that never begins, the case whose em-dash sentinel once reached a client PDF;
- **`baselineHasSurvivorBand: false`** — the population Phase 3A's spec amendment was about: a survivor benefit worth $1,595 here that the engine emits no band for, so the app would otherwise show nothing of it. Until this scenario the golden suite could not see that branch at all.

It was authored by searching with the **same pipeline the fixture runs through**, which is the lesson from Phase 3A: a fixture specified from a unit test's *forced* filing ages returned `null` in production, because forced filing ages are not optimizer-chosen filing ages.

The suite is now 33 scenarios and 771 tests, and `fixtures:gen` is idempotent.

## What the sweep still cannot see

Stated plainly, because a coverage claim that overstates itself is worse than none.

- **The person-level chart family is not covered at all.** `BenefitChart`, `BreakEvenSection`, the six charts in `OptionalCharts.tsx` and the PDF's `PersonSection` are built on `benefitMath.ts` — the app's own illustrative math, explicitly independent of the engine. None of the invariants here touch it. That family has a known 62-vs-62y1m problem and no dollars-mode awareness.
- **No pixels.** The sweep reads strings and numbers. The chart defects this project has shipped were visual (a line dropping at the end, a marker colliding with an axis label) and only a screenshot catches those.
- **`surfaces.ts` is a model of what each component renders, not the components themselves.** It can drift from them. It is written to be read beside the components for that reason.
- **One `asOf` and one set of assumptions.** Every household is evaluated at 2026-01-15 with 2.5% COLA and a 2.5% discount rate.
- **No single-claimant PDF path.** The married path is swept; the single-claimant report's own composition is not.

## Files

| File | Responsibility |
|---|---|
| `validation/sweep/households.ts` | Seeded household generation |
| `validation/sweep/harness.ts` | Fetch stub, runner, canonicalizer, finding formatter |
| `validation/sweep/surfaces.ts` | What each surface renders |
| `validation/sweep/self-check.sweep.ts` | Proves the sweep can fail |
| `validation/sweep/order-independence.sweep.ts` | Invariant 1 |
| `validation/sweep/reconciliation.sweep.ts` | Invariants 3 and 4, and strategy-table consistency |
| `validation/sweep/copy.sweep.ts` | Invariants 5, 6 and 7 |
| `validation/sweep/find-candidates.sweep.ts` | Branch-reaching household search, for fixture authoring |
