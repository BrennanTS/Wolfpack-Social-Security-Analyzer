# Phase 3B-ii-a — widowed intake, and an honest analysis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an adviser enter a widow(er) and her deceased spouse's record, and make the resulting analysis carry no survivor-blind figures.

**Architecture:** `maritalStatus` replaces `hasSpouse` on the form. A new `widowedForm.ts` holds the widowed field types, their validation, and the conversion into 3B-i's `Deceased` / `AlreadyClaimed`. `analyzeWidowed` stops publishing own-record claiming options and break-evens for a widow and publishes the income she is actually recommended to receive. The display guard stays up: nothing renders a widowed household this phase.

**Tech Stack:** TypeScript, React, Vitest (node + jsdom projects), Testing Library, Playwright.

## Global Constraints

- `src/vendor/ssa-tools/` is **READ-ONLY**. Never modify it. Import via the `$lib/*` alias.
- **Every dollar figure comes from the engine.** The app supplies dates and composition (`max`, sum, difference of engine outputs) and computes no benefit rule.
- **`householdDisplayShape` must still throw on `'widowed'` at the end of this phase.** Removing it is 3B-ii-b's job. A task that makes a widowed household render has exceeded its scope.
- **Legacy share links must keep working.** `m=1` means married and `m=0` means single, exactly as today. The widowed value is a third value on the same parameter, `m=w`.
- **An already-claimed date is a fact, not a candidate.** It legitimately sits in the past. Never clamp it forward to today.
- **No single or married behaviour or fixture value may change.** If a previously-passing single/married assertion fails, STOP and report BLOCKED rather than updating it.
- Month convention: form and `YearMonth` months are **1-12**. The engine's `MonthDate.initFromYearsMonths` takes 0-11. Absolute month index is `year * 12 + (month - 1)`.
- Style: single quotes, 2-space indent, 100-col. **No prettier in this repo** — do not run it, it fights the house style. `npm run lint` runs oxlint.
- Run tests with `npx vitest run <path>`. Commit with `SKIP_E2E=1 git commit`. **Never `--no-verify`.**
- **Leave the working tree clean.** Revert every mutation, delete every scratch file.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/household.ts` | **Modify.** Empty `claimingOptions`/`breakEvens` and a steady-state `recommendedMonthly` for widowed; carry `piaEstimated`. |
| `src/lib/widowed.ts` | **Modify.** Add `piaEstimated` to `WidowedOutcome` (it is already computed in `context()`). |
| `src/lib/widowedForm.ts` | **Create.** Widowed form field types, validation, and conversion to `Deceased` / `AlreadyClaimed`. Pure, no React. |
| `src/lib/formState.ts` | **Modify.** `maritalStatus`, the two new field groups, `toHousehold`'s widowed branch, completeness. |
| `src/lib/shareLink.ts` | **Modify.** `m=w` plus the widowed parameters; legacy reading unchanged. |
| `src/components/DeceasedFields.tsx` | **Create.** The field group. |
| `src/components/Analyzer.tsx` | **Modify.** Three-way control and the state it threads. |

---

### Task 1: An honest widowed analysis

**Files:**
- Modify: `src/lib/widowed.ts`, `src/lib/household.ts`
- Test: `src/lib/household.test.ts`

**Interfaces:**
- Consumes: `WidowedOutcome` from `./widowed`; `deceasedContext` from `./deceased`.
- Produces: `WidowedOutcome` gains `piaEstimated: boolean`; `HouseholdAnalysis` gains `piaEstimated: boolean | null`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('analyzeHousehold — widowed', …)` block in `src/lib/household.test.ts`. It already defines a widowed `household` fixture; reuse it.

```ts
  it('publishes no own-record claiming options or break-evens for a widow', async () => {
    // Her own benefit may be smaller than the survivor benefit in EVERY month
    // she is alive, so a table of "what you'd get claiming at 62 through 70"
    // describes income she would never receive, and a break-even between two
    // of those ages compares two irrelevant quantities. Empty rather than
    // wrong: `BreakEvenSection` renders nothing on an empty array, so the
    // misleading section disappears by construction.
    const { people } = await analyzeHousehold(household, assumptions, asOf);
    expect(people[0].claimingOptions).toEqual([]);
    expect(people[0].breakEvens).toEqual([]);
  });

  it('still publishes them for single and married households', async () => {
    // The guard above must be scoped to widowed. An implementation that
    // returns empty for every status would satisfy the previous test.
    const single = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(single.people[0].claimingOptions.length).toBeGreaterThan(0);
    expect(single.people[0].breakEvens.length).toBeGreaterThan(0);

    const married = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] }, assumptions, asOf,
    );
    expect(married.people[0].claimingOptions.length).toBeGreaterThan(0);
  });

  it('reports the income she is actually recommended to receive', async () => {
    // Steady state: the month the LATER of the two recommended dates falls,
    // once both benefits are running. Equal to the summed bands at that month,
    // which stack to max(own, survivor) by construction.
    const result = await analyzeHousehold(household, assumptions, asOf);
    const { optimal, periods, people } = result;
    const steadyMonth = Math.max(
      optimal.survivorClaimDate!.monthIndex,
      optimal.filingAges[0].monthDuration.asMonths() +
        (household.people[0].birthYear * 12 + (household.people[0].birthMonth - 1)),
    );
    const banded = periods
      .filter((b) => b.startIndex <= steadyMonth && steadyMonth <= b.endIndex)
      .reduce((t, b) => t + b.monthlyAmount, 0);
    expect(banded).toBeGreaterThan(0);
    expect(people[0].recommendedMonthly).toBeCloseTo(banded, 2);
  });

  it('does not report her own-record benefit as the recommended monthly', async () => {
    // The defect this replaces: `analyzePerson` returned her benefit at her own
    // filing age, which omits the survivor benefit entirely. For this fixture
    // the survivor benefit dominates, so the two differ.
    const { people } = await analyzeHousehold(household, assumptions, asOf);
    const ownRecordOnly = ssaMonthlyBenefitAtFilingAge(
      createPiaRecipient(
        household.people[0].birthYear,
        household.people[0].birthMonth,
        household.people[0].piaMonthly,
        household.people[0].gender,
      ),
      people[0].recommendedFilingAge.monthDuration,
    ).benefit;
    expect(people[0].recommendedMonthly).toBeGreaterThan(ownRecordOnly);
  });

  it('carries whether the deceased PIA was estimated', async () => {
    const known = await analyzeHousehold(household, assumptions, asOf);
    expect(known.piaEstimated).toBe(false);

    const fromCheck = await analyzeHousehold(
      {
        ...household,
        deceased: {
          ...household.deceased,
          record: { kind: 'checkAmount', monthlyAmount: 2400, filed: { year: 2022, month: 5 } },
        },
      },
      assumptions,
      asOf,
    );
    expect(fromCheck.piaEstimated).toBe(true);
  });

  it('leaves piaEstimated null where there is no deceased record', async () => {
    const single = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(single.piaEstimated).toBeNull();
  });
```

Add to that file's imports if not already present:

```ts
import { createPiaRecipient, ssaMonthlyBenefitAtFilingAge } from './ssaTools';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/household.test.ts`
Expected: FAIL — `claimingOptions` is non-empty, and `piaEstimated` does not exist.

- [ ] **Step 3: Add `piaEstimated` to `WidowedOutcome`**

In `src/lib/widowed.ts`, add the field to the interface (beside `finalIndex`):

```ts
  /**
   * Whether the deceased's PIA was RECOVERED from a check amount rather than
   * known. Carried on the outcome for the same reason `finalIndex` is: it is
   * a fact about the search's inputs that the caller needs and would otherwise
   * have to re-derive by re-running `deceasedContext`, whose bisection is the
   * expensive part.
   */
  piaEstimated: boolean;
```

Populate it in `outcomeFromContext` from the context that is already built:

```ts
    piaEstimated: ctx.dec.piaEstimated,
```

- [ ] **Step 4: Make the widowed person figures honest**

In `src/lib/household.ts`, replace `analyzeWidowed`'s `people` construction:

```ts
  const bands = widowedBands(input, best);

  // The month the LATER of the two recommended dates falls: once both benefits
  // are running, the amount stops changing. The bands stack to
  // `max(own, survivor)` by construction, so summing the bands covering that
  // month IS the engine's answer — no benefit rule is computed here.
  const steadyMonth = Math.max(best.survivorClaimIndex, best.ownFilingIndex);
  const steadyMonthly = roundCents(
    bands
      .filter((b) => b.startIndex <= steadyMonth && steadyMonth <= b.endIndex)
      .reduce((total, b) => total + b.monthlyAmount, 0),
  );

  // `analyzePerson` computes `claimingOptions`, `breakEvens` and
  // `recommendedMonthly` from this person's OWN record alone. For a widow those
  // are not merely incomplete, they are misleading: her own benefit may be
  // smaller than the survivor benefit in every month she is alive, so a table
  // of "what you'd get claiming at 62 through 70" describes income she would
  // never receive, and a break-even between two of those ages compares two
  // irrelevant quantities. Measured: break-evens came out byte-identical
  // across every widowed golden fixture regardless of the deceased's PIA.
  //
  // Emptied HERE rather than guarded in each display component, so the
  // misleading section disappears by construction — `BreakEvenSection` already
  // renders nothing on an empty array. Every component remembering to check a
  // status is exactly the failure mode that put a survivor-blind break-even in
  // front of a widow in the first place.
  const own = analyzePerson(
    person,
    formatFilingAge(monthDurationBetween(person, best.ownFilingIndex)),
    assumptions.annualCola,
    asOf,
  );
  const people = [
    { ...own, claimingOptions: [], breakEvens: [], recommendedMonthly: steadyMonthly },
  ];
```

- [ ] **Step 5: Carry `piaEstimated` on the analysis**

Add to the `HouseholdAnalysis` interface in `src/lib/household.ts`:

```ts
  /**
   * Whether the deceased's PIA was recovered from a check amount rather than
   * known — a current check carries every COLA since filing, which the
   * engine's PIA does not, so the recovered figure is in that year's dollars.
   *
   * Null where there is no deceased record at all (single and married). A
   * display layer must label a `true` as an estimate rather than presenting it
   * as equivalent to a known PIA.
   */
  piaEstimated: boolean | null;
```

Set `piaEstimated: best.piaEstimated` in `analyzeWidowed`'s returned object, and `piaEstimated: null` in the single and married returns.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/household.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: every previously-passing test still passes. **If a single or married fixture value moved, STOP and report BLOCKED.** The widowed golden fixtures may need `recommendedMonthly` re-recorded if that field is pinned — check `validation/fixtures/scenarios.json` for a widowed `recommendedMonthly`; if one is pinned and moves, that is expected and is the one permitted movement, so document it in the scenario's `description` in `validation/scripts/gen-fixtures.mjs`.

- [ ] **Step 8: Prove the scoping test can fail**

Temporarily make `analyzePerson` return empty `claimingOptions` for every status, and re-run. The test *"still publishes them for single and married households"* MUST fail. Restore afterwards.

This project has shipped four tests that passed with the defect they existed to catch, and every task on this feature has had at least one found by mutation. An "is empty" assertion is satisfied by an implementation that empties everything.

- [ ] **Step 9: Commit**

```bash
git add src/lib/widowed.ts src/lib/household.ts src/lib/household.test.ts
git commit -m "fix: stop publishing survivor-blind figures for a widow"
```

---

### Task 2: Widowed form fields and validation

**Files:**
- Create: `src/lib/widowedForm.ts`
- Test: `src/lib/widowedForm.test.ts`

**Interfaces:**
- Consumes: `Deceased`, `DeceasedRecord`, `YearMonth`, `deceasedPia` from `./deceased`; `AlreadyClaimed` from `./widowed`.
- Produces:
  - `interface DeceasedFormFields`, `interface AlreadyClaimedFormFields`
  - `const BLANK_DECEASED: DeceasedFormFields`, `const BLANK_ALREADY_CLAIMED: AlreadyClaimedFormFields`
  - `type WidowedFieldError = 'deathBeforeBirth' | 'deathInFuture' | 'claimBeforeDeath' | 'claimBeforeBirth' | 'checkAmountUnreachable'`
  - `function widowedErrors(d, a, survivorBirth, asOf): Partial<Record<string, WidowedFieldError>>`
  - `function isWidowedComplete(d: DeceasedFormFields): boolean`
  - `function toDeceased(d: DeceasedFormFields): Deceased`
  - `function toAlreadyClaimed(a: AlreadyClaimedFormFields): AlreadyClaimed`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/widowedForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BLANK_ALREADY_CLAIMED,
  BLANK_DECEASED,
  isWidowedComplete,
  toAlreadyClaimed,
  toDeceased,
  widowedErrors,
  type DeceasedFormFields,
} from './widowedForm';

const asOf = new Date(2026, 0, 15);
const survivorBirth = { year: 1964, month: 6 };

const filled: DeceasedFormFields = {
  birthYear: 1960, birthMonth: 3,
  deathYear: 2024, deathMonth: 3,
  recordKind: 'pia',
  piaMonthly: 3000,
  hadFiled: false,
  checkAmount: '',
  filedYear: '',
  filedMonth: '',
};

describe('isWidowedComplete', () => {
  it('needs identity, a death date and a record', () => {
    expect(isWidowedComplete(BLANK_DECEASED)).toBe(false);
    expect(isWidowedComplete(filled)).toBe(true);
  });

  it('needs hadFiled answered on the PIA route', () => {
    expect(isWidowedComplete({ ...filled, hadFiled: null })).toBe(false);
  });

  it('needs the amount and the filing date on the check-amount route', () => {
    const check: DeceasedFormFields = {
      ...filled, recordKind: 'checkAmount', piaMonthly: '', hadFiled: null,
      checkAmount: 2400, filedYear: 2022, filedMonth: 5,
    };
    expect(isWidowedComplete(check)).toBe(true);
    expect(isWidowedComplete({ ...check, filedMonth: '' })).toBe(false);
    expect(isWidowedComplete({ ...check, checkAmount: '' })).toBe(false);
  });
});

describe('widowedErrors', () => {
  it('accepts a valid household', () => {
    expect(widowedErrors(filled, BLANK_ALREADY_CLAIMED, survivorBirth, asOf)).toEqual({});
  });

  it('rejects a death before the deceased was born', () => {
    const bad = { ...filled, deathYear: 1959, deathMonth: 12 };
    expect(widowedErrors(bad, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).death).toBe(
      'deathBeforeBirth',
    );
  });

  it('rejects a death in the future — widowed means it has happened', () => {
    const bad = { ...filled, deathYear: 2027, deathMonth: 1 };
    expect(widowedErrors(bad, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).death).toBe(
      'deathInFuture',
    );
  });

  it('accepts a death in the current month', () => {
    const edge = { ...filled, deathYear: 2026, deathMonth: 1 };
    expect(widowedErrors(edge, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).death).toBeUndefined();
  });

  it('rejects a survivor claim at or before the death month', () => {
    const at = { ...BLANK_ALREADY_CLAIMED, survivorSinceYear: 2024, survivorSinceMonth: 3 };
    expect(widowedErrors(filled, at, survivorBirth, asOf).survivorSince).toBe('claimBeforeDeath');

    const after = { ...BLANK_ALREADY_CLAIMED, survivorSinceYear: 2024, survivorSinceMonth: 4 };
    expect(widowedErrors(filled, after, survivorBirth, asOf).survivorSince).toBeUndefined();
  });

  it('rejects an own-benefit claim before the survivor was born', () => {
    const bad = { ...BLANK_ALREADY_CLAIMED, ownSinceYear: 1960, ownSinceMonth: 1 };
    expect(widowedErrors(filled, bad, survivorBirth, asOf).ownSince).toBe('claimBeforeBirth');
  });

  it('does NOT reject an already-claimed date in the past', () => {
    // A claimed date is a FACT, not a candidate. It legitimately sits before
    // today and must not be clamped forward or flagged.
    const past = { ...BLANK_ALREADY_CLAIMED, ownSinceYear: 2024, ownSinceMonth: 8 };
    expect(widowedErrors(filled, past, survivorBirth, asOf)).toEqual({});
  });

  it('rejects a check amount no real PIA could produce', () => {
    // `deceasedPia` throws on an out-of-bracket amount; the form must surface
    // that as a field error rather than let it escape as a crash.
    const bad: DeceasedFormFields = {
      ...filled, recordKind: 'checkAmount', piaMonthly: '', hadFiled: null,
      checkAmount: 500000, filedYear: 2022, filedMonth: 5,
    };
    expect(widowedErrors(bad, BLANK_ALREADY_CLAIMED, survivorBirth, asOf).checkAmount).toBe(
      'checkAmountUnreachable',
    );
  });

  it('accepts a large but reachable check amount', () => {
    // The guard must not be satisfiable by rejecting everything large.
    const ok: DeceasedFormFields = {
      ...filled, recordKind: 'checkAmount', piaMonthly: '', hadFiled: null,
      checkAmount: 3200, filedYear: 2022, filedMonth: 5,
    };
    expect(widowedErrors(ok, BLANK_ALREADY_CLAIMED, survivorBirth, asOf)).toEqual({});
  });
});

describe('toDeceased', () => {
  it('maps "had not filed" to a null filing date', () => {
    // 3B-i translates `filed: null` to deceasedFilingDate = deathDate, which
    // is the engine's own selector for its never-filed branch.
    expect(toDeceased(filled).record).toEqual({ kind: 'pia', piaMonthly: 3000, filed: null });
  });

  it('carries the filing date when they had filed', () => {
    const f = { ...filled, hadFiled: true, filedYear: 2018, filedMonth: 9 };
    expect(toDeceased(f).record).toEqual({
      kind: 'pia', piaMonthly: 3000, filed: { year: 2018, month: 9 },
    });
  });

  it('maps the check-amount route', () => {
    const c: DeceasedFormFields = {
      ...filled, recordKind: 'checkAmount', piaMonthly: '', hadFiled: null,
      checkAmount: 2400, filedYear: 2022, filedMonth: 5,
    };
    expect(toDeceased(c).record).toEqual({
      kind: 'checkAmount', monthlyAmount: 2400, filed: { year: 2022, month: 5 },
    });
  });
});

describe('toAlreadyClaimed', () => {
  it('maps blanks to null, not to zero', () => {
    expect(toAlreadyClaimed(BLANK_ALREADY_CLAIMED)).toEqual({
      survivorSince: null, ownSince: null,
    });
  });

  it('maps a partially-filled date to null rather than a nonsense month', () => {
    const partial = { ...BLANK_ALREADY_CLAIMED, survivorSinceYear: 2024, survivorSinceMonth: '' };
    expect(toAlreadyClaimed(partial as never).survivorSince).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/widowedForm.test.ts`
Expected: FAIL — `Failed to resolve import "./widowedForm"`.

- [ ] **Step 3: Implement `src/lib/widowedForm.ts`**

```ts
/**
 * The widowed household's form fields, their validation, and their conversion
 * into the shapes `analyzeHousehold` consumes.
 *
 * Kept out of `formState.ts`, which is already the app's busiest module, and
 * pure so every rule is testable without a DOM.
 *
 * The validation posture matches the rest of this project: block only what is
 * impossible or would produce a meaningless answer, and leave everything else
 * to the adviser's judgment. An unusual-looking PIA is not blocked — SSA's
 * maximum rises every year, and a hard ceiling would eventually reject a
 * legitimate high earner.
 */
import { deceasedPia, type Deceased, type DeceasedRecord, type YearMonth } from './deceased';
import type { AlreadyClaimed } from './widowed';

export interface DeceasedFormFields {
  birthYear: number | '';
  /** 1-12. */
  birthMonth: number | '';
  deathYear: number | '';
  /** 1-12. */
  deathMonth: number | '';
  /** Which route the adviser took: a known PIA, or the check they were receiving. */
  recordKind: 'pia' | 'checkAmount';
  /** PIA route. */
  piaMonthly: number | '';
  /**
   * PIA route only. `false` means they died without ever filing — a case the
   * engine treats specially. Null means unanswered, which blocks completeness:
   * defaulting it would silently pick one of two materially different
   * survivor-benefit bases.
   */
  hadFiled: boolean | null;
  /** Check-amount route. */
  checkAmount: number | '';
  /** The month they filed. Required on the check-amount route; used on the PIA route when `hadFiled`. */
  filedYear: number | '';
  /** 1-12. */
  filedMonth: number | '';
}

export interface AlreadyClaimedFormFields {
  survivorSinceYear: number | '';
  /** 1-12. */
  survivorSinceMonth: number | '';
  ownSinceYear: number | '';
  /** 1-12. */
  ownSinceMonth: number | '';
}

export const BLANK_DECEASED: DeceasedFormFields = {
  birthYear: '',
  birthMonth: '',
  deathYear: '',
  deathMonth: '',
  recordKind: 'pia',
  piaMonthly: '',
  hadFiled: null,
  checkAmount: '',
  filedYear: '',
  filedMonth: '',
};

export const BLANK_ALREADY_CLAIMED: AlreadyClaimedFormFields = {
  survivorSinceYear: '',
  survivorSinceMonth: '',
  ownSinceYear: '',
  ownSinceMonth: '',
};

export type WidowedFieldError =
  | 'deathBeforeBirth'
  | 'deathInFuture'
  | 'claimBeforeDeath'
  | 'claimBeforeBirth'
  | 'checkAmountUnreachable';

/** Absolute month index, matching `benefitPeriods.ts`'s convention. */
const idx = (year: number, month: number): number => year * 12 + (month - 1);

/** A year/month pair, or null when either half is blank. Never a partial date. */
function pair(year: number | '', month: number | ''): YearMonth | null {
  if (year === '' || month === '') return null;
  return { year, month };
}

export function isWidowedComplete(d: DeceasedFormFields): boolean {
  if (d.birthYear === '' || d.birthMonth === '') return false;
  if (d.deathYear === '' || d.deathMonth === '') return false;

  if (d.recordKind === 'checkAmount') {
    return d.checkAmount !== '' && d.filedYear !== '' && d.filedMonth !== '';
  }

  if (d.piaMonthly === '' || d.hadFiled === null) return false;
  // "They had filed" is only meaningful with a date to go with it.
  return d.hadFiled ? d.filedYear !== '' && d.filedMonth !== '' : true;
}

/**
 * Field errors, keyed by the field they belong beside. An empty object means
 * nothing is blocking.
 *
 * Incomplete input is NOT an error — a half-typed date is a form in progress,
 * and `isWidowedComplete` is what gates the analysis. This reports only
 * combinations that are complete and impossible.
 */
export function widowedErrors(
  d: DeceasedFormFields,
  a: AlreadyClaimedFormFields,
  survivorBirth: YearMonth,
  asOf: Date,
): Partial<Record<'death' | 'survivorSince' | 'ownSince' | 'checkAmount', WidowedFieldError>> {
  const errors: Partial<
    Record<'death' | 'survivorSince' | 'ownSince' | 'checkAmount', WidowedFieldError>
  > = {};

  const birth = pair(d.birthYear, d.birthMonth);
  const death = pair(d.deathYear, d.deathMonth);
  const asOfIndex = idx(asOf.getFullYear(), asOf.getMonth() + 1);

  if (death) {
    if (birth && idx(death.year, death.month) < idx(birth.year, birth.month)) {
      errors.death = 'deathBeforeBirth';
    } else if (idx(death.year, death.month) > asOfIndex) {
      // Strictly after: a death in the current month has happened.
      errors.death = 'deathInFuture';
    }
  }

  const survivorBirthIndex = idx(survivorBirth.year, survivorBirth.month);
  const claims: [keyof typeof errors, YearMonth | null][] = [
    ['survivorSince', pair(a.survivorSinceYear, a.survivorSinceMonth)],
    ['ownSince', pair(a.ownSinceYear, a.ownSinceMonth)],
  ];
  for (const [field, claim] of claims) {
    if (!claim) continue;
    const claimIndex = idx(claim.year, claim.month);
    if (claimIndex < survivorBirthIndex) {
      errors[field] = 'claimBeforeBirth';
    } else if (death && claimIndex <= idx(death.year, death.month)) {
      // A benefit that depends on the death cannot precede it, and SSA pays
      // from the month AFTER. `survivorBenefit` throws on the equal case.
      errors[field] = 'claimBeforeDeath';
    }
    // Deliberately no "in the past" check: an already-claimed date is a FACT,
    // and clamping or flagging it would contradict the model, which searches
    // around it rather than over it.
  }

  if (d.recordKind === 'checkAmount' && isWidowedComplete(d)) {
    try {
      deceasedPia(toDeceased(d));
    } catch {
      // `deceasedPia` throws when no PIA in its bracket could pay this amount —
      // a data-entry error, surfaced here rather than escaping as a crash.
      errors.checkAmount = 'checkAmountUnreachable';
    }
  }

  return errors;
}

function toRecord(d: DeceasedFormFields): DeceasedRecord {
  if (d.recordKind === 'checkAmount') {
    return {
      kind: 'checkAmount',
      monthlyAmount: d.checkAmount as number,
      filed: pair(d.filedYear, d.filedMonth) as YearMonth,
    };
  }
  return {
    kind: 'pia',
    piaMonthly: d.piaMonthly as number,
    filed: d.hadFiled ? pair(d.filedYear, d.filedMonth) : null,
  };
}

/** Only meaningful once `isWidowedComplete` is true. */
export function toDeceased(d: DeceasedFormFields): Deceased {
  return {
    birthYear: d.birthYear as number,
    birthMonth: d.birthMonth as number,
    deathYear: d.deathYear as number,
    deathMonth: d.deathMonth as number,
    record: toRecord(d),
  };
}

export function toAlreadyClaimed(a: AlreadyClaimedFormFields): AlreadyClaimed {
  return {
    survivorSince: pair(a.survivorSinceYear, a.survivorSinceMonth),
    ownSince: pair(a.ownSinceYear, a.ownSinceMonth),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/widowedForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the check-amount guard test can fail**

Temporarily change the `checkAmount` guard to always set the error, and re-run. The test *"accepts a large but reachable check amount"* MUST fail. Then change it to never set the error; *"rejects a check amount no real PIA could produce"* MUST fail. Restore afterwards.

- [ ] **Step 6: Commit**

```bash
git add src/lib/widowedForm.ts src/lib/widowedForm.test.ts
git commit -m "feat: widowed form fields, validation and conversion"
```

---

### Task 3: Three-way marital status in form state

**Files:**
- Modify: `src/lib/formState.ts`
- Test: `src/lib/formState.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces: `AnalyzerFormState.maritalStatus: 'single' | 'married' | 'widowed' | null`, `.deceased: DeceasedFormFields`, `.alreadyClaimed: AlreadyClaimedFormFields`. `hasSpouse` is **removed**.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/formState.test.ts`:

```ts
describe('widowed form state', () => {
  const survivor = {
    name: '', birthYear: 1964, birthMonth: 6, gender: 'female' as const,
    monthlyBenefit: 1200, lifeExpectancy: 92,
  };
  const deceased = {
    birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
    recordKind: 'pia' as const, piaMonthly: 3000, hadFiled: false,
    checkAmount: '' as const, filedYear: '' as const, filedMonth: '' as const,
  };
  const form: AnalyzerFormState = {
    ...BLANK_FORM,
    maritalStatus: 'widowed',
    personA: survivor,
    deceased,
  };

  it('builds a widowed household', () => {
    const household = toHousehold(form);
    expect(household.status).toBe('widowed');
    if (household.status !== 'widowed') throw new Error('expected widowed');
    expect(household.people).toHaveLength(1);
    expect(household.deceased.record).toEqual({ kind: 'pia', piaMonthly: 3000, filed: null });
    expect(household.alreadyClaimed).toEqual({ survivorSince: null, ownSince: null });
  });

  it('is incomplete until the deceased record is filled in', () => {
    expect(isFormComplete({ ...form, deceased: BLANK_DECEASED })).toBe(false);
    expect(isFormComplete(form)).toBe(true);
  });

  it('is incomplete while a field error is outstanding', () => {
    const impossible = { ...form, deceased: { ...deceased, deathYear: 2027 } };
    expect(isFormComplete(impossible)).toBe(false);
  });

  it('still builds single and married households', () => {
    // The three-way change must not disturb the two existing statuses.
    expect(toHousehold({ ...BLANK_FORM, maritalStatus: 'single', personA: survivor }).status)
      .toBe('single');
    const married = toHousehold({
      ...BLANK_FORM, maritalStatus: 'married', personA: survivor, personB: survivor,
    });
    expect(married.status).toBe('married');
    expect(married.people).toHaveLength(2);
  });
});
```

Add `BLANK_DECEASED` to that file's imports from `./widowedForm`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/formState.test.ts`
Expected: FAIL — `maritalStatus` does not exist on `AnalyzerFormState`.

- [ ] **Step 3: Change the form state shape**

In `src/lib/formState.ts`, replace `hasSpouse` on `AnalyzerFormState`:

```ts
  /**
   * Null means "not yet chosen", which is what gates the analysis. Replaces the
   * former boolean `hasSpouse`: a widowed household is neither single nor
   * married, and a third boolean would have made every read site guess.
   */
  maritalStatus: 'single' | 'married' | 'widowed' | null;
  /** Only meaningful when `maritalStatus === 'widowed'`. */
  deceased: DeceasedFormFields;
  /** Only meaningful when `maritalStatus === 'widowed'`. */
  alreadyClaimed: AlreadyClaimedFormFields;
```

Add to `BLANK_FORM`: `maritalStatus: null`, `deceased: BLANK_DECEASED`, `alreadyClaimed: BLANK_ALREADY_CLAIMED`.

Import from `./widowedForm`:

```ts
import {
  BLANK_ALREADY_CLAIMED,
  BLANK_DECEASED,
  isWidowedComplete,
  toAlreadyClaimed,
  toDeceased,
  widowedErrors,
  type AlreadyClaimedFormFields,
  type DeceasedFormFields,
} from './widowedForm';
```

- [ ] **Step 4: Update `toHousehold` and `isFormComplete`**

```ts
export function toHousehold(form: AnalyzerFormState): Household {
  const personA = toPerson(form.personA, 'a');
  if (form.maritalStatus === 'widowed') {
    return {
      status: 'widowed',
      people: [personA],
      deceased: toDeceased(form.deceased),
      alreadyClaimed: toAlreadyClaimed(form.alreadyClaimed),
    };
  }
  if (form.maritalStatus !== 'married') return { status: 'single', people: [personA] };
  return { status: 'married', people: [personA, toPerson(form.personB, 'b')] };
}
```

In `isFormComplete`, replace the `hasSpouse` reads:

```ts
export function isFormComplete(form: AnalyzerFormState): boolean {
  if (form.maritalStatus === null || form.personA.lifeExpectancy === null) return false;
  if (!isPersonComplete(form.personA)) return false;
  // Married analyses require real spouse data — never defaulted from person A.
  if (form.maritalStatus === 'married' && !isPersonComplete(form.personB)) return false;

  if (form.maritalStatus === 'widowed') {
    if (!isWidowedComplete(form.deceased)) return false;
    // An impossible combination must not reach the engine — several of these
    // produce a throw rather than a wrong answer.
    const { birthYear, birthMonth } = form.personA;
    if (birthYear === '' || birthMonth === '') return false;
    const errors = widowedErrors(
      form.deceased,
      form.alreadyClaimed,
      { year: birthYear, month: birthMonth },
      new Date(),
    );
    if (Object.keys(errors).length > 0) return false;
  }

  // A person with no work record of their own is legitimate — they may draw a
  // spousal benefit on their partner's record. A household where *nobody*
  // earns has nothing to analyze. A widow always has the deceased's record.
  if (form.maritalStatus === 'widowed') return true;
  const benefits =
    form.maritalStatus === 'married'
      ? [form.personA.monthlyBenefit, form.personB.monthlyBenefit]
      : [form.personA.monthlyBenefit];
  return benefits.some((b) => b !== '' && b > 0);
}
```

- [ ] **Step 5: Fix every remaining `hasSpouse` reference**

Run `grep -rn "hasSpouse" src/` and update each site. The compiler will find them too — `npx tsc -b`. Expect hits in `src/lib/shareLink.ts` (Task 4 rewrites these; for now make it compile by reading `maritalStatus`) and `src/components/Analyzer.tsx` (Task 5).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run && npx tsc -b`
Expected: PASS, and the compiler clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/formState.ts src/lib/formState.test.ts src/lib/shareLink.ts src/components/Analyzer.tsx
git commit -m "feat: make marital status three-way"
```

---

### Task 4: Share links

**Files:**
- Modify: `src/lib/shareLink.ts`
- Test: `src/lib/shareLink.test.ts`

**Interfaces:**
- Consumes: `AnalyzerFormState` from Task 3.
- Produces: no new exports; `toShareParams` / `fromShareParams` handle widowed.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/shareLink.test.ts`:

```ts
describe('widowed share links', () => {
  const form: AnalyzerFormState = {
    ...BLANK_FORM,
    maritalStatus: 'widowed',
    personA: {
      name: '', birthYear: 1964, birthMonth: 6, gender: 'female',
      monthlyBenefit: 1200, lifeExpectancy: 92,
    },
    deceased: {
      birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
      recordKind: 'pia', piaMonthly: 3000, hadFiled: true,
      checkAmount: '', filedYear: 2022, filedMonth: 5,
    },
    alreadyClaimed: {
      survivorSinceYear: 2024, survivorSinceMonth: 8, ownSinceYear: '', ownSinceMonth: '',
    },
  };

  it('round-trips a widowed household', () => {
    const back = fromShareParams(toShareParams(form));
    expect(back.maritalStatus).toBe('widowed');
    expect(back.deceased).toEqual(form.deceased);
    expect(back.alreadyClaimed).toEqual(form.alreadyClaimed);
  });

  it('round-trips the check-amount route', () => {
    const check = {
      ...form,
      deceased: {
        ...form.deceased, recordKind: 'checkAmount' as const, piaMonthly: '' as const,
        hadFiled: null, checkAmount: 2400,
      },
    };
    expect(fromShareParams(toShareParams(check)).deceased).toEqual(check.deceased);
  });

  it('leaves an unset already-claimed date absent, not zero', () => {
    const params = toShareParams(form);
    expect(params.get('coy')).toBeNull();
    expect(fromShareParams(params).alreadyClaimed.ownSinceYear).toBe('');
  });

  it('writes no widowed parameters for a married household', () => {
    const married = { ...BLANK_FORM, maritalStatus: 'married' as const };
    const params = toShareParams(married);
    expect(params.get('dy')).toBeNull();
    expect(params.get('m')).toBe('1');
  });
});

describe('legacy share links', () => {
  // Links already in circulation carry m=1 / m=0. They must keep working
  // unchanged — that compatibility is why the widowed value was added to this
  // parameter rather than replacing it.
  it('still reads m=1 as married and m=0 as single', () => {
    expect(fromShareParams(new URLSearchParams('m=1')).maritalStatus).toBe('married');
    expect(fromShareParams(new URLSearchParams('m=0')).maritalStatus).toBe('single');
  });

  it('leaves the status unchosen when m is absent or unrecognised', () => {
    expect(fromShareParams(new URLSearchParams('')).maritalStatus).toBeNull();
    expect(fromShareParams(new URLSearchParams('m=x')).maritalStatus).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/shareLink.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the widowed parameters**

In `src/lib/shareLink.ts`, add near the other helpers:

```ts
/**
 * Widowed parameters. Prefixed `d` for the deceased and `c` for what the
 * survivor has already claimed, so none can collide with the `a`/`b` person
 * prefixes already in use.
 */
function writeWidowed(params: URLSearchParams, form: AnalyzerFormState): void {
  const d = form.deceased;
  if (d.birthYear !== '') params.set('dy', String(d.birthYear));
  if (d.birthMonth !== '') params.set('dm', String(d.birthMonth));
  if (d.deathYear !== '') params.set('ddy', String(d.deathYear));
  if (d.deathMonth !== '') params.set('ddm', String(d.deathMonth));
  params.set('dk', d.recordKind === 'checkAmount' ? 'c' : 'p');
  if (d.piaMonthly !== '') params.set('dp', String(d.piaMonthly));
  if (d.checkAmount !== '') params.set('dc', String(d.checkAmount));
  if (d.hadFiled !== null) params.set('df', d.hadFiled ? '1' : '0');
  if (d.filedYear !== '') params.set('dfy', String(d.filedYear));
  if (d.filedMonth !== '') params.set('dfm', String(d.filedMonth));

  const a = form.alreadyClaimed;
  if (a.survivorSinceYear !== '') params.set('csy', String(a.survivorSinceYear));
  if (a.survivorSinceMonth !== '') params.set('csm', String(a.survivorSinceMonth));
  if (a.ownSinceYear !== '') params.set('coy', String(a.ownSinceYear));
  if (a.ownSinceMonth !== '') params.set('com', String(a.ownSinceMonth));
}

function readWidowed(params: URLSearchParams): {
  deceased: DeceasedFormFields;
  alreadyClaimed: AlreadyClaimedFormFields;
} {
  const hadFiled = params.get('df');
  return {
    deceased: {
      birthYear: num(params, 'dy') ?? '',
      birthMonth: num(params, 'dm') ?? '',
      deathYear: num(params, 'ddy') ?? '',
      deathMonth: num(params, 'ddm') ?? '',
      recordKind: params.get('dk') === 'c' ? 'checkAmount' : 'pia',
      piaMonthly: num(params, 'dp') ?? '',
      hadFiled: hadFiled === '1' ? true : hadFiled === '0' ? false : null,
      checkAmount: num(params, 'dc') ?? '',
      filedYear: num(params, 'dfy') ?? '',
      filedMonth: num(params, 'dfm') ?? '',
    },
    alreadyClaimed: {
      survivorSinceYear: num(params, 'csy') ?? '',
      survivorSinceMonth: num(params, 'csm') ?? '',
      ownSinceYear: num(params, 'coy') ?? '',
      ownSinceMonth: num(params, 'com') ?? '',
    },
  };
}
```

Import the two types from `./widowedForm`, and `BLANK_ALREADY_CLAIMED` / `BLANK_DECEASED` for the non-widowed case.

In `toShareParams`, replace the `hasSpouse` lines:

```ts
  if (form.maritalStatus !== null) {
    params.set(
      'm',
      form.maritalStatus === 'married' ? '1' : form.maritalStatus === 'widowed' ? 'w' : '0',
    );
  }
  if (form.maritalStatus === 'married') writePerson(params, 'b', form.personB);
  if (form.maritalStatus === 'widowed') writeWidowed(params, form);
```

In `fromShareParams`, replace the `married` / `hasSpouse` lines:

```ts
  // `m=1` and `m=0` predate the widowed status and MUST keep their meaning:
  // links already in circulation carry them, and their recipient cannot see
  // that a parameter changed meaning. `w` is a third value on the same key
  // rather than a new key, for exactly that reason.
  const statusParam = params.get('m');
  const maritalStatus: AnalyzerFormState['maritalStatus'] =
    statusParam === '1'
      ? 'married'
      : statusParam === '0'
        ? 'single'
        : statusParam === 'w'
          ? 'widowed'
          : null;
```

and in the returned object:

```ts
    personB: maritalStatus === 'married' ? readPerson(params, 'b') : BLANK_FORM.personB,
    maritalStatus,
    ...(maritalStatus === 'widowed'
      ? readWidowed(params)
      : { deceased: BLANK_DECEASED, alreadyClaimed: BLANK_ALREADY_CLAIMED }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/shareLink.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the legacy test can fail**

Temporarily make `m=1` map to `'single'` and re-run. The legacy test MUST fail. Restore afterwards. Backward compatibility that nothing asserts is backward compatibility that will be broken silently.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shareLink.ts src/lib/shareLink.test.ts
git commit -m "feat: carry a widowed household in a share link"
```

---

### Task 5: The intake UI

**Files:**
- Create: `src/components/DeceasedFields.tsx`
- Modify: `src/components/Analyzer.tsx`
- Test: `src/components/DeceasedFields.test.tsx`

**Interfaces:**
- Consumes: everything Tasks 2-4 produce.
- Produces: `<DeceasedFields deceased alreadyClaimed errors onDeceasedChange onAlreadyClaimedChange />`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/DeceasedFields.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeceasedFields } from './DeceasedFields';
import { BLANK_ALREADY_CLAIMED, BLANK_DECEASED } from '../lib/widowedForm';

const noop = () => {};

function renderFields(overrides = {}) {
  return render(
    <DeceasedFields
      deceased={BLANK_DECEASED}
      alreadyClaimed={BLANK_ALREADY_CLAIMED}
      errors={{}}
      onDeceasedChange={noop}
      onAlreadyClaimedChange={noop}
      {...overrides}
    />,
  );
}

describe('DeceasedFields', () => {
  it('asks for the deceased identity and death date', () => {
    renderFields();
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date of death/i)).toBeInTheDocument();
  });

  it('shows the PIA route by default and the check route on request', async () => {
    const onDeceasedChange = vi.fn();
    renderFields({ onDeceasedChange });
    expect(screen.getByLabelText(/benefit at full retirement age/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /monthly check/i }));
    expect(onDeceasedChange).toHaveBeenCalledWith(
      expect.objectContaining({ recordKind: 'checkAmount' }),
    );
  });

  it('renders a field error where the field is', () => {
    renderFields({ errors: { death: 'deathInFuture' } });
    expect(screen.getByText(/cannot be in the future/i)).toBeInTheDocument();
  });

  it('renders nothing about an estimate on the PIA route', () => {
    // The estimate caveat belongs to the check-amount route only; showing it
    // on a known PIA would be a true sentence beside a number it does not
    // describe — this project's recurring defect shape.
    renderFields();
    expect(screen.queryByText(/estimate/i)).not.toBeInTheDocument();
  });

  it('says the check-amount route is an estimate', async () => {
    renderFields({ deceased: { ...BLANK_DECEASED, recordKind: 'checkAmount' } });
    expect(screen.getByText(/estimate/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/DeceasedFields.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/DeceasedFields.tsx`**

Follow `src/components/PersonFields.tsx` exactly for markup conventions: a `<fieldset className="person-fields">` with a `<legend>`, `.field` wrappers, `.field-hint` for hints, and the same month/year select-plus-input pairing. Read that file before writing this one and mirror it — a field group that looks different from the one above it reads as a bug.

Required behaviour:
- Deceased date of birth and date of death, month + year, same controls as `PersonFields`.
- A two-button segmented control for the record route, labelled **Benefit at full retirement age** and **Monthly check they received**, matching the existing `.segmented-control` markup in `Analyzer.tsx`.
- PIA route: the amount, plus a Yes/No control for "Had they filed before they died?" and, when Yes, the filing month.
- Check route: the amount and the filing month, plus a hint reading exactly: `This is an estimate — a current check includes every cost-of-living increase since they filed, which the benefit formula does not.`
- Two optional already-claiming dates, under a hint reading exactly: `Leave blank if they have not started that benefit yet.`
- Error text per `WidowedFieldError`: `deathBeforeBirth` → `Date of death cannot be before date of birth.`; `deathInFuture` → `Date of death cannot be in the future.`; `claimBeforeDeath` → `A survivor benefit cannot start before the month after the death.`; `claimBeforeBirth` → `That date is before this person was born.`; `checkAmountUnreachable` → `No Social Security benefit reaches that amount — check for an extra digit.`

Put the error strings in one `const ERROR_TEXT: Record<WidowedFieldError, string>` in this file. They are field-level UI text with no print counterpart, so they do not belong in `methodologyCopy.ts`, which is for sentences shared between screen and PDF.

- [ ] **Step 4: Wire it into `Analyzer.tsx`**

- Replace `hasSpouse` state with `maritalStatus`, and `handleMaritalChange(false | true)` with `handleMaritalChange('single' | 'married' | 'widowed')`.
- Add a third `<button>` to the existing `.segmented-control`, labelled `Widowed`, following the two already there exactly.
- Render `<DeceasedFields …>` when `maritalStatus === 'widowed'`, in the same position `<PersonFields person={personB} …>` occupies for married.
- Compute `errors` with `widowedErrors(deceased, alreadyClaimed, {year, month} from personA, new Date())` and pass them down. Guard the call: person A's birth year/month may still be blank, in which case pass no errors.
- Update the hint under the control to cover the third option. Current text: `Married uses ssa.tools couple optimizer (includes the spousal top-up)`. New text: `Married uses the ssa.tools couple optimizer. Widowed models the survivor benefit and your own, claimed on separate dates.`
- Thread `deceased` and `alreadyClaimed` into the `form` memo and its dependency array.

- [ ] **Step 5: Run the component tests and the full suite**

Run: `npx vitest run && npx tsc -b && npm run lint`
Expected: PASS and clean.

- [ ] **Step 6: Confirm a widowed household still does not render**

Run: `npx vitest run src/components`
Then, manually verify the guard is intact:

```bash
grep -n "Phase 3B-ii-b" src/lib/household.ts
```

Expected: the `householdDisplayShape` throw is still present. **If entering a widowed household in the UI now renders a result rather than surfacing that error, this task has exceeded its scope** — the analysis is reachable but must not be displayed until 3B-ii-b.

- [ ] **Step 7: Add an e2e test**

Append to `validation/e2e/interactions.spec.ts`, following the existing `reveals spouse fields and refuses to analyze until they are complete` test as the model:

```ts
test('reveals the deceased fields when Widowed is chosen', async ({ page }) => {
  await gotoApp(page);
  await fillPerson(page, 0, { year: 1964, month: 6, gender: 'female', benefit: 1200 });
  await page.getByRole('button', { name: 'Widowed' }).click();
  await expect(page.getByLabel(/date of death/i)).toBeVisible();
});
```

Use whatever helpers that file already defines for navigation and filling a person; do not invent new ones.

- [ ] **Step 8: Run everything**

```bash
npm run lint && npx tsc -b && npx vitest run && npm run build && PW_PORT=4199 npm run test:e2e && npm run sweep
```

- [ ] **Step 9: Commit**

```bash
git add src/components validation/e2e
git commit -m "feat: collect a widowed household"
```

---

## Self-review

**Spec coverage.** Three-way status → Task 3. Deceased record both routes → Tasks 2, 5. Already-claimed as facts → Task 2 (`toAlreadyClaimed`, and the deliberate absence of a past-date check). Validation → Task 2. Share links with legacy compatibility → Task 4. Survivor-blind figures → Task 1. `piaEstimated` carrier → Task 1. Guard stays up → Task 5 Step 6.

**Not covered, by design:** all widowed rendering, the `benefitMath.ts` rebuild, the `expectedNpv` mislabel, and type-checking the test suite — all 3B-ii-b or later, all listed in the spec's Out of scope.

**Known risk to watch during execution.** Task 3 Step 5 removes `hasSpouse` repo-wide, which touches files Tasks 4 and 5 also change. The compiler finds every site, but the intermediate commit at the end of Task 3 will contain small edits to `shareLink.ts` and `Analyzer.tsx` that those later tasks then rewrite. That is deliberate — the alternative is a broken build between tasks — but a reviewer seeing `shareLink.ts` in Task 3's diff should expect it.
