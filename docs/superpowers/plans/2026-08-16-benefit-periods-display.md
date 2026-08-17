# Benefit-Periods Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the household what the engine's benefit periods already know — which benefit is paid, to whom, from when — plus the income cliff at the first death and what each strategy does to the survivor.

**Architecture:** Phase 2b-i put typed, dated bands on `HouseholdAnalysis`. This plan surfaces them: the timeline gains per-series keys, the chart gains a band per benefit type with claim and death markers, two new derived figures appear (the income cliff, survivor income per strategy), and a real/nominal toggle wraps the lot.

**Tech Stack:** React 19, TypeScript, Recharts, @react-pdf/renderer, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-16-benefit-periods-rebase-design.md` — this plan is **2b-ii**, owning success criteria **4, 5, 7, 8 and 9**. Criteria 1, 2, 3 and 6 were delivered by 2b-i and are already merged.

## Global Constraints

- **Never modify `src/vendor/ssa-tools/`.** Vendored MIT upstream.
- No new dependencies.
- **No recommended filing age may change for any golden scenario**, and `recommendedFilingAgeByPerson` in `validation/fixtures/scenarios.json` now pins them — so the suite can actually detect it. This plan touches display only.
- **No benefit rule may be computed by hand.** 2b-i deleted the hand-rebuilt model; every figure here is arithmetic over engine-produced band amounts, or a date comparison. If you find yourself writing a reduction factor, a DRC rate, or an age threshold that decides an *amount*, stop and report.
- `npm run fixtures:gen` idempotent — empty `git diff` on `scenarios.json`.
- `npm run lint` (oxlint) zero warnings.
- **Every task ends green:** `npm run lint`, `npm run test` and `npm run build` pass before each commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch: `feat/periods-display`.
- **Local e2e uses `PW_PORT=4199`** — port 4173 is occupied. The pre-commit hook runs e2e on the default port and will fail; run e2e yourself, then `SKIP_E2E=1 git commit ...`. Never `--no-verify`.

## Copy is the risk on this branch, not the arithmetic

Across three branches every serious defect has been **user-facing text that was wrong beside a right number**: a caption claiming survivor benefits were unmodeled after they were; an em-dash sentinel that printed "beginning at age — —" in a client PDF; a confident wrong cause for a missing benefit; a fabricated present-tense dollar figure; and a "survivor benefits are modeled" claim printed on the same page as the note saying they were not.

Two rules follow, and they bind every task here:

1. **Never hand-maintain the same sentence in two places.** Three of those defects existed because the copy lived in `methodologyCopy.ts`, `pdf/HouseholdSection.tsx` and `pdf/ReportDocument.tsx` independently, so a guard added to one never reached the others. Every new user-facing sentence goes in `methodologyCopy.ts` as a function and is consumed by every surface.
2. **A statement must be true for every household shape the code can produce** — zero entitlement, eligible-but-bandless, a `$0.00` band, the unmodeled survivor direction, and a single claimant. If a sentence is only true for the common case, it is wrong.

## What 2b-i left you

On `HouseholdAnalysis` (`src/lib/household.ts`):

```ts
periods: BenefitBand[];        // every benefit as a dated band
survivorGap: SurvivorGap | null;
combinedTimeline: CombinedTimelinePoint[];
spousalTopUp?: { atFra; atRecommendedFilingAge; startsAtSpouseAge: string | null; lowerEarnerLabel };
```

`BenefitBand` is `{ personId, type: 'personal' | 'spousal' | 'survivor', startIndex, endIndex, monthlyAmount }`, where the indices are **inclusive absolute months**, `calendarYear * 12 + (month - 1)`. `monthsInYear(band, year)` is exported alongside it.

Two properties of the bands you must design around:

- **Survivor is a top-up on a continuing personal band.** The engine emits Survivor as *replacing* Personal at the full amount; 2b-i splits it so the personal band continues and the survivor band carries the difference. So the survivor band is **already** the increment — do not subtract anything again.
- **The first-death month is not derivable from the bands**, which is why Task 1 exposes it explicitly. A person who dies before filing holds no band at all, so their death month is nowhere in the band ends to be read.

  *(Corrected after execution, and this is the sentence Phase 3 will design from — the original wording was wrong. It said the split "extends the deceased's personal band to the survivor's death." It does not: `splitDualEntitlement` carries forward `latestPersonalBand(bands, survivor.personId)` — the **survivor's own** band — and the engine already ends the earner's personal periods at `earnerFinalDate`, `strategy-calc.ts:104-110`. The field is still needed, for the reason stated above.)*

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/benefitPeriods.ts` | **Modify.** Expose each person's final month |
| `src/lib/household.ts` | **Modify.** Per-series timeline keys; carry final months; survivor income per strategy |
| `src/lib/dollarsMode.ts` | **Create.** The real/nominal transform, pure |
| `src/lib/incomeCliff.ts` | **Create.** The first-death drop, derived from the timeline |
| `src/components/CombinedIncomeChart.tsx` | **Modify.** Band per benefit type, markers |
| `src/components/IncomeCliffCallout.tsx` | **Create.** |
| `src/components/StrategyComparisonTable.tsx` | **Modify.** Survivor-income column |
| `src/components/methodologyCopy.ts` | **Modify.** Every new sentence lives here |
| `src/components/pdf/HouseholdSection.tsx` | **Modify.** Same bands, cliff and column in print |
| `src/lib/shareLink.ts` | **Modify.** The `dollars` parameter |
| `src/lib/chartTheme.ts` | **Modify.** One new series token |

---

### Task 1: Expose the death months, and key the timeline by series

**Files:**
- Modify: `src/lib/benefitPeriods.ts`, `src/lib/benefitPeriods.test.ts`
- Modify: `src/lib/household.ts`, `src/lib/household.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:

```ts
// benefitPeriods.ts — HouseholdPeriods gains one field
export interface HouseholdPeriods {
  bands: BenefitBand[];
  survivorGap: SurvivorGap | null;
  /**
   * Each person's inclusive final month index — the month they reach their
   * plan-to age. NOT derivable from the bands: a person who dies before
   * filing holds no band at all, so their death month is nowhere in the band
   * ends to be read.
   *
   * (Corrected after execution. This comment originally said the split
   * "extends the deceased's personal band to the SURVIVOR's death". It does
   * not: `splitDualEntitlement` carries forward
   * `latestPersonalBand(bands, survivor.personId)` — the SURVIVOR's own band
   * — and the engine already ends the earner's personal periods at
   * `earnerFinalDate`, `strategy-calc.ts:104-110`. The field is still
   * needed, for the reason stated above. Phase 3 must not re-inherit the old
   * wording.)
   */
  finalIndexByPersonId: Record<string, number>;
}

// household.ts
export interface CombinedTimelinePoint {
  year: number;
  /** Keyed `${personId}:${type}` — the chart's stacked series. */
  bySeries: Record<string, number>;
  /** Per-person roll-up. The tooltip and the PDF summary both want a person's total. */
  byPersonId: Record<string, number>;
  total: number;
}

// on HouseholdAnalysis
finalIndexByPersonId: Record<string, number>;
```

`byPersonId` is **kept**, derived from `bySeries`. Both are genuinely wanted — the stacked bands are per series, the tooltip line "Jane: $49,100" is per person — and deriving one from the other means they cannot disagree.

This task changes no rendering. It ends green with the charts drawing exactly what they draw today.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/lib/benefitPeriods.test.ts
it('reports each person final month, which the bands cannot tell you', () => {
  // Jane is the higher earner and dies first, so the split extends John's
  // personal band past her death — and hers past her own death too.
  const john = person('a', 1958, 3, 1400, 'male', 88);
  const jane = person('b', 1960, 9, 3000, 'female', 80);
  const { finalIndexByPersonId } = householdPeriods(
    [john, jane],
    [recipientFor(john), recipientFor(jane)],
    [age(62), age(70)],
    ['John', 'Jane'],
  );
  // Jane born Sep 1960, plan-to 80 -> Sep 2040. John born Mar 1958,
  // plan-to 88 -> Mar 2046. Verify both against `dateAtSsaAge` yourself.
  expect(finalIndexByPersonId.b).toBe(2040 * 12 + 8);
  expect(finalIndexByPersonId.a).toBe(2046 * 12 + 2);
});
```

```ts
// append to src/lib/household.test.ts
it('keys the timeline by person and benefit type', async () => {
  const result = await analyzeHousehold(
    { status: 'married', people: [dan, sarah] },
    assumptions,
    asOf,
  );
  const withSpousal = result.periods.find((b) => b.type === 'spousal');
  const point = result.combinedTimeline.find(
    (p) => p.year === Math.floor(withSpousal!.startIndex / 12) + 1,
  )!;
  expect(point.bySeries[`${withSpousal!.personId}:spousal`]).toBeGreaterThan(0);
});

it('rolls series up to the same per-person totals', async () => {
  const result = await analyzeHousehold(
    { status: 'married', people: [dan, sarah] },
    assumptions,
    asOf,
  );
  for (const point of result.combinedTimeline) {
    for (const person of result.people) {
      const id = person.person.id;
      const summed = Object.entries(point.bySeries)
        .filter(([key]) => key.startsWith(`${id}:`))
        .reduce((acc, [, value]) => acc + value, 0);
      expect(point.byPersonId[id]).toBeCloseTo(summed, 2);
    }
  }
});
```

Read `household.test.ts`'s existing fixtures before relying on `dan`, `sarah`, `assumptions` and `asOf`; use whatever names are actually there. The first test assumes a spousal band exists for that pairing — assert it does before indexing, or the test can pass vacuously on `undefined`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npm run test -- benefitPeriods household`
Expected: FAIL — `finalIndexByPersonId` and `bySeries` do not exist.

- [ ] **Step 3: Implement**

`householdPeriods` already computes `finalDates` and maps them through `monthIndexOf` for gap detection. Return them keyed by person id rather than recomputing.

In `buildCombinedTimeline`, accumulate into `bySeries[`${band.personId}:${band.type}`]` and derive `byPersonId` by summing each person's series. Keep the existing rounding.

Carry `finalIndexByPersonId` onto `HouseholdAnalysis` in both the married and single branches.

- [ ] **Step 4: Run everything and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/scenarios.json
```
Expected: empty.

```bash
git add src/lib/
SKIP_E2E=1 git commit -m "feat: expose each person's final month and key the timeline by series

A person who dies before filing holds no band at all, so the first-death
month cannot be read back off the bands. The income-cliff callout needs it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: One band per benefit type

**Files:**
- Modify: `src/lib/chartTheme.ts`
- Modify: `src/components/CombinedIncomeChart.tsx`, `src/components/CombinedIncomeChart.test.tsx`
- Modify: `src/components/pdf/HouseholdSection.tsx`, `src/components/pdf/HouseholdSection.test.tsx`

**Interfaces:**
- Consumes: Task 1's `bySeries`
- Produces:

```ts
// chartTheme.ts
export const CHART_SAGE = '#7d9b76';

/**
 * A person's own record keeps their identity colour; benefits drawn on the
 * OTHER person's record get their own. Only the dependent ever holds a
 * spousal or survivor band, so at most four series exist and none collide.
 */
export function seriesColor(personIndex: number, type: BandType): string;
```

Satisfies criteria **4** and **5**.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to src/components/CombinedIncomeChart.test.tsx
it('renders a legend entry per benefit type, not per person', () => {
  render(<CombinedIncomeChart timeline={timelineWithSpousal} people={[dan, sarah]} />);
  expect(screen.getByText(/Sarah — spousal/)).toBeInTheDocument();
  expect(screen.getByText(/Dan — own benefit/)).toBeInTheDocument();
});

it('omits a band and its legend entry when every year of it is zero', () => {
  // A $0.00 spousal band is reachable: the engine emits one when a
  // DRC-inflated personal benefit exceeds the combined cap.
  render(<CombinedIncomeChart timeline={timelineWithZeroSpousal} people={[dan, sarah]} />);
  expect(screen.queryByText(/spousal/i)).not.toBeInTheDocument();
});

it('marks each person filing and the first death', () => {
  render(
    <CombinedIncomeChart
      timeline={timelineWithSurvivor}
      people={[dan, sarah]}
      finalIndexByPersonId={{ a: 2046 * 12 + 2, b: 2040 * 12 + 8 }}
    />,
  );
  expect(screen.getByTestId('first-death-marker')).toBeInTheDocument();
});
```

**Verify how Recharts reference-line labels behave in jsdom before relying on this assertion.** `ResponsiveContainer` has no layout in jsdom and the existing chart tests work around it; a label may never reach the DOM as queryable text. If `getByTestId` on the marker is not workable either, assert the marker's presence however the file's existing chart tests assert rendered chart internals, and say what you chose. Do not weaken it to something that passes without the marker existing.

**The three timeline fixtures:**

- `timelineWithSpousal` and `timelineWithSurvivor` — build from real `analyzeHousehold` output. The `dan`/`sarah` pairing already used in `household.test.ts` produces both.
- `timelineWithZeroSpousal` — a `$0.00` spousal band arises when the lower earner's DRC-inflated personal benefit exceeds the combined cap, which needs them filing well past their own FRA. **Find a reachable household rather than assuming one**: sweep filing ages through `householdPeriods` until a spousal band with `monthlyAmount === 0` appears, and record the parameters in a comment. If none is reachable through the *optimizer*, that is worth reporting — the criterion would then only be testable with forced filing ages, which is still a valid test but a weaker claim.

A hand-built `bySeries` that matches no shape the pipeline produces tests nothing about the app. Where you must hand-build one, comment why.

- [ ] **Step 2: Run to confirm they fail**

Run: `npm run test -- CombinedIncomeChart`
Expected: FAIL — the chart renders one series per person.

- [ ] **Step 3: Implement the series**

Derive the series list from the keys actually present in `bySeries`, **dropping any series whose value is zero in every point** — that is criterion 5, and it is what makes a `$0.00` spousal band disappear rather than render an invisible band with a legend entry.

Label each series `{personLabel} — {own benefit | spousal | survivor}`. Colour by `seriesColor(personIndex, type)`.

Recharts `stackId` stays `"household"` so the stack still sums to the household total.

- [ ] **Step 4: Add the markers**

A `ReferenceLine` per person at their filing year, and one at the first death — `Math.min(...Object.values(finalIndexByPersonId))` converted to a calendar year. The death marker only appears for a couple.

`finalIndexByPersonId` becomes an optional prop, defaulted, so the single-claimant call site need not pass it.

- [ ] **Step 5: Mirror it in the PDF**

`pdf/HouseholdSection.tsx`'s `CombinedIncomeBars` renders the same decomposition with the same colours and the same legend labels. **Take the labels from the same function the screen uses** — do not retype them. That duplication is the mechanism behind three prior defects.

- [ ] **Step 6: Run everything and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

```bash
git add src/lib/chartTheme.ts src/components/
SKIP_E2E=1 git commit -m "feat: show one band per benefit type, on screen and in print

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The income-cliff callout

**Files:**
- Create: `src/lib/incomeCliff.ts`, `src/lib/incomeCliff.test.ts`
- Create: `src/components/IncomeCliffCallout.tsx`, `src/components/IncomeCliffCallout.test.tsx`
- Modify: `src/components/HouseholdPanel.tsx`, `src/components/methodologyCopy.ts`
- Modify: `src/components/pdf/HouseholdSection.tsx`

**Interfaces:**
- Consumes: Task 1's `finalIndexByPersonId`
- Produces:

```ts
export interface IncomeCliff {
  /** Calendar year of the first death. */
  deathYear: number;
  /** Household total in the last full year before it. */
  before: number;
  /** Household total in the first full year after it. */
  after: number;
  /** Positive percentage drop, e.g. 37.3. Zero when income does not fall. */
  dropPercent: number;
  survivorLabel: string;
}

export function incomeCliff(analysis: HouseholdAnalysis): IncomeCliff | null;
```

Returns null for a single claimant, and for a couple whose first death falls outside the timeline.

Satisfies criterion **9**.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/incomeCliff.test.ts
it('measures the drop across the first death', async () => {
  const result = await analyzeHousehold(
    { status: 'married', people: [dan, sarah] },
    assumptions,
    asOf,
  );
  const cliff = incomeCliff(result)!;
  const firstDeath = Math.min(...Object.values(result.finalIndexByPersonId));
  expect(cliff.deathYear).toBe(Math.floor(firstDeath / 12));
  // Compared against full years on either side, so a partial death year
  // cannot masquerade as a drop in income.
  expect(cliff.before).toBe(
    result.combinedTimeline.find((p) => p.year === cliff.deathYear - 1)!.total,
  );
  expect(cliff.after).toBe(
    result.combinedTimeline.find((p) => p.year === cliff.deathYear + 1)!.total,
  );
  expect(cliff.dropPercent).toBeCloseTo(((cliff.before - cliff.after) / cliff.before) * 100, 2);
});

it('returns null for a single claimant', async () => {
  const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
  expect(incomeCliff(result)).toBeNull();
});
```

**Use full years either side of the death year, never the death year itself.** The death year is partial by construction — the deceased is paid for part of it — so measuring into it reports a drop that is an artefact of the calendar rather than a change in income.

- [ ] **Step 2: Run to confirm they fail**

Run: `npm run test -- incomeCliff`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement and render**

`incomeCliff` is arithmetic over `combinedTimeline` and `finalIndexByPersonId`. No engine call.

`IncomeCliffCallout` renders below the chart in `HouseholdPanel`, and the same figures appear in `pdf/HouseholdSection.tsx`. **The sentence lives in `methodologyCopy.ts`** and both surfaces call it.

The copy must be true when `dropPercent` is 0 — reachable when the survivor's step-up offsets the loss — so do not write "income falls" unconditionally.

**If `analysis.survivorGap` is set, the after figure understates the survivor.** Say so in the callout, reusing `survivorGapNote` rather than writing a second sentence about it.

- [ ] **Step 4: Run everything and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

```bash
git add src/lib/incomeCliff.ts src/lib/incomeCliff.test.ts src/components/
SKIP_E2E=1 git commit -m "feat: state the income cliff at the first death

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Survivor income per strategy

**Files:**
- Modify: `src/lib/household.ts`, `src/lib/household.test.ts`
- Modify: `src/components/StrategyComparisonTable.tsx`, `src/components/StrategyComparisonTable.test.tsx`
- Modify: `src/components/pdf/HouseholdSection.tsx`

**Interfaces:**
- Consumes: Task 1's `finalIndexByPersonId`, Task 3's `incomeCliff` shape
- Produces:

```ts
// on HouseholdStrategy
/**
 * Annual household income in the first full year after the first death,
 * under THIS strategy. Null for a single claimant. This is the argument for
 * delaying that lifetime PV cannot show: delaying raises the survivor's
 * income for every year they outlive their spouse.
 */
survivorIncome: number | null;
```

Satisfies criterion **8**.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/household.test.ts
it('reports survivor income for every compared strategy', async () => {
  const result = await analyzeHousehold(
    { status: 'married', people: [dan, sarah] },
    assumptions,
    asOf,
  );
  expect(result.comparisons.every((s) => s.survivorIncome !== null)).toBe(true);

  const earliest = result.comparisons.find((s) => s.key === 'earliest');
  const latest = result.comparisons.find((s) => s.key === 'latest');
  // Delaying raises the survivor's income — that is the whole point of the
  // column. Guarded, because `household.ts` legitimately omits unattainable
  // rows and folds a named row into the optimum when they coincide.
  if (earliest && latest) {
    expect(latest.survivorIncome!).toBeGreaterThan(earliest.survivorIncome!);
  }
});

it('leaves survivor income null for a single claimant', async () => {
  const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
  expect(result.comparisons.every((s) => s.survivorIncome === null)).toBe(true);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test -- household`
Expected: FAIL — `survivorIncome` is not on `HouseholdStrategy`.

- [ ] **Step 3: Implement**

For each comparison row, call `householdPeriods` with **that row's** filing ages, build a timeline from the resulting bands, and take the total for the first full year after the first death. The death months do not vary by strategy, so compute them once.

This adds an engine call per compared row — at most four. `buildComparisons` is already `async` and the optimizer does far more work; if you measure a real regression, report it rather than caching speculatively.

**Reuse the timeline builder and the cliff's year arithmetic.** A second, subtly different notion of "the year after the first death" in the same codebase is how two figures that should agree drift apart.

- [ ] **Step 4: Add the column**

A `Survivor income` column in `StrategyComparisonTable`, rendered only for a married household, and the same column in the PDF table. Header and any explanatory sentence come from `methodologyCopy.ts`.

State in the copy that the figure assumes the death direction the engine models. When `survivorGap` is set it understates — reuse the existing note rather than writing another.

- [ ] **Step 5: Run everything and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

```bash
git add src/lib/ src/components/
SKIP_E2E=1 git commit -m "feat: show what each strategy pays the survivor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Real and nominal dollars

**Files:**
- Create: `src/lib/dollarsMode.ts`, `src/lib/dollarsMode.test.ts`
- Modify: `src/lib/formState.ts`, `src/lib/shareLink.ts`, `src/lib/shareLink.test.ts`
- Modify: `src/components/Analyzer.tsx`, `src/components/HouseholdPanel.tsx`
- Modify: `src/components/CombinedIncomeChart.tsx`, `src/components/methodologyCopy.ts`
- Modify: `src/components/pdf/HouseholdSection.tsx`

**Interfaces:**
- Consumes: Task 1's timeline, Task 3's `IncomeCliff`
- Produces:

```ts
export type DollarsMode = 'real' | 'nominal';

/**
 * Real is the engine's own output, untouched: `PersonalBenefitPeriods`
 * applies no COLA, so the bands are already in constant dollars. Nominal is
 * the transform, compounding `annualCola` forward from `asOf`.
 *
 * That is the reverse of the usual arrangement and it is the safer one — the
 * honest view needs no arithmetic of ours, and the flattering one has to
 * justify itself.
 */
export function toNominal(
  timeline: CombinedTimelinePoint[],
  annualCola: number,
  asOfYear: number,
): CombinedTimelinePoint[];
```

Satisfies criterion **7**.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/dollarsMode.test.ts
const point = (year: number, total: number): CombinedTimelinePoint => ({
  year,
  bySeries: { 'a:personal': total },
  byPersonId: { a: total },
  total,
});

it('leaves the base year untouched', () => {
  const out = toNominal([point(2026, 1000)], 2.5, 2026);
  expect(out[0].total).toBeCloseTo(1000, 2);
});

it('compounds the COLA forward', () => {
  // Ten years at 2.5%: 1000 * 1.025^10 = 1280.08.
  const out = toNominal([point(2036, 1000)], 2.5, 2026);
  expect(out[0].total).toBeCloseTo(1280.08, 1);
});

it('is the identity at a zero COLA', () => {
  const input = [point(2026, 1000), point(2046, 2000)];
  expect(toNominal(input, 0, 2026)).toEqual(input);
});

it('scales every series, not just the total', () => {
  const out = toNominal([point(2036, 1000)], 2.5, 2026);
  expect(out[0].bySeries['a:personal']).toBeCloseTo(1280.08, 1);
  expect(out[0].byPersonId.a).toBeCloseTo(1280.08, 1);
});
```

`annualCola` is stored as a **percent** (2.5 means 2.5%), unlike `discountRate` which is a fraction. `formBounds.ts:27` records the asymmetry. Convert once, inside `toNominal`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npm run test -- dollarsMode`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the transform and the toggle**

A two-way control above the chart, defaulting to `real`. It lives in `Analyzer.tsx` state alongside the other form fields, so the share link can carry it.

The chart, the cliff callout and the survivor-income column all read the same mode. **The axis and every figure must move together** — a chart in nominal beside a callout in real is the same class of defect as a wrong caption.

The chart's caption states which dollars are shown. That sentence goes in `methodologyCopy.ts`.

- [ ] **Step 4: Carry it in the share link**

A `dollars` parameter, `real` or `nominal`. Anything else is **dropped, not clamped**, per the module's standing rule — an unrecognized value leaves the default.

Add to `shareLink.test.ts`: the round trip, and that an unknown value falls back to `real` rather than erroring.

- [ ] **Step 5: The PDF prints real**

Print cannot toggle. It renders **real**, and the methodology note states the nominal figure for the first-death year — the one nominal number clients ask about, preserved in prose.

Say plainly in the note that the charts are in today's dollars. `pdf/HouseholdSection.tsx` already carries a correct COLA sentence from 2b-i; extend it rather than adding a second.

- [ ] **Step 6: Run everything, including e2e, and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

Add one e2e spec: toggling to nominal changes the chart's figures, and toggling back restores them.

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/scenarios.json
```
Expected: empty.

```bash
git add src/lib/ src/components/
SKIP_E2E=1 git commit -m "feat: add a real/nominal dollars toggle, defaulting to real

The engine's periods carry no COLA, so real is its output untouched and
nominal is the transform. Print stays real, with the nominal first-death
figure kept in prose.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Entry order must not change the analysis

**Files:**
- Modify: `src/lib/incomeCliff.ts`, `src/lib/incomeCliff.test.ts`
- Modify: `src/lib/household.ts`, `src/lib/household.test.ts`
- Modify: `src/components/methodologyCopy.ts` if the copy names a person a tie leaves undefined

**Interfaces:**
- Consumes: everything the earlier tasks built
- Produces: no new exports

**Added at the user's request, outside the original spec.** The requirement, in their words: *"Order of entry of people should not matter for the app. I would like not to have to put the older or younger person first or the higher or lower earning person in any kind of order."*

This is a property, and it is testable: analysing `[A, B]` must produce the same analysis as `[B, A]`, modulo the two people's ids and labels.

Two confirmed violations, both of which change what the client reads:

1. **`household.ts:452`** classifies the higher earner with `personA.piaMonthly >= personB.piaMonthly`, while the engine's `classifyEarnerDependent` uses a strict `>` (`benefit-calculator.ts:231`). **On equal PIAs they disagree**, and swapping entry order flips which name is printed as the lower earner. This is the seam recorded at `docs/reference/ssa-tools-engine-audit.md` §6.4.
2. **`incomeCliff.firstDeath`** breaks an exact tie with `finalIndexes[0] <= finalIndexes[1] ? 0 : 1`. Two people sharing a birth month and a plan-to age hit it — a same-age couple both planning to 85 — and swapping the order names the other spouse as survivor.

- [ ] **Step 1: Write the failing property test**

```ts
// append to src/lib/household.test.ts
/**
 * Entry order is a data-entry accident, not a fact about the household. An
 * adviser must not have to put the older, younger, higher- or lower-earning
 * person first.
 */
it('produces the same analysis whichever person is entered first', async () => {
  const forward = await analyzeHousehold(
    { status: 'married', people: [dan, sarah] },
    assumptions,
    asOf,
  );
  const swapped = await analyzeHousehold(
    { status: 'married', people: [{ ...sarah, id: 'a' }, { ...dan, id: 'b' }] },
    assumptions,
    asOf,
  );

  // The optimum is a property of the household, so the same two ages come
  // back — attached to the other slot.
  expect(swapped.optimal.filingAges[0].label).toBe(forward.optimal.filingAges[1].label);
  expect(swapped.optimal.filingAges[1].label).toBe(forward.optimal.filingAges[0].label);
  expect(swapped.optimal.expectedNpv).toBeCloseTo(forward.optimal.expectedNpv, 2);

  // Same money, same years, whichever way round.
  expect(swapped.combinedTimeline.map((p) => p.total)).toEqual(
    forward.combinedTimeline.map((p) => p.total),
  );

  // The spousal top-up accrues to a person, not to a slot.
  expect(swapped.spousalTopUp?.atRecommendedFilingAge).toBe(
    forward.spousalTopUp?.atRecommendedFilingAge,
  );
  expect(swapped.spousalTopUp?.lowerEarnerLabel).toBe(forward.spousalTopUp?.lowerEarnerLabel);
});

it('names the same survivor whichever person is entered first', async () => {
  // Same birth month, same plan-to age: their final months are identical, so
  // the old tie-break picked whoever happened to be entered first.
  const twinA = { ...dan, id: 'a' as const, lifeExpectancy: 85 };
  const twinB = { ...sarah, id: 'b' as const, birthYear: dan.birthYear, birthMonth: dan.birthMonth, lifeExpectancy: 85 };

  const forward = await analyzeHousehold(
    { status: 'married', people: [twinA, twinB] },
    assumptions,
    asOf,
  );
  const swapped = await analyzeHousehold(
    { status: 'married', people: [{ ...twinB, id: 'a' }, { ...twinA, id: 'b' }] },
    assumptions,
    asOf,
  );
  expect(incomeCliff(swapped)).toEqual(incomeCliff(forward));
});
```

Check `household.test.ts`'s existing fixtures before relying on `dan`, `sarah`, `assumptions` and `asOf`. If `dan` and `sarah` have equal PIAs the first test will not exercise the `>=` seam — verify, and if it does not, add a third case with equal PIAs that does.

- [ ] **Step 2: Run to confirm they fail**

Run: `npm run test -- household`
Expected: FAIL on the tie cases.

- [ ] **Step 3: Fix the ties by recognising the concept does not apply**

Do **not** invent a better tie-break. A tie-break picks a winner where there is no winner, and any rule — birth date, name, id — is still arbitrary and still a fact about data entry rather than about the household.

- **`firstDeath` returns `null` on an exact tie.** If both people's final months are identical there is no survivor and no income cliff; the callout should not render. That is more correct than picking one, as well as order-independent.
- **The higher-earner classification uses the engine's `classifyEarnerDependent`** rather than a local `>=`, so `household.ts` and the engine cannot disagree. On an equal-PIA tie the spousal entitlement is already `max(0, PIA/2 − PIA) = 0`, so no amount changes — but the copy must not name a "lower earner" when the two are equal. Check what `spousalSummary` does with a zero entitlement and make sure that path is what runs.

- [ ] **Step 4: Run everything and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/scenarios.json
```
Expected: empty. **A moved fixture means the classification change altered a real household, not just a tie** — stop and report.

```bash
git add src/lib/ src/components/
SKIP_E2E=1 git commit -m "fix: make the analysis independent of which person is entered first

Two ties were broken by entry order — the higher-earner classification on
equal PIAs, and the first death on identical final months. Both now
recognise that a tie means the concept does not apply.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Adviser-facing labels, the name input, and the marker collision

**Added at the user's request after reviewing screenshots.** Three independent items:

1. `personLabel` (`src/lib/format.ts:37-41`) returns `'You'` for index 0. It becomes `'Client'` — *"This is mainly an advisor tool."* Ripples into legends, headers, methodology copy, the PDF and the name input's placeholder. Second-person prose ("your own benefit") is not a person label and must not be substituted mechanically.
2. The "Name (optional)" input (`src/components/PersonFields.tsx:63-72`) is a bare `<input type="text">` with no class while its siblings are styled. Reuse the existing form CSS.
3. The first filing marker's label collides with the y-axis tick labels — "Client files" renders on top of "$40k". Fix consistently across all three markers.

---

### Task 8: The chart shows the annual rate, not the calendar-year sum

**Added at the user's request after reviewing screenshots**, and it reverses a decision made in Task 1.

The user, on seeing the chart taper toward each person's death: *"The chart should not drop down at the end. I think it would be flat at the last death… What if we don't do smooth lines and only straight."*

**Files:**
- Modify: `src/lib/household.ts`, `src/lib/household.test.ts`
- Modify: `src/components/CombinedIncomeChart.tsx` and its test
- Modify: `src/components/pdf/HouseholdSection.tsx` and its test
- Modify: `src/components/methodologyCopy.ts` and its test

**The defect.** `buildCombinedTimeline` computes `monthsInYear(band, year) * band.monthlyAmount`, so a partial filing year or a partial final year yields a partial annual total. The chart renders that as a **slope**, which reads as income rising or falling when in fact the payment is unchanged and the calendar is not. It happens at both ends of every band, and it is why the first death renders as a two-year descent rather than a step.

Task 1 introduced this deliberately, replacing older code that always credited twelve payments. It is arithmetically correct. But the partial values are consumed **only by the two charts** — `incomeCliff` compares full years either side precisely to avoid this artifact, and `survivorIncome` reads a full year — so the precision has never bought anything except the misleading shape.

**The change.** A band contributes its full annual rate (`monthlyAmount * 12`) to every year in which it pays at least one month, and nothing to years it does not. Bands become flat from filing to death, and every transition is a clean step at a year boundary.

The `Area` series change from `type="monotone"` to `type="linear"` — the user asked for straight lines, not curves. If the transitions still read as ramps rather than steps once the values are flat, `stepAfter` is the alternative; report which you used and why.

**What this costs, and it must be disclosed rather than absorbed.** A filing year and a final year now render at full height though only part of each is actually paid. The y-axis stops meaning "money deposited in this calendar year" and starts meaning "income rate once this benefit is running."

`combinedIncomeCaption` currently says *"Each person's segments for the year sum to what they were actually paid — counting only the months actually paid, so a filing year or a final year is shorter than a full one."* **That becomes false.** Rewrite it to say the bands show the annual rate, and that a filing year and a final year pay only part of it. This is the thirteenth chance on this project for a right number to ship beside wrong text; the sentence is the deliverable as much as the shape is.

**Check before assuming:** `incomeCliff`'s `before`/`after` and `survivorIncome` all read full years, whose value is unchanged by this — but verify that rather than trust it, and say so. If `monthsInYear` becomes unused in production, report it; do not delete it as part of this task.

---

## Verification against the spec's success criteria

4. **A band per benefit type, survivor stacked on a continuing personal band** — Task 2 Steps 3 and 5.
5. **A zero-amount band renders no band and no legend entry** — Task 2 Step 1, second test, and Step 3. The reachable case is a `$0.00` spousal band; the spec's amendment records why the survivor case is not.
7. **Dollars toggle defaults to real, travels in the share link, PDF prints real with the nominal first-death figure in prose** — Task 5 Steps 3, 4 and 5.
8. **Survivor income per strategy** — Task 4.
9. **The cliff states before, after and the percentage drop** — Task 3.
10. **Lint, tests, build, e2e** — every task.

Criteria 1, 2, 3 and 6 were delivered by 2b-i.

Task 6 sits outside the spec's criteria — it was added at the user's request during execution.

## Follow-on work identified during execution

Neither belongs in this plan; both need their own spec.

**The earliest-claim comparison row has never rendered, for any household.** `buildComparisons` asks `findStrategyByAges` for an exact `{years: 62, months: 0}`, but SSA requires a full month at 62, so entitlement begins at 62y1m — and the day-1-or-2 exception (SSA deems you attain an age the day before your birthday) is unreachable because `DEFAULT_BIRTH_DAY = 15` fixes every recipient at the 15th. So no ranked strategy ever carries 62y0m and the row is dropped at `household.ts:173`. The table shows at most *FRA*, *Optimal* and *delay to 70* — the client's most common instinct has no row and no "vs. best" delta. Fix: ask each recipient for its own `earliestFilingMonth()` and stop hardcoding "62" in the label. Safe against the pinned golden invariant, since adding a row cannot move the optimum.

**Birth day of month is not collected.** More consequential than the earliest-claim case alone: because SSA attains an age the day before the birthday, someone born on the **1st** attains every age in the previous month, shifting their whole FRA and filing schedule a month earlier. `DEFAULT_BIRTH_DAY = 15` hides that for every user. Adding the field touches the form, the share link and the PDF; keeping 15 as the default is what makes existing fixtures safe.

## Known gaps this plan does not close

- **No golden or e2e scenario reaches the survivor-gap disclosure** — all 21 have `survivorGap === null`, so the note and anything keyed off it stay unexercised end-to-end. A fixture needs hand-derived expected values.
- **Survivor-band amounts are not independently pinned** in `scenarios.json`; only totals and spousal top-ups are. Worth doing early here if a task touches that composition.
- **`tsconfig.app.json` excludes `*.test.ts(x)`**, and the whole `validation/` tree sits outside every tsconfig, so neither is type-checked.
- **The engine starts modelled survivor benefits at ≥62** while the gap disclosure tells the reader SSA can pay from 60. The asymmetry is real and undisclosed; it belongs with Phase 3's widowed filing status.
