# Per-Person Life Expectancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give person B the life-expectancy control person A already has, without changing any existing analysis.

**Architecture:** `lifeExpectancy` moves from `AnalyzerFormState` down onto `PersonFormFields`, beside the other per-person attributes. `toHousehold` falls back to the SSA suggestion when a person's value is null, which is exactly what person B receives today — so the move is behavior-preserving by construction. Then the share link gains `ale`/`ble`, and the assumptions panel gains a second control.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-per-person-life-expectancy-design.md`

## Global Constraints

- **Never modify `src/vendor/ssa-tools/`.** Vendored MIT upstream.
- No new dependencies.
- **No golden fixture may change.** `validation/fixtures/scenarios.json` must be byte-identical at the end of every task. This is the plan's central invariant, not a nice-to-have — see "The invariant" below.
- `npm run fixtures:gen` must remain idempotent — empty `git diff` on `scenarios.json`.
- `npm run lint` (oxlint) zero warnings.
- **Every task ends green:** `npm run lint`, `npm run test` and `npm run build` all pass before each commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch: `feat/per-person-life-expectancy`.
- **Local e2e uses `PW_PORT=4199`** — port 4173 is occupied by unrelated software. The pre-commit hook runs e2e on the default port and will fail; use `SKIP_E2E=1 git commit ...` after running e2e yourself. Never use `--no-verify`.
- Life-expectancy bounds stay `LIFE_EXPECTANCY_BOUNDS` (75–100) for both people. Do not introduce a second bounds constant.

## The invariant

Both people already receive a life expectancy today:

- Person A: the form's slider (`formState.ts:79-80`).
- Person B: `getSuggestedLifeExpectancy(spouseAge, spouseGender)`, computed inside `toHousehold` (`formState.ts:84-90`).

This plan adds a **control** for B. It does not change either default. Therefore **every golden scenario must produce identical output**: same recommended filing ages, same dollar figures, same break-even years.

If a fixture moves, stop and report. A moved fixture means the refactor changed a default, which is the one thing this phase must not do.

**Know what the invariant does not prove.** `validation/engine/golden.test.ts:53-65` builds its `Person` objects directly from the fixture rather than calling `formState.toHousehold`, so the golden suite exercises the engine path and never touches the code this plan changes. A green golden run proves the engine is untouched; it cannot catch a regression in `toHousehold`'s fallback.

That burden falls entirely on `src/lib/formState.test.ts`. Treat Task 1's tests as the real safety net, not a formality on top of the fixtures.

Similarly, `fillScenarioForm` (`validation/e2e/helpers/app.ts:38`) never touches the life-expectancy slider — the e2e fixtures carry a `lifeExpectancy` per person, but the browser tests let the app seed its own. Do not "fix" that as part of this plan: making the helper fill the sliders would change every e2e scenario's inputs and is out of scope.

## A trap to avoid in tests

`toHousehold` calls `getCurrentAge(birthYear, birthMonth)` with no `asOf`, so a person's derived life expectancy depends on **today's date**. A test asserting `expect(le).toBe(83)` for a birth year will pass now and fail next year.

Do not assert absolute life-expectancy numbers in `formState.test.ts`. Assert **relationships** that are stable over time — two people of the same age but different genders get different values, an explicit value overrides the fallback. Exact-number coverage of the table already lives in `src/lib/lifeExpectancy.test.ts`, which tests the function directly with an explicit age.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/formState.ts` | **Modify.** Field moves to `PersonFormFields`; `toHousehold` fallback; per-person suggestion helper |
| `src/lib/shareLink.ts` | **Modify.** `ale`/`ble`, plus the legacy `le` branch |
| `src/components/Analyzer.tsx` | **Modify.** State moves into the person objects; `handlePersonBChange` seeds B |
| `src/components/AssumptionsPanel.tsx` | **Modify.** Two life-expectancy controls |

`household.ts`, `personAnalysis.ts`, `ssaTools.ts` and everything under `src/components/pdf/` are **untouched** — they already consume `Person.lifeExpectancy` per person.

---

### Task 1: Move the field onto the person

**Files:**
- Modify: `src/lib/formState.ts`
- Modify: `src/lib/formState.test.ts`
- Modify: `src/lib/shareLink.ts`
- Modify: `src/components/Analyzer.tsx`
- Modify (type fallout only): any test file constructing a `PersonFormFields` or spreading `BLANK_FORM` — at least `src/lib/shareLink.test.ts` and `src/components/CopyLinkButton.test.tsx`. Adding `lifeExpectancy` to the literal is the whole fix; do not change what those tests assert.

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:

```ts
export interface PersonFormFields {
  name: string;
  birthYear: number | '';
  birthMonth: number | '';
  gender: Gender | null;
  monthlyBenefit: number | '';
  lifeExpectancy: number | null;   // NEW
}

// AnalyzerFormState LOSES its top-level `lifeExpectancy` field.

/** The SSA-suggested plan-to age for one person, or null if identity is incomplete. */
export function suggestedLifeExpectancyFor(fields: PersonFormFields): number | null;
```

`suggestedLifeExpectancy(form)` is **replaced** by `suggestedLifeExpectancyFor(fields)`. Update every caller.

This task is a pure refactor: **no behavior changes at all.** The share link still reads and writes `le`; it just lands on `form.personA.lifeExpectancy` instead of `form.lifeExpectancy`. Task 2 introduces `ale`/`ble`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/lib/formState.test.ts
describe('per-person life expectancy', () => {
  // Both born 1960, so both are the same age — gender is the only variable.
  // Absolute values are deliberately not asserted: getCurrentAge reads the
  // wall clock, so an exact expectation would rot. See the plan's note.
  const male: PersonFormFields = {
    name: '', birthYear: 1960, birthMonth: 6, gender: 'male',
    monthlyBenefit: 2500, lifeExpectancy: null,
  };
  const female: PersonFormFields = {
    name: '', birthYear: 1960, birthMonth: 6, gender: 'female',
    monthlyBenefit: 1200, lifeExpectancy: null,
  };

  it('gives each person their own suggested value when neither is set', () => {
    const household = toHousehold({
      ...BLANK_FORM,
      personA: { ...male, lifeExpectancy: 85 },
      personB: female,
      hasSpouse: true,
    });
    // Same age, different gender: SSA's table gives women more remaining years,
    // so B's fallback must exceed what a male of the same age would receive.
    expect(household.people[1].lifeExpectancy).toBeGreaterThan(
      suggestedLifeExpectancyFor(male)!,
    );
  });

  it('uses an explicit value for person B rather than the fallback', () => {
    const household = toHousehold({
      ...BLANK_FORM,
      personA: { ...male, lifeExpectancy: 85 },
      personB: { ...female, lifeExpectancy: 92 },
      hasSpouse: true,
    });
    expect(household.people[1].lifeExpectancy).toBe(92);
    expect(household.people[0].lifeExpectancy).toBe(85);
  });

  it('requires person A life expectancy but not person B', () => {
    const base = {
      ...BLANK_FORM,
      personA: { ...male, lifeExpectancy: 85 },
      personB: female,
      hasSpouse: true,
    };
    expect(isFormComplete(base)).toBe(true);
    expect(isFormComplete({ ...base, personA: { ...male, lifeExpectancy: null } })).toBe(false);
  });

  it('returns null from the suggestion helper when identity is incomplete', () => {
    expect(suggestedLifeExpectancyFor({ ...male, gender: null })).toBeNull();
    expect(suggestedLifeExpectancyFor({ ...male, birthYear: '' })).toBeNull();
  });
});
```

Import `suggestedLifeExpectancyFor`, `toHousehold`, `isFormComplete`, `BLANK_FORM` and the `PersonFormFields` type. Check what the file already imports before adding duplicates.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- formState`
Expected: FAIL — `suggestedLifeExpectancyFor` is not exported and `PersonFormFields` has no `lifeExpectancy`.

- [ ] **Step 3: Implement `formState.ts`**

```ts
export interface PersonFormFields {
  name: string;
  birthYear: number | '';
  birthMonth: number | '';
  gender: Gender | null;
  monthlyBenefit: number | '';
  /**
   * Plan-to age. Null means "use the SSA suggestion for this person", which
   * is what person B received unconditionally before this field existed.
   */
  lifeExpectancy: number | null;
}

export interface AnalyzerFormState {
  personA: PersonFormFields;
  personB: PersonFormFields;
  hasSpouse: boolean | null;
  annualCola: number;
  discountRate: number;
}

const BLANK_PERSON: PersonFormFields = {
  name: '',
  birthYear: '',
  birthMonth: '',
  gender: null,
  monthlyBenefit: '',
  lifeExpectancy: null,
};

export const BLANK_FORM: AnalyzerFormState = {
  personA: BLANK_PERSON,
  personB: BLANK_PERSON,
  hasSpouse: null,
  annualCola: CPI_DEFAULT_COLA,
  discountRate: DEFAULT_DISCOUNT_RATE,
};

/** The SSA-suggested plan-to age for one person, or null if identity is incomplete. */
export function suggestedLifeExpectancyFor(fields: PersonFormFields): number | null {
  const { birthYear, birthMonth, gender } = fields;
  if (birthYear === '' || birthMonth === '' || gender === null) return null;
  return getSuggestedLifeExpectancy(getCurrentAge(birthYear, birthMonth).years, gender);
}

function toPerson(fields: PersonFormFields, id: 'a' | 'b'): Person {
  return {
    id,
    name: fields.name.trim() || undefined,
    birthYear: fields.birthYear as number,
    birthMonth: fields.birthMonth as number,
    gender: fields.gender as Gender,
    piaMonthly: fields.monthlyBenefit as number,
    // Falling back to the SSA suggestion reproduces exactly what person B
    // received before this field existed, so no existing analysis moves.
    lifeExpectancy: fields.lifeExpectancy ?? (suggestedLifeExpectancyFor(fields) as number),
  };
}

export function toHousehold(form: AnalyzerFormState): Household {
  const personA = toPerson(form.personA, 'a');
  if (!form.hasSpouse) return { status: 'single', people: [personA] };
  return { status: 'married', people: [personA, toPerson(form.personB, 'b')] };
}
```

`isFormComplete` changes one line: the top-level `form.lifeExpectancy === null` check becomes `form.personA.lifeExpectancy === null`. Person B's is **not** gated — it has a fallback.

Delete the old `suggestedLifeExpectancy(form)` export. `getSuggestedLifeExpectancy` and `getCurrentAge` are already imported.

- [ ] **Step 4: Update `shareLink.ts` — same parameter, new home**

In `toShareParams`, `form.lifeExpectancy` becomes `form.personA.lifeExpectancy`. In `fromShareParams`, the `lifeExpectancy:` entry moves off the returned object and onto person A.

`readPerson` returns a `PersonFormFields`, which now needs the field. Give it `lifeExpectancy: null` in this task; Task 2 replaces that with proper per-person parsing.

`fromShareParams` then applies the existing `le` value to person A, keeping the current bounds check verbatim:

```ts
const personA = readPerson(params, 'a');
personA.lifeExpectancy =
  le !== null && isInBounds(le, LIFE_EXPECTANCY_BOUNDS) ? le : null;

return {
  personA,
  personB: hasSpouse ? readPerson(params, 'b') : BLANK_FORM.personB,
  hasSpouse,
  // the top-level `lifeExpectancy:` entry is deleted
  annualCola: /* unchanged */,
  discountRate: /* unchanged */,
};
```

Leave the `annualCola` and `discountRate` entries exactly as they are — they are elided above only to keep this snippet short.

- [ ] **Step 5: Update `Analyzer.tsx`**

Delete the `lifeExpectancy` / `setLifeExpectancy` state (`Analyzer.tsx:47`). The value now lives inside `personA`.

- The `form` memo (`Analyzer.tsx:75-85`) drops its `lifeExpectancy` entry and its dependency.
- The analysis effect's dependency array (`Analyzer.tsx:126`) drops `lifeExpectancy` — `personA` already covers it.
- `handlePersonAChange` (`Analyzer.tsx:130-134`) sets the suggestion **inside** the person object instead of calling `setLifeExpectancy`:

```tsx
function handlePersonAChange(next: PersonFormFields) {
  if (next.birthYear !== '' && next.birthMonth !== '' && next.gender !== null) {
    const age = getCurrentAge(next.birthYear, next.birthMonth).years;
    setPersonA({ ...next, lifeExpectancy: getSuggestedLifeExpectancy(age, next.gender) });
    return;
  }
  setPersonA(next);
}
```

Read the existing function before replacing it — preserve any behavior it has beyond what is shown here.

- `ssaSuggested` (`Analyzer.tsx:128`) becomes `suggestedLifeExpectancyFor(personA)`.
- The `AssumptionsPanel` call site passes `lifeExpectancy={personA.lifeExpectancy}` and `onLifeExpectancyChange={(v) => setPersonA({ ...personA, lifeExpectancy: v })}`. The panel's own props are unchanged in this task.

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run test && npm run build`
Expected: PASS, including every golden scenario unchanged.

Then confirm the invariant explicitly:

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/scenarios.json
```

Expected: empty. **If any fixture moved, STOP and report** — a moved fixture means a default changed.

- [ ] **Step 7: Run e2e and commit**

```bash
PW_PORT=4199 npm run test:e2e
```

```bash
git add src/lib/formState.ts src/lib/formState.test.ts src/lib/shareLink.ts src/components/Analyzer.tsx
SKIP_E2E=1 git commit -m "refactor: move life expectancy onto the person

Person B's life expectancy was already derived separately but had nowhere
to live in form state. Moving the field onto PersonFormFields, with the SSA
suggestion as the fallback, reproduces today's behavior exactly and gives
B's value somewhere for a control to write to.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Per-person share-link parameters

**Files:**
- Modify: `src/lib/shareLink.ts`
- Modify: `src/lib/shareLink.test.ts`

**Interfaces:**
- Consumes: Task 1's `PersonFormFields.lifeExpectancy`
- Produces: no new exports. The URL schema gains `ale` and `ble`; `le` becomes a legacy alias for `ale`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/lib/shareLink.test.ts
describe('per-person life expectancy params', () => {
  const form: AnalyzerFormState = {
    ...BLANK_FORM,
    personA: {
      name: '', birthYear: 1960, birthMonth: 6, gender: 'male',
      monthlyBenefit: 2500, lifeExpectancy: 85,
    },
    personB: {
      name: '', birthYear: 1962, birthMonth: 3, gender: 'female',
      monthlyBenefit: 1200, lifeExpectancy: 92,
    },
    hasSpouse: true,
  };

  it('round-trips two distinct values', () => {
    const back = fromShareParams(toShareParams(form));
    expect(back.personA.lifeExpectancy).toBe(85);
    expect(back.personB.lifeExpectancy).toBe(92);
  });

  it('omits ble for a single claimant', () => {
    const params = toShareParams({ ...form, hasSpouse: false });
    expect(params.get('ale')).toBe('85');
    expect(params.has('ble')).toBe(false);
  });

  it('hydrates a legacy le link onto person A', () => {
    const back = fromShareParams(new URLSearchParams('ay=1960&am=6&ag=m&ab=2500&m=0&le=88'));
    expect(back.personA.lifeExpectancy).toBe(88);
  });

  it('prefers ale over a legacy le when both are present', () => {
    const back = fromShareParams(new URLSearchParams('ay=1960&am=6&ag=m&ab=2500&m=0&le=88&ale=91'));
    expect(back.personA.lifeExpectancy).toBe(91);
  });

  it('drops an out-of-range value without touching the other person', () => {
    const back = fromShareParams(
      new URLSearchParams('ay=1960&am=6&ag=m&ab=2500&by=1962&bm=3&bg=f&bb=1200&m=1&ale=200&ble=92'),
    );
    expect(back.personA.lifeExpectancy).toBeNull();
    expect(back.personB.lifeExpectancy).toBe(92);
  });

  it('drops non-numeric junk', () => {
    const back = fromShareParams(new URLSearchParams('ay=1960&am=6&ag=m&ab=2500&m=0&ale=eighty'));
    expect(back.personA.lifeExpectancy).toBeNull();
  });
});
```

The bounds are `LIFE_EXPECTANCY_BOUNDS` = 75–100, so `200` is out of range and `92` is in range. Verify those two facts against `src/lib/formBounds.ts` before relying on them.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- shareLink`
Expected: FAIL — `ale`/`ble` are not written, so the round trip returns null.

- [ ] **Step 3: Implement**

```ts
function readLifeExpectancy(params: URLSearchParams, key: string): number | null {
  const value = num(params, key);
  if (value === null || !isInBounds(value, LIFE_EXPECTANCY_BOUNDS)) return null;
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
    lifeExpectancy: readLifeExpectancy(params, `${prefix}le`),
  };
}
```

Note the key is `${prefix}le` — `ale` and `ble` — which matches the existing `ay`/`by` prefix convention.

In `writePerson`, add:

```ts
if (person.lifeExpectancy !== null) params.set(`${prefix}le`, String(person.lifeExpectancy));
```

Then remove the top-level `le` write from `toShareParams` entirely — new links carry `ale`/`ble` only.

In `fromShareParams`, apply the legacy fallback **after** `readPerson`:

```ts
// `le` predates the per-person split, where it meant person A's value. Honour
// it so links already in circulation reproduce the same analysis rather than
// silently losing a parameter the recipient cannot see is missing. `ale` wins
// when both are present — it is the newer, more specific key.
const personA = readPerson(params, 'a');
if (personA.lifeExpectancy === null) {
  personA.lifeExpectancy = readLifeExpectancy(params, 'le');
}
```

Remove the now-unused top-level `le` parsing and the `lifeExpectancy:` entry from the returned object.

- [ ] **Step 4: Run the tests**

Run: `npm run test -- shareLink`
Expected: PASS.

- [ ] **Step 5: Run everything and commit**

Run: `npm run lint && npm run test && npm run build && PW_PORT=4199 npm run test:e2e`

```bash
git add src/lib/shareLink.ts src/lib/shareLink.test.ts
SKIP_E2E=1 git commit -m "feat: carry each person's life expectancy in the share link

Adds ale and ble alongside the existing a/b prefixed parameters. A legacy
le link still hydrates person A, which is what it has always meant.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Person B's control

**Files:**
- Modify: `src/components/AssumptionsPanel.tsx`
- Modify: `src/components/AssumptionsPanel.test.tsx`
- Modify: `src/components/Analyzer.tsx`

**Interfaces:**
- Consumes: Task 1's `PersonFormFields.lifeExpectancy` and `suggestedLifeExpectancyFor`
- Produces:

```ts
interface LifeExpectancyControl {
  label: string;                 // the person's display name
  value: number | null;
  onChange: (value: number) => void;
  ssaSuggested: number | null;
  gender: Gender | null;
}

interface AssumptionsPanelProps {
  lifeExpectancies: LifeExpectancyControl[];   // one or two entries
  annualCola: number;
  onAnnualColaChange: (value: number) => void;
  discountRate: number;
  onDiscountRateChange: (value: number) => void;
  expanded: boolean;
  onToggle: () => void;
}
```

The five separate life-expectancy props (`lifeExpectancy`, `onLifeExpectancyChange`, `ssaSuggestedLifeExpectancy`, `gender`, and their coupling) collapse into one array. A single person is a one-element array, so the panel has one rendering path rather than a married branch and a single branch.

- [ ] **Step 1: Write the failing test**

```tsx
// append to src/components/AssumptionsPanel.test.tsx
it('renders one life-expectancy control per person', () => {
  render(
    <AssumptionsPanel
      lifeExpectancies={[
        { label: 'Dan', value: 85, onChange: vi.fn(), ssaSuggested: 83, gender: 'male' },
        { label: 'Sarah', value: 92, onChange: vi.fn(), ssaSuggested: 86, gender: 'female' },
      ]}
      annualCola={2.5}
      onAnnualColaChange={vi.fn()}
      discountRate={0.025}
      onDiscountRateChange={vi.fn()}
      expanded
      onToggle={vi.fn()}
    />,
  );
  expect(screen.getByLabelText(/Dan/)).toHaveValue('85');
  expect(screen.getByLabelText(/Sarah/)).toHaveValue('92');
  // Each hint reads its own person's gender, not person A's.
  expect(screen.getByText(/86/)).toBeInTheDocument();
});

it('calls the right person handler', async () => {
  const onChangeB = vi.fn();
  render(
    <AssumptionsPanel
      lifeExpectancies={[
        { label: 'Dan', value: 85, onChange: vi.fn(), ssaSuggested: 83, gender: 'male' },
        { label: 'Sarah', value: 92, onChange: onChangeB, ssaSuggested: 86, gender: 'female' },
      ]}
      annualCola={2.5}
      onAnnualColaChange={vi.fn()}
      discountRate={0.025}
      onDiscountRateChange={vi.fn()}
      expanded
      onToggle={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /Use SSA age \(86\)/ }));
  expect(onChangeB).toHaveBeenCalledWith(86);
});
```

`renderPanel` in this file passes the old prop shape and will no longer typecheck — update the helper to the new shape rather than working around it. Every existing test in the file that relies on `renderPanel` must keep passing.

Range inputs report `value` as a string, which is why the assertions above use `'85'` and not `85`.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- AssumptionsPanel`
Expected: FAIL — the component does not accept `lifeExpectancies`.

- [ ] **Step 3: Implement the panel**

Replace the single life-expectancy `div.field.advanced-field` block (`AssumptionsPanel.tsx:85-129`) with a map over `lifeExpectancies`. Per entry:

- The `id` must be unique per person — `life-${index}` — and the `htmlFor` must match it, or the two sliders collide and `getByLabelText` finds the wrong one.
- The label reads `{control.label} — plan to age {value}`, so the accessible name contains the person's name. Keep the existing "Set date of birth and gender to enable life expectancy planning." placeholder for a null value.
- The "SSA suggests age N for male/female" hint and its "Use SSA age (N)" button read `control.ssaSuggested` and `control.gender`.
- Keep `LIFE_EXPECTANCY_BOUNDS` for `min`/`max` and the existing `range-labels` markup.

Do not change the discount-rate or COLA blocks.

- [ ] **Step 4: Wire `Analyzer.tsx`**

Add `handlePersonBChange`, mirroring `handlePersonAChange` from Task 1 — seeding B's suggestion when their identity becomes complete. It replaces the bare `setPersonB` currently passed to `PersonFields` for index 1.

Build the array and pass it:

```tsx
const lifeExpectancies = [
  {
    label: personLabel(personA.name, 0),
    value: personA.lifeExpectancy,
    onChange: (v: number) => setPersonA({ ...personA, lifeExpectancy: v }),
    ssaSuggested: suggestedLifeExpectancyFor(personA),
    gender: personA.gender,
  },
  ...(hasSpouse
    ? [{
        label: personLabel(personB.name, 1),
        value: personB.lifeExpectancy,
        onChange: (v: number) => setPersonB({ ...personB, lifeExpectancy: v }),
        ssaSuggested: suggestedLifeExpectancyFor(personB),
        gender: personB.gender,
      }]
    : []),
];
```

`personLabel` comes from `src/lib/format.ts` and already falls back to "You" / "Spouse" — check its exact signature before calling it.

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run test && npm run build`

Then re-confirm the invariant:

```bash
npm run fixtures:gen && git diff --stat validation/fixtures/scenarios.json
```

Expected: empty.

- [ ] **Step 6: Add the e2e coverage**

Append to `validation/e2e/interactions.spec.ts`. It already imports `fillScenarioForm` and defines a `married` fixture at the top of the file — use both rather than building new ones.

```ts
test('gives each spouse their own life-expectancy slider', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, married);

  const a = page.locator('#life-0');
  const b = page.locator('#life-1');
  await expect(a).toHaveAttribute('type', 'range');
  await expect(b).toHaveAttribute('type', 'range');

  // The two must be independent: moving B's must not move A's.
  const aBefore = await a.inputValue();
  await b.fill('100');
  await expect(a).toHaveValue(aBefore);
  await expect(b).toHaveValue('100');
});
```

The married fixture's spouse is Sarah, born 1964 — comfortably inside the 75–100 range at either end, so `100` is reachable from wherever the slider seeds.

If asserting a *changed analysis* proves flaky because the recommendation is stable across that range, assert the independence of the two controls only, and say so in your report. Independence is the behavior this task adds; a moved recommendation is a bonus, not the requirement.

Run: `PW_PORT=4199 npm run test:e2e`

- [ ] **Step 7: Commit**

```bash
git add src/components/
SKIP_E2E=1 git commit -m "feat: give person B a life-expectancy control

Their value was already computed separately, printed in the client PDF,
and impossible to adjust. The panel now renders one control per person.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification against the spec's success criteria

1. **B has a control with the same bounds and hint** — Task 3 Steps 3 and 4.
2. **Each hint reflects its own person's gender** — Task 3 Step 1, first test.
3. **B's control absent when single; not required for completeness** — Task 3 Step 4 (the spread), Task 1 Step 1 (third test).
4. **Every golden fixture unchanged** — asserted in Task 1 Step 6 and Task 3 Step 5.
5. **A link carries both values** — Task 2 Step 1, first test.
6. **A legacy `le` link still hydrates person A** — Task 2 Step 1, third test.
7. **Out-of-range dropped, not clamped, independently per person** — Task 2 Step 1, fifth test.
8. **Lint, tests, build, e2e** — every task.
