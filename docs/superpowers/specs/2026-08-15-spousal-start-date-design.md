# Spousal benefit start date and reduction basis

- **Date:** 2026-08-15
- **Branch:** `fix/spousal-start-date`
- **Status:** Approved for planning
- **Lifespan:** Interim. Phase 2's rebase onto the engine's benefit periods deletes
  `spousalTopUp` entirely; this fix stops the app displaying a wrong figure in
  the meantime.

## The defect

`spousalTopUp(worker, spouse, spouseFilingAge)` in `src/lib/ssaTools.ts` takes
no argument for when the **worker** files. It structurally cannot know, and it
gets two things wrong as a result.

**A spousal benefit cannot begin before the worker has filed.** SSA pays a
spousal benefit on the worker's record only once the worker has claimed. Our
figure is presented as though it begins when the *spouse* files.

**The reduction is measured from the wrong date.** SSA reduces a spousal benefit
by how early *the spousal benefit itself* begins relative to the spouse's own
full retirement age — not by when the spouse filed on their own record. Our code
reduces by the spouse's filing age.

These errors push in **opposite** directions, so the net is household-specific
rather than a uniform overstatement:

> Worker delays to 70, spouse claims at 62 — the strategy the optimizer most
> often recommends. We show the top-up beginning at 62 (eight years too early)
> and apply a 58-month early-claim reduction to it. In reality it begins at the
> worker's filing, by which time the spouse is past their own FRA, so it is
> **unreduced**.

The bug therefore fires inside the recommended strategy, which is where a wrong
number does the most damage.

## The fix

`spousalTopUp` gains the worker's filing age. The spousal benefit's start is
`max(spouseFilingDate, workerFilingDate)`, and the reduction is computed from
that date against the spouse's own FRA — unreduced when it lands at or after it.

The displayed figure gains its start date. Not "$1,200/mo" but "$1,200/mo from
2035, when Jane files at 70." A spousal amount without its start is exactly the
ambiguity that produced this defect.

Both quantities on `HouseholdAnalysis.spousalTopUp` keep their meaning:

- `atFra` — the unreduced entitlement, `max(0, higherPIA/2 − lowerPIA)`.
  Unaffected by this change; it is a reference figure, not a payment.
- `atRecommendedFilingAge` — what is actually paid under the recommended
  strategy. This is the value that changes.

## One sub-claim to verify, not assume

The engine audit (`docs/reference/ssa-tools-engine-audit.md`) also reports that
`spousalTopUp` "omits the 50%-of-PIA combined cap". Reading the code,
`baseSpousalBenefit` appears to express that cap already, as
`max(0, workerPIA/2 − spousePIA)`.

**Verify this against the engine and the audit's citation before acting on it.**
If the audit is right there is a second correction to make in the same function;
if it is not, say so and leave the arithmetic alone. Do not implement a "fix"
for a rule that is already correctly applied — that is how a working calculation
acquires a bug.

## Fixtures

Golden fixture values will move for any scenario where the worker files later
than the spouse. Every changed value must be **hand-derived from SSA's published
rules and confirmed against the engine** — never read off the engine and
recorded. That discipline has already caught a units error and a wrong
expectation in this project.

`validation/scripts/gen-fixtures.mjs` preserves `spousalTopUpAtFilingAge` by
scenario id and throws rather than fabricating one. It must remain idempotent:
`npm run fixtures:gen` produces an empty diff.

## Success criteria

1. A household where the worker files after the spouse reports a spousal top-up
   that begins at the worker's filing date, not the spouse's.
2. A spousal benefit whose start falls at or after the spouse's own FRA is
   **unreduced**, even when the spouse filed on their own record years earlier.
3. A spousal benefit whose start falls before the spouse's FRA is reduced by the
   months between that start and their FRA — not by the months between their own
   filing and their FRA.
4. The displayed figure states when the benefit begins, on screen and in the PDF.
5. The 50%-cap sub-claim is explicitly resolved: either corrected with evidence,
   or documented as already correct.
6. Every changed fixture value is hand-derived, with the arithmetic recorded in
   its `description`.
7. `npm run fixtures:gen` remains idempotent.
8. `npm run lint`, the unit and component suite, `npm run build` and the e2e
   suite all pass.

## Out of scope

The full rebase onto `strategySumPeriodsCouple`, the survivor benefit, the
income-cliff view, and the real/nominal toggle. All are Phase 2, which replaces
this function rather than extending it.
