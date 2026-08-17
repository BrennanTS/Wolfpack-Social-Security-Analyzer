# Survivor Claim Alternative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the adviser what the household would receive if the survivor claimed the survivor benefit on a different date from their own retirement benefit — a plan the vendored optimizer structurally cannot consider.

**Architecture:** A new pure module runs a one-dimensional search over the survivor's claim month, holding the engine's recommended filing ages fixed. Amounts come from the engine's `survivorBenefit()` and from the bands already on `HouseholdAnalysis`; the app supplies only dates and a `max(own, survivor)` composition. The result renders below the income-cliff callout on both surfaces.

**Tech Stack:** TypeScript, React 19, @react-pdf/renderer, Vitest + Testing Library, Playwright, vendored ssa.tools engine.

**Spec:** `docs/superpowers/specs/2026-08-16-survivor-claim-alternative-design.md`
**Evidence:** `docs/reference/survivor-start-impact.md`

## Global Constraints

- **Never modify `src/vendor/ssa-tools/`.** Vendored MIT upstream, read-only.
- No new dependencies.
- **This phase is purely additive.** No displayed figure changes; no existing assertion moves; no existing fixture value moves. **If one does, STOP and report** — it means the phase changed something it should not have.
- **The recommendation does not change.** This phase does not re-optimize. Every existing scenario's `recommendedFilingAgeByPerson` stays as pinned.
- **No benefit rule may be computed by hand.** Every amount comes from `survivorBenefit()`, `benefitOnDate()`, or the bands already on `HouseholdAnalysis`. The app supplies dates and a `max()`.
- `npm run fixtures:gen` idempotent for existing scenarios — new ones are added through `gen-fixtures.mjs`'s `specs` array, not by editing `scenarios.json` directly (the generator overwrites `description` from `spec.description`, so a direct edit is silently reverted).
- `npm run lint` (oxlint) zero warnings.
- **Every task ends green:** `npm run lint`, `npm run test` and `npm run build` pass before each commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch: `feat/survivor-claim-alternative`.
- **Local e2e uses `PW_PORT=4199`** — port 4173 is occupied. The pre-commit hook runs e2e on the default port and will fail; run e2e yourself, then `SKIP_E2E=1 git commit ...`. Never `--no-verify`.

## Copy is the standing defect — thirteen instances, zero arithmetic defects

Every serious defect on this project across five branches has been **user-facing text wrong beside a right number**. The shapes that have actually occurred:

- A sentence true when written, made false by a later change to the thing beneath it.
- A shared sentence reused in a second component, printing the same warning twice on one page. Single-sourcing prevents drift, not duplication.
- An unbranched clause true for every tested household and false for one the engine can produce.
- A claim that overstated what its own guard established.

So: the sentence goes in `methodologyCopy.ts` and both surfaces call it, it must be true for every household shape below, and **it must not restate anything `survivorGapNote` or `incomeCliffSentence` already says on the same page.**

## Engine facts this plan relies on

Verified. Re-check any your implementation depends on.

- `survivorBenefit(survivor, deceased, deceasedFilingDate, deceasedDeathDate, survivorFilingDate): Money` — `benefit-calculator.ts:444`. **Throws if `survivorFilingDate <= deceasedDeathDate`** (`:455`). Every candidate month in this plan is at least `death + 1`, so the throw is unreachable — but do not widen the range without re-checking that.
- The reduction is linear from 71.5% at SSA age 60 to 100% at survivor-FRA (`benefit-calculator.ts:510-536`), keyed to the date you pass. **The start date is the amount.**
- `recipient.survivorNormalRetirementDate(): MonthDate` — `recipient.ts:460`. A *different* table from retirement FRA (`constants.ts:620-708`).
- `recipient.birthdate.dateAtSsaAge(age: MonthDuration): MonthDate`.
- `monthDateAt(index: number): MonthDate` and `monthIndexOf` — already exported from `src/lib/household.ts:425` and `src/lib/benefitPeriods.ts`.
- `firstDeath(personIds, finalIndexByPersonId): FirstDeath | null` — `src/lib/incomeCliff.ts:65`. Returns `{ deathYear, deathMonthIndex, survivorIndex }`; **null on an exact tie**, which this plan must propagate.
- `BenefitBand` is `{ personId, type, startIndex, endIndex, monthlyAmount }` with **inclusive** absolute month indices.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/survivorClaim.ts` | **Create.** The one-dimensional search. Pure, React-free, no engine orchestration beyond `survivorBenefit`. |
| `src/lib/survivorClaim.test.ts` | **Create.** |
| `src/lib/household.ts` | **Modify.** Carry the result on `HouseholdAnalysis`. |
| `src/components/methodologyCopy.ts` | **Modify.** One sentence, consumed by both surfaces. |
| `src/components/SurvivorClaimNote.tsx` | **Create.** Screen. |
| `src/components/HouseholdPanel.tsx` | **Modify.** Render it below the cliff callout. |
| `src/components/pdf/HouseholdSection.tsx` | **Modify.** Same section in print. |
| `validation/scripts/gen-fixtures.mjs` | **Modify.** New scenarios only. |

---

### Task 1: The search

**Files:**
- Create: `src/lib/survivorClaim.ts`, `src/lib/survivorClaim.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:

```ts
export interface SurvivorClaimAlternative {
  /** Inclusive absolute month index of the best survivor claim month. */
  claimIndex: number;
  /** The survivor's age at that month, e.g. "60 years, 0 months" — via `formatFilingAge`. */
  claimAge: string;
  /** The survivor's display label. */
  survivorLabel: string;
  /** Lifetime total paid to the survivor after the first death, as the app shows it today. */
  baselineTotal: number;
  /** The same, under the best claim month. */
  bestTotal: number;
  /** `bestTotal - baselineTotal`. Strictly positive whenever this object is non-null. */
  gain: number;
}

export function survivorClaimAlternative(
  people: Person[],
  recipients: Recipient[],
  filingAges: MonthDuration[],
  bands: BenefitBand[],
  finalIndexByPersonId: Record<string, number>,
  survivorGap: SurvivorGap | null,
  labels: string[],
): SurvivorClaimAlternative | null;
```

Returns `null` — meaning "render nothing" — for a single claimant, a set `survivorGap`, a null `firstDeath` (exact tie), and a gain that is not strictly positive.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/survivorClaim.test.ts
import { describe, expect, it } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import { createPiaRecipient } from './ssaTools';
import { householdPeriods } from './benefitPeriods';
import { survivorClaimAlternative } from './survivorClaim';
import type { Person } from './personAnalysis';

const age = (years: number, months = 0) =>
  MonthDuration.initFromYearsMonths({ years, months });

const person = (
  id: 'a' | 'b',
  birthYear: number,
  birthMonth: number,
  pia: number,
  gender: 'male' | 'female',
  lifeExpectancy: number,
): Person => ({ id, birthYear, birthMonth, gender, piaMonthly: pia, lifeExpectancy });

const recipientFor = (p: Person) =>
  createPiaRecipient(p.birthYear, p.birthMonth, p.piaMonthly, p.gender);

/**
 * An older higher earner with a much younger spouse — the shape the engine's
 * survivor-start rule mishandles, and the one the impact measurement found
 * the false $0 in. Dan dies at 78 (Feb 2036); Sarah is 68 then but does not
 * file until 70 under a delay strategy, so the engine pays her nothing for
 * those years.
 */
const dan = person('a', 1958, 2, 2400, 'male', 78);
const sarah = person('b', 1968, 5, 1200, 'female', 90);

function run(filingAges: [MonthDuration, MonthDuration]) {
  const people = [dan, sarah];
  const recipients = people.map(recipientFor);
  const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
    people,
    recipients,
    filingAges,
    ['Dan', 'Sarah'],
  );
  return survivorClaimAlternative(
    people,
    recipients,
    filingAges,
    bands,
    finalIndexByPersonId,
    survivorGap,
    ['Dan', 'Sarah'],
  );
}

describe('survivorClaimAlternative', () => {
  it('finds a gain when the survivor files long after the first death', () => {
    const result = run([age(70), age(70)]);
    expect(result).not.toBeNull();
    expect(result!.gain).toBeGreaterThan(0);
    expect(result!.bestTotal).toBe(result!.baselineTotal + result!.gain);
    expect(result!.survivorLabel).toBe('Sarah');
  });

  it('never claims before the death or before SSA age 60', () => {
    const result = run([age(70), age(70)])!;
    // Dan dies Feb 2036; Sarah reaches SSA age 60 in May 2028. The death is
    // later, so the floor here is the death month + 1.
    const deathIndex = 2036 * 12 + 1; // Feb 2036
    expect(result.claimIndex).toBeGreaterThan(deathIndex);
  });

  it('returns null for a single claimant', () => {
    const recipients = [recipientFor(dan)];
    const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
      [dan],
      recipients,
      [age(67)],
      ['Dan'],
    );
    expect(
      survivorClaimAlternative(
        [dan],
        recipients,
        [age(67)],
        bands,
        finalIndexByPersonId,
        survivorGap,
        ['Dan'],
      ),
    ).toBeNull();
  });

  it('returns null when the survivor already claims early enough to gain nothing', () => {
    // Sarah files at 62y1m, well before Dan's death, so the engine already
    // starts her survivor benefit at the death and there is nothing to move.
    expect(run([age(70), age(62, 1)])).toBeNull();
  });
});
```

**Verify the two dates in the second test by hand before accepting them.** Dan born Feb 1958 with a plan-to age of 78 reaches 78 in Feb 2036; Sarah born May 1968 reaches SSA age 60 in May 2028. If the engine's `dateAtSsaAge` disagrees, correct the *test* to match the engine's own arithmetic and say so in your report.

**If the fourth test does not return null** — that is, a gain exists even when the survivor files at 62y1m — do not weaken it. Report what the gain is and why, because it means the search is finding something the design did not anticipate.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- survivorClaim`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Structure it as five small steps:

1. **Bail out.** `people.length !== 2` → null. `survivorGap !== null` → null. `firstDeath(...)` null → null.
2. **Identify the parties.** `firstDeath` gives `survivorIndex` and `deathMonthIndex`. The deceased is the other index. Take each one's `Recipient`, their filing date via `birthdate.dateAtSsaAge(filingAges[i])`, and the survivor's final month from `finalIndexByPersonId`.
3. **Build the per-month "own" series from the bands, not from the engine.** For each month `m` from `deathMonthIndex + 1` to the survivor's final index, the survivor's own amount is the sum of their **personal** bands covering `m`. Their baseline amount is the sum of **all** their bands covering `m` — personal plus any survivor top-up the engine emitted. Reading it off the bands is what makes `baselineTotal` exactly what the app displays, rather than a re-derivation of the engine's rule.
4. **Search.** The range is inclusive from
   `lo = Math.max(deathMonthIndex + 1, monthIndexOf(survivorRecipient.birthdate.dateAtSsaAge(MonthDuration.initFromYearsMonths({ years: 60, months: 0 }))))`
   to
   `hi = Math.max(deathMonthIndex + 1, monthIndexOf(survivorRecipient.survivorNormalRetirementDate()))`.
   For each candidate `c`, the survivor benefit is `survivorBenefit(survivorRecipient, deceasedRecipient, deceasedFilingDate, monthDateAt(deathMonthIndex), monthDateAt(c)).value()` — one call per candidate, constant across months. The total is `Σ over m of max(ownAt(m), c <= m ? survivorAmount : 0)`.
5. **Return.** Best candidate by total; `gain = bestTotal - baselineTotal`; **null if `gain <= 0`**. Format `claimAge` with the existing `formatFilingAge(survivorRecipient.birthdate.ageAtSsaDate(monthDateAt(claimIndex)))` and take `.label`.

`hi` uses survivor-FRA rather than the survivor's own filing date deliberately — survivor-FRA is where the reduction reaches 100%, and stopping at the own-filing date would exclude it whenever the survivor files earlier, which is exactly where waiting is worth most.

Round the two totals with `roundCents` from `src/lib/benefitMath.ts`.

- [ ] **Step 4: Run the tests**

Run: `npm run test -- survivorClaim`
Expected: PASS.

- [ ] **Step 5: Run everything and commit**

Run: `npm run lint && npm run test && npm run build`

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/scenarios.json
```
Expected: empty. This task has no callers, so nothing can have moved.

```bash
git add src/lib/survivorClaim.ts src/lib/survivorClaim.test.ts
SKIP_E2E=1 git commit -m "feat: search for the survivor's best claim month

Holds the recommended filing ages fixed and varies only when the survivor
claims, between SSA age 60 and their survivor-FRA. Amounts come from the
engine; the app supplies dates and a max().

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Carry it, and render it on both surfaces

**Files:**
- Modify: `src/lib/household.ts`, `src/lib/household.test.ts`
- Modify: `src/components/methodologyCopy.ts`, `src/components/methodologyCopy.test.ts`
- Create: `src/components/SurvivorClaimNote.tsx`, `src/components/SurvivorClaimNote.test.tsx`
- Modify: `src/components/HouseholdPanel.tsx`, `src/components/HouseholdPanel.test.tsx`
- Modify: `src/components/pdf/HouseholdSection.tsx`, `src/components/pdf/HouseholdSection.test.tsx`

**Interfaces:**
- Consumes: Task 1's `survivorClaimAlternative` and `SurvivorClaimAlternative`
- Produces:

```ts
// on HouseholdAnalysis
survivorClaim: SurvivorClaimAlternative | null;

// methodologyCopy.ts
export function survivorClaimNote(alt: SurvivorClaimAlternative | null): string | null;
```

`survivorClaimNote` returns `null` when `alt` is null, so **both surfaces get their render decision from one place** rather than each testing the condition. A prior task on this branch's predecessor rendered the same warning twice by reusing a shared function in a second component; returning null centralizes the decision as well as the wording.

- [ ] **Step 1: Write the failing copy test**

```ts
// append to src/components/methodologyCopy.test.ts
it('states the claim month and the gain, and says the optimizer cannot consider it', () => {
  const note = survivorClaimNote({
    claimIndex: 2036 * 12 + 4,
    claimAge: '68 years, 0 months',
    survivorLabel: 'Sarah',
    baselineTotal: 300_000,
    bestTotal: 435_700,
    gain: 135_700,
  })!;
  expect(note).toMatch(/Sarah/);
  expect(note).toMatch(/68 years, 0 months/);
  expect(note).toMatch(/\$135,700/);
  expect(note).toMatch(/optimizer/i);
});

it('renders nothing when there is no alternative to show', () => {
  expect(survivorClaimNote(null)).toBeNull();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- methodologyCopy`
Expected: FAIL — `survivorClaimNote` is not exported.

- [ ] **Step 3: Write the sentence**

It must say: who the survivor is, the age at which they would claim the survivor benefit, what the household gains over its lifetime, and that the recommendation above comes from an optimizer that cannot model a separate survivor claim date.

It must **not**: restate the death year (`incomeCliffSentence` directly above already gives it), restate anything in `survivorGapNote` (which cannot be showing, since `survivorGap` forces this to null), or describe it as a recommendation. It is an alternative the model cannot see, not advice.

Check every sentence you write against a household where the gain is small, one where the survivor claims at exactly their survivor-FRA, and one where they claim at exactly 60.

- [ ] **Step 4: Wire `household.ts`**

Call `survivorClaimAlternative` in the married branch, after `householdPeriods` and `firstDeath` are both available, passing the same canonicalized `enginePeople`/`recipient0,1`/`engineLabels` the rest of that branch uses — **not** the display-order arrays. Getting this wrong reintroduces the entry-order dependence Phase 2b-ii closed. Set `survivorClaim: null` in the single branch.

- [ ] **Step 5: Render on both surfaces**

`SurvivorClaimNote` renders `survivorClaimNote(analysis.survivorClaim)` and returns `null` when that is null. `HouseholdPanel` places it directly below `<IncomeCliffCallout />` (`HouseholdPanel.tsx:181`). `pdf/HouseholdSection.tsx` renders the same string from the same function in the same position relative to its cliff section.

- [ ] **Step 6: Add the render tests**

```tsx
// src/components/SurvivorClaimNote.test.tsx
it('renders the note when there is an alternative', () => {
  render(
    <SurvivorClaimNote
      analysis={{ survivorClaim: {
        claimIndex: 2036 * 12 + 4,
        claimAge: '68 years, 0 months',
        survivorLabel: 'Sarah',
        baselineTotal: 300_000,
        bestTotal: 435_700,
        gain: 135_700,
      } } as unknown as HouseholdAnalysis}
    />,
  );
  expect(screen.getByTestId('survivor-claim-note')).toHaveTextContent(/135,700/);
});

it('renders nothing when there is none', () => {
  const { container } = render(
    <SurvivorClaimNote analysis={{ survivorClaim: null } as unknown as HouseholdAnalysis} />,
  );
  expect(container).toBeEmptyDOMElement();
});
```

Add the matching PDF-surface test in `pdf/HouseholdSection.test.tsx`, asserting the string appears **exactly once** on the page. Count occurrences rather than using `toContain` — a prior defect on this project printed an identical note twice on one page and `toContain` could not see it.

- [ ] **Step 7: Run everything and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/scenarios.json
```
Expected: empty. **A moved fixture here means the phase changed a displayed figure — STOP and report.**

```bash
git add src/lib/ src/components/
SKIP_E2E=1 git commit -m "feat: show the survivor claim date the optimizer cannot consider

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Golden scenarios that can see the defect

**Files:**
- Modify: `validation/scripts/gen-fixtures.mjs`
- Modify: `validation/fixtures/scenarios.ts`
- Modify: `validation/engine/golden.test.ts`

**Interfaces:**
- Consumes: Task 2's `HouseholdAnalysis.survivorClaim`
- Produces: a new `ScenarioExpected` field

```ts
/**
 * The survivor's age at the best survivor-claim month, and the lifetime gain
 * over what the app displays — null where no alternative applies. Engine-
 * recorded like `recommendedFilingAgeByPerson`, not hand-derived: it depends
 * on the optimizer's chosen filing ages.
 */
survivorClaim: { claimAge: string; gain: number } | null;
```

**Every existing scenario is blind to this.** All 30 give both people plan-to age 85, and the survivor-start behaviour is bit-exact across all 61,823 of their filing-age combinations. So this task adds scenarios; it changes none.

- [ ] **Step 1: Add the scenarios**

Append to the `specs` array in `validation/scripts/gen-fixtures.mjs`. The shape that makes the defect reachable is an older higher earner with a much younger spouse and **different plan-to ages** — `spec.life` and `spec.spouseLife` are both already supported (`gen-fixtures.mjs:238`).

Add these two. The first reuses the parameters Task 1's tests already prove produce a gain, so it cannot land on a shape that turns out to be blind:

```js
{ id: 'married-1958-widow-claims-late', mode: 'full', birthYear: 1958, birthMonth: 2,
  gender: 'male', hasSpouse: true, pia: 2400, life: 78,
  spouseBirthYear: 1968, spouseBirthMonth: 5, spousePia: 1200, spouseLife: 90,
  description: '<see below>' },
```

For the second — the null case — pick a couple whose survivor is already past their survivor-FRA at the first death, so no claim month improves on the baseline. **Verify it actually yields `null` before recording it**; if the shape you pick produces a gain, that is a more interesting fixture than the one you meant to add, so keep it and find a different null case.

Give each a `description` in the file's established style: state why the shape matters, what makes it different from the existing 30 (different plan-to ages per person, which none of them have), and the arithmetic behind the recorded values.

- [ ] **Step 2: Record the expectations**

`survivorClaim` depends on the optimizer's chosen filing ages, so it is **engine-recorded, not hand-derived** — the same class as `recommendedFilingAgeByPerson`. Follow that field's existing preserve-or-throw pattern in `gen-fixtures.mjs` so a future run cannot silently fabricate one, and say so in the `conventions` string.

**Say plainly in your report that these are engine-recorded**, so nobody later mistakes them for the hand-derived class that the spousal figures belong to.

- [ ] **Step 3: Assert it in the golden suite**

Add an assertion in `validation/engine/golden.test.ts` alongside the existing per-scenario checks, comparing `result.survivorClaim` against the fixture's. Follow the file's existing `describe.each(fullScenarios)` structure rather than adding a second pattern.

**Confirm at least one new scenario produces a non-null `survivorClaim`** — otherwise the assertion passes vacuously across every scenario and the suite is still blind. Report which one does.

- [ ] **Step 4: Verify the existing fixtures did not move**

```bash
npm run fixtures:gen && git diff validation/fixtures/scenarios.json
```

Expected: **additions only** — the new scenarios and the new `survivorClaim` field on existing ones (which must be `null` for every pre-existing scenario, since they are blind to this). **Any changed value on a pre-existing scenario means something moved that should not have — STOP and report.**

- [ ] **Step 5: Run everything and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

```bash
git add validation/
SKIP_E2E=1 git commit -m "test: add golden scenarios that can see the survivor-claim gap

Every pre-existing scenario uses plan-to age 85 for both people, which makes
the survivor-start behaviour bit-exact and the suite blind to it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification against the spec's success criteria

1. **A household with a late-filing survivor shows a claim month, a gain, and the optimizer statement** — Task 2 Steps 3 and 5; Task 1 Step 1, first test.
2. **Recommended filing ages unchanged** — Task 2 Step 7 and Task 3 Step 4, both asserting no existing fixture moved.
3. **No existing fixture value moves** — Task 1 Step 5, Task 2 Step 7, Task 3 Step 4.
4. **Nothing renders in the four silent cases** — Task 1's null returns (single claimant, `survivorGap`, tie, zero gain) plus Task 2 Step 6's empty-DOM test.
5. **Every amount from the engine** — Task 1 Step 3, items 3 and 4.
6. **New scenarios make the defect visible** — Task 3, with Step 3's non-vacuity check.
7. **Lint, tests, build, e2e** — every task.
