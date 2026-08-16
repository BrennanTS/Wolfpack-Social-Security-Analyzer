# Shareable URL Parameters and Benefit-Entry Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an adviser copy a link that reproduces an analysis on another machine without carrying client names, and stop a yearly benefit figure being entered where a monthly one belongs.

**Architecture:** One pure module, `src/lib/shareLink.ts`, encodes and decodes the form state against a single shared table of field bounds. The bounds table also feeds the form's own validation and the assumption sliders, so the link parser and the UI can never disagree about what is valid. Everything arriving from a URL is untrusted: an out-of-range value is dropped, never clamped.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-shareable-url-params-design.md`

## Global Constraints

- **Never modify `src/vendor/ssa-tools/`.** Vendored MIT upstream.
- **No new dependencies.** The Clipboard API and `URLSearchParams` are built in.
- **Names are never encoded into a URL, under any circumstance.**
- **Invalid URL parameters are dropped, not clamped.** An out-of-range value leaves its field blank so the form visibly asks for it. Never substitute a plausible number.
- **Benefit range is 0–5,000 for both people.** `MIN_BENEFIT_BY_INDEX` goes away; a single `MIN_BENEFIT = 0` replaces it.
- **The completeness gate is "at least one person has a positive benefit"** — not "person A does".
- Slider bounds, copied verbatim from `AssumptionsPanel.tsx`: life expectancy `75–100`, COLA `0–8` step `0.1`, discount rate `0–6` step `0.1`.
- **Units differ between the two rate fields, and the mismatch is silent.** `annualCola` is stored as a percent (`2.5` = 2.5%). `discountRate` is stored as a **fraction** (`0.025` = 2.5%) — its slider converts on both sides. Validating a raw `discountRate` against a `0–6` bound would accept `5`, a 500% rate.
- `npm run lint` (oxlint) must pass with zero warnings.
- **Every task ends green:** `npm run lint`, `npm run test` and `npm run build` must all pass before each commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch: `feat/share-links`.
- **Local e2e runs use `PW_PORT=4199`** — port 4173 is occupied by unrelated software. The pre-commit hook runs e2e on the default port and will fail; use `SKIP_E2E=1 git commit ...`, never `--no-verify`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/formBounds.ts` | **Create.** Single source of truth for every field's valid range |
| `src/lib/shareLink.ts` | **Create.** `toShareParams` / `fromShareParams`, pure |
| `src/lib/benefitEntry.ts` | **Create.** Yearly-figure detection |
| `src/lib/formState.ts` | **Modify.** Range change, new completeness gate |
| `src/components/PersonFields.tsx` | **Modify.** Monthly label, yearly nudge, `maxLength` fix |
| `src/components/CopyLinkButton.tsx` | **Create.** Header control + clipboard fallback |
| `src/components/Analyzer.tsx` | **Modify.** Hydrate on mount, strip query, render the button |
| `index.html` | **Modify.** Referrer meta tag |

**Dependency direction:** `formBounds` depends on nothing. `shareLink` and `benefitEntry` depend on `formBounds` (and `shareLink` on `formState` for its types). Components depend on all three. Nothing depends back upward.

**A trap to avoid.** `PersonFields.tsx` currently sets `maxLength={String(MAX_BENEFIT).length}` — four digits. That would make typing `36000` impossible, so the yearly detector could never fire. Task 4 raises it. Do not leave it at four.

---

### Task 1: Shared field bounds

**Files:**
- Create: `src/lib/formBounds.ts`
- Create: `src/lib/formBounds.test.ts`
- Modify: `src/lib/formState.ts`
- Modify: `src/components/PersonFields.tsx`
- Modify: `src/components/AssumptionsPanel.tsx`

**Interfaces:**
- Consumes: nothing
- Produces:

```ts
export const MIN_BENEFIT = 0;
export const MAX_BENEFIT = 5000;
export const LIFE_EXPECTANCY_BOUNDS = { min: 75, max: 100 } as const;
export const COLA_BOUNDS = { min: 0, max: 8, step: 0.1 } as const;
export const DISCOUNT_BOUNDS_PERCENT = { min: 0, max: 6, step: 0.1 } as const;
export function isBenefitInRange(benefit: number): boolean;
export function isInBounds(value: number, bounds: { min: number; max: number }): boolean;
/** Takes the stored fraction (0.025), not the slider's percent. */
export function isDiscountRateInBounds(fraction: number): boolean;
```

`isBenefitInRange` **loses its `index` parameter** — both people now share one range.

**Watch the units.** `annualCola` is stored as a percent (2.5 = 2.5%) and its slider binds directly. `discountRate` is stored as a **fraction** (0.025 = 2.5%) and its slider converts on both sides. That asymmetry already exists in the codebase; this task makes it explicit rather than repeating it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/formBounds.test.ts
import { describe, expect, it } from 'vitest';
import {
  COLA_BOUNDS,
  DISCOUNT_BOUNDS_PERCENT,
  isBenefitInRange,
  isDiscountRateInBounds,
  isInBounds,
  LIFE_EXPECTANCY_BOUNDS,
  MAX_BENEFIT,
  MIN_BENEFIT,
} from './formBounds';

describe('benefit range', () => {
  it('spans $0 to $5,000 for either person', () => {
    expect([MIN_BENEFIT, MAX_BENEFIT]).toEqual([0, 5000]);
  });

  it('accepts a zero benefit — a person with no work record of their own', () => {
    expect(isBenefitInRange(0)).toBe(true);
  });

  it('accepts a genuine low-earner PIA that the old $500 floor rejected', () => {
    expect(isBenefitInRange(250)).toBe(true);
  });

  it('rejects a negative benefit and one above the ceiling', () => {
    expect(isBenefitInRange(-1)).toBe(false);
    expect(isBenefitInRange(5001)).toBe(false);
  });

  it('accepts both endpoints', () => {
    expect(isBenefitInRange(0)).toBe(true);
    expect(isBenefitInRange(5000)).toBe(true);
  });
});

describe('assumption bounds match the sliders in AssumptionsPanel', () => {
  // These are asserted rather than merely exported so that changing a slider
  // without changing the shared bound (or vice versa) fails here instead of
  // silently letting a URL carry a value the slider cannot represent.
  it('pins life expectancy to 75-100', () => {
    expect(LIFE_EXPECTANCY_BOUNDS).toEqual({ min: 75, max: 100 });
  });

  it('pins COLA to 0-8 and the discount rate to 0-6 percent', () => {
    expect(COLA_BOUNDS.min).toBe(0);
    expect(COLA_BOUNDS.max).toBe(8);
    expect(DISCOUNT_BOUNDS_PERCENT.min).toBe(0);
    expect(DISCOUNT_BOUNDS_PERCENT.max).toBe(6);
  });
});

describe('isDiscountRateInBounds takes a fraction, not a percent', () => {
  it('accepts the default 0.025, which is 2.5%', () => {
    expect(isDiscountRateInBounds(0.025)).toBe(true);
  });

  it('accepts both endpoints as fractions', () => {
    expect(isDiscountRateInBounds(0)).toBe(true);
    expect(isDiscountRateInBounds(0.06)).toBe(true);
  });

  // The trap: 5 as a fraction is 500%. A bound compared against the raw
  // fraction would wave this through, because 5 sits inside 0-6.
  it('rejects a percent-shaped value passed as a fraction', () => {
    expect(isDiscountRateInBounds(5)).toBe(false);
    expect(isDiscountRateInBounds(2.5)).toBe(false);
  });
});

describe('isInBounds', () => {
  it('is inclusive at both ends', () => {
    expect(isInBounds(75, LIFE_EXPECTANCY_BOUNDS)).toBe(true);
    expect(isInBounds(100, LIFE_EXPECTANCY_BOUNDS)).toBe(true);
    expect(isInBounds(74, LIFE_EXPECTANCY_BOUNDS)).toBe(false);
    expect(isInBounds(101, LIFE_EXPECTANCY_BOUNDS)).toBe(false);
  });

  it('rejects NaN rather than treating it as in range', () => {
    expect(isInBounds(Number.NaN, LIFE_EXPECTANCY_BOUNDS)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- formBounds`
Expected: FAIL — `Cannot find module './formBounds'`.

- [ ] **Step 3: Create the module**

```ts
// src/lib/formBounds.ts
/**
 * Every field's valid range, in one place.
 *
 * The URL parser, the form's own validation and the assumption sliders all
 * read from here. Duplicating a bound is how a link ends up carrying a value
 * a slider cannot represent, or a field marking something invalid that the
 * submission gate happily accepts — both of which this app has had before.
 *
 * Both people share the benefit range. The primary person used to have a $500
 * floor, which caught values that were too *low* while the realistic
 * data-entry error (typing a yearly figure) makes the number too *high*. It
 * blocked nothing real and rejected genuine low-earner PIAs.
 *
 * $5,000 is a tripwire, not a wall: it sits above the maximum PIA attainable
 * at full retirement age today, and SSA's maximum rises each year. When this
 * needs raising, `formBounds.test.ts` is where it is written down.
 */

export const MIN_BENEFIT = 0;
export const MAX_BENEFIT = 5000;

export const LIFE_EXPECTANCY_BOUNDS = { min: 75, max: 100 } as const;

/**
 * UNITS — these two differ, and getting it wrong is silent.
 *
 * `annualCola` is stored as a percent (2.5 means 2.5%), and its slider binds
 * to it directly.
 *
 * `discountRate` is stored as a FRACTION (0.025 means 2.5%). Its slider works
 * in percent and converts on both sides: `value={discountRate * 100}` and
 * `onChange={... / 100}` in AssumptionsPanel.
 *
 * DISCOUNT_BOUNDS_PERCENT is therefore expressed in PERCENT, to match the slider.
 * Anything validating `form.discountRate` against it must multiply by 100
 * first — comparing the raw fraction would accept 5.0, i.e. a 500% rate.
 */
export const COLA_BOUNDS = { min: 0, max: 8, step: 0.1 } as const;
export const DISCOUNT_BOUNDS_PERCENT = { min: 0, max: 6, step: 0.1 } as const;

export function isInBounds(value: number, bounds: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}

export function isBenefitInRange(benefit: number): boolean {
  return isInBounds(benefit, { min: MIN_BENEFIT, max: MAX_BENEFIT });
}

/** Takes the stored fraction (0.025), not the slider's percent. */
export function isDiscountRateInBounds(fraction: number): boolean {
  return isInBounds(fraction * 100, DISCOUNT_BOUNDS_PERCENT);
}
```

The name `DISCOUNT_BOUNDS_PERCENT` carries the unit deliberately. A bare
`DISCOUNT_BOUNDS` sitting next to a fraction-valued field is exactly how this
gets misused.

- [ ] **Step 4: Repoint the existing consumers**

In `src/lib/formState.ts`, delete `MAX_BENEFIT`, `MIN_BENEFIT_BY_INDEX` and the local `isBenefitInRange`, and re-export from the new module so existing importers keep working:

```ts
export { isBenefitInRange, MAX_BENEFIT, MIN_BENEFIT } from './formBounds';
```

In `src/components/PersonFields.tsx`, replace `MIN_BENEFIT_BY_INDEX[index]` with `MIN_BENEFIT` and drop the `index` argument from `isBenefitInRange(...)`.

In `src/components/AssumptionsPanel.tsx`, replace the three sliders' literal `min`/`max`/`step` with the bounds constants (`#life` → `LIFE_EXPECTANCY_BOUNDS`, `#cola` → `COLA_BOUNDS`, `#discount` → `DISCOUNT_BOUNDS_PERCENT`). Behavior must not change; only the source of the numbers does.

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run test && npm run build`
Expected: PASS. The hint text in `PersonFields` now reads `$0–$5,000` for both people — that is intended.

- [ ] **Step 6: Commit**

```bash
git add src/lib/formBounds.ts src/lib/formBounds.test.ts src/lib/formState.ts src/components/PersonFields.tsx src/components/AssumptionsPanel.tsx
git commit -m "refactor: put every field bound in one shared module

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The completeness gate becomes "at least one person earns"

**Files:**
- Modify: `src/lib/formState.ts`
- Modify: `src/lib/formState.test.ts`

**Interfaces:**
- Consumes: Task 1's `isBenefitInRange(benefit)`
- Produces: `isFormComplete` unchanged in signature; changed in rule

**Why:** a zero-benefit person A is legitimate — it is the mirror of the spouse-with-no-work-record case the app already supports. Someone with no earnings record married to an earner receives a spousal benefit. Only the all-zero household has nothing to analyze.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/formState.test.ts
describe('at least one person must have a positive benefit', () => {
  const earner = {
    name: '', birthYear: 1962, birthMonth: 4,
    gender: 'male' as const, monthlyBenefit: 2400,
  };
  const noRecord = {
    name: '', birthYear: 1964, birthMonth: 2,
    gender: 'female' as const, monthlyBenefit: 0,
  };
  const base = { ...BLANK_FORM, lifeExpectancy: 85 };

  it('accepts a married household where person A has no work record', () => {
    expect(
      isFormComplete({ ...base, hasSpouse: true, personA: noRecord, personB: earner }),
    ).toBe(true);
  });

  it('accepts a married household where person B has no work record', () => {
    expect(
      isFormComplete({ ...base, hasSpouse: true, personA: earner, personB: noRecord }),
    ).toBe(true);
  });

  it('rejects a household where neither person earns', () => {
    expect(
      isFormComplete({
        ...base, hasSpouse: true,
        personA: noRecord, personB: { ...noRecord, birthYear: 1966 },
      }),
    ).toBe(false);
  });

  it('rejects a single claimant with no benefit — nothing to analyze', () => {
    expect(isFormComplete({ ...base, hasSpouse: false, personA: noRecord })).toBe(false);
  });

  it('accepts a genuine low-earner PIA the old $500 floor rejected', () => {
    expect(
      isFormComplete({
        ...base, hasSpouse: false,
        personA: { ...earner, monthlyBenefit: 250 },
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- formState`
Expected: FAIL — the first case returns `false`, because the current rule requires person A's benefit to be in range *and* the old range floor was 500; after Task 1 it fails on the "at least one earns" cases only.

- [ ] **Step 3: Change the rule**

```ts
// src/lib/formState.ts
/** Identity present and the benefit within range. Zero is a valid benefit. */
function isPersonComplete(p: PersonFormFields): boolean {
  if (p.birthYear === '' || p.birthMonth === '' || p.gender === null) return false;
  if (p.monthlyBenefit === '') return false;
  return isBenefitInRange(p.monthlyBenefit);
}

export function isFormComplete(form: AnalyzerFormState): boolean {
  if (form.hasSpouse === null || form.lifeExpectancy === null) return false;
  if (!isPersonComplete(form.personA)) return false;
  // Married analyses require real spouse data — never defaulted from person A.
  if (form.hasSpouse && !isPersonComplete(form.personB)) return false;

  // A person with no work record of their own is legitimate — they may draw a
  // spousal benefit on their partner's record. A household where *nobody*
  // earns has nothing to analyze.
  const benefits = form.hasSpouse
    ? [form.personA.monthlyBenefit, form.personB.monthlyBenefit]
    : [form.personA.monthlyBenefit];
  return benefits.some((b) => b !== '' && b > 0);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/formState.ts src/lib/formState.test.ts
git commit -m "fix: require at least one earner rather than a positive person A

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Yearly-figure detection

**Files:**
- Create: `src/lib/benefitEntry.ts`
- Create: `src/lib/benefitEntry.test.ts`

**Interfaces:**
- Consumes: Task 1's `isBenefitInRange`, `MAX_BENEFIT`
- Produces:

```ts
export interface YearlySuspicion { entered: number; monthly: number }
/** Non-null only when `entered` is implausible monthly AND entered/12 is plausible. */
export function detectYearlyEntry(entered: number): YearlySuspicion | null;
```

**Why this shape:** the mistake has a precise signature. Testing magnitude alone ("over $5,000") would also flag a mistyped `50000` that divides to an implausible `4166.67`… which is in fact plausible, so that one *is* caught — but it would equally flag `999999`, where `83333` is not plausible and no useful suggestion exists. Only offer a conversion when the conversion is itself sensible.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/benefitEntry.test.ts
import { describe, expect, it } from 'vitest';
import { detectYearlyEntry } from './benefitEntry';

describe('detectYearlyEntry', () => {
  it('flags a plain yearly figure and suggests the monthly equivalent', () => {
    expect(detectYearlyEntry(36_000)).toEqual({ entered: 36_000, monthly: 3000 });
  });

  it('flags a yearly figure that divides to a non-round monthly amount', () => {
    // 30,000 / 12 = 2,500 exactly; 31,000 / 12 = 2,583.33 -> rounded to the cent.
    expect(detectYearlyEntry(31_000)?.monthly).toBeCloseTo(2583.33, 2);
  });

  it('says nothing about a plausible monthly benefit', () => {
    expect(detectYearlyEntry(3000)).toBeNull();
    expect(detectYearlyEntry(4800)).toBeNull();
    expect(detectYearlyEntry(5000)).toBeNull();
  });

  it('says nothing about zero', () => {
    expect(detectYearlyEntry(0)).toBeNull();
  });

  it('says nothing when the monthly equivalent is also implausible', () => {
    // 999,999 / 12 = 83,333 — still far above the ceiling, so there is no
    // useful suggestion to offer. Out of range, but not a yearly-entry error.
    expect(detectYearlyEntry(999_999)).toBeNull();
  });

  it('says nothing when the monthly equivalent would be zero-ish', () => {
    // 5,001 is barely over the ceiling; 5,001/12 = 416.75 is plausible, so this
    // IS flagged. Documented deliberately: a near-ceiling typo is rare, and a
    // dismissible suggestion costs the user nothing.
    expect(detectYearlyEntry(5001)).not.toBeNull();
  });

  it('ignores non-finite input', () => {
    expect(detectYearlyEntry(Number.NaN)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- benefitEntry`
Expected: FAIL — `Cannot find module './benefitEntry'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/benefitEntry.ts
import { isBenefitInRange } from './formBounds';

export interface YearlySuspicion {
  /** What the user typed. */
  entered: number;
  /** The monthly equivalent to offer them, rounded to the cent. */
  monthly: number;
}

/**
 * Detects a yearly benefit typed into a monthly field.
 *
 * The signature of that mistake is specific: the entered value is implausible
 * as a monthly benefit, *and* dividing it by twelve produces one that is
 * plausible. Flagging on magnitude alone would fire on values where no useful
 * suggestion exists (999,999 divides to 83,333, still nonsense), and the whole
 * point is to offer a fix rather than just complain.
 *
 * Returns null when there is nothing helpful to say. Callers must treat this
 * as a suggestion, never a block — SSA's maximum benefit rises every year, so
 * a hard ceiling would eventually reject a legitimate high earner.
 */
export function detectYearlyEntry(entered: number): YearlySuspicion | null {
  if (!Number.isFinite(entered) || entered <= 0) return null;
  if (isBenefitInRange(entered)) return null;

  const monthly = Math.round((entered / 12) * 100) / 100;
  if (!isBenefitInRange(monthly) || monthly <= 0) return null;

  return { entered, monthly };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/benefitEntry.ts src/lib/benefitEntry.test.ts
git commit -m "feat: detect a yearly benefit typed into the monthly field

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the nudge and the monthly label into the form

**Files:**
- Modify: `src/components/PersonFields.tsx`
- Modify: `src/components/PersonFields.test.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Task 3's `detectYearlyEntry`
- Produces: no new exports; `PersonFields` gains the nudge UI

**Three changes, and the third is easy to miss:**
1. The label becomes **"Monthly benefit at full retirement age"** — prevention first, since the current label never says monthly and that is the root cause.
2. The nudge renders when `detectYearlyEntry` returns non-null, with a button applying the conversion.
3. **`maxLength` must be raised.** It is currently `String(MAX_BENEFIT).length` — four digits — which makes typing `36000` impossible and the detector unreachable. Set it to `7` (enough for a seven-figure typo to be caught and refused, without allowing unbounded paste).

- [ ] **Step 1: Write the failing test**

```tsx
// append to src/components/PersonFields.test.tsx
describe('yearly-entry nudge', () => {
  const blank = {
    name: '', birthYear: '' as const, birthMonth: '' as const,
    gender: null, monthlyBenefit: '' as const,
  };

  it('says the benefit is monthly, in the label', () => {
    render(<PersonFields person={blank} index={0} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/monthly benefit at full retirement age/i)).toBeDefined();
  });

  it('accepts more than four digits, so a yearly figure can be typed at all', async () => {
    const onChange = vi.fn();
    render(<PersonFields person={blank} index={0} onChange={onChange} />);
    await userEvent.type(
      screen.getByLabelText(/monthly benefit at full retirement age/i),
      '36000',
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthlyBenefit: 36000 }),
    );
  });

  it('offers the monthly equivalent when a yearly figure is entered', () => {
    render(
      <PersonFields person={{ ...blank, monthlyBenefit: 36000 }} index={0} onChange={vi.fn()} />,
    );
    const nudge = screen.getByTestId('yearly-entry-nudge');
    expect(nudge.textContent).toMatch(/36,000/);
    expect(nudge.textContent).toMatch(/3,000/);
  });

  it('applies the conversion when the suggestion is accepted', async () => {
    const onChange = vi.fn();
    render(
      <PersonFields person={{ ...blank, monthlyBenefit: 36000 }} index={0} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /use \$3,000/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthlyBenefit: 3000 }),
    );
  });

  it('stays quiet for a plausible monthly benefit', () => {
    render(
      <PersonFields person={{ ...blank, monthlyBenefit: 4800 }} index={0} onChange={vi.fn()} />,
    );
    expect(screen.queryByTestId('yearly-entry-nudge')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- PersonFields`
Expected: FAIL — the label does not say "monthly", and there is no `yearly-entry-nudge`.

- [ ] **Step 3: Implement**

In `src/components/PersonFields.tsx`:

```tsx
import { detectYearlyEntry } from '../lib/benefitEntry';
import { formatCurrency } from '../lib/format';

// inside the component, next to `benefitOutOfRange`:
const yearlySuspicion =
  benefitText === '' ? null : detectYearlyEntry(Number(benefitText));
```

Change the label text to `Monthly benefit at full retirement age`, change `maxLength` to `7` (updating its comment — it is a paste guard, not a ceiling), and render the nudge directly beneath the input:

```tsx
{yearlySuspicion && (
  <div className="benefit-nudge" data-testid="yearly-entry-nudge">
    <span>
      {formatCurrency(yearlySuspicion.entered)} looks like a yearly amount.
    </span>
    <button
      type="button"
      className="benefit-nudge-action"
      onClick={() => {
        const next = yearlySuspicion.monthly;
        setBenefitText(String(next));
        set({ monthlyBenefit: next });
      }}
    >
      Use {formatCurrency(yearlySuspicion.monthly)}/month
    </button>
  </div>
)}
```

Add a `.benefit-nudge` rule to `src/App.css` near `.field-hint`, styled to be noticed — a gold left border like `.chart-caveat`, with the action rendered as an inline button rather than a link.

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PersonFields.tsx src/components/PersonFields.test.tsx src/App.css
git commit -m "feat: say the benefit is monthly, and offer to convert a yearly figure

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Encode and decode the share link

**Files:**
- Create: `src/lib/shareLink.ts`
- Create: `src/lib/shareLink.test.ts`

**Interfaces:**
- Consumes: Task 1's bounds, `AnalyzerFormState`/`BLANK_FORM` from `formState`
- Produces:

```ts
export function toShareParams(form: AnalyzerFormState): URLSearchParams;
export function fromShareParams(params: URLSearchParams): AnalyzerFormState;
export function buildShareUrl(form: AnalyzerFormState, origin: string, pathname: string): string;
```

Parameter names: `ay` `am` `ag` `ab` for person A's year, month, gender and benefit; `by` `bm` `bg` `bb` for person B; `m` for married (`1`/`0`); `le`, `cola`, `dr`.

Gender encodes as `m` / `f`. Person B's params are omitted entirely when single.

**The rule that matters: an invalid value is dropped, not clamped.** `fromShareParams` merges onto `BLANK_FORM`, so a rejected field stays blank and the form visibly asks for it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/shareLink.test.ts
import { describe, expect, it } from 'vitest';
import { BLANK_FORM, type AnalyzerFormState } from './formState';
import { buildShareUrl, fromShareParams, toShareParams } from './shareLink';

const married: AnalyzerFormState = {
  ...BLANK_FORM,
  personA: { name: 'Dan', birthYear: 1962, birthMonth: 4, gender: 'male', monthlyBenefit: 2400 },
  personB: { name: 'Sarah', birthYear: 1964, birthMonth: 2, gender: 'female', monthlyBenefit: 2100 },
  hasSpouse: true,
  lifeExpectancy: 85,
  annualCola: 2.5,
  discountRate: 2.5,
};

const single: AnalyzerFormState = {
  ...BLANK_FORM,
  personA: { name: 'Dan', birthYear: 1962, birthMonth: 4, gender: 'male', monthlyBenefit: 2400 },
  hasSpouse: false,
  lifeExpectancy: 85,
};

describe('round trip', () => {
  it('restores everything except the names', () => {
    const restored = fromShareParams(toShareParams(married));
    expect(restored).toEqual({
      ...married,
      personA: { ...married.personA, name: '' },
      personB: { ...married.personB, name: '' },
    });
  });

  it('restores a single household without person B', () => {
    const restored = fromShareParams(toShareParams(single));
    expect(restored.hasSpouse).toBe(false);
    expect(restored.personA.birthYear).toBe(1962);
    expect(restored.personB).toEqual(BLANK_FORM.personB);
  });
});

describe('names are never encoded', () => {
  it('omits both name fields from the query string', () => {
    const query = toShareParams(married).toString();
    expect(query).not.toMatch(/Dan/i);
    expect(query).not.toMatch(/Sarah/i);
  });

  it('omits person B entirely when single', () => {
    const query = toShareParams(single).toString();
    expect(query).not.toMatch(/[?&]?b[ymgb]=/);
  });
});

describe('invalid parameters are dropped, never clamped', () => {
  const parse = (q: string) => fromShareParams(new URLSearchParams(q));

  it('drops a benefit above the ceiling rather than clamping to it', () => {
    expect(parse('ab=99999').personA.monthlyBenefit).toBe('');
  });

  it('drops a negative benefit', () => {
    expect(parse('ab=-5').personA.monthlyBenefit).toBe('');
  });

  it('drops an impossible month', () => {
    expect(parse('am=13').personA.birthMonth).toBe('');
    expect(parse('am=0').personA.birthMonth).toBe('');
  });

  it('drops an unknown gender', () => {
    expect(parse('ag=x').personA.gender).toBeNull();
  });

  it('drops a birth year outside the offered range', () => {
    expect(parse('ay=1800').personA.birthYear).toBe('');
    expect(parse('ay=2200').personA.birthYear).toBe('');
  });

  it('drops non-numeric junk', () => {
    expect(parse('ab=abc').personA.monthlyBenefit).toBe('');
    expect(parse('le=soon').lifeExpectancy).toBeNull();
  });

  it('drops assumptions outside their slider bounds', () => {
    expect(parse('cola=99').annualCola).toBe(BLANK_FORM.annualCola);
    expect(parse('dr=99').discountRate).toBe(BLANK_FORM.discountRate);
    expect(parse('le=200').lifeExpectancy).toBeNull();
  });

  // `dr` travels as a percent and is stored as a fraction. Without the
  // conversion this reads back as a 250% discount rate, and nothing else in
  // the app would notice.
  it('converts the discount rate from percent back to a fraction', () => {
    expect(parse('dr=2.5').discountRate).toBeCloseTo(0.025, 6);
  });

  it('round-trips the discount rate through both conversions', () => {
    const params = toShareParams({ ...single, discountRate: 0.031 });
    expect(params.get('dr')).toBe('3.1');
    expect(fromShareParams(params).discountRate).toBeCloseTo(0.031, 6);
  });

  it('keeps the valid fields when a sibling field is invalid', () => {
    const form = parse('ay=1962&am=99&ab=2400');
    expect(form.personA.birthYear).toBe(1962);
    expect(form.personA.birthMonth).toBe('');
    expect(form.personA.monthlyBenefit).toBe(2400);
  });

  it('returns a blank form for an empty query string', () => {
    expect(parse('')).toEqual(BLANK_FORM);
  });

  it('accepts a zero benefit, which is a valid no-work-record entry', () => {
    expect(parse('ab=0').personA.monthlyBenefit).toBe(0);
  });
});

describe('buildShareUrl', () => {
  it('joins origin, path and query', () => {
    const url = buildShareUrl(single, 'https://example.test', '/');
    expect(url.startsWith('https://example.test/?')).toBe(true);
    expect(url).toMatch(/ay=1962/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- shareLink`
Expected: FAIL — `Cannot find module './shareLink'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/shareLink.ts
import {
  COLA_BOUNDS,
  DISCOUNT_BOUNDS_PERCENT,
  isBenefitInRange,
  isInBounds,
  LIFE_EXPECTANCY_BOUNDS,
} from './formBounds';
import { BLANK_FORM, type AnalyzerFormState, type PersonFormFields } from './formState';
import type { Gender } from './personAnalysis';

/**
 * Encodes the analyzer's form state into a shareable query string, and back.
 *
 * Two rules shape everything here.
 *
 * Names are never encoded. They are display-only — `personLabel` falls back to
 * "You" / "Spouse" — so excluding them costs nothing and keeps a link reading
 * as a scenario rather than a client record. A date of birth and a dollar
 * figure with no name attached is far weaker as identifying information, and
 * links leak: into history, chat logs, screenshots and Referer headers.
 *
 * Everything arriving from a URL is untrusted, and an invalid value is
 * DROPPED, not clamped. Clamping would silently substitute a plausible number
 * that the recipient never notices, in a tool whose output informs a financial
 * decision. A dropped field stays blank, so the form visibly asks for it.
 */

const CURRENT_YEAR = new Date().getFullYear();
// Mirrors the range `PersonFields` offers in its birth-year select.
const BIRTH_YEAR_BOUNDS = { min: CURRENT_YEAR - 87, max: CURRENT_YEAR - 18 };

function num(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function intInBounds(
  params: URLSearchParams,
  key: string,
  bounds: { min: number; max: number },
): number | '' {
  const value = num(params, key);
  if (value === null || !Number.isInteger(value) || !isInBounds(value, bounds)) return '';
  return value;
}

function readGender(params: URLSearchParams, key: string): Gender | null {
  const raw = params.get(key);
  if (raw === 'm') return 'male';
  if (raw === 'f') return 'female';
  return null;
}

function readBenefit(params: URLSearchParams, key: string): number | '' {
  const value = num(params, key);
  if (value === null || !isBenefitInRange(value)) return '';
  return value;
}

function readPerson(params: URLSearchParams, prefix: 'a' | 'b'): PersonFormFields {
  return {
    // Deliberately never decoded — see the module comment.
    name: '',
    birthYear: intInBounds(params, `${prefix}y`, BIRTH_YEAR_BOUNDS),
    birthMonth: intInBounds(params, `${prefix}m`, { min: 1, max: 12 }),
    gender: readGender(params, `${prefix}g`),
    monthlyBenefit: readBenefit(params, `${prefix}b`),
  };
}

function writePerson(
  params: URLSearchParams,
  prefix: 'a' | 'b',
  person: PersonFormFields,
): void {
  if (person.birthYear !== '') params.set(`${prefix}y`, String(person.birthYear));
  if (person.birthMonth !== '') params.set(`${prefix}m`, String(person.birthMonth));
  if (person.gender !== null) params.set(`${prefix}g`, person.gender === 'male' ? 'm' : 'f');
  if (person.monthlyBenefit !== '') params.set(`${prefix}b`, String(person.monthlyBenefit));
}

export function toShareParams(form: AnalyzerFormState): URLSearchParams {
  const params = new URLSearchParams();
  writePerson(params, 'a', form.personA);
  if (form.hasSpouse !== null) params.set('m', form.hasSpouse ? '1' : '0');
  if (form.hasSpouse) writePerson(params, 'b', form.personB);
  if (form.lifeExpectancy !== null) params.set('le', String(form.lifeExpectancy));
  params.set('cola', String(form.annualCola));
  // `dr` travels as a PERCENT so the link is human-readable and matches the
  // slider; the form stores a fraction. Convert on both sides.
  params.set('dr', String(form.discountRate * 100));
  return params;
}

export function fromShareParams(params: URLSearchParams): AnalyzerFormState {
  const married = params.get('m');
  const hasSpouse = married === '1' ? true : married === '0' ? false : null;

  const le = num(params, 'le');
  const cola = num(params, 'cola');
  const dr = num(params, 'dr');

  return {
    personA: readPerson(params, 'a'),
    personB: hasSpouse ? readPerson(params, 'b') : BLANK_FORM.personB,
    hasSpouse,
    lifeExpectancy:
      le !== null && isInBounds(le, LIFE_EXPECTANCY_BOUNDS) ? le : BLANK_FORM.lifeExpectancy,
    annualCola: cola !== null && isInBounds(cola, COLA_BOUNDS) ? cola : BLANK_FORM.annualCola,
    // `dr` arrives as a percent; the form stores a fraction.
    discountRate:
      dr !== null && isInBounds(dr, DISCOUNT_BOUNDS_PERCENT)
        ? dr / 100
        : BLANK_FORM.discountRate,
  };
}

export function buildShareUrl(
  form: AnalyzerFormState,
  origin: string,
  pathname: string,
): string {
  return `${origin}${pathname}?${toShareParams(form).toString()}`;
}
```

If `BIRTH_YEAR_BOUNDS` does not match the select's actual range, read `BIRTH_YEARS` in `PersonFields.tsx` and align it — a year the select cannot display must not survive a round trip. Report which you used.

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shareLink.ts src/lib/shareLink.test.ts
git commit -m "feat: encode and decode the form state as URL parameters

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: The Copy link button

**Files:**
- Create: `src/components/CopyLinkButton.tsx`
- Create: `src/components/CopyLinkButton.test.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Task 5's `buildShareUrl`
- Produces: `<CopyLinkButton form={AnalyzerFormState} disabled={boolean} />`

The clipboard can fail — an insecure context, or a denied permission — and must not fail silently. On failure the component shows the URL in a read-only, pre-selected input so the adviser can copy it manually.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/CopyLinkButton.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyLinkButton } from './CopyLinkButton';
import { BLANK_FORM } from '../lib/formState';

const form = {
  ...BLANK_FORM,
  personA: { name: 'Dan', birthYear: 1962, birthMonth: 4, gender: 'male' as const, monthlyBenefit: 2400 },
  hasSpouse: false,
  lifeExpectancy: 85,
};

afterEach(() => vi.unstubAllGlobals());

describe('CopyLinkButton', () => {
  it('is disabled when the form is incomplete', () => {
    render(<CopyLinkButton form={BLANK_FORM} disabled />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeDisabled();
  });

  it('writes a link containing the form state to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CopyLinkButton form={form} disabled={false} />);

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toMatch(/ay=1962/);
  });

  it('never puts a name in the copied link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CopyLinkButton form={form} disabled={false} />);

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect(writeText.mock.calls[0][0]).not.toMatch(/Dan/i);
  });

  it('falls back to a selectable field when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<CopyLinkButton form={form} disabled={false} />);

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
    const fallback = await screen.findByTestId('share-link-fallback');
    expect((fallback as HTMLInputElement).value).toMatch(/ay=1962/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- CopyLinkButton`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```tsx
// src/components/CopyLinkButton.tsx (structure)
import { useState } from 'react';
import { buildShareUrl } from '../lib/shareLink';
import type { AnalyzerFormState } from '../lib/formState';

interface CopyLinkButtonProps {
  form: AnalyzerFormState;
  disabled: boolean;
}

export function CopyLinkButton({ form, disabled }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  async function handleCopy() {
    const url = buildShareUrl(form, window.location.origin, window.location.pathname);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFallbackUrl(null);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Insecure context or denied permission — show it rather than fail silently.
      setFallbackUrl(url);
    }
  }

  // Render: a `btn-ghost`-styled button reading "Copy link" (or "Copied" while
  // `copied`), matching the header's existing controls; and when `fallbackUrl`
  // is set, a read-only input with data-testid="share-link-fallback",
  // `onFocus={(e) => e.currentTarget.select()}` and an explanatory label.
}
```

Match `Analyzer.tsx`'s existing header button markup (`btn-ghost` / `btn-export`) so the control does not look foreign.

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CopyLinkButton.tsx src/components/CopyLinkButton.test.tsx src/App.css
git commit -m "feat: add a Copy link control with a clipboard fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Hydrate on load, strip the query, set the referrer policy

**Files:**
- Modify: `src/components/Analyzer.tsx`
- Modify: `index.html`

**Interfaces:**
- Consumes: Tasks 5 and 6
- Produces: no new exports

- [ ] **Step 1: Hydrate once on mount**

**Keep the parse pure and the stripping in an effect.** `src/main.tsx` wraps the
app in `<StrictMode>`, which deliberately invokes `useState` initializers twice
in development to surface impure ones. Putting `history.replaceState` inside the
initializer means the second invocation reads an already-stripped URL and returns
a blank form — the feature would appear broken in dev and work in production, or
vice versa depending on which result React keeps. Reading `location.search` is a
read and is fine in the initializer; mutating history is not.

```tsx
// Parse once, before first paint. A lazy initializer rather than an effect:
// an effect would paint the blank form first and then replace it, flickering
// and briefly running an analysis on empty inputs.
const [initialForm] = useState(() => {
  if (typeof window === 'undefined') return BLANK_FORM;
  const params = new URLSearchParams(window.location.search);
  if ([...params.keys()].length === 0) return BLANK_FORM;
  return fromShareParams(params);
});

// Strip the query string separately, because this is a side effect and
// StrictMode double-invokes state initializers. replaceState is idempotent,
// so running it twice is harmless; parsing after a strip would not be.
//
// Stripping un-leaks nothing by itself — the recipient already has the URL —
// but it keeps a client's date of birth and benefit out of the address bar for
// the rest of a meeting, which is the realistic exposure here: a shared screen
// or a glance over the shoulder. The cost is that a refresh clears the form;
// that trade is deliberate.
useEffect(() => {
  if (window.location.search !== '') {
    window.history.replaceState({}, '', window.location.pathname);
  }
}, []);
```

Initialize each piece of form state from `initialForm` instead of `BLANK_FORM`.

- [ ] **Step 2: Render the button**

Add `<CopyLinkButton form={form} disabled={!inputsComplete} />` beside the Export PDF button in the header, using the same `inputsComplete` value that gates PDF export.

- [ ] **Step 3: Set the referrer policy**

In `index.html`, inside `<head>`:

```html
<meta name="referrer" content="strict-origin-when-cross-origin" />
```

The Resources panel links out to ssa.gov; a query string must not travel in the `Referer` header.

- [ ] **Step 4: Verify by hand**

Run `PW_PORT=4199 npm run test:e2e` and also start the dev server, load a URL with `?ay=1962&am=4&ag=m&ab=2400&m=0&le=85`, and confirm the form populates, the analysis renders, and the address bar has no query string. Report what you saw.

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Analyzer.tsx index.html
git commit -m "feat: hydrate the form from a shared link and clear the query string

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end coverage

**Files:**
- Modify: `validation/e2e/interactions.spec.ts`

**Interfaces:**
- Consumes: Tasks 4, 6 and 7

- [ ] **Step 1: Write the specs**

```ts
// append to validation/e2e/interactions.spec.ts
test('hydrates the form from a shared link and clears the query string', async ({ page }) => {
  await page.goto('/?ay=1962&am=4&ag=m&ab=2400&m=0&le=85');

  await expect(page.getByTestId('benefit-table')).toBeVisible();
  await expect(page.locator('#a-benefit')).toHaveValue('2400');
  // The address bar must not retain client data after hydration.
  expect(new URL(page.url()).search).toBe('');
});

test('ignores an out-of-range parameter rather than clamping it', async ({ page }) => {
  await page.goto('/?ay=1962&am=4&ag=m&ab=99999&m=0&le=85');

  // The benefit is dropped, so the field is empty and no analysis runs.
  await expect(page.locator('#a-benefit')).toHaveValue('');
  await expect(page.getByTestId('benefit-table')).toHaveCount(0);
});

// The spec calls this out specifically: the gate renders before the analyzer
// and keys off sessionStorage without navigating, so parameters should survive
// sign-in. It is exactly the kind of interaction that breaks silently.
test('a shared link still hydrates after the password gate', async ({ browser }) => {
  // A fresh context, without the shared fixture's sessionStorage seeding.
  const page = await (await browser.newContext()).newPage();
  await page.goto('/?ay=1962&am=4&ag=m&ab=2400&m=0&le=85');

  await expect(page.locator('#password')).toBeVisible();
  await page.locator('#password').fill('wolfpack');
  await page.getByRole('button', { name: /enter|sign in|unlock/i }).click();

  await expect(page.getByTestId('benefit-table')).toBeVisible();
  await expect(page.locator('#a-benefit')).toHaveValue('2400');
});

test('offers to convert a yearly benefit figure', async ({ page }) => {
  await page.goto('/');
  await page.locator('#a-benefit').fill('36000');

  const nudge = page.getByTestId('yearly-entry-nudge');
  await expect(nudge).toBeVisible();
  await page.getByRole('button', { name: /use \$3,000/i }).click();
  await expect(page.locator('#a-benefit')).toHaveValue('3000');
  await expect(nudge).toHaveCount(0);
});
```

- [ ] **Step 2: Run the suite**

Run: `PW_PORT=4199 npm run test:e2e`
Expected: all specs pass.

- [ ] **Step 3: Run everything**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add validation/e2e/interactions.spec.ts
git commit -m "test: cover share-link hydration and the yearly-entry nudge end to end

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification against the spec's success criteria

1. **Link reproduces the analysis, names blank** — Task 5 round-trip test; Task 8 e2e.
2. **No name in a URL** — Task 5 and Task 6 both assert it.
3. **Invalid parameters dropped, not clamped** — Task 5's rejection tests; Task 8 e2e.
4. **Address bar carries no client data** — Task 7 strip; Task 8 asserts an empty search string.
5. **A link survives the password gate** — Task 8's fresh-context e2e test. Confirm the gate's actual submit-button label and password-input id before writing it; the selectors above are a starting guess, and the existing gate test in `interactions.spec.ts` shows the real ones.
6. **Zero-benefit person A works; all-zero does not** — Task 2.
7. **36000 offers 3000; 4800 offers nothing; neither blocked** — Tasks 3 and 4.
8. **The field states the amount is monthly** — Task 4.
9. **Lint, unit/component, build and e2e all pass** — every task.
