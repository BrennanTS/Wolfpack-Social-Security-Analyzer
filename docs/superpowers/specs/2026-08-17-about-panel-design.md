# An About panel, and getting the plumbing off the working surface

- **Date:** 2026-08-17
- **Branch:** `chore/about-panel`
- **Status:** Approved for planning
- **Type:** Cleanup. No behaviour, no figures, no new analysis.

## Why

Two kinds of reference material currently sit in the adviser's working surface.

**The calculation engine is named twenty times.** `ssa.tools` appears in thirteen places on screen, three in the PDF, and four more in `methodologyCopy.ts` strings that render on both. Most are a parenthetical appended to a heading the adviser has already read a dozen times — `Recommended Strategy (ssa.tools)`, `Discount rate (ssa.tools)`, `Running ssa.tools analysis…`. Repetition of a brand name is not attribution; it is noise, and it crowds out the words that carry meaning.

**The "How This Works" methodology block and the thirty-year CPI history are permanent fixtures.** Both are things an adviser reads once, or reaches for when a client asks a question. Neither needs to be on screen during every analysis.

## What this changes

A new **About** panel holds all of it. Nothing else about the app's behaviour changes: no figure moves, no analysis differs, no new capability appears.

### The About panel

A drawer, closed by default, opened from the header beside Resources — matching `ResourcesPanel`'s existing pattern exactly.

**A drawer rather than a route.** This app has no router at all; share links carry state in query parameters and `Analyzer` strips them on load. Introducing routing for one static page would be a real cost against no benefit the drawer does not already provide.

It contains, in order:

1. **What this tool does** — one short orienting paragraph.
2. **How This Works** — the **four static** method cards moved verbatim from `Analyzer.tsx`: FRA, early-claiming reduction, delayed credits, and life expectancy by gender.

> **Amended 2026-08-17, during implementation — this originally said five cards, including spousal, and that was wrong.** The spousal card is not reference material: it renders `spousalMethodologyCopy(analysis)`, which states *this household's* actual top-up, when it begins, and how survivor benefits are modelled for it. `HouseholdPanel` carries no spousal prose and `spousalSummary` is print-only, so that card is **the only place on screen** an adviser sees this household's top-up explained in words. Moving it would have silently deleted per-household information — the same "remove the brand, never the information" rule this spec applies to strings, missed at block level.
>
> The spousal card therefore **stays on the main surface** and no static spousal card is added to About, which would only duplicate the sentence `spousalMethodologyCopy` already opens with. The life-expectancy card does move: its dynamic figure is already shown beside the live slider at `AssumptionsPanel:116`, so nothing is lost.
3. **Calculation engine** — the single attribution. What ssa.tools is, that it is MIT-licensed, a link, and one sentence on what it computes.
4. **BLS CPI-U — Last 30 Years** — moved from the bottom of `AssumptionsPanel`.
5. **Version** — via the existing `AppVersion` component.

### The strip

All twenty mentions go, from screen and print alike.

**The rule: remove the brand, never the information.** A mention that is doing double duty — standing in for a fact the adviser needs — must be replaced by that fact, not deleted.

| Now | Becomes | Note |
|---|---|---|
| `Recommended Strategy (ssa.tools)` | `Recommended Strategy` | Screen and PDF, both surfaces |
| `Running ssa.tools analysis…` | `Running analysis…` | |
| `Discount rate (ssa.tools)` | `Discount rate` | The hint beneath already explains it |
| `(ssa.tools expected NPV)` | `(mortality-weighted expected present value)` | The brand was hiding the meaning |
| `Using ssa.tools default discount rate.` | `Using the default discount rate.` | |
| `Married uses the ssa.tools couple optimizer.` | `Married optimizes both filing dates jointly.` | |
| `Benefit math uses SSA historical COLA tables (ssa.tools).` | `Benefit math uses SSA historical COLA tables.` | |
| `optimized jointly by ssa.tools` | `optimized jointly` | `methodologyCopy.ts` |
| `modeled via the ssa.tools couple optimizer` | `modeled via the couple optimizer` | `methodologyCopy.ts` |
| `The ssa.tools engine does not model…` | `The engine does not model…` | `methodologyCopy.ts` |
| `Prepared by {BRAND} using the open-source ssa.tools engine…` | `Prepared by {BRAND}…` | PDF disclosures |
| `, married (ssa.tools couple)` | `, married` | Summary line |

### What is deliberately kept

**`resources.ts`'s ssa.tools section.** Two curated links — the calculator and the GitHub repository — inside a panel whose entire purpose is external references, sitting beside SSA's own tools. Those are useful to an adviser, not repetitive. Removing them would delete something rather than tidy it.

## Decisions worth recording

**The PDF loses its attribution too, at the user's explicit direction.** My recommendation was to leave the printed report alone: it goes to a client who may never see the app, and the methodology appendix naming an open-source engine tells that client the figures came from somewhere known rather than from us. The user weighed that and chose consistency across surfaces. Recorded here as a deliberate choice, not an oversight.

**The MIT licence is unaffected.** Its obligation is that the copyright and permission notice accompany "copies or substantial portions of the Software" — satisfied by the LICENSE file in `src/vendor/ssa-tools/`, which this phase does not touch. A generated PDF is output, not a copy of the software. There is no obligation to name the engine in either surface, and the single About statement is better practice than twenty parentheticals regardless.

## What this will disturb, and why that is fine

`validation/sweep/copy.sweep.ts` pins several of these strings, and `methodologyCopy.ts` is shared between screen and print — so one edit serves both surfaces, but the sweep's screen-vs-print invariant and the component tests will need updating alongside. **That is the sweep working, not a complication.** If a string changes on one surface and not the other, the sweep is exactly the thing that should fail.

**No golden fixture value may move.** This phase changes no figure. If `npm run fixtures:gen` produces any diff, stop — something has been changed that should not have been.

## Architecture

| File | Responsibility |
|---|---|
| `src/components/AboutPanel.tsx` | **Create.** The drawer, mirroring `ResourcesPanel`. |
| `src/components/AboutPanel.test.tsx` | **Create.** |
| `src/lib/about.ts` | **Create.** The About content as data — the method cards and the engine statement — so the panel is markup and the words live in one reviewable place, following `resources.ts`'s precedent. |
| `src/components/Analyzer.tsx` | **Modify.** Remove the "How This Works" block, add the About toggle, strip the inline mentions. |
| `src/components/AssumptionsPanel.tsx` | **Modify.** Remove the CPI history block; strip three mentions. |
| `src/components/HouseholdPanel.tsx`, `PersonPanel.tsx` | **Modify.** Strip the recommendation-heading mentions. |
| `src/components/methodologyCopy.ts` | **Modify.** Four shared strings. |
| `src/components/pdf/PersonSection.tsx`, `pdf/HouseholdSection.tsx`, `pdf/ReportDocument.tsx` | **Modify.** Three print mentions. |
| `validation/sweep/copy.sweep.ts` | **Modify.** Re-pin whatever moved. |

## Testing

**Component.** The About drawer opens and closes from the header, renders all five sections, and traps Escape the way `ResourcesPanel` does.

**A regression guard worth having: assert `ssa.tools` appears nowhere in the rendered ANALYSIS surface**, screen or print. That is a single test that holds the whole cleanup in place, and it will catch the next person reintroducing a parenthetical — more valuable than asserting each of the twenty individually.

Two exemptions, both deliberate and both outside the working surface:

- **The About panel's engine attribution** — naming the engine there is the entire point of this change, so the guard must scope to the analysis flow rather than the whole app.
- **`resources.ts`'s two links.**

> The first exemption was missing from this spec's first draft, whose success criterion said "nowhere except `resources.ts`'s two links" — which would have made the About panel fail its own test. Corrected before planning.

**Copy.** Every replacement string is pinned verbatim, as `DeceasedFields`' strings now are. This project's recurring defect is copy, and a rename touching twenty sites is precisely where a half-applied change hides — the adviser-tone rename is still half-applied from an earlier phase for exactly this reason.

**Sweep.** `npm run sweep` passes, including screen-vs-print agreement on the shared `methodologyCopy` strings.

## Success criteria

1. `ssa.tools` appears nowhere in the rendered analysis surface — screen or PDF — enforced by a test. The About panel's engine attribution and `resources.ts`'s two links are the only places it survives.
2. The About drawer opens from the header and carries the orienting paragraph, the five method cards, the engine attribution, the CPI history and the version.
3. `AssumptionsPanel` no longer renders the CPI history; `Analyzer` no longer renders "How This Works".
4. No replacement loses information — every mention that stood in for a fact is replaced by that fact.
5. No golden fixture value moves.
6. `npm run lint`, `npx tsc -b`, the unit and component suites, `npm run build`, the e2e suite and `npm run sweep` all pass.

## Out of scope

**The half-applied adviser-tone rename** — "Your Information", "Your analysis awaits", `PersonPanel`'s "Your FRA" still sit beside "Client". Same category of work, genuinely separate change, and folding it in would make one diff two renames deep.

**The three parked invariant-sweep findings** — the PDF's duplicate spousal paragraph, the screen's duplicate survivor-gap note, and the dead `earliest` comparison row. Still queued.

**Anything about widowed rendering** — that is 3B-ii-b.
