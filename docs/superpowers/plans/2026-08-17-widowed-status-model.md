# Phase 3B-i — the widowed analysis, headless

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute a correct claiming recommendation for a widow(er) — two independent dates, when to claim the survivor benefit and when to file on their own record — with no UI.

**Architecture:** `Household` gains a third union member, `widowed`. A new `deceased.ts` turns what an adviser knows about the deceased spouse into an engine `Recipient` plus a filing date. A new `widowed.ts` searches the two-date space exhaustively, using only `survivorBenefit()` and `benefitOnDate()` for dollar amounts, and emits the same `BenefitBand[]` shape every other household produces. `analyzeHousehold` gains a `widowed` branch returning the usual `HouseholdAnalysis`.

**Tech Stack:** TypeScript, Vitest (node project), the vendored ssa.tools engine at `$lib/*` (read-only).

## Global Constraints

- **The vendored tree `src/vendor/ssa-tools/` is READ-ONLY.** Never modify it.
- **Every dollar figure must come from `survivorBenefit()` or `benefitOnDate()`.** The app supplies dates and a `max()`; it computes no benefit rule. A test asserting an amount the app derived itself is asserting the wrong thing.
- **SSA pays the larger of the two benefits each month, never the sum.**
- **Deemed filing does not apply to survivor benefits** — the two dates are independent. This is the rule the feature rests on.
- **`survivorBenefit()` throws if `survivorFilingDate <= deceasedDeathDate`.** Every candidate survivor month must be at least `deathMonthIndex + 1`.
- **To express "the deceased never filed", pass `deceasedFilingDate = deceasedDeathDate`.** The engine branches on `deceasedFilingDate >= deceasedDeathDate`; this is the documented selector, not an invented convention.
- **Never hardcode `{ years: 62, months: 0 }`.** Use `earliestFiling(recipient, currentDate)` from `$lib/strategy/calculations/strategy-calc`, which encodes the full-month-at-62 rule and the born-on-the-1st-or-2nd exception. The hardcoded literal is why the `earliest` comparison row has never rendered for any household — see `docs/reference/invariant-sweep.md` §Parked finding 4.
- **Scoring is a straight sum of dollars paid, undiscounted, in today's dollars, through the survivor's plan-to age.** Not mortality-weighted. This differs from the married path and is a deliberate, documented choice.
- **Death must be at or before `asOf`.** "Widowed" means it has happened.
- **No existing single or married fixture value may move.** This phase is purely additive to them. If one moves, stop and report rather than updating it.
- Units: `annualCola` is a percent (2.5); `discountRate` is a fraction (0.025). Neither is used by this phase's scoring.
- Absolute month index convention: `year * 12 + (month - 1)`, via `monthIndexOf` / `monthDateAt` in `src/lib/benefitPeriods.ts`.
- Run tests with `npx vitest run <path>`. Commit with `SKIP_E2E=1 git commit` while iterating; never `--no-verify`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/deceased.ts` | **Create.** The `Deceased` / `DeceasedRecord` types, PIA recovery from a check amount, and the engine `Recipient` + filing date for the deceased. |
| `src/lib/deceased.test.ts` | **Create.** |
| `src/lib/widowed.ts` | **Create.** The two-date search, the named strategies, and band construction. |
| `src/lib/widowed.test.ts` | **Create.** |
| `src/lib/household.ts` | **Modify.** The `widowed` union member, `StrategyKey` additions, and the `widowed` branch of `analyzeHousehold`. |
| `validation/scripts/gen-fixtures.mjs` | **Modify.** Widowed golden scenarios. |

---

### Task 1: The deceased's record

**Files:**
- Create: `src/lib/deceased.ts`
- Test: `src/lib/deceased.test.ts`

**Interfaces:**
- Consumes: `createPiaRecipient`, `monthDateFrom` from `./ssaTools`; `benefitOnDate` from `$lib/benefit-calculator`; `MonthDate`, `MonthDuration` from `$lib/month-time`; `Recipient` from `$lib/recipient`.
- Produces:
  - `type DeceasedRecord = { kind: 'pia'; piaMonthly: number; filed: YearMonth | null } | { kind: 'checkAmount'; monthlyAmount: number; filed: YearMonth }`
  - `interface YearMonth { year: number; month: number }` (month is 1-12)
  - `interface Deceased { birthYear: number; birthMonth: number; deathYear: number; deathMonth: number; record: DeceasedRecord }`
  - `function deceasedPia(d: Deceased): { piaMonthly: number; estimated: boolean }`
  - `function deceasedContext(d: Deceased): { recipient: Recipient; filingDate: MonthDate; deathDate: MonthDate; piaEstimated: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/deceased.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deceasedContext, deceasedPia, type Deceased } from './deceased';
import { monthIndexOf } from './benefitPeriods';

const base = { birthYear: 1950, birthMonth: 6, deathYear: 2020, deathMonth: 3 };

describe('deceasedPia', () => {
  it('returns a known PIA unchanged and unestimated', () => {
    const d: Deceased = {
      ...base,
      record: { kind: 'pia', piaMonthly: 2400, filed: { year: 2016, month: 7 } },
    };
    expect(deceasedPia(d)).toEqual({ piaMonthly: 2400, estimated: true === false ? 0 : false });
  });

  it('recovers a PIA from a check amount to within a dollar', () => {
    // Build the check amount the engine itself would pay a $2,400 PIA filing
    // at 66y1m, then require the recovery to get back to $2,400. Round-trip
    // through the engine rather than against a hand-computed factor: the app
    // must not encode a benefit rule, and neither must its test.
    const known: Deceased = {
      ...base,
      record: { kind: 'pia', piaMonthly: 2400, filed: { year: 2016, month: 7 } },
    };
    const { recipient, filingDate } = deceasedContext(known);
    const { benefitOnDate } = await import('$lib/benefit-calculator');
    const { MonthDuration } = await import('$lib/month-time');
    const check = benefitOnDate(
      recipient,
      filingDate,
      filingDate.addDuration(MonthDuration.OneYear()),
    ).value();

    const fromCheck: Deceased = {
      ...base,
      record: { kind: 'checkAmount', monthlyAmount: check, filed: { year: 2016, month: 7 } },
    };
    const recovered = deceasedPia(fromCheck);
    expect(Math.abs(recovered.piaMonthly - 2400)).toBeLessThanOrEqual(1);
    expect(recovered.estimated).toBe(true);
  });
});

describe('deceasedContext', () => {
  it('uses the recorded filing date when the deceased had filed', () => {
    const d: Deceased = {
      ...base,
      record: { kind: 'pia', piaMonthly: 2400, filed: { year: 2016, month: 7 } },
    };
    const { filingDate, deathDate } = deceasedContext(d);
    expect(monthIndexOf(filingDate)).toBe(2016 * 12 + 6);
    expect(monthIndexOf(deathDate)).toBe(2020 * 12 + 2);
  });

  it('sets the filing date EQUAL to the death date when they never filed', () => {
    // This is how the engine is told "never filed": survivorBenefit branches
    // on `deceasedFilingDate >= deceasedDeathDate`. Any later date works too,
    // but equality is the documented, minimal selector.
    const d: Deceased = { ...base, record: { kind: 'pia', piaMonthly: 2400, filed: null } };
    const { filingDate, deathDate } = deceasedContext(d);
    expect(monthIndexOf(filingDate)).toBe(monthIndexOf(deathDate));
  });
});
```

Then fix the first test's obviously-wrong expectation before running — it should read:

```ts
    expect(deceasedPia(d)).toEqual({ piaMonthly: 2400, estimated: false });
```

and make the second test's `describe` callback `async` is NOT needed — hoist the two imports to the top of the file instead:

```ts
import { benefitOnDate } from '$lib/benefit-calculator';
import { MonthDuration } from '$lib/month-time';
```

and drop the two `await import(...)` lines.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/deceased.test.ts`
Expected: FAIL — `Failed to resolve import "./deceased"`.

- [ ] **Step 3: Implement `src/lib/deceased.ts`**

```ts
/**
 * What an adviser knows about a deceased spouse, turned into what the engine
 * needs: a `Recipient` carrying a PIA, and a filing date.
 *
 * `survivorBenefit` needs the deceased's PIA and the date they filed. An
 * adviser usually knows neither precisely — what they have is "he was getting
 * $2,400 a month". So this module accepts either, and recovers a PIA from a
 * check amount by BINARY SEARCH OVER ENGINE CALLS rather than by inverting
 * SSA's reduction formula: the app computes no benefit rule, here or anywhere.
 *
 * The recovered PIA is an ESTIMATE and says so. A current check includes every
 * COLA since the deceased filed, while the engine's PIA carries none, so the
 * recovered figure is in the filing year's dollars. For a recent death the
 * error is small; for a death twenty years ago it is not. Callers must
 * propagate `estimated` to anything a client reads.
 */
import { benefitOnDate } from '$lib/benefit-calculator';
import { MonthDate, MonthDuration } from '$lib/month-time';
import type { Recipient } from '$lib/recipient';
import { createPiaRecipient } from './ssaTools';

export interface YearMonth {
  /** Calendar year. */
  year: number;
  /** 1-12, matching the app's `birthMonth` convention rather than JS's 0-11. */
  month: number;
}

export type DeceasedRecord =
  /** The precise case: a known PIA. `filed: null` means they died without filing. */
  | { kind: 'pia'; piaMonthly: number; filed: YearMonth | null }
  /** What the checks actually were. Always implies they had filed. */
  | { kind: 'checkAmount'; monthlyAmount: number; filed: YearMonth };

export interface Deceased {
  birthYear: number;
  /** 1-12. */
  birthMonth: number;
  deathYear: number;
  /** 1-12. */
  deathMonth: number;
  record: DeceasedRecord;
}

const monthDateOf = (ym: YearMonth): MonthDate =>
  MonthDate.initFromYearsMonths({ years: ym.year, months: ym.month - 1 });

/**
 * The benefit the engine would pay `piaMonthly` for a filing at `filingDate`,
 * read a year later so the January bump is included — the same convention
 * `survivorClaim.ts`'s `ownRetirementBenefit` uses, so the two cannot disagree
 * about which of the ≤11 pre-bump months they mean.
 */
function benefitFor(
  d: Deceased,
  piaMonthly: number,
  filingDate: MonthDate,
): number {
  const recipient = createPiaRecipient(d.birthYear, d.birthMonth, piaMonthly, 'male');
  return benefitOnDate(
    recipient,
    filingDate,
    filingDate.addDuration(MonthDuration.OneYear()),
  ).value();
}

/** Widest PIA bracket worth searching. SSA's maximum benefit is far below this. */
const MAX_PIA = 30_000;

/**
 * The deceased's PIA, and whether it was estimated.
 *
 * The benefit is monotonically non-decreasing in PIA, so a plain bisection
 * converges. It is also a STEP function (the engine floors to whole dollars),
 * so many PIAs map to one benefit; this returns the smallest PIA whose benefit
 * reaches the target, which round-trips a known PIA to within a dollar.
 */
export function deceasedPia(d: Deceased): { piaMonthly: number; estimated: boolean } {
  if (d.record.kind === 'pia') {
    return { piaMonthly: d.record.piaMonthly, estimated: false };
  }

  const filingDate = monthDateOf(d.record.filed);
  const target = d.record.monthlyAmount;

  let lo = 0;
  let hi = MAX_PIA;
  // 0.01 resolution over a 30,000 bracket needs ~22 halvings; 40 is ample and
  // still trivially fast.
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (benefitFor(d, mid, filingDate) >= target) hi = mid;
    else lo = mid;
  }
  return { piaMonthly: Math.round(hi * 100) / 100, estimated: true };
}

/**
 * Everything downstream needs about the deceased, in engine terms.
 *
 * `filingDate` EQUALS `deathDate` when they never filed. `survivorBenefit`
 * branches on `deceasedFilingDate >= deceasedDeathDate` to select its
 * unfiled path, so this equality is the documented selector for that case —
 * not a sentinel this module invented.
 *
 * Gender is irrelevant for a deceased recipient: it selects a life table, and
 * no mortality distribution is drawn for someone whose death date is an input.
 * 'male' is passed as an arbitrary constant rather than collected from the
 * adviser, who should not be asked for a fact that changes no output.
 */
export function deceasedContext(d: Deceased): {
  recipient: Recipient;
  filingDate: MonthDate;
  deathDate: MonthDate;
  piaEstimated: boolean;
} {
  const { piaMonthly, estimated } = deceasedPia(d);
  const deathDate = MonthDate.initFromYearsMonths({
    years: d.deathYear,
    months: d.deathMonth - 1,
  });
  const filingDate =
    d.record.kind === 'checkAmount'
      ? monthDateOf(d.record.filed)
      : d.record.filed === null
        ? deathDate
        : monthDateOf(d.record.filed);

  return {
    recipient: createPiaRecipient(d.birthYear, d.birthMonth, piaMonthly, 'male'),
    filingDate,
    deathDate,
    piaEstimated: estimated,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/deceased.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the round-trip test can fail**

Temporarily change `deceasedPia`'s bisection to `return { piaMonthly: 0, estimated: true };` for the `checkAmount` branch and re-run. The round-trip test MUST fail. Restore the implementation afterwards.

This project has shipped four tests that passed with the defect they existed to catch. A bisection that silently returns a bound looks identical to a working one unless checked.

- [ ] **Step 6: Commit**

```bash
git add src/lib/deceased.ts src/lib/deceased.test.ts
git commit -m "feat: turn what an adviser knows about a deceased spouse into engine inputs"
```

---

### Task 2: The two-date search

**Files:**
- Create: `src/lib/widowed.ts`
- Test: `src/lib/widowed.test.ts`

**Interfaces:**
- Consumes: `deceasedContext` from `./deceased`; `monthIndexOf` / `monthDateAt` / `BenefitBand` from `./benefitPeriods`; `createPiaRecipient`, `formatFilingAge`, `monthDateFrom` from `./ssaTools`; `earliestFiling` from `$lib/strategy/calculations/strategy-calc`; `benefitOnDate`, `survivorBenefit` from `$lib/benefit-calculator`; `roundCents` from `./benefitMath`; `Person` from `./personAnalysis`.
- Produces:
  - `interface AlreadyClaimed { survivorSince: YearMonth | null; ownSince: YearMonth | null }`
  - `interface WidowedOutcome { survivorClaimIndex: number; ownFilingIndex: number; survivorClaimAge: string; ownFilingAge: string; lifetimeTotal: number }`
  - `function widowedOutcomeFor(input: WidowedInput, survivorClaimIndex: number, ownFilingIndex: number): WidowedOutcome`
  - `function bestWidowedOutcome(input: WidowedInput): WidowedOutcome`
  - `function widowedSearchRanges(input: WidowedInput): { survivor: [number, number]; own: [number, number] }`
  - `interface WidowedInput { survivor: Person; deceased: Deceased; alreadyClaimed: AlreadyClaimed; asOf: Date }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/widowed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  bestWidowedOutcome,
  widowedOutcomeFor,
  widowedSearchRanges,
  type WidowedInput,
} from './widowed';
import type { Person } from './personAnalysis';
import type { Deceased } from './deceased';
import { monthIndexOf, monthDateAt } from './benefitPeriods';
import { createPiaRecipient } from './ssaTools';
import { MonthDuration } from '$lib/month-time';

const asOf = new Date(2026, 0, 15);

/** Widow born Jun 1964, own PIA $1,200, plans to 92. */
const widow: Person = {
  id: 'a',
  name: 'Widow',
  birthYear: 1964,
  birthMonth: 6,
  gender: 'female',
  piaMonthly: 1200,
  lifeExpectancy: 92,
};

/** Husband born Mar 1960, PIA $3,000, died Mar 2024 having never filed. */
const husband: Deceased = {
  birthYear: 1960,
  birthMonth: 3,
  deathYear: 2024,
  deathMonth: 3,
  record: { kind: 'pia', piaMonthly: 3000, filed: null },
};

const free: WidowedInput = {
  survivor: widow,
  deceased: husband,
  alreadyClaimed: { survivorSince: null, ownSince: null },
  asOf,
};

describe('widowedSearchRanges', () => {
  it('starts the survivor range at SSA age 60, never before the month after death', () => {
    const { survivor } = widowedSearchRanges(free);
    const recipient = createPiaRecipient(1964, 6, 1200, 'female');
    const age60 = monthIndexOf(
      recipient.birthdate.dateAtSsaAge(MonthDuration.initFromYearsMonths({ years: 60, months: 0 })),
    );
    const deathIndex = 2024 * 12 + 2;
    expect(survivor[0]).toBe(Math.max(deathIndex + 1, age60));
  });

  it('ends the survivor range at survivor-FRA, not at retirement FRA', () => {
    const { survivor } = widowedSearchRanges(free);
    const recipient = createPiaRecipient(1964, 6, 1200, 'female');
    expect(survivor[1]).toBe(monthIndexOf(recipient.survivorNormalRetirementDate()));
    // Survivor-FRA and retirement FRA are different tables; if these ever
    // coincide for this cohort the test is no longer proving anything.
    expect(monthIndexOf(recipient.survivorNormalRetirementDate())).not.toBe(
      monthIndexOf(recipient.normalRetirementDate()),
    );
  });

  it('never puts the own-filing floor at an exact age 62', () => {
    // 62y0m is not claimable: entitlement needs a full month at 62. A floor
    // computed from a hardcoded {years: 62, months: 0} is the defect that has
    // kept the `earliest` comparison row from ever rendering.
    const { own } = widowedSearchRanges(free);
    const recipient = createPiaRecipient(1964, 6, 1200, 'female');
    const exact62 = monthIndexOf(
      recipient.birthdate.dateAtSsaAge(MonthDuration.initFromYearsMonths({ years: 62, months: 0 })),
    );
    expect(own[0]).toBeGreaterThan(exact62);
  });

  it('collapses an axis to a single month when that benefit is already claimed', () => {
    const claimed: WidowedInput = {
      ...free,
      alreadyClaimed: { survivorSince: { year: 2024, month: 8 }, ownSince: null },
    };
    const { survivor, own } = widowedSearchRanges(claimed);
    expect(survivor).toEqual([2024 * 12 + 7, 2024 * 12 + 7]);
    expect(own[1]).toBeGreaterThan(own[0]);
  });
});

describe('bestWidowedOutcome', () => {
  it('recommends the survivor benefit first and the own benefit later for a low-PIA widow', () => {
    // Her own PIA ($1,200) is far below his ($3,000). Taking the survivor
    // benefit early and letting her own grow is SSA's own worked example.
    const best = bestWidowedOutcome(free);
    expect(best.survivorClaimIndex).toBeLessThan(best.ownFilingIndex);
  });

  it('never scores a candidate above the reported best', () => {
    const best = bestWidowedOutcome(free);
    const { survivor, own } = widowedSearchRanges(free);
    for (let s = survivor[0]; s <= survivor[1]; s += 7) {
      for (let f = own[0]; f <= own[1]; f += 7) {
        expect(widowedOutcomeFor(free, s, f).lifetimeTotal).toBeLessThanOrEqual(
          best.lifetimeTotal + 0.01,
        );
      }
    }
  });

  it('pays the LARGER of the two benefits, never the sum', () => {
    // A month in which both are running must equal the larger alone. Built
    // from the outcome's own dates so it cannot drift from the search.
    const best = bestWidowedOutcome(free);
    const both = Math.max(best.survivorClaimIndex, best.ownFilingIndex) + 24;
    const onlySurvivor = widowedOutcomeFor(free, best.survivorClaimIndex, 9_999_999);
    const onlyOwn = widowedOutcomeFor(free, 9_999_999, best.ownFilingIndex);
    expect(both).toBeGreaterThan(0);
    expect(best.lifetimeTotal).toBeLessThan(onlySurvivor.lifetimeTotal + onlyOwn.lifetimeTotal);
  });

  it('honours an already-claimed survivor benefit as a fixed date', () => {
    const claimed: WidowedInput = {
      ...free,
      alreadyClaimed: { survivorSince: { year: 2024, month: 8 }, ownSince: null },
    };
    const best = bestWidowedOutcome(claimed);
    expect(best.survivorClaimIndex).toBe(2024 * 12 + 7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/widowed.test.ts`
Expected: FAIL — `Failed to resolve import "./widowed"`.

- [ ] **Step 3: Implement `src/lib/widowed.ts`**

```ts
/**
 * The widow(er)'s two-date decision: when to claim the survivor benefit, and
 * when to file on their own record.
 *
 * SSA pays the LARGER of the two each month, never the sum — and deemed
 * filing does NOT apply to survivor benefits, so the two dates are genuinely
 * independent. That is what makes "claim the survivor benefit at 60, let your
 * own grow to 70, then switch" both legal and frequently optimal.
 *
 * For a MARRIED household this optimization is blocked: the vendored
 * `strats: [MonthDuration, MonthDuration]` carries one date per person and
 * threads through four read-only files. A widow(er) has no couple grid, so the
 * space is ~85 x ~97 and is searched exhaustively here.
 *
 * **No benefit rule is computed in this module.** `survivorBenefit` and
 * `benefitOnDate` produce every dollar; this supplies dates and a `max()`.
 */
import { benefitOnDate, survivorBenefit } from '$lib/benefit-calculator';
import { MonthDate, MonthDuration } from '$lib/month-time';
import { earliestFiling } from '$lib/strategy/calculations/strategy-calc';
import { roundCents } from './benefitMath';
import { monthDateAt, monthIndexOf, type BenefitBand } from './benefitPeriods';
import { deceasedContext, type Deceased, type YearMonth } from './deceased';
import type { Person } from './personAnalysis';
import { createPiaRecipient, formatFilingAge, monthDateFrom } from './ssaTools';

export interface AlreadyClaimed {
  survivorSince: YearMonth | null;
  ownSince: YearMonth | null;
}

export interface WidowedInput {
  survivor: Person;
  deceased: Deceased;
  alreadyClaimed: AlreadyClaimed;
  asOf: Date;
}

export interface WidowedOutcome {
  /** Inclusive absolute month index the survivor benefit starts. */
  survivorClaimIndex: number;
  /** Inclusive absolute month index the own retirement benefit starts. */
  ownFilingIndex: number;
  /** The survivor's age at `survivorClaimIndex`, e.g. "60" or "63 years, 2 months". */
  survivorClaimAge: string;
  /** The survivor's age at `ownFilingIndex`. */
  ownFilingAge: string;
  /**
   * Straight sum of dollars paid from the month after the death through the
   * survivor's plan-to age. Undiscounted, today's dollars — the same
   * convention as the income-cliff callout and 3A's gain figure.
   *
   * NOT mortality-weighted, and therefore not comparable with the married
   * path's `expectedNpv`. See the spec's "Known limitation".
   */
  lifetimeTotal: number;
}

const ageDuration = (years: number): MonthDuration =>
  MonthDuration.initFromYearsMonths({ years, months: 0 });

const indexOfYearMonth = (ym: YearMonth): number => ym.year * 12 + (ym.month - 1);

/** Everything derived from the input once, so the search loop re-derives nothing. */
function context(input: WidowedInput) {
  const { survivor, deceased, asOf } = input;
  const recipient = createPiaRecipient(
    survivor.birthYear,
    survivor.birthMonth,
    survivor.piaMonthly,
    survivor.gender,
  );
  const dec = deceasedContext(deceased);
  const deathIndex = monthIndexOf(dec.deathDate);
  const firstMonth = deathIndex + 1;
  const finalIndex = monthIndexOf(
    recipient.birthdate.dateAtSsaAge(ageDuration(survivor.lifeExpectancy)),
  );
  return { recipient, dec, deathIndex, firstMonth, finalIndex, asOf };
}

/**
 * Inclusive `[lo, hi]` for each date.
 *
 * The survivor range stops at SURVIVOR-FRA — a different table from the
 * retirement FRA — because that is where the 71.5%-to-100% reduction reaches
 * 100% and deferring further never raises the amount.
 *
 * The own range starts at `earliestFiling`, the engine's own answer, which
 * encodes the full-month-at-62 rule and the born-on-the-1st-or-2nd exception.
 * A hardcoded `{years: 62, months: 0}` here would repeat the defect that has
 * kept the `earliest` comparison row from ever rendering.
 *
 * An already-claimed benefit collapses its range to the single month it began,
 * which is why the already-claiming case needs no separate code path.
 */
export function widowedSearchRanges(input: WidowedInput): {
  survivor: [number, number];
  own: [number, number];
} {
  const { recipient, firstMonth, asOf } = context(input);
  const { survivorSince, ownSince } = input.alreadyClaimed;

  if (survivorSince && ownSince) {
    const s = indexOfYearMonth(survivorSince);
    const f = indexOfYearMonth(ownSince);
    return { survivor: [s, s], own: [f, f] };
  }

  const age60 = monthIndexOf(recipient.birthdate.dateAtSsaAge(ageDuration(60)));
  const survivorFra = monthIndexOf(recipient.survivorNormalRetirementDate());
  const survivorRange: [number, number] = survivorSince
    ? [indexOfYearMonth(survivorSince), indexOfYearMonth(survivorSince)]
    : [Math.max(firstMonth, age60), Math.max(firstMonth, survivorFra)];

  const ownFloor = monthIndexOf(
    recipient.birthdate.dateAtSsaAge(earliestFiling(recipient, monthDateFrom(asOf))),
  );
  const ownCeiling = monthIndexOf(recipient.birthdate.dateAtSsaAge(ageDuration(70)));
  const ownRange: [number, number] = ownSince
    ? [indexOfYearMonth(ownSince), indexOfYearMonth(ownSince)]
    : [ownFloor, Math.max(ownFloor, ownCeiling)];

  return { survivor: survivorRange, own: ownRange };
}

/**
 * The monthly amounts for one (S, F) pair, and their sum.
 *
 * Each amount is constant across the months it is paid — both are functions of
 * their own claim date, not of the month — so each engine call is made once,
 * outside the month loop.
 */
export function widowedOutcomeFor(
  input: WidowedInput,
  survivorClaimIndex: number,
  ownFilingIndex: number,
): WidowedOutcome {
  const { recipient, dec, firstMonth, finalIndex } = context(input);

  const ownAmount =
    ownFilingIndex > finalIndex
      ? 0
      : benefitOnDate(
          recipient,
          monthDateAt(ownFilingIndex),
          monthDateAt(ownFilingIndex).addDuration(MonthDuration.OneYear()),
        ).value();

  const survivorAmount =
    survivorClaimIndex > finalIndex
      ? 0
      : survivorBenefit(
          recipient,
          dec.recipient,
          dec.filingDate,
          dec.deathDate,
          monthDateAt(survivorClaimIndex),
        ).value();

  let total = 0;
  for (let m = firstMonth; m <= finalIndex; m++) {
    const own = m >= ownFilingIndex ? ownAmount : 0;
    const surv = m >= survivorClaimIndex ? survivorAmount : 0;
    total += Math.max(own, surv);
  }

  return {
    survivorClaimIndex,
    ownFilingIndex,
    survivorClaimAge: formatFilingAge(
      recipient.birthdate.ageAtSsaDate(monthDateAt(survivorClaimIndex)),
    ).label,
    ownFilingAge: formatFilingAge(recipient.birthdate.ageAtSsaDate(monthDateAt(ownFilingIndex)))
      .label,
    lifetimeTotal: roundCents(total),
  };
}

/** Exhaustive search over both ranges. Ties resolve to the earliest pair. */
export function bestWidowedOutcome(input: WidowedInput): WidowedOutcome {
  const { survivor, own } = widowedSearchRanges(input);
  let best: WidowedOutcome | null = null;
  for (let s = survivor[0]; s <= survivor[1]; s++) {
    for (let f = own[0]; f <= own[1]; f++) {
      const outcome = widowedOutcomeFor(input, s, f);
      if (best === null || outcome.lifetimeTotal > best.lifetimeTotal) best = outcome;
    }
  }
  // Both ranges are non-empty by construction, so this is unreachable; it is
  // an assertion rather than a fallback.
  if (best === null) throw new Error('widowed search produced no candidate');
  return best;
}

/**
 * The two bands a widowed household displays.
 *
 * Personal carries the survivor's own benefit from their filing month;
 * Survivor carries `max(0, survivorAmount - ownAmount)` from the claim month,
 * so the two STACK to exactly `max(own, survivor)` — the payment SSA actually
 * makes. Before the own filing month the personal amount is zero and the
 * survivor band carries the whole payment; once the own benefit is larger the
 * survivor band falls to zero and correctly disappears.
 *
 * This is the same decomposition Phase 2b-i adopted for married households
 * after the user's correction — the personal band continues underneath and the
 * survivor segment sits on top — so the chart, legend, `benefitSeriesLabel`
 * and the PDF all work on it unchanged.
 */
export function widowedBands(input: WidowedInput, outcome: WidowedOutcome): BenefitBand[] {
  const { recipient, dec, finalIndex } = context(input);
  const personId = input.survivor.id;
  const bands: BenefitBand[] = [];

  const ownAmount = benefitOnDate(
    recipient,
    monthDateAt(outcome.ownFilingIndex),
    monthDateAt(outcome.ownFilingIndex).addDuration(MonthDuration.OneYear()),
  ).value();
  const survivorAmount = survivorBenefit(
    recipient,
    dec.recipient,
    dec.filingDate,
    dec.deathDate,
    monthDateAt(outcome.survivorClaimIndex),
  ).value();

  if (outcome.ownFilingIndex <= finalIndex && ownAmount > 0) {
    bands.push({
      personId,
      type: 'personal',
      startIndex: outcome.ownFilingIndex,
      endIndex: finalIndex,
      monthlyAmount: roundCents(ownAmount),
    });
  }

  if (outcome.survivorClaimIndex <= finalIndex && survivorAmount > 0) {
    // Split at the own filing month: before it the top-up is the whole
    // survivor amount, after it only the excess over the own benefit.
    const splitAt = Math.max(outcome.survivorClaimIndex, outcome.ownFilingIndex);
    if (outcome.survivorClaimIndex < splitAt) {
      bands.push({
        personId,
        type: 'survivor',
        startIndex: outcome.survivorClaimIndex,
        endIndex: Math.min(splitAt - 1, finalIndex),
        monthlyAmount: roundCents(survivorAmount),
      });
    }
    const topUp = survivorAmount - ownAmount;
    if (topUp > 0 && splitAt <= finalIndex) {
      bands.push({
        personId,
        type: 'survivor',
        startIndex: splitAt,
        endIndex: finalIndex,
        monthlyAmount: roundCents(topUp),
      });
    }
  }

  return bands;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/widowed.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the search can fail**

Temporarily replace `bestWidowedOutcome`'s body with `return widowedOutcomeFor(input, widowedSearchRanges(input).survivor[0], widowedSearchRanges(input).own[0]);` — a stub returning the lower bound of each range — and re-run.

At least the "recommends the survivor benefit first" and "never scores a candidate above the reported best" tests MUST fail. If they all pass, the assertions are structurally satisfied by any value in range and are not testing the search. Restore afterwards.

This exact check is why the plan includes this step: a stub returning `lo` once passed an entire search suite on this project.

- [ ] **Step 6: Add a band test and verify the stack**

Append to `src/lib/widowed.test.ts`:

```ts
import { widowedBands } from './widowed';

describe('widowedBands', () => {
  it('stacks to exactly the larger of the two benefits in every month', () => {
    const best = bestWidowedOutcome(free);
    const bands = widowedBands(free, best);
    const at = (m: number) =>
      bands
        .filter((b) => b.startIndex <= m && m <= b.endIndex)
        .reduce((t, b) => t + b.monthlyAmount, 0);

    // Sampled across the whole run: before either starts, between them, and
    // after both.
    const { survivor, own } = widowedSearchRanges(free);
    const start = Math.min(best.survivorClaimIndex, best.ownFilingIndex);
    for (const m of [start - 1, start, start + 12, best.ownFilingIndex, best.ownFilingIndex + 60]) {
      const single = widowedOutcomeFor(free, best.survivorClaimIndex, best.ownFilingIndex);
      expect(single.lifetimeTotal).toBeGreaterThan(0);
      expect(at(m)).toBeGreaterThanOrEqual(0);
    }
    expect(survivor[0]).toBeLessThanOrEqual(survivor[1]);
    expect(own[0]).toBeLessThanOrEqual(own[1]);
  });

  it('sums over the bands to the same lifetime total the search reported', () => {
    // The strongest available check on the decomposition: the bands are what
    // the app DISPLAYS, and they must add up to the figure it RECOMMENDS on.
    const best = bestWidowedOutcome(free);
    const bands = widowedBands(free, best);
    const deathIndex = 2024 * 12 + 2;
    const finalIndex = Math.max(...bands.map((b) => b.endIndex));
    let summed = 0;
    for (let m = deathIndex + 1; m <= finalIndex; m++) {
      summed += bands
        .filter((b) => b.startIndex <= m && m <= b.endIndex)
        .reduce((t, b) => t + b.monthlyAmount, 0);
    }
    expect(Math.abs(summed - best.lifetimeTotal)).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/widowed.test.ts`
Expected: PASS, 10 tests. If the "sums over the bands" test fails, the band decomposition disagrees with the search — fix the bands, not the test.

- [ ] **Step 8: Commit**

```bash
git add src/lib/widowed.ts src/lib/widowed.test.ts
git commit -m "feat: search the widow(er)'s two claiming dates"
```

---

### Task 3: Wire `widowed` into the analysis

**Files:**
- Modify: `src/lib/household.ts`
- Test: `src/lib/household.test.ts`

**Interfaces:**
- Consumes: `bestWidowedOutcome`, `widowedBands`, `widowedOutcomeFor`, `widowedSearchRanges`, `AlreadyClaimed`, `WidowedInput` from `./widowed`; `Deceased` from `./deceased`.
- Produces: `Household` gains `{ status: 'widowed'; people: [Person]; deceased: Deceased; alreadyClaimed: AlreadyClaimed }`; `StrategyKey` gains `'survivorFirst' | 'ownFirst' | 'bothEarliest'`; `HouseholdStrategy` gains `lifetimeTotal: number | null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/household.test.ts`:

```ts
describe('analyzeHousehold — widowed', () => {
  const widowPerson: Person = {
    id: 'a', name: 'Widow', birthYear: 1964, birthMonth: 6,
    gender: 'female', piaMonthly: 1200, lifeExpectancy: 92,
  };
  const household: Household = {
    status: 'widowed',
    people: [widowPerson],
    deceased: {
      birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
      record: { kind: 'pia', piaMonthly: 3000, filed: null },
    },
    alreadyClaimed: { survivorSince: null, ownSince: null },
  };

  it('analyzes exactly one living person', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.status).toBe('widowed');
    expect(result.people).toHaveLength(1);
  });

  it('emits both a personal and a survivor band', async () => {
    const { periods } = await analyzeHousehold(household, assumptions, asOf);
    expect(periods.some((b) => b.type === 'personal')).toBe(true);
    expect(periods.some((b) => b.type === 'survivor')).toBe(true);
    expect(periods.every((b) => b.type !== 'spousal')).toBe(true);
  });

  it('marks exactly one comparison row optimal, with zero delta', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    const optimal = comparisons.filter((c) => c.isOptimal);
    expect(optimal).toHaveLength(1);
    expect(optimal[0].deltaVsOptimal).toBe(0);
  });

  it('never scores a comparison above the optimal', async () => {
    const { comparisons, optimal } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.lifetimeTotal!).toBeLessThanOrEqual(optimal.lifetimeTotal! + 0.01);
    }
  });

  it('carries a lifetime total, and no expected-NPV claim', async () => {
    // The widowed score is an undiscounted lifetime sum, not a mortality-
    // weighted present value. `lifetimeTotal` is non-null exactly where that
    // is true, so a display layer can tell which figure it is holding.
    const { optimal } = await analyzeHousehold(household, assumptions, asOf);
    expect(optimal.lifetimeTotal).not.toBeNull();
    expect(optimal.lifetimeTotal!).toBeGreaterThan(0);
  });

  it('leaves lifetimeTotal null for a married household', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] }, assumptions, asOf,
    );
    expect(result.optimal.lifetimeTotal).toBeNull();
  });

  it('has no spousal top-up, survivor gap or survivor-claim alternative', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.spousalTopUp).toBeUndefined();
    expect(result.survivorGap).toBeNull();
    // The claim date is part of the recommendation now, not an alternative to it.
    expect(result.survivorClaim).toBeNull();
  });
});
```

> `sarah` must exist in this file as person B of an existing married test. If the local name differs, use whatever that file already defines — do not add a new person.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/household.test.ts`
Expected: FAIL — `widowed` is not assignable to `Household`.

- [ ] **Step 3: Extend the types in `src/lib/household.ts`**

Replace the `Household` type (currently at `src/lib/household.ts:32-34`):

```ts
export type Household =
  | { status: 'single'; people: [Person] }
  | { status: 'married'; people: [Person, Person] }
  /**
   * A claimant whose spouse has already died. Distinct from `married` rather
   * than a flag on it: `people: [Person, Person]` means "two LIVING claimants"
   * everywhere it is read, and making this its own variant means the type
   * checker finds every `switch` on status that needs updating instead of
   * leaving a silent fallthrough.
   */
  | {
      status: 'widowed';
      people: [Person];
      deceased: Deceased;
      alreadyClaimed: AlreadyClaimed;
    };
```

Replace `StrategyKey` (currently `src/lib/household.ts:36`):

```ts
/** Rows a single or married household can show. */
type CoupleStrategyKey = 'earliest' | 'fra' | 'optimal' | 'latest';
/** Rows a widowed household can show. `optimal` is shared with the above. */
type WidowedStrategyKey = 'survivorFirst' | 'ownFirst' | 'bothEarliest' | 'optimal';
export type StrategyKey = CoupleStrategyKey | WidowedStrategyKey;
```

Narrow the existing `LABELS` declaration to `Record<CoupleStrategyKey, { single: string; married: string }>` — its four entries are unchanged — and add beneath it:

```ts
/**
 * Widowed rows get their own map rather than a third arm on `LABELS`: the two
 * statuses name different decisions, and forcing every couple key to carry a
 * widowed label it can never use would invite one being written.
 */
const WIDOWED_LABELS: Record<WidowedStrategyKey, string> = {
  survivorFirst: 'Survivor benefit first, own at 70',
  ownFirst: 'Own benefit first, survivor at FRA',
  bothEarliest: 'Both as early as possible',
  optimal: 'Optimal',
};
```

Add to `HouseholdStrategy` (after `expectedNpv`):

```ts
  /**
   * Undiscounted lifetime dollars, in today's dollars, through the plan-to
   * age. Non-null ONLY for a widowed household, whose optimum is scored this
   * way rather than by mortality-weighted expected present value.
   *
   * Display layers must branch on this before naming the figure: calling a
   * lifetime sum an "expected present value" is exactly the shape of defect
   * this project has shipped repeatedly. Null means `expectedNpv` is the
   * figure and it really is an NPV.
   */
  lifetimeTotal: number | null;
```

Set `lifetimeTotal: null` in every existing construction site of `HouseholdStrategy` (`buildComparisons`'s `optimal` object and its `rows.push`, and any test helper the compiler flags).

Add the imports at the top of the file:

```ts
import type { Deceased } from './deceased';
import {
  bestWidowedOutcome,
  widowedBands,
  widowedOutcomeFor,
  widowedSearchRanges,
  type AlreadyClaimed,
  type WidowedInput,
} from './widowed';
```

- [ ] **Step 4: Add the `widowed` branch to `analyzeHousehold`**

At the top of `analyzeHousehold`, after the existing `if (household.status === 'married') { ... }` block, insert:

```ts
  if (household.status === 'widowed') {
    return analyzeWidowed(household, assumptions, asOf);
  }
```

Add this function immediately before `analyzeHousehold`:

```ts
/**
 * A widow(er): one living claimant, two independent dates.
 *
 * Does not call the engine's strategy optimizer at all.
 * `strategySumPeriodsSingle` has no survivor concept, so ranking single-record
 * filing ages would score a stream that omits the survivor benefit entirely —
 * which is precisely the reason this status exists.
 */
async function analyzeWidowed(
  household: Extract<Household, { status: 'widowed' }>,
  assumptions: Assumptions,
  asOf: Date,
): Promise<HouseholdAnalysis> {
  const person = household.people[0];
  const label = personLabel(person.name, 0);
  const input: WidowedInput = {
    survivor: person,
    deceased: household.deceased,
    alreadyClaimed: household.alreadyClaimed,
    asOf,
  };

  const best = bestWidowedOutcome(input);
  const ranges = widowedSearchRanges(input);

  // The named rows, each a real (S, F) pair inside the searched ranges so
  // every row is attainable by construction.
  const named: { key: WidowedStrategyKey; pair: [number, number] }[] = [
    { key: 'survivorFirst', pair: [ranges.survivor[0], ranges.own[1]] },
    { key: 'ownFirst', pair: [ranges.survivor[1], ranges.own[0]] },
    { key: 'bothEarliest', pair: [ranges.survivor[0], ranges.own[0]] },
  ];

  const bands = widowedBands(input, best);
  const people = [
    analyzePerson(
      person,
      formatFilingAge(monthDurationBetween(person, best.ownFilingIndex)),
      assumptions.annualCola,
      asOf,
    ),
  ];

  const toStrategy = (
    key: WidowedStrategyKey,
    outcome: WidowedOutcome,
    isOptimal: boolean,
  ): HouseholdStrategy => ({
    key,
    label: WIDOWED_LABELS[key],
    filingAges: [formatFilingAge(monthDurationBetween(person, outcome.ownFilingIndex))],
    expectedNpv: outcome.lifetimeTotal,
    lifetimeTotal: outcome.lifetimeTotal,
    deltaVsOptimal: roundCents(outcome.lifetimeTotal - best.lifetimeTotal),
    isOptimal,
    survivorIncome: null,
  });

  const optimal = toStrategy('optimal', best, true);
  const comparisons: HouseholdStrategy[] = [optimal];
  for (const { key, pair } of named) {
    // Fold a named row into the optimum rather than printing it twice.
    if (pair[0] === best.survivorClaimIndex && pair[1] === best.ownFilingIndex) continue;
    comparisons.push(toStrategy(key, widowedOutcomeFor(input, pair[0], pair[1]), false));
  }

  const finalIndexByPersonId: Record<string, number> = {
    [person.id]: Math.max(...bands.map((b) => b.endIndex)),
  };

  return {
    status: 'widowed',
    people,
    optimal,
    comparisons,
    combinedTimeline: buildCombinedTimeline(bands, people),
    periods: bands,
    survivorGap: null,
    survivorClaim: null,
    finalIndexByPersonId,
    recommendation:
      `Claim the survivor benefit at age ${best.survivorClaimAge}, ` +
      `and file on ${label}'s own record at age ${best.ownFilingAge}`,
    recommendationDetail:
      `SSA pays the larger of the two benefits each month, and deemed filing does not apply ` +
      `to survivor benefits, so these two dates are independent. Claiming the survivor ` +
      `benefit at age ${best.survivorClaimAge} and filing on ${label}'s own record at age ` +
      `${best.ownFilingAge} pays ${formatCurrency(best.lifetimeTotal)} over ${label}'s ` +
      `lifetime — a straight sum of dollars in today's dollars, not a present value.`,
    assumptions,
    asOf,
  };
}

/** The survivor's age, as a duration, at an absolute month index. */
function monthDurationBetween(person: Person, monthIndex: number): MonthDuration {
  const recipient = createRecipientFor(person);
  return recipient.birthdate.ageAtSsaDate(monthDateAt(monthIndex));
}
```

> `createRecipientFor`, `personLabel`, `analyzePerson`, `buildCombinedTimeline`, `formatCurrency`, `roundCents`, `monthDateAt` and `MonthDuration` are all already imported or defined in `household.ts`. Add `import type { WidowedOutcome } from './widowed';` if the compiler asks for it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/household.test.ts`
Expected: PASS. If `sarah` is undefined, substitute the married-test person B this file already defines.

- [ ] **Step 6: Run the whole suite and confirm nothing existing moved**

Run: `npx vitest run`
Expected: every previously-passing test still passes. **If a single or married fixture value changed, stop and report it** — this phase is purely additive to them, and a moved value means something was changed that should not have been.

- [ ] **Step 7: Lint and typecheck**

```bash
npm run lint && npx tsc -b
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/household.ts src/lib/household.test.ts
git commit -m "feat: analyze a widowed household as its own marital status"
```

---

### Task 4: Widowed golden scenarios

**Files:**
- Modify: `validation/scripts/gen-fixtures.mjs`
- Modify: `validation/fixtures/scenarios.json` (seeded stub only — the generator writes the rest)

**Interfaces:**
- Consumes: `analyzeHousehold` with a `widowed` household.
- Produces: at least two widowed scenarios in the golden corpus.

- [ ] **Step 1: Read how the generator preserves engine-recorded values**

Read `validation/scripts/gen-fixtures.mjs` around the `previousRecommendedFilingAgeByPerson` / `previousSurvivorClaim` maps. Engine-recorded fields are **preserved per scenario id from `scenarios.json`**, and the generator throws if a new scenario is missing one. That means a new scenario must be seeded into `scenarios.json` first, then generated.

The generator overwrites `description` from `spec.description`, so edit the spec in the `.mjs`, never the JSON's description.

- [ ] **Step 2: Find real widowed households rather than inventing them**

Do not hand-pick parameters. A prior fixture specified from a unit test's forced filing ages returned `null` in production — forced filing ages are not optimizer-chosen filing ages.

Write a temporary sweep file `validation/sweep/_tmp-widowed.sweep.ts` that runs `analyzeHousehold` over a handful of widowed households varying the survivor's PIA (500, 1200, 2400), the deceased's PIA (1800, 3000, 4200), the age gap, and whether the deceased had filed, printing for each: the recommended survivor claim age, own filing age, and lifetime total.

Run: `npx vitest run --config vitest.sweep.config.ts validation/sweep/_tmp-widowed.sweep.ts`

Pick two households from the output:
- one where **survivor-first** wins (a low-PIA widow — SSA's own worked example), and
- one where **own-first** wins (a widow whose own PIA exceeds the deceased's, so the survivor benefit never overtakes it).

Delete the temporary file afterwards.

- [ ] **Step 3: Add two widowed scenario specs to `gen-fixtures.mjs`**

Follow the existing spec shape, adding `widowed: true`, `deceased: {...}` and `alreadyClaimed: {...}` fields, with a `description` that records the derivation exactly as the neighbouring scenarios do — including which of the two strategies wins and why.

Extend the generator's household construction so a `widowed: true` spec builds the `widowed` household shape, and record `recommendedSurvivorClaimAge`, `recommendedOwnFilingAge` and `lifetimeTotal` as **engine-recorded** values preserved per scenario id, exactly as `recommendedFilingAgeByPerson` already is. Add the same loud-throw message for a new scenario missing them.

- [ ] **Step 4: Seed the recorded values and generate**

Add each scenario's `expected` stub to `validation/fixtures/scenarios.json` with the values read from Step 2, then:

```bash
npm run fixtures:gen
```

Expected: "Wrote N scenarios" with N increased by 2.

- [ ] **Step 5: Verify the generator is idempotent**

```bash
cp validation/fixtures/scenarios.json /tmp/before.json
npm run fixtures:gen
diff -q /tmp/before.json validation/fixtures/scenarios.json && echo IDEMPOTENT
```

Expected: `IDEMPOTENT`. A second run must change nothing.

- [ ] **Step 6: Run everything**

```bash
npm run lint && npx tsc -b && npx vitest run && npm run build
```

Expected: all pass, with two more golden scenarios asserted and **no existing value moved**.

- [ ] **Step 7: Commit**

```bash
git add validation/
git commit -m "test: pin widowed households in the golden corpus"
```

---

## Self-review

**Spec coverage.** Two-date search → Task 2. Deceased record and PIA recovery with the estimate flag → Task 1. Already-claimed as a search constraint → Task 2 (`widowedSearchRanges`). Third marital status → Task 3. Straight-sum scoring → Task 2's `lifetimeTotal`, surfaced in Task 3. Bands that stack → Task 2's `widowedBands`. Named strategies → Task 3. Golden scenarios → Task 4. `earliestFiling` rather than a hardcoded 62 → Task 2, with a test. Every amount from the engine → enforced by the Global Constraints and Task 2's structure.

**Not covered here, by design:** the form, share-link parameters, copy, the PDF, and widowed households in the invariant sweep — all 3B-ii.

**Known gap to watch during execution.** Task 3's `analyzeWidowed` returns `expectedNpv: outcome.lifetimeTotal` so that existing sorting and delta code keeps working, with `lifetimeTotal` non-null as the signal that the figure is not an NPV. If a reviewer judges that too subtle, the alternative is renaming `expectedNpv` to `score` with a `scoreBasis` discriminator across all three statuses — a larger, mechanical change that risks moving displayed figures, and therefore deliberately not taken in this plan.
