# Per-person life expectancy

- **Date:** 2026-08-15
- **Branch:** `feat/per-person-life-expectancy`
- **Status:** Approved for planning
- **Phase:** 2a. Phase 2b rebases the display onto the engine's benefit
  periods and depends on this being in place.

## The actual current state

The data model is already per-person. `Person.lifeExpectancy` is a field on
each person, and `toHousehold` (`src/lib/formState.ts:78-91`) gives the two
people different values:

- **Person A** takes the value from the form's single slider.
- **Person B** takes `getSuggestedLifeExpectancy(spouseAge, spouseGender)`,
  computed on the spot from their own age and gender.

So the calculation already distinguishes the two. What is missing is a
**control**. Person B's life expectancy cannot be adjusted, is never shown
next to the slider that implies it governs the household, and is printed in
the client's PDF (`src/components/pdf/PersonSection.tsx:91`).

`src/lib/lifeExpectancy.ts:38-40` already records this as a known problem, in
the docstring of the very function that supplies the unadjustable value.

## Why it matters now

Phase 2b makes who outlives whom the central question the app answers. An
adviser who cannot move one spouse's mortality cannot explore the survivor
scenario at all — and the survivor scenario is the reason a delay strategy
usually wins.

The second half is worse than the first. A number the adviser never saw, and
could not have changed, appears in a document they hand to a client over
their own signature. Whatever the right value is, it should be one they chose.

## Design

### Life expectancy moves onto the person

`AnalyzerFormState.lifeExpectancy` is deleted. `PersonFormFields` gains
`lifeExpectancy: number | null`, alongside the other per-person attributes it
already holds — birth year, birth month, gender, benefit. Life expectancy
belongs in exactly the same category and is the only one currently hoisted
above the person.

### Defaults are unchanged, deliberately

Each person's default remains `getSuggestedLifeExpectancy` applied to their
own current age and gender — which is what both people already receive today.

**No existing analysis may change its result.** This is the property that
makes the change safe to review: every golden fixture, every recommended
filing age and every dollar figure must be byte-identical afterwards. A moved
fixture in this phase is a defect, not an expected consequence. Phase 2b
relies on the same invariant, so establishing it here is what lets 2b assert
that the periods rebase changed only the display.

### Two sliders

`AssumptionsPanel` renders one life-expectancy control per person, each
labelled with that person's name (falling back to "You" / "Spouse" via the
existing `personLabel`). Person B's control appears only for a married
household.

Each keeps the existing bounds — `LIFE_EXPECTANCY_BOUNDS`, 75 to 100 — and
each keeps the existing "SSA suggests age N for male/female" hint beside it,
now reading from that person's own gender rather than person A's.

### Completeness

`isFormComplete` currently gates on `form.lifeExpectancy !== null`. That
becomes: person A's is required; person B's is **never** required, married or
not — `isPersonComplete` does not check `lifeExpectancy` at all, and
`toPerson` falls back to person B's own SSA suggestion whenever their field is
null. This is not the same shape as the other person-B fields (identity and
benefit, which *are* gated on marital status), because person B's life
expectancy always has a usable value even when unset, and requiring it would
force an adviser to interact with a control whose entire point is that they
don't have to.

### Share links

The `le` parameter becomes `ale` and `ble`, following the existing `a`/`b`
prefix convention (`ay`, `am`, `ag`, `ab`). `ble` is omitted when `m=0`, as
person B's other parameters already are.

**A legacy `le` parameter must keep working, applied to person A only.**
That is exactly what it means today, so an old link reproduces the same
analysis rather than silently dropping a value the recipient cannot see is
missing. When both `le` and `ale` are present, `ale` wins — the newer,
more specific parameter. This compatibility branch is not permanent scope
creep: links are already in circulation, and a link that quietly loses a
parameter is the failure mode the share-link spec exists to prevent.

Validation is unchanged in kind: each parameter is bounds-checked
independently and **dropped, not clamped**, when invalid.

## Architecture

No new modules. The change is a field moving down one level and the
consequences rippling outward:

| File | Change |
|---|---|
| `src/lib/formState.ts` | Field moves to `PersonFormFields`; `toHousehold` reads each person's own; `suggestedLifeExpectancy` becomes per-person |
| `src/components/AssumptionsPanel.tsx` | Two controls instead of one |
| `src/lib/shareLink.ts` | `ale`/`ble`, plus the legacy `le` branch |
| `src/components/pdf/PersonSection.tsx` | No change — it already prints `person.lifeExpectancy` |

`household.ts`, `personAnalysis.ts` and the engine adapter are untouched.
They already consume `Person.lifeExpectancy` per person.

## Testing

**Unit — `formState`:** `toHousehold` gives each person their own value; a
married household with different ages and genders produces two different
figures; the completeness gate requires B's only when married.

**Unit — defaults:** the seeded default for a person reproduces that same
person's own `suggestedLifeExpectancyFor` result — assert the value each
person actually receives against that shared, wall-clock-aware helper, not an
absolute literal (which would rot as `getCurrentAge` ages the fixture forward)
and not a "was the function called" mock check (which proves nothing about
whether the result reached the person). Comparing two people of the same age
but different genders against each other's `suggestedLifeExpectancyFor`
result is what actually distinguishes a per-person suggestion from a shared
one.

**Unit — `shareLink`:** round trip with two distinct values; `ble` absent
when single; a legacy `le` link hydrates person A and leaves person B at its
default; `le` and `ale` together resolve to `ale`; each out-of-range value
dropped independently, leaving the other intact.

**Component:** two sliders for a married household, one for a single
claimant; each slider's SSA hint reflects its own person's gender.

**Golden:** every existing scenario unchanged — same recommended filing ages,
same amounts. This is the phase's central assertion.

**End-to-end:** adjusting person B's slider changes the household analysis on
screen, which is the capability this phase exists to add.

## Success criteria

1. Person B has a life-expectancy control with the same bounds and the same
   SSA suggestion hint as person A.
2. The hint beside each control reflects that person's own gender.
3. Person B's control is absent for a single claimant, and its value is not
   required for the form to be complete.
4. **Every golden fixture is unchanged** — no recommendation and no dollar
   figure moves.
5. A link carries both values and reproduces the analysis on another machine.
6. A legacy `le` link still hydrates person A's value.
7. An out-of-range `ale` or `ble` is dropped, not clamped, and does not
   affect the other person's value.
8. `npm run lint`, the unit and component suite, `npm run build` and the e2e
   suite all pass.

## Out of scope

The benefit-periods rebase, survivor benefits, the income-cliff callout, the
chart's band decomposition, the real/nominal toggle, and the survivor-income
column in the strategy comparison. All are Phase 2b.

Mortality *distributions* are also out of scope. The optimizer already uses
SSA's full death-probability distribution internally
(`getDeathProbabilityDistribution`); `lifeExpectancy` is the planning horizon
for display and lifetime totals, and this phase does not change that
relationship.
