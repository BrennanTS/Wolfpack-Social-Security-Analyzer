# About panel and the ssa.tools strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move reference material — the methodology cards, the thirty-year CPI history, and the engine attribution — off the adviser's working surface into an About drawer, and remove twenty repetitions of the engine's brand name from screen and print.

**Architecture:** A new `AboutPanel` drawer mirrors the existing `ResourcesPanel` exactly (closed by default, opened from the header, Escape to close). Its words live in `src/lib/about.ts` as data, following `resources.ts`'s precedent. The strip is a mechanical rename across nine files, held in place afterwards by one test asserting the brand appears nowhere in the analysis surface.

**Tech Stack:** React, TypeScript, Vitest + Testing Library (jsdom project), Playwright, `@react-pdf/renderer`.

## Global Constraints

- **This phase changes no behaviour and no figure.** No analysis differs, no number moves. If `npm run fixtures:gen` produces any diff, STOP and report BLOCKED.
- **Remove the brand, never the information.** A mention standing in for a fact the adviser needs must be replaced by that fact, not deleted. The replacement table in Task 3 is exact — use it verbatim.
- `src/vendor/ssa-tools/` is **READ-ONLY**, including its LICENSE. This phase does not touch it, and the MIT obligation is satisfied there rather than by any UI text.
- **`ssa.tools` survives in exactly two places:** the About panel's engine attribution, and `src/lib/resources.ts`'s two links. Everywhere else in rendered screen or PDF output it goes.
- **Source comments are not rendered output.** Do not strip `ssa.tools` from code comments or docstrings — several explain why the app defers to the engine, and deleting them loses real reasoning. The strip is about what an adviser or client reads.
- Style: single quotes, 2-space indent, 100-col. **No prettier in this repo** — do not run it, it fights the house style. `npm run lint` runs oxlint.
- Run tests with `npx vitest run <path>`. Commit with `SKIP_E2E=1 git commit`. **Never `--no-verify`.**
- **Leave the working tree clean.** Revert every mutation, delete every scratch file.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/about.ts` | **Create.** The About content as data — the orienting paragraph, the five method cards, the engine attribution. |
| `src/components/AboutPanel.tsx` | **Create.** The drawer. Markup only; words come from `about.ts` and `cpiHistory.ts`. |
| `src/components/AboutPanel.test.tsx` | **Create.** |
| `src/components/Analyzer.tsx` | **Modify.** Add the About toggle and panel; remove the "How This Works" block; strip five mentions. |
| `src/components/AssumptionsPanel.tsx` | **Modify.** Remove the CPI history block; strip four mentions. |
| `src/components/HouseholdPanel.tsx`, `src/components/PersonPanel.tsx` | **Modify.** Strip three mentions. |
| `src/components/methodologyCopy.ts` | **Modify.** Four strings shared by screen and print. |
| `src/components/pdf/PersonSection.tsx`, `pdf/HouseholdSection.tsx`, `pdf/ReportDocument.tsx` | **Modify.** Three print mentions. |
| `validation/sweep/copy.sweep.ts` | **Modify.** The regression guard, plus re-pinning whatever moved. |

---

### Task 1: The About content and drawer

**Files:**
- Create: `src/lib/about.ts`, `src/components/AboutPanel.tsx`, `src/components/AboutPanel.test.tsx`

**Interfaces:**
- Consumes: `getCpiLast30Years`, `BLS_CPI_URL` from `../lib/cpiHistory`; `formatPercent` from `../lib/format`; `AppVersion` from `./AppVersion`.
- Produces: `interface AboutCard { title: string; body: string }`, `const ABOUT_INTRO: string`, `const ABOUT_CARDS: AboutCard[]`, `const ENGINE_ATTRIBUTION: { title: string; body: string; href: string; linkText: string }`, and `<AboutPanel open onClose />`.

- [ ] **Step 1: Write the failing test**

Create `src/components/AboutPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AboutPanel } from './AboutPanel';

describe('AboutPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<AboutPanel open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('carries the five method cards', () => {
    render(<AboutPanel open onClose={() => {}} />);
    for (const title of [
      'Full Retirement Age (FRA)',
      'Early claiming (before FRA)',
      'Delayed credits (after FRA)',
      'Life expectancy by gender',
      'Spousal benefits',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('states the calculation engine once, with a link', () => {
    // The single attribution this whole change exists to consolidate.
    render(<AboutPanel open onClose={() => {}} />);
    const link = screen.getByRole('link', { name: /ssa\.tools/i });
    expect(link).toHaveAttribute('href', 'https://ssa.tools/');
    expect(screen.getByText(/MIT/)).toBeInTheDocument();
  });

  it('carries the thirty-year CPI history', () => {
    render(<AboutPanel open onClose={() => {}} />);
    expect(screen.getByText(/BLS CPI-U/)).toBeInTheDocument();
    expect(screen.getByText('30-yr average')).toBeInTheDocument();
  });

  it('closes on the close button and on Escape', async () => {
    const onClose = vi.fn();
    render(<AboutPanel open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();

    onClose.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/AboutPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./AboutPanel"`.

- [ ] **Step 3: Create `src/lib/about.ts`**

The five card bodies are moved **verbatim** from `Analyzer.tsx`'s "How This Works" block — read that block before writing this file and copy the wording exactly, except for the engine card, whose text is replaced below. The percentages and rules in those cards are load-bearing; do not paraphrase them.

```ts
/**
 * What the About panel says.
 *
 * Words as data, following `resources.ts`'s precedent, so the panel is markup
 * and the copy sits in one reviewable place. These are NOT shared with the PDF
 * — `methodologyCopy.ts` is the module for sentences that appear on both
 * surfaces, and nothing here does.
 */

export interface AboutCard {
  title: string;
  body: string;
}

export const ABOUT_INTRO =
  'This tool models Social Security claiming decisions for a household: when each person ' +
  'should file, what they receive, and how household income changes when one spouse dies. ' +
  'It is an estimate for planning conversations, not advice, and not affiliated with the ' +
  'Social Security Administration.';

export const ABOUT_CARDS: AboutCard[] = [
  {
    title: 'Full Retirement Age (FRA)',
    body: "Set by birth year on SSA's published schedule — 66 for those born 1943-1954, " +
      'rising to 67 for 1960 and later.',
  },
  {
    title: 'Early claiming (before FRA)',
    body: 'Benefits are reduced 5/9 of 1% per month for the first 36 months early, then ' +
      '5/12 of 1% per month thereafter.',
  },
  {
    title: 'Delayed credits (after FRA)',
    body: 'Benefits increase 2/3 of 1% per month (8% per year) until age 70.',
  },
  {
    title: 'Life expectancy by gender',
    body: "SSA's 2021 period life table supplies a suggested planning age for each person. " +
      'Adjust it under Planning assumptions — every lifetime total moves with it.',
  },
  {
    title: 'Spousal benefits',
    body: 'Married households are optimized jointly, including the spousal top-up: half the ' +
      "higher earner's amount at full retirement age, less the lower earner's own benefit, " +
      'and payable only once both have filed.',
  },
];

/**
 * The single engine attribution. This is the one place in the app, outside
 * `resources.ts`'s links, where the engine is named — the whole point of
 * consolidating twenty scattered mentions into one accurate statement.
 */
export const ENGINE_ATTRIBUTION = {
  title: 'Calculation engine',
  body:
    'Benefit amounts, full retirement ages, spousal and survivor rules, and the ' +
    'mortality-weighted optimal filing search all come from the open-source ssa.tools ' +
    'calculator, used under the MIT licence. This app supplies the dates, the household ' +
    'model and the presentation; it computes no benefit rule of its own.',
  href: 'https://ssa.tools/',
  linkText: 'ssa.tools',
};
```

- [ ] **Step 4: Create `src/components/AboutPanel.tsx`**

**Read `src/components/ResourcesPanel.tsx` first and mirror it exactly** — the backdrop button, the `<aside>` with `aria-labelledby`, the header with the close button and its inline SVG, the body, the footer, and the `useEffect` that binds Escape while open. A panel that behaves differently from the one beside it reads as a bug.

Reuse the existing `resources-panel` / `resources-header` / `resources-body` / `resources-section` class names rather than inventing parallel ones, so the drawer inherits its styling — add only what is genuinely new. Compose:

- `<p>{ABOUT_INTRO}</p>`
- a section titled `How This Works` listing `ABOUT_CARDS` as `<h4>{title}</h4><p>{body}</p>`
- a section for `ENGINE_ATTRIBUTION` — its body, with the link rendered from `href`/`linkText`
- a section titled `BLS CPI-U — Last 30 Years`, moved verbatim from `AssumptionsPanel.tsx` (the source paragraph, the three `cpi-stat` figures, and the two-column year table). Copy that JSX exactly; it is being relocated, not redesigned.
- a footer carrying `<AppVersion />`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/AboutPanel.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/about.ts src/components/AboutPanel.tsx src/components/AboutPanel.test.tsx
git commit -m "feat: add an About panel"
```

---

### Task 2: Wire it in, and empty the two source blocks

**Files:**
- Modify: `src/components/Analyzer.tsx`, `src/components/AssumptionsPanel.tsx`
- Test: `src/components/Analyzer.test.tsx`, `src/components/AssumptionsPanel.test.tsx`

**Interfaces:**
- Consumes: `<AboutPanel open onClose />` from Task 1.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/Analyzer.test.tsx`:

```tsx
describe('the About panel', () => {
  it('opens from the header and is closed by default', async () => {
    render(<Analyzer darkMode={false} onToggleDarkMode={() => {}} />);
    expect(screen.queryByText(/How This Works/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^about$/i }));
    expect(screen.getByText(/How This Works/i)).toBeInTheDocument();
  });

  it('no longer renders How This Works on the main surface', () => {
    // It moved to About. If this starts passing with the panel CLOSED, the
    // block was left behind rather than moved.
    render(<Analyzer darkMode={false} onToggleDarkMode={() => {}} />);
    expect(screen.queryByText('Full Retirement Age (FRA)')).not.toBeInTheDocument();
  });
});
```

Append to `src/components/AssumptionsPanel.test.tsx`:

```tsx
it('no longer renders the thirty-year CPI history', () => {
  // Moved to the About panel. The COLA slider and its hint stay here; only
  // the reference table left.
  renderPanel();
  expect(screen.queryByText(/BLS CPI-U/)).not.toBeInTheDocument();
  expect(screen.queryByText('30-yr average')).not.toBeInTheDocument();
});
```

> `renderPanel()` is whatever helper that file already uses to render `AssumptionsPanel` with its required props. Read the file and reuse it; do not add a second helper.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Analyzer.test.tsx src/components/AssumptionsPanel.test.tsx`
Expected: FAIL — no About button, and the CPI history still renders.

- [ ] **Step 3: Add the About toggle and panel to `Analyzer.tsx`**

Add `const [aboutOpen, setAboutOpen] = useState(false);` beside `resourcesOpen`.

In `.header-actions`, add a button immediately **before** the existing Resources button, following its markup exactly (`type="button"`, `aria-haspopup="dialog"`, an inline SVG, then the label). Use a distinct icon path — a circled `i` is conventional:

```tsx
<path
  d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 7v4.5M8 4.75v.75"
  stroke="currentColor"
  strokeWidth="1.1"
  strokeLinecap="round"
/>
```

Label it `About`. Render `<AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />` beside the existing `<ResourcesPanel …>`.

- [ ] **Step 4: Move the four static cards out, and KEEP the spousal card**

> **Changed during implementation — read this carefully, it is not what the plan originally said.**

Remove from `Analyzer.tsx`'s `<div className="methodology">` block only the **four static cards**: FRA, early claiming, delayed credits, and life expectancy by gender. Their wording now lives in `about.ts`.

**The spousal card stays on the main surface.** It is not reference material: it renders `spousalMethodologyCopy(analysis)`, which states *this household's* actual top-up, when it begins, and how survivor benefits are modelled for it. `HouseholdPanel` carries no spousal prose and `spousalSummary` is print-only, so this card is the only place on screen an adviser sees that explained. Deleting it would silently remove per-household information.

Keep the surrounding `<div className="methodology">` wrapper, its heading and its `.method-grid` so the remaining card renders in the same place it does today. If a single-card grid looks wrong, adjust the CSS — do not delete the card.

**Also remove the now-redundant static spousal entry from `ABOUT_CARDS` in `src/lib/about.ts`**, added by Task 1 when the plan still called for five. It would duplicate the sentence `spousalMethodologyCopy` already opens with. Update `AboutPanel.test.tsx`'s card-title assertion to the four remaining titles.

`spousalMethodologyCopy` keeps both its callers — the screen card and the PDF. Do not delete or alter the function.

- [ ] **Step 5: Delete the CPI history block from `AssumptionsPanel.tsx`**

Remove the entire `<div className="cpi-history">` block — heading, source paragraph, `.cpi-stats`, the table, and the trailing `cpi-active-note` about the 30-year average. Remove now-unused imports (`getCpiLast30Years`, `BLS_CPI_URL`, and the `cpi` local) — the compiler will name them.

**Keep** the COLA slider, its hint, and the separate `cpi-active-note` at line ~83 about the discount rate — those describe live controls, not reference material.

- [ ] **Step 6: Run the tests and the full suite**

Run: `npx vitest run && npx tsc -b && npm run lint`
Expected: PASS and clean. Some existing tests may assert the moved content on its old surface — update those to look in About, and say which you changed in your report.

- [ ] **Step 7: Commit**

```bash
git add src/components/Analyzer.tsx src/components/Analyzer.test.tsx src/components/AssumptionsPanel.tsx src/components/AssumptionsPanel.test.tsx
git commit -m "feat: move How This Works and the CPI history into About"
```

---

### Task 3: Strip the screen mentions

**Files:**
- Modify: `src/components/Analyzer.tsx`, `src/components/AssumptionsPanel.tsx`, `src/components/HouseholdPanel.tsx`, `src/components/PersonPanel.tsx`

**Interfaces:** none — this task changes only rendered strings.

- [ ] **Step 1: Apply the replacement table exactly**

Every replacement below is verbatim. **Remove the brand, never the information** — the two entries that gain words are doing so because the brand was standing in front of a fact.

| File | Now | Becomes |
|---|---|---|
| `Analyzer.tsx` (marital hint) | `Married uses the ssa.tools couple optimizer. Widowed models the survivor benefit and your own, claimed on separate dates.` | `Married optimizes both filing dates jointly. Widowed models the survivor benefit and your own, claimed on separate dates.` |
| `Analyzer.tsx` (summary) | `, married (ssa.tools couple)` | `, married` |
| `Analyzer.tsx` (summary) | `benefits via <strong>ssa.tools</strong> engine.` | *(delete the clause and the preceding separator; the sentence already names the claimant and status)* |
| `Analyzer.tsx` (loading) | `Running ssa.tools analysis…` | `Running analysis…` |
| `AssumptionsPanel.tsx` | `Discount rate (ssa.tools) — ` | `Discount rate — ` |
| `AssumptionsPanel.tsx` | `Used for mortality-weighted optimal filing (ssa.tools expected NPV). Default 2.5%` | `Used for mortality-weighted optimal filing (expected present value). Default 2.5%` |
| `AssumptionsPanel.tsx` | `Using ssa.tools default discount rate.` | `Using the default discount rate.` |
| `AssumptionsPanel.tsx` | `Benefit math uses SSA historical COLA tables (ssa.tools). This rate applies to` | `Benefit math uses SSA historical COLA tables. This rate applies to` |
| `HouseholdPanel.tsx` | `Household — Recommended Strategy (ssa.tools)` | `Household — Recommended Strategy` |
| `PersonPanel.tsx` | `{label} — Recommended Strategy (ssa.tools)` | `{label} — Recommended Strategy` |
| `PersonPanel.tsx` | `Monthly benefit (ssa.tools) and lifetime total to age {lifeExpectancy} at 0% discount.` | `Monthly benefit and lifetime total to age {lifeExpectancy} at 0% discount.` |

For the third row, read the surrounding sentence in `Analyzer.tsx` before cutting — remove the clause cleanly rather than leaving a dangling separator or a double space. A stray `·` or `  ` is exactly the kind of defect this project keeps shipping.

- [ ] **Step 2: Update any test that pinned an old string**

Run `npx vitest run` and fix the assertions that named the old text. **Update them to the new string; do not loosen them to a regex** — pinned copy is how this project holds copy in place.

- [ ] **Step 3: Verify no double spaces or dangling separators were introduced**

```bash
grep -rnE "\S  +\S|· *<|,  |\( *\)" src/components/Analyzer.tsx src/components/AssumptionsPanel.tsx src/components/HouseholdPanel.tsx src/components/PersonPanel.tsx
```
Expected: no output.

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npx tsc -b && npm run lint && npm run build`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add src/components
git commit -m "refactor: drop the engine's brand name from the screen"
```

---

### Task 4: Strip the shared and print mentions

**Files:**
- Modify: `src/components/methodologyCopy.ts`, `src/components/pdf/PersonSection.tsx`, `src/components/pdf/HouseholdSection.tsx`, `src/components/pdf/ReportDocument.tsx`
- Test: `src/components/methodologyCopy.test.ts`, `src/components/pdf/*.test.tsx`, `validation/sweep/copy.sweep.ts`

**Interfaces:** none — rendered strings only.

- [ ] **Step 1: Apply the replacement table exactly**

`methodologyCopy.ts`'s strings render on **both** surfaces, so these four edits serve screen and print at once.

| File | Now | Becomes |
|---|---|---|
| `methodologyCopy.ts` (`coupleModelingNote`) | `The spousal top-up is modeled via the ssa.tools couple optimizer; the survivor` | `The spousal top-up is modeled via the couple optimizer; the survivor` |
| `methodologyCopy.ts` (`coupleModelingNote`) | `The spousal top-up and survivor benefits are both modeled via the ssa.tools couple` | `The spousal top-up and survivor benefits are both modeled via the couple` |
| `methodologyCopy.ts` (`spousalMethodologyCopy`) | `Married households are optimized jointly by ssa.tools, including the spousal top-up.` | `Married households are optimized jointly, including the spousal top-up.` |
| `methodologyCopy.ts` (~line 772) | `The ssa.tools engine does not model survivor benefits in this household's` | `The engine does not model survivor benefits in this household's` |
| `pdf/PersonSection.tsx` | `Recommended Strategy (ssa.tools)` | `Recommended Strategy` |
| `pdf/HouseholdSection.tsx` | `Household — Recommended Strategy (ssa.tools)` | `Household — Recommended Strategy` |
| `pdf/ReportDocument.tsx` | `Prepared by {BRAND_NAME} using the open-source ssa.tools engine for educational planning only.` | `Prepared by {BRAND_NAME} for educational planning only.` |
| `src/lib/household.ts:887` | `The ssa.tools couple optimizer maximizes combined expected present value at ` | `The couple optimizer maximizes combined expected present value at ` |
| `src/lib/household.ts:1244` | `ssa.tools recommends filing at age {label} ` | `The optimizer recommends filing at age {label} ` |

> **`src/lib/household.ts` was missing from this plan's original file list — a defect found during Task 3's review.** Those two strings build `recommendationDetail`, which renders on **both** surfaces: `HouseholdPanel.tsx:163` on screen and `pdf/HouseholdSection.tsx:249` in print. They are among the most prominent sentences in the app. `src/lib/household.test.ts:1284` pins the old wording and must be re-pinned to the new.

> The PDF losing its attribution is the user's explicit decision, against the recommendation to keep it — see the spec's "Decisions worth recording". Implement it as specified.

- [ ] **Step 2: Re-pin the moved strings**

Run `npx vitest run` and update every assertion that named the old text — in `methodologyCopy.test.ts`, the PDF test files, and `validation/sweep/copy.sweep.ts`. **Update to the new string; do not loosen to a regex.**

- [ ] **Step 3: Confirm the sweep's screen-vs-print invariant still holds**

Run: `npm run sweep`
Expected: PASS, including `screen vs print`. That invariant asserts both surfaces render byte-identical sentences from the shared module — **if it fails, a string was changed on one surface and not the other**, which is precisely what it exists to catch. Fix the code, not the test.

- [ ] **Step 4: Confirm no fixture moved**

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/
```
Expected: no diff. **If any fixture value changed, STOP and report BLOCKED** — this phase changes no figure.

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npx tsc -b && npm run lint && npm run build && PW_PORT=4199 npm run test:e2e`

- [ ] **Step 6: Commit**

```bash
git add src/components validation/sweep
git commit -m "refactor: drop the engine's brand name from the printed report"
```

---

### Task 5: The regression guard

**Files:**
- Modify: `validation/sweep/copy.sweep.ts`
- Test: the same file

**Interfaces:**
- Consumes: `screenSurface`, `pdfSurface` from `validation/sweep/surfaces.ts`.

- [ ] **Step 0: Extend `surfaces.ts` to cover the recommendation sentences**

> **Added after Task 3's review found the gap.** `surfaces.ts` models `methodologyCopy`'s output but **not** `analysis.recommendation` or `analysis.recommendationDetail` — two of the most prominent sentences in the app, rendered on screen at `HouseholdPanel.tsx:161-163` and in print at `pdf/HouseholdSection.tsx:248-249`. Without this step the guard below would pass while `household.ts`'s mentions remained, reporting success over a surface it never looked at.

Add both to `screenSurface` and to `pdfSurface`, sourced from the analysis:

```ts
  push(lines, 'HouseholdPanel.recommendation', analysis.recommendation);
  push(lines, 'HouseholdPanel.recommendationDetail', analysis.recommendationDetail);
```

and the print equivalents keyed `pdf/HouseholdSection.recommendation` / `…recommendationDetail`.

This widens the sweep's existing sentinel, duplicate-sentence and screen-vs-print checks to cover them too — a genuine improvement independent of this cleanup. **Run `npm run sweep` immediately after and before writing the new test:** if any pre-existing invariant now fails on these sentences, that is a real finding about copy this project has never checked. Report it rather than suppressing it.

- [ ] **Step 1: Write the failing test**

Add to `validation/sweep/copy.sweep.ts`, inside the `describe('rendered copy', …)` block:

```ts
  it(`names no calculation engine on the analysis surface across ${COUNT} households`, async () => {
    // One assertion holding a twenty-site cleanup in place. The engine is
    // named once, in the About panel, and linked twice from Resources — both
    // outside the analysis surface these two builders cover. A parenthetical
    // creeping back onto a heading is the realistic regression, and asserting
    // each of the twenty sites individually would not catch a twenty-first.
    const findings: Finding[] = [];

    for (let index = 0; index < COUNT; index++) {
      const { household, label } = householdAt(index);
      const analysis = await analyze(household);

      for (const mode of MODES) {
        for (const line of [...screenSurface(analysis, mode), ...pdfSurface(analysis)]) {
          if (/ssa\.tools/i.test(line.text)) {
            findings.push({ index, label, detail: `[${mode}] ${line.source}: "${line.text}"` });
          }
        }
      }
    }

    console.log(summarize('engine brand on the analysis surface', findings));
    expect(findings).toEqual([]);
  });
```

- [ ] **Step 2: Run it**

Run: `SWEEP_COUNT=200 npx vitest run --config vitest.sweep.config.ts validation/sweep/copy.sweep.ts`
Expected: PASS — Tasks 3 and 4 already removed the mentions this guards.

- [ ] **Step 3: Prove the guard can fail**

Temporarily restore one mention — put `(ssa.tools)` back into `coupleModelingNote` in `methodologyCopy.ts` — and re-run. The new test MUST fail and name that source. Restore afterwards.

A guard that cannot fail is worse than no guard: it reports success over an unchecked surface. Every task on this project's recent branches has had at least one such test found by mutation, so verify rather than assume.

- [ ] **Step 4: Run the full sweep and suite**

Run: `npm run sweep && npx vitest run && npm run lint && npx tsc -b`

- [ ] **Step 5: Commit**

```bash
git add validation/sweep/copy.sweep.ts
git commit -m "test: hold the engine-brand strip in place"
```

---

## Self-review

**Spec coverage.** About drawer mirroring Resources → Task 1. The five method cards, engine attribution, CPI history, version → Task 1. Wiring and emptying the two source blocks → Task 2. The screen strip → Task 3. The shared and print strip → Task 4. The regression guard with both exemptions → Task 5. "No fixture moves" → Task 4 Step 4. Sweep re-pinning → Task 4 Step 2.

**Not covered, by design:** the half-applied adviser-tone rename, the three parked invariant-sweep findings, and anything about widowed rendering — all listed in the spec's Out of scope.

**A risk worth naming.** Task 2 deletes the "How This Works" block whose spousal card called `spousalMethodologyCopy`, a function the PDF also uses. The step says to check for other callers and leave the function alone either way. If an implementer instead deletes the function, the PDF loses a section and the sweep's screen-vs-print invariant will not catch it — that invariant compares sentences both surfaces render, and a sentence removed from both stays consistent. Task 4's re-pinning step is what would surface it, via a failing PDF test.
