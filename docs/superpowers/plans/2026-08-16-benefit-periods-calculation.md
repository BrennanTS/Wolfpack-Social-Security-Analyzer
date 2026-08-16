# Benefit-Periods Calculation Rebase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the household analysis from the engine's typed benefit periods instead of a hand-rebuilt model, and delete the hand-rebuilt model.

**Architecture:** A new pure module `src/lib/benefitPeriods.ts` calls `strategySumPeriodsCouple` / `strategySumPeriodsSingle`, normalizes the result into app-domain bands, performs the dual-entitlement split, and detects the survivor direction the engine cannot model. `household.ts` then drives its timeline and spousal figures from those bands. `spousalTopUp` and `spousalEntitlement` are deleted.

**Tech Stack:** TypeScript, Vitest + Testing Library, Playwright, vendored ssa.tools engine.

**Spec:** `docs/superpowers/specs/2026-08-16-benefit-periods-rebase-design.md` — this plan is **2b-i**, the calculation half. The display half (chart bands, cliff callout, survivor column, dollars toggle) is 2b-ii and is **out of scope here.**

## Global Constraints

- **Never modify `src/vendor/ssa-tools/`.** Vendored MIT upstream. If an engine API differs from what this plan assumes, read the vendored source and adapt *your* code.
- No new dependencies.
- **No recommended filing age may change for any golden scenario.** The optimizer is untouched by this plan.
- **The hand-derived spousal fixtures must be reproduced from the periods at their existing values.** See "The cross-check" below. If they disagree, **STOP and report**.
- `npm run fixtures:gen` must remain idempotent — empty `git diff` on `scenarios.json`.
- `npm run lint` (oxlint) zero warnings.
- **Every task ends green:** `npm run lint`, `npm run test` and `npm run build` all pass before each commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch: `feat/benefit-periods`.
- **Local e2e uses `PW_PORT=4199`** — port 4173 is occupied by unrelated software. The pre-commit hook runs e2e on the default port and will fail; run e2e yourself, then use `SKIP_E2E=1 git commit ...`. Never use `--no-verify`.

## The cross-check

This is the plan's most valuable test, and the reason 2b-i is a separate plan.

`validation/fixtures/scenarios.json` carries `spousalTopUpAtFilingAge` and `startsAtSpouseAge`. Those values were **hand-derived from SSA's published rules in a previous phase and then confirmed against the engine** — they are not engine output recorded blindly. `gen-fixtures.mjs` preserves them by scenario id and throws rather than fabricating one.

After this rebase they must be produced from the periods' Spousal band instead of from `spousalTopUp`, **and they must come out identical.** Two independent derivations of the same quantity agreeing is far stronger evidence than either alone.

If they disagree, do not adjust the fixture. One of the two is wrong, and which one is the most important thing this plan can discover. Stop and report with both numbers and your derivation.

## Engine facts this plan relies on

Verified against the vendored source. Re-check any that your implementation depends on.

- `strategySumPeriodsCouple(recipients, finalDates, strats)` → `BenefitPeriod[]` — `strategy-calc.ts:24`
- `strategySumPeriodsSingle(recipient, finalDate, strat)` → `BenefitPeriod[]` — `strategy-calc.ts:846`
- Both are exported from `$lib/strategy/calculations` (the index), along with `BenefitType`.
- `BenefitPeriod`: `startDate`, `endDate` (**both inclusive**), `amount: Money`, `recipientIndex: number`, `benefitType: BenefitType` — `benefit-period.ts:17`
- **The earner never receives Spousal or Survivor.** `strategy-calc.ts:104` states it outright. The engine classifies the higher-PIA person as earner via `classifyEarnerDependent`.
- **A Survivor period replaces the dependent's Personal period**, which is truncated to `survivorStartDate − 1` — `strategy-calc.ts:114-122`.
- **A Spousal period stacks on Personal.** Start is `max(earnerFilingDate, dependentFilingDate)`; end is `min(survivorStartDate − 1, dependentFinalDate)` — `strategy-calc.ts:143-170`.
- A survivor period is emitted **only when the dependent's personal benefit is less than the survivor benefit** — `strategy-calc.ts:98`. So the top-up is always positive when a Survivor band exists.
- **`PersonalBenefitPeriods` may emit one or two periods** per person — the delayed-January-bump amount and the final amount — with **no COLA applied** — `recipient-personal-benefits.ts:40-90`.
- A zero-PIA dependent has their filing date bumped up to the earner's — `strategy-calc.ts:63-69`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/benefitPeriods.ts` | **Create.** Engine adapter: normalize, dual-entitlement split, survivor-gap detection |
| `src/lib/benefitPeriods.test.ts` | **Create.** |
| `src/lib/household.ts` | **Modify.** Drive spousal figures and the timeline from bands |
| `src/lib/ssaTools.ts` | **Modify.** Delete `spousalTopUp`, `spousalEntitlement`, `SpousalPayment` |
| `validation/engine/golden.test.ts` | **Modify.** Pin the decomposition |

Untouched in this plan: every component, the PDF, `methodologyCopy.ts`, `shareLink.ts`.

---

### Task 1: The benefit-periods adapter

**Files:**
- Create: `src/lib/benefitPeriods.ts`
- Create: `src/lib/benefitPeriods.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:

```ts
export type BandType = 'personal' | 'spousal' | 'survivor';

export interface BenefitBand {
  personId: string;
  type: BandType;
  /** Inclusive absolute month index: calendarYear * 12 + (month - 1), month 1-12. */
  startIndex: number;
  /** Inclusive. */
  endIndex: number;
  monthlyAmount: number;
}

/**
 * Set when the engine cannot model the survivor direction this household
 * would actually experience — the higher earner outliving the lower earner
 * while holding the smaller benefit. Null when there is nothing to disclose.
 */
export interface SurvivorGap {
  survivorLabel: string;
  survivorOwnMonthly: number;
  deceasedMonthly: number;
}

export interface HouseholdPeriods {
  bands: BenefitBand[];
  survivorGap: SurvivorGap | null;
}

export function householdPeriods(
  people: Person[],
  recipients: Recipient[],
  filingAges: MonthDuration[],
  labels: string[],
): HouseholdPeriods;

/** Payment months this band contributes to a given calendar year. */
export function monthsInYear(band: BenefitBand, year: number): number;
```

`householdPeriods` accepts one or two people and dispatches to the single or couple engine entry point accordingly.

- [ ] **Step 1: Establish the death dates, and say what you chose**

The engine needs a concrete `finalDate` per person. The app has `person.lifeExpectancy`, a plan-to age.

Use `recipient.birthdate.dateAtSsaAge(MonthDuration.initFromYearsMonths({ years: person.lifeExpectancy, months: 0 }))` — the month they reach that age, inclusive.

This is a deliberate tightening. `buildCombinedTimeline` today credits a full 12 payments in the final calendar year regardless of birth month; month-precision means someone born in June collects six that year. That is a correction, and it is confined to the chart. Record the choice in your report.

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/benefitPeriods.test.ts
import { describe, expect, it } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import { createPiaRecipient } from './ssaTools';
import { householdPeriods, monthsInYear } from './benefitPeriods';
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

describe('householdPeriods — single', () => {
  it('produces personal bands only', () => {
    const p = person('a', 1960, 6, 2500, 'male', 85);
    const { bands, survivorGap } = householdPeriods([p], [recipientFor(p)], [age(67)], ['You']);
    expect(bands.every((b) => b.type === 'personal')).toBe(true);
    expect(bands.every((b) => b.personId === 'a')).toBe(true);
    expect(survivorGap).toBeNull();
  });
});

describe('householdPeriods — dual entitlement', () => {
  // Jane (b) is the HIGHER earner and must die FIRST, because that is the
  // only direction the engine models. Her plan-to age of 80 puts her death
  // in 2040; John's 88 carries him to 2046, so he survives her by six years.
  // Getting this backwards produces no survivor band at all and every
  // assertion below fails for an unrelated reason.
  const john = person('a', 1958, 3, 1400, 'male', 88);
  const jane = person('b', 1960, 9, 3000, 'female', 80);

  const run = () =>
    householdPeriods(
      [john, jane],
      [recipientFor(john), recipientFor(jane)],
      [age(62), age(70)],
      ['John', 'Jane'],
    );

  it('emits a survivor band for the lower earner', () => {
    // Guards every assertion below: without this the others can pass
    // vacuously on an empty band list.
    expect(run().bands.filter((b) => b.type === 'survivor')).toHaveLength(1);
  });

  it("continues the survivor's own personal band past the first death", () => {
    const { bands } = run();
    const survivor = bands.find((b) => b.type === 'survivor')!;
    const personal = bands.filter((b) => b.personId === 'a' && b.type === 'personal');
    // The engine truncates personal at survivorStart - 1; the split must
    // carry it forward to the end of the survivor's own life instead.
    expect(Math.max(...personal.map((b) => b.endIndex))).toBe(survivor.endIndex);
  });

  it('splits the survivor benefit into the personal band plus a top-up', () => {
    const { bands } = run();
    const survivor = bands.find((b) => b.type === 'survivor')!;
    const johnAtDeath = bands
      .filter((b) => b.personId === 'a' && b.type === 'personal')
      .reduce((latest, b) => (b.startIndex > latest.startIndex ? b : latest));
    const janeFinal = bands
      .filter((b) => b.personId === 'b' && b.type === 'personal')
      .reduce((latest, b) => (b.startIndex > latest.startIndex ? b : latest));

    expect(survivor.monthlyAmount).toBeGreaterThan(0);
    // John is 82 when Jane dies — long past his survivor FRA — so he
    // inherits her full benefit, delayed credits included. The split must
    // preserve that total: his own band plus the top-up equals her benefit.
    expect(johnAtDeath.monthlyAmount + survivor.monthlyAmount).toBeCloseTo(
      janeFinal.monthlyAmount,
      0,
    );
  });

  it('never leaves a spousal band overlapping a survivor band', () => {
    const { bands } = run();
    const survivor = bands.find((b) => b.type === 'survivor')!;
    const spousal = bands.filter((b) => b.type === 'spousal');
    // Jane's PIA is 3000 and John's 1400, so half of hers exceeds his and a
    // spousal band genuinely exists — this does not pass by absence.
    expect(spousal.length).toBeGreaterThan(0);
    for (const band of spousal) {
      expect(band.endIndex).toBeLessThan(survivor.startIndex);
    }
  });
});

describe('monthsInYear', () => {
  it('counts only the months the band actually covers', () => {
    // Sep 2030 (2030*12 + 8) through Mar 2032 (2032*12 + 2).
    const band: BenefitBand = {
      personId: 'a',
      type: 'personal',
      startIndex: 2030 * 12 + 8,
      endIndex: 2032 * 12 + 2,
      monthlyAmount: 100,
    };
    expect(monthsInYear(band, 2029)).toBe(0);
    expect(monthsInYear(band, 2030)).toBe(4); // Sep, Oct, Nov, Dec
    expect(monthsInYear(band, 2031)).toBe(12);
    expect(monthsInYear(band, 2032)).toBe(3); // Jan, Feb, Mar
    expect(monthsInYear(band, 2033)).toBe(0);
  });
});
```

Import `BenefitBand` as a type where the last block needs it.

**The dual-entitlement assertions are deliberately relational, not absolute.** Do not replace them with hard-coded dollar figures derived by running the code — that records whatever it currently does rather than what it should do. If you want an absolute figure, hand-derive it from SSA's rules first and say so.

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npm run test -- benefitPeriods`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Implement**

Structure the module in four steps, each small enough to read at once:

1. **Call the engine.** One or two people; build `finalDates` per Step 1; call `strategySumPeriodsSingle` or `strategySumPeriodsCouple`.
2. **Normalize.** Map each `BenefitPeriod` to a `BenefitBand`: `recipientIndex` → `personId` via the `people` array, `benefitType` → lowercase `BandType`, `MonthDate` → absolute month index, `Money` → number.
3. **Split.** For each survivor band, find that person's **latest-starting** personal band (there may be two, because of the January bump — the later one is what they were receiving). Extend its `endIndex` to the survivor band's `endIndex`, and reduce the survivor band's `monthlyAmount` by that personal amount. Drop the survivor band if the result is not strictly positive.
4. **Detect the gap.** Only for a married household where the **dependent dies first** — the engine then emits no survivor band for anyone. Compare the earner's own monthly benefit against the dependent's benefit at their death. If the dependent's is larger, return a `SurvivorGap`; otherwise null.

For the month index, use the engine's `MonthDate` accessors rather than inventing arithmetic — read `src/vendor/ssa-tools/month-time.ts` for the available getters and use whichever gives you the calendar year and the 0-based month index.

`monthsInYear` is pure integer arithmetic over `startIndex`/`endIndex` and the year's own index range; it must not reach into the engine.

- [ ] **Step 5: Run the tests**

Run: `npm run test -- benefitPeriods`
Expected: PASS.

- [ ] **Step 6: Run everything and commit**

Run: `npm run lint && npm run test && npm run build`

```bash
git add src/lib/benefitPeriods.ts src/lib/benefitPeriods.test.ts
SKIP_E2E=1 git commit -m "feat: add the benefit-periods adapter

Normalizes the engine's typed periods into app bands and performs the
dual-entitlement split: SSA pays a survivor their own benefit plus a
top-up, where the engine emits one replacing period at the full amount.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Drive the household from the bands

**Files:**
- Modify: `src/lib/household.ts`
- Modify: `src/lib/household.test.ts`
- Modify: `src/lib/ssaTools.ts`
- Modify: `src/lib/ssaTools.test.ts`

**Interfaces:**
- Consumes: Task 1's `householdPeriods`, `monthsInYear`, `BenefitBand`. Note the signature takes `MonthDuration[]` for the filing ages while `household.ts` holds `FilingAgeDisplay[]` — each of those carries a `.monthDuration`, which is what to pass.
- Produces: `HouseholdAnalysis` keeps its existing shape, plus:

```ts
// on HouseholdAnalysis — new, additive
periods: BenefitBand[];
survivorGap: SurvivorGap | null;
```

`combinedTimeline` and `spousalTopUp` keep their current types, so no component changes in this plan. Their **values** now come from the bands.

- [ ] **Step 1: Rebuild the timeline from the bands**

Replace `buildCombinedTimeline` (`household.ts:153`). It currently credits 12 payments in every year at or after a person's filing year. It becomes: for each calendar year in range, sum `monthsInYear(band, year) * band.monthlyAmount` across all bands, grouped into `byPersonId`.

The year range runs from the earliest band start to the latest band end.

`CombinedTimelinePoint` keeps its shape — `byPersonId` still sums a person's bands together. Splitting the chart series by type is 2b-ii.

- [ ] **Step 2: Produce the spousal figures from the Spousal band**

The married branch (`household.ts:205-240`) stops calling `spousalTopUp`:

- `atRecommendedFilingAge` — the Spousal band's `monthlyAmount`, or 0 when there is no Spousal band.
- `startsAtSpouseAge` — the lower earner's age at the Spousal band's `startIndex`, formatted with the existing `formatFilingAge`.
- `atFra` — `baseSpousalBenefit(higher, lower).value()` from `$lib/benefit-calculator`, which is what `spousalEntitlement` wrapped. Import the engine function directly; do not reimplement the arithmetic.
- `lowerEarnerLabel` — unchanged.

- [ ] **Step 3: Delete the hand-rebuilt model**

Remove `spousalTopUp`, `spousalEntitlement` and the `SpousalPayment` interface from `src/lib/ssaTools.ts`, and their tests from `src/lib/ssaTools.test.ts`.

**Delete only the tests that test those functions.** `ssaTools.test.ts` also covers `formatFilingAge`, the FRA schedule and the claim-age helpers — those stay. In particular there is an FRA-schedule regression guard written as a spousal test; if its real subject is the FRA schedule rather than `spousalTopUp`, preserve its intent by rewriting it against something that still exists, and say so in your report.

- [ ] **Step 4: Add household-level tests**

```ts
// append to src/lib/household.test.ts
it('exposes the engine periods on the analysis', async () => {
  const result = await analyzeHousehold(
    { status: 'married', people: [dan, sarah] },
    assumptions,
    asOf,
  );
  expect(result.periods.length).toBeGreaterThan(0);
  expect(result.periods.every((b) => b.monthlyAmount >= 0)).toBe(true);
});

it('credits only the months a person is actually paid in their filing year', async () => {
  const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
  const filingYear = dan.birthYear + result.optimal.filingAges[0].years;
  const point = result.combinedTimeline.find((p) => p.year === filingYear)!;
  const fullYear = result.combinedTimeline.find((p) => p.year === filingYear + 1)!;
  // Dan is not born in January, so his first year is necessarily partial.
  expect(point.total).toBeLessThan(fullYear.total);
});
```

Read the fixtures at the top of `household.test.ts` before relying on `dan`, `sarah`, `assumptions` and `asOf` — use whatever names are actually there. Confirm `dan`'s birth month is not January before asserting the partial first year; if it is, use a person whose is not.

- [ ] **Step 5: Run the golden suite — this is the cross-check**

Run: `npm run test -- golden`

Two things must hold:

1. **Every recommended filing age is unchanged.** The optimizer is untouched; a moved filing age means the rebase altered the calculation.
2. **`spousalTopUpAtFilingAge` and `startsAtSpouseAge` reproduce their existing hand-derived values.**

**If either fails, STOP and report** — with the scenario id, both numbers, and your reading of which derivation is wrong. Do not edit `scenarios.json`. See "The cross-check" above for why this matters more than the rest of the suite.

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

Then confirm fixture idempotence:

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/scenarios.json
```

Expected: empty.

- [ ] **Step 7: Commit**

```bash
git add src/lib/
SKIP_E2E=1 git commit -m "refactor: drive the household analysis from the engine's periods

Deletes spousalTopUp and spousalEntitlement. The spousal figures now come
from the engine's Spousal band and reproduce the hand-derived fixture
values exactly, and the timeline counts actual payment months.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Pin the decomposition in the golden suite

**Files:**
- Modify: `validation/engine/golden.test.ts`
- Modify: `validation/fixtures/scenarios.ts`

**Interfaces:**
- Consumes: Task 2's `HouseholdAnalysis.periods`
- Produces: no new exports

Task 2 proves the *totals* still hold. This task pins the *structure*, so 2b-ii cannot silently change which benefit is paid when while leaving the sums intact.

- [ ] **Step 1: Add band-shape assertions**

Add to `golden.test.ts`, driven by the existing scenario loop rather than a new fixture field:

```ts
it('decomposes every household into well-formed bands', async () => {
  // per scenario, inside the existing iteration pattern — follow the file's
  // established style rather than the shape sketched here
  const result = await run(scenario);
  for (const band of result.periods) {
    expect(band.endIndex).toBeGreaterThanOrEqual(band.startIndex);
    expect(band.monthlyAmount).toBeGreaterThan(0);
    expect(['personal', 'spousal', 'survivor']).toContain(band.type);
  }
  // A single claimant can only ever hold a personal benefit.
  if (scenario.inputs.status === 'single') {
    expect(result.periods.every((b) => b.type === 'personal')).toBe(true);
  }
  // Spousal and survivor never overlap: you cannot draw a spousal benefit
  // on a deceased spouse's record.
  const spousal = result.periods.filter((b) => b.type === 'spousal');
  const survivor = result.periods.filter((b) => b.type === 'survivor');
  for (const sp of spousal) {
    for (const sv of survivor) {
      if (sp.personId !== sv.personId) continue;
      expect(sp.endIndex).toBeLessThan(sv.startIndex);
    }
  }
});
```

Read the file's existing test structure first — it iterates scenarios in an established way, and this must follow it rather than introduce a second pattern.

**Every assertion here must be reachable.** If no golden scenario produces a survivor band, the overlap check passes vacuously — that is a finding, and Step 2 addresses it.

- [ ] **Step 2: Confirm a survivor band is actually reachable, and report**

Determine whether any existing golden scenario produces a Survivor band at all. A survivor band requires the dependent to outlive the earner, and every fixture person carries `lifeExpectancy: 85` — with equal plan-to ages, the **older** person dies first, so the direction depends on birth years, not mortality.

Report what you find. If no scenario produces one, say so plainly and **do not add a scenario to force it** — a new golden fixture needs hand-derived expected values, which is its own piece of work with its own evidence, not a step tacked onto this task. Record it as a gap for 2b-ii's plan to pick up.

- [ ] **Step 3: Run everything and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/scenarios.json
```

Expected: empty.

```bash
git add validation/
SKIP_E2E=1 git commit -m "test: pin the benefit-period decomposition in the golden suite

Structure assertions, so a later change cannot alter which benefit is paid
when while leaving the totals intact.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification against the spec's success criteria

This plan owns criteria 1, 2, 3 and 6. The rest belong to 2b-ii.

1. **`spousalTopUp` and `spousalEntitlement` no longer exist** — Task 2 Step 3.
2. **Every recommended filing age unchanged** — Task 2 Step 5.
3. **Spousal fixtures reproduced from the periods** — Task 2 Step 5, the cross-check.
6. **The unmodeled survivor direction is detected** — Task 1 Step 4, item 4; surfaced on `HouseholdAnalysis.survivorGap` in Task 2. *Displaying* it is 2b-ii.
