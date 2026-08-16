# Spousal Start Date and Reduction Basis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the app showing a spousal benefit that begins before the worker has filed, and reduce it by when the benefit actually begins rather than by when the spouse filed on their own record.

**Architecture:** `spousalTopUp` gains the worker's filing age and returns both the amount and the spouse's age when the benefit starts. The unreduced entitlement moves to its own function, since it is a reference figure with no filing dates in it at all. Callers, copy and fixtures follow.

**Tech Stack:** TypeScript, Vitest + Testing Library, Playwright, vendored ssa.tools engine.

**Spec:** `docs/superpowers/specs/2026-08-15-spousal-start-date-design.md`

## Global Constraints

- **Never modify `src/vendor/ssa-tools/`.** Vendored MIT upstream.
- No new dependencies.
- **Fixture values are hand-derived from SSA's published rules and confirmed against the engine — never read off the engine and recorded.** If hand and engine disagree, STOP and report.
- Tolerances: `monthlyUsd: 1`, `percentOfPia: 0.1`, `breakEvenYears: 0.1`.
- `npm run fixtures:gen` must remain idempotent — empty `git diff` on `scenarios.json`.
- `npm run lint` (oxlint) zero warnings.
- **Every task ends green:** `npm run lint`, `npm run test` and `npm run build` all pass before each commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch: `fix/spousal-start-date`.
- **Local e2e uses `PW_PORT=4199`** — port 4173 is occupied by unrelated software. The pre-commit hook runs e2e on the default port and will fail; use `SKIP_E2E=1 git commit ...`, never `--no-verify`.

## The domain rules this implements

1. A spousal benefit is payable only once **the worker** has filed on their own record.
2. The reduction is measured from the age at which **the spousal benefit itself begins**, relative to the spouse's own full retirement age — not from the spouse's own filing age.
3. Delayed retirement credits never apply to spousal benefits: beginning at or after FRA yields the unreduced amount, and no more.
4. The early-claim schedule for a spousal benefit is 25/36 of 1% per month for the first 36 months early, then 5/12 of 1% per month beyond.

Worked example, which is the recommended strategy in most dual-earner households — worker delays to 70, spouse claims at 62:

| | today | correct |
|---|---|---|
| Benefit begins | spouse's age 62 | worker's filing, when the spouse is ~66–70 |
| Reduction applied | 58 months early | none, if that lands at or after the spouse's FRA |

The two errors push in opposite directions, so the net is household-specific.

## Engine API available to you

From `src/vendor/ssa-tools/` (read-only), already used elsewhere in `ssaTools.ts`:

- `recipient.birthdate.dateAtSsaAge(age: MonthDuration): MonthDate`
- `recipient.birthdate.ageAtSsaDate(date: MonthDate): MonthDuration`
- `recipient.normalRetirementAge(): MonthDuration`
- `MonthDate.max(a, b): MonthDate`
- `baseSpousalBenefit(higher, lower): Money` from `$lib/benefit-calculator`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/ssaTools.ts` | **Modify.** `spousalTopUp` signature and reduction basis; new `spousalEntitlement` |
| `src/lib/household.ts` | **Modify.** Pass the worker's filing age; carry the start on `spousalTopUp` |
| `src/components/methodologyCopy.ts` | **Modify.** Say when the benefit begins |
| `src/components/pdf/HouseholdSection.tsx`, `pdf/ReportDocument.tsx` | **Modify.** Same, in print |
| `validation/fixtures/scenarios.json`, `scripts/gen-fixtures.mjs`, `engine/golden.test.ts` | **Modify.** Hand-derived values |

---

### Task 1: Correct the spousal amount and its start

**Files:**
- Modify: `src/lib/ssaTools.ts`
- Modify: `src/lib/ssaTools.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:

```ts
export interface SpousalPayment {
  /** Monthly top-up once payable. 0 when there is no entitlement. */
  amount: number;
  /** The spouse's age when the benefit actually begins. */
  startsAtSpouseAge: FilingAgeDisplay;
}

/** Unreduced entitlement: max(0, higherPIA/2 − lowerPIA). No filing dates. */
export function spousalEntitlement(worker: Recipient, spouse: Recipient): number;

export function spousalTopUp(
  worker: Recipient,
  spouse: Recipient,
  spouseFilingAge: MonthDuration,
  workerFilingAge: MonthDuration,
): SpousalPayment;
```

`spousalTopUp` **gains a fourth parameter and changes its return type** from `number` to `SpousalPayment`. Every caller must be updated; Task 2 does that.

- [ ] **Step 1: Resolve the 50%-cap sub-claim before writing anything**

`docs/reference/ssa-tools-engine-audit.md` reports that `spousalTopUp` "omits the 50%-of-PIA combined cap". Read `baseSpousalBenefit` in `src/vendor/ssa-tools/benefit-calculator.ts` and the audit's citation, and decide.

Reading suggests `baseSpousalBenefit` already expresses that cap as `max(0, workerPIA/2 − spousePIA)`. **Verify rather than assume, and do not implement a correction for a rule already correctly applied** — that is how a working calculation acquires a bug.

Record the verdict in your report either way, with the file:line you read. If the audit is right, treat it as an additional finding and fix it in this task with its own test.

- [ ] **Step 2: Write the failing tests**

```ts
// replace the existing describe('spousalTopUp', ...) block in src/lib/ssaTools.test.ts
import { MonthDuration } from '$lib/month-time';
import { spousalEntitlement, spousalTopUp } from './ssaTools';

describe('spousalEntitlement', () => {
  it('tops a no-record spouse up to half the worker PIA', () => {
    const worker = createPiaRecipient(1960, 6, 2500, 'male');
    const spouse = createPiaRecipient(1962, 3, 0, 'female');
    expect(spousalEntitlement(worker, spouse)).toBeCloseTo(1250, 0);
  });

  it('is zero when the spouse own PIA already exceeds half the worker PIA', () => {
    const worker = createPiaRecipient(1960, 6, 2500, 'male');
    const spouse = createPiaRecipient(1962, 3, 2000, 'female');
    expect(spousalEntitlement(worker, spouse)).toBe(0);
  });
});

describe('spousalTopUp — start date', () => {
  const age = (years: number, months = 0) =>
    MonthDuration.initFromYearsMonths({ years, months });

  // Worker born Jun 1960 (FRA 67), spouse born Mar 1962 (FRA 67), spouse has
  // no record of her own. This is the strategy the optimizer usually picks.
  const worker = () => createPiaRecipient(1960, 6, 2500, 'male');
  const spouse = () => createPiaRecipient(1962, 3, 0, 'female');

  it('cannot begin before the worker files', () => {
    // Worker files at 70 (Jun 2030). Spouse filed at 62 (Mar 2024) on her own
    // record, but the spousal benefit waits for him.
    const result = spousalTopUp(worker(), spouse(), age(62), age(70));
    // Jun 2030 − Mar 1962 = 68 years, 3 months.
    expect(result.startsAtSpouseAge.years).toBe(68);
    expect(result.startsAtSpouseAge.months).toBe(3);
  });

  it('is unreduced when it begins at or after the spouse own FRA', () => {
    // Beginning at 68y3m is past her FRA of 67, so no reduction applies.
    const result = spousalTopUp(worker(), spouse(), age(62), age(70));
    expect(result.amount).toBeCloseTo(1250, 0);
  });

  it('begins at the spouse filing age when the worker filed first', () => {
    // Worker files at 62 (Jun 2022); spouse files at 65 (Mar 2027).
    const result = spousalTopUp(worker(), spouse(), age(65), age(62));
    expect(result.startsAtSpouseAge.years).toBe(65);
    expect(result.startsAtSpouseAge.months).toBe(0);
  });

  it('reduces by the months between the actual start and the spouse FRA', () => {
    // Starts at 65y0m, 24 months before her FRA of 67, all within the first
    // 36-month band: 24 × 25/36 of 1% = 16.6667%. 1250 × 0.833333 = 1041.67.
    const result = spousalTopUp(worker(), spouse(), age(65), age(62));
    expect(result.amount).toBeCloseTo(1041.67, 1);
  });

  it('does not reduce by the spouse own filing age when the start is later', () => {
    // Filing on her own record at 62 while the benefit starts at 65 must give
    // the 65 reduction (1041.67), NOT the 62 reduction (~875).
    const startsAt65 = spousalTopUp(worker(), spouse(), age(62), age(65));
    expect(startsAt65.startsAtSpouseAge.years).toBe(65);
    expect(startsAt65.amount).toBeCloseTo(1041.67, 1);
  });

  it('grants no delayed credits for beginning after FRA', () => {
    const atFra = spousalTopUp(worker(), spouse(), age(67), age(62));
    const wellAfter = spousalTopUp(worker(), spouse(), age(70), age(62));
    expect(atFra.amount).toBeCloseTo(1250, 0);
    expect(wellAfter.amount).toBeCloseTo(1250, 0);
  });

  it('pays nothing when there is no entitlement, whatever the dates', () => {
    const earner = createPiaRecipient(1962, 3, 2000, 'female');
    const result = spousalTopUp(worker(), earner, age(62), age(70));
    expect(result.amount).toBe(0);
  });
});
```

The fifth test is the one that pins the defect. Under the old code it returns roughly `875` (the 62 reduction); the fix makes it `1041.67`.

Verify the two dates in the first test by hand before accepting them: worker born Jun 1960 filing at exactly 70 gives Jun 2030; a spouse born Mar 1962 is 68 years and 3 months in Jun 2030. If SSA's attained-age convention shifts this by a month, correct the **test** to match the engine's own date arithmetic and say so in your report.

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npm run test -- ssaTools`
Expected: FAIL — `spousalEntitlement` is not exported, and `spousalTopUp` takes three arguments.

- [ ] **Step 4: Implement**

```ts
// src/lib/ssaTools.ts — replace spousalTopUp entirely
import { MonthDate } from '$lib/month-time';

export interface SpousalPayment {
  amount: number;
  startsAtSpouseAge: FilingAgeDisplay;
}

/**
 * The unreduced spousal entitlement: half the worker's PIA, less the spouse's
 * own PIA, floored at zero. A reference figure — it has no filing dates in it
 * and is never what anyone is actually paid.
 */
export function spousalEntitlement(worker: Recipient, spouse: Recipient): number {
  return baseSpousalBenefit(worker, spouse).value();
}

/**
 * The spousal top-up the spouse actually receives, and when it starts.
 *
 * Two rules that the previous three-argument version could not express:
 *
 *  - A spousal benefit is payable only once the WORKER has filed. Filing on
 *    your own record earlier does not start it.
 *  - The reduction is measured from the age at which the spousal benefit
 *    itself begins, not from the spouse's own filing age. Those differ
 *    whenever the worker files later — which is exactly what the optimizer
 *    usually recommends.
 *
 * Delayed credits never apply, so beginning at or after FRA yields the
 * unreduced entitlement and no more.
 */
export function spousalTopUp(
  worker: Recipient,
  spouse: Recipient,
  spouseFilingAge: MonthDuration,
  workerFilingAge: MonthDuration,
): SpousalPayment {
  const startDate = MonthDate.max(
    spouse.birthdate.dateAtSsaAge(spouseFilingAge),
    worker.birthdate.dateAtSsaAge(workerFilingAge),
  );
  const startsAtSpouseAge = formatFilingAge(spouse.birthdate.ageAtSsaDate(startDate));

  const base = spousalEntitlement(worker, spouse);
  if (base <= 0) return { amount: 0, startsAtSpouseAge };

  const monthsEarly =
    spouse.normalRetirementAge().asMonths() - startsAtSpouseAge.monthDuration.asMonths();
  if (monthsEarly <= 0) return { amount: base, startsAtSpouseAge };

  // SSA spousal reduction: 25/36 of 1% per month for the first 36 months
  // early, then 5/12 of 1% per month beyond that.
  const first = Math.min(monthsEarly, 36);
  const rest = Math.max(0, monthsEarly - 36);
  const reduction = first * (25 / 36 / 100) + rest * (5 / 12 / 100);
  return {
    amount: Math.round(base * (1 - reduction) * 100) / 100,
    startsAtSpouseAge,
  };
}
```

If `MonthDate.max` is not a static on that class, read `src/vendor/ssa-tools/month-time.ts` for the real accessor and adjust — do not modify the vendored file.

- [ ] **Step 5: Run the tests**

Run: `npm run test -- ssaTools`
Expected: PASS. Other suites will fail to compile until Task 2 updates the callers; that is expected within this task only, and Step 6 must not be reached until you have run the full suite.

- [ ] **Step 6: Commit together with Task 2**

This task changes a signature with live callers, so it cannot end green on its own. **Do Task 2 before committing**, then commit both. The plan's every-task-ends-green rule applies to the pair.

---

### Task 2: Update the callers and the fixtures

**Files:**
- Modify: `src/lib/household.ts`
- Modify: `src/lib/household.test.ts`
- Modify: `validation/fixtures/scenarios.json`
- Modify: `validation/scripts/gen-fixtures.mjs`
- Modify: `validation/engine/golden.test.ts`
- Modify: `validation/fixtures/scenarios.ts`

**Interfaces:**
- Consumes: Task 1's `spousalEntitlement(worker, spouse)` and `spousalTopUp(worker, spouse, spouseFilingAge, workerFilingAge): SpousalPayment`
- Produces:

```ts
// on HouseholdAnalysis
spousalTopUp?: {
  atFra: number;                    // unreduced entitlement
  atRecommendedFilingAge: number;   // what is actually paid
  startsAtSpouseAge: string;        // e.g. "68 years, 3 months" — the label
  lowerEarnerLabel: string;         // unchanged
};
```

- [ ] **Step 1: Rewire `household.ts`**

The married branch currently calls `spousalTopUp` twice. Replace with:

```ts
const higherIndex = aIsHigher ? 0 : 1;
const paid = spousalTopUp(
  higher,
  lower,
  optimal.filingAges[lowerIndex].monthDuration,
  optimal.filingAges[higherIndex].monthDuration,
);

// …
spousalTopUp: {
  // Unreduced reference figure — deliberately has no filing dates in it.
  atFra: roundCents(spousalEntitlement(higher, lower)),
  atRecommendedFilingAge: paid.amount,
  startsAtSpouseAge: paid.startsAtSpouseAge.label,
  lowerEarnerLabel: lowerIndex === 0 ? labelA : labelB,
},
```

Note `atFra` no longer routes through `spousalTopUp` at all. It is the entitlement, and calling a payment function with an FRA filing age to obtain it was always a roundabout way of asking for the base.

`roundCents` lives in `src/lib/benefitMath.ts` and is **not currently imported** by `household.ts` — add the import, or drop the call and let `spousalEntitlement` return the raw value, since `baseSpousalBenefit` derives from PIAs that are already whole dollars. Either is fine; say which you chose.

- [ ] **Step 2: Add a household-level test**

```ts
// append to src/lib/household.test.ts
it('does not start the spousal benefit before the higher earner files', async () => {
  const noRecord: Person = { ...sarah, piaMonthly: 0 };
  const result = await analyzeHousehold(
    { status: 'married', people: [dan, noRecord] },
    assumptions,
    asOf,
  );
  const spousal = result.spousalTopUp!;
  const higherIndex = dan.piaMonthly >= noRecord.piaMonthly ? 0 : 1;
  const lowerIndex = higherIndex === 0 ? 1 : 0;

  // The benefit cannot begin before the higher earner files, so the spouse's
  // age at start must be at least her age when he files.
  const higherFilesAtYear =
    result.people[higherIndex].person.birthYear +
    result.optimal.filingAges[higherIndex].years;
  const spouseAgeThen = higherFilesAtYear - result.people[lowerIndex].person.birthYear;

  const startYears = Number(spousal.startsAtSpouseAge.split(' ')[0]);
  expect(startYears).toBeGreaterThanOrEqual(spouseAgeThen - 1);
  expect(spousal.startsAtSpouseAge).not.toBe('');
});

it('reports the unreduced entitlement separately from what is paid', async () => {
  const noRecord: Person = { ...sarah, piaMonthly: 0 };
  const result = await analyzeHousehold(
    { status: 'married', people: [dan, noRecord] },
    assumptions,
    asOf,
  );
  const spousal = result.spousalTopUp!;
  // Half of Dan's PIA, since she has no record of her own.
  expect(spousal.atFra).toBeCloseTo(dan.piaMonthly / 2, 0);
  expect(spousal.atRecommendedFilingAge).toBeLessThanOrEqual(spousal.atFra);
});

it('omits spousal data for a single claimant', async () => {
  const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
  expect(result.spousalTopUp).toBeUndefined();
});
```

- [ ] **Step 3: Run the engine suite and record what moved**

Run: `npm run test -- golden`

Expect failures on `spousalTopUpAtFilingAge` for scenarios where the higher earner files later than the lower earner. **Record the scenario id and the old and new value for each before changing anything.**

- [ ] **Step 4: Hand-derive every changed value**

For each failing scenario, work it out from the rules — do not copy the engine's number:

1. Unreduced entitlement = `max(0, higherPIA/2 − lowerPIA)`.
2. Actual start = the later of the two filing dates. Convert to the lower earner's age at that date.
3. Months early = the lower earner's own FRA in months, minus their age at start in months. Zero or negative means **unreduced**.
4. Reduction = first 36 months × 25/36 of 1%, then the remainder × 5/12 of 1%.

Update the value **only if your arithmetic matches the engine**. Record the derivation in that scenario's `description`, as the existing entries do. **If hand and engine disagree, STOP and report** — that is a real defect, not a stale fixture.

Add `spousalTopUpAtFilingAge` values to `gen-fixtures.mjs`'s preserved map for any scenario whose value changed, and re-run `npm run fixtures:gen` to confirm an empty diff.

- [ ] **Step 5: Assert the start in the engine suite**

Add `startsAtSpouseAge` to `ScenarioExpected` in `validation/fixtures/scenarios.ts` as `string | null`, populate it for the married scenarios, and assert it in `golden.test.ts` alongside the two amounts.

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit Tasks 1 and 2 together**

```bash
git add src/lib/ssaTools.ts src/lib/ssaTools.test.ts src/lib/household.ts src/lib/household.test.ts validation/
git commit -m "fix: start the spousal benefit when the worker files, not the spouse

A spousal benefit is payable only once the worker has filed, and its
reduction is measured from when the benefit itself begins rather than
from the spouse's own filing age. The two errors pushed in opposite
directions, so the net was household-specific.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Say when the benefit begins

**Files:**
- Modify: `src/components/methodologyCopy.ts`
- Modify: `src/components/methodologyCopy.test.ts`
- Modify: `src/components/pdf/HouseholdSection.tsx`
- Modify: `src/components/pdf/ReportDocument.tsx`

**Interfaces:**
- Consumes: Task 2's `spousalTopUp.startsAtSpouseAge: string`
- Produces: no new exports

A spousal amount without its start is the ambiguity that produced this defect. Every place the figure appears must now carry when it begins.

- [ ] **Step 1: Write the failing copy test**

```ts
// append to src/components/methodologyCopy.test.ts
it('states when the spousal benefit begins', () => {
  const analysis = {
    status: 'married',
    spousalTopUp: {
      atFra: 1250,
      atRecommendedFilingAge: 1250,
      startsAtSpouseAge: '68 years, 3 months',
      lowerEarnerLabel: 'Sarah',
    },
  } as unknown as HouseholdAnalysis;

  const copy = spousalCopy(analysis);
  expect(copy).toMatch(/68 years, 3 months/);
  expect(copy).toMatch(/Sarah/);
});
```

Match the real export name and signature in `methodologyCopy.ts` rather than the placeholder `spousalCopy` above — read the file first and use what is there.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- methodologyCopy`
Expected: FAIL — the copy does not mention the start.

- [ ] **Step 3: Update the copy in all three places**

On screen (`methodologyCopy.ts`) and in the PDF (`HouseholdSection.tsx`, and the methodology block in `ReportDocument.tsx`), state the start alongside the amount. Something of this shape, adapted to each site's existing sentence:

> Sarah may receive a spousal top-up of $1,250.00/mo, beginning at her age 68 years, 3 months — when Dan files. A spousal benefit cannot start before the worker has filed. The unreduced amount at her own full retirement age is $1,250.00.

Keep the existing distinction between the two quantities; this adds the start, it does not replace the labelling.

- [ ] **Step 4: Run everything, including e2e**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/
git commit -m "feat: state when the spousal benefit begins, on screen and in print

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification against the spec's success criteria

1. **Benefit begins at the worker's filing** — Task 1 Step 2 test 1; Task 2 Step 2.
2. **Unreduced when it begins at or after the spouse's FRA** — Task 1 test 2.
3. **Reduced by the months between the actual start and FRA** — Task 1 tests 4 and 5; test 5 is the one that fails under the old code.
4. **The displayed figure states when it begins** — Task 3, all three sites.
5. **The 50%-cap sub-claim resolved** — Task 1 Step 1, with the verdict recorded either way.
6. **Changed fixtures hand-derived with arithmetic recorded** — Task 2 Step 4.
7. **`fixtures:gen` idempotent** — Task 2 Step 4.
8. **Lint, tests, build, e2e** — every task.
