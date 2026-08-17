# The cross-surface invariant sweep

- **Date:** 2026-08-17
- **Branch:** `chore/invariant-sweep`
- **Status:** Approved (design approved in conversation; executed unattended)

## Why

Across five shipped branches this project produced **zero arithmetic defects and sixteen copy defects**, four tests that structurally could not fail, and three separate encounters with golden-suite blindness. Every one of those was caught by a human reading a screenshot or a reviewer reading a diff. None was caught by the test suite.

The reason is a shape, not an accident. The suite asserts **the field that was just touched**, across thirty fixtures that are far less varied than their count suggests — all thirty give both people a plan-to age of 85, which makes whole behaviours bit-exact and therefore invisible. `order-independence-runs-deep` records the lesson explicitly: *test a property over the whole output, not over the field you just touched.*

This phase builds the missing half of the suite: properties asserted over the **entire analysis**, swept across thousands of generated households rather than thirty hand-written ones.

## What it is not

It does not ship a feature, change the recommendation, alter a displayed figure's value, or touch the vendored tree. It is additive test infrastructure plus the fixes it licenses.

## The invariants

Each one is chosen because a defect this project actually shipped would have tripped it.

| # | Invariant | The defect it would have caught |
|---|---|---|
| 1 | `canonicalize(analyze([B,A])) === canonicalize(analyze([A,B]))` over the **whole** analysis | Order-dependence survived two fixes because the tests asserted only `lowerEarnerLabel` |
| 2 | Screen and PDF render identical figures for the same household | The on-screen top-up drifted to person-A-anchored while the PDF stayed lower-earner-anchored |
| 3 | Bands, combined timeline, strategy table and cliff reconcile against one another | The chart double-counted the death year against a true $68.7k |
| 4 | Real and nominal differ by exactly the deflator | The dollars-mode caption asserted byte-identical copy between modes, pinning a defect |
| 5 | No rendered string contains a sentinel or empty substitution | `"beginning at age — —"` reached a client PDF |
| 6 | No sentence repeats verbatim in consecutive paragraphs | A fix created exactly this duplicate |
| 7 | Branch reachability — every copy branch and comparison row is reached by some household | The earliest-claim row has never rendered for any household, ever |

## Rules of engagement (unattended)

**Fixed autonomously** — defects with exactly one correct answer:
- screen and PDF disagreeing on the same quantity (one of them is wrong)
- a sentinel or empty substitution in rendered output (never intended)
- a branch no household can reach (dead or mis-gated)
- an assertion that cannot fail

**Parked with evidence, not fixed** — anything requiring judgment:
- any change to a displayed figure's value
- any change to the recommendation
- copy rewrites beyond restoring a plainly broken sentence
- anything touching `src/vendor/`

A finding that is ambiguous is parked. The default is park, not fix.

## Deliverables

1. `validation/sweep/` — the harness, runnable as `npm run sweep`.
2. `docs/reference/invariant-sweep.md` — the findings, with counts and reproductions.
3. One commit per autonomous fix, tests green at each.
4. Golden scenarios with varied life expectancies and age gaps, so the corpus can see this class at all.
5. A parked list with a recommendation per item.

## Success criteria

1. The harness runs unattended and reports every invariant's pass/fail with a count and a reproducing household.
2. Every autonomous fix is covered by a test that fails without it.
3. `npm run lint`, the unit and component suite, `npm run build` and the e2e suite all pass.
4. No existing fixture value moves. If one does, that is a signal the sweep changed something it should not have — park it and report.
