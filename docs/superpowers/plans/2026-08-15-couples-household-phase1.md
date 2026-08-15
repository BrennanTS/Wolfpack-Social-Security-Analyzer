# Couples Household Support (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the worker/spouse asymmetry with a symmetric household model, correct four calculation defects, present couples results in a tabbed Household/Person view with a strategy comparison table, split the PDF report, and establish a three-layer testing foundation with CI.

**Architecture:** `src/lib/socialSecurity.ts` splits into five focused modules (`format`, `benefitMath`, `personAnalysis`, `household`, plus the existing `ssaTools` adapter). `household.ts` is the only module that knows whether one person or two is being analyzed. Data flows one way: form state → `toHousehold()` → `analyzeHousehold()` → `HouseholdAnalysis` → components, which never call the engine themselves.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Playwright, Recharts, `@react-pdf/renderer`, vendored ssa.tools engine.

**Spec:** `docs/superpowers/specs/2026-08-15-couples-household-phase1-design.md`

## Global Constraints

- **Never modify `src/vendor/ssa-tools/`.** It is vendored MIT-licensed upstream code. All date injection and new calculations happen in `src/lib/ssaTools.ts`.
- **Fixture values are hand-derived from SSA's published rules, never copied from engine output.** If engine and fixture disagree, re-derive by hand before deciding which is wrong.
- **Fixture tolerances** (from `validation/fixtures/scenarios.json`): `monthlyUsd: 1`, `percentOfPia: 0.1`, `breakEvenYears: 0.1`, `crosscheckUsd: 1`.
- **No new runtime dependencies.** Only devDependencies may be added (`@testing-library/react`, `@testing-library/user-event`, `jsdom`).
- **`npm run lint` (oxlint) must pass with zero warnings** before every commit.
- **The live ssa.tools cross-check stays on-demand only** (`npm run crosscheck:ssatools`). Never wire it into CI on any schedule.
- **Claiming age window is 62–70 inclusive.** `MIN_CLAIM_AGE = 62`, `MAX_CLAIM_AGE = 70`.
- **Commit messages** end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Branch:** `feat/couples-household`.
- **Local test runs:** port 4173 may be occupied by unrelated software. Use `PW_PORT=4199 npm run test:e2e` after Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/format.ts` | **Create.** Currency, FRA and age display; `personLabel` fallback |
| `src/lib/benefitMath.ts` | **Create.** `ClaimingOption`, `BreakEvenPair`, cumulative/break-even math |
| `src/lib/personAnalysis.ts` | **Create.** `Person`, `FraResult`, `PersonAnalysis`, `analyzePerson` |
| `src/lib/household.ts` | **Create.** `Household`, `HouseholdStrategy`, `HouseholdAnalysis`, `analyzeHousehold` |
| `src/lib/ssaTools.ts` | **Modify.** `asOf` injection, corrected spousal top-up, ranked strategies |
| `src/lib/socialSecurity.ts` | **Delete** at Task 15 |
| `src/lib/formState.ts` | **Modify.** `toHousehold`, married validation |
| `src/components/HouseholdView.tsx` | **Create.** Single/married branch + tab strip |
| `src/components/HouseholdPanel.tsx` | **Create.** Household tab contents |
| `src/components/StrategyComparisonTable.tsx` | **Create.** Comparison rows |
| `src/components/CombinedIncomeChart.tsx` | **Create.** Stacked household income |
| `src/components/PersonPanel.tsx` | **Create** from `ResultsPanel.tsx` |
| `src/components/pdf/theme.ts` | **Create.** Colors, layout constants, StyleSheet |
| `src/components/pdf/charts.tsx` | **Create.** `PdfChart`, `PdfHeatmap`, `PdfOpportunityCost`, `PdfMonthlyRamp` |
| `src/components/pdf/PersonSection.tsx` | **Create.** Per-person pages + `BenefitTable` |
| `src/components/pdf/HouseholdSection.tsx` | **Create.** Household page |
| `src/components/pdf/ReportDocument.tsx` | **Create.** Composition, `PageFooter`, `MethodPair` |
| `validation/fixtures/scenarios.json` | **Modify.** `people[]` schema, `asOf`, new scenarios |
| `.github/workflows/ci.yml` | **Create.** lint → unit+component → e2e |

**Note on the PDF split:** the spec named four `pdf/` modules. The chart components alone are ~360 lines, so meeting the spec's own 300-line limit requires a fifth (`charts.tsx`). The spec has been amended to match.

**Module dependency direction** (no cycles): `format` and `benefitMath` depend on nothing; `personAnalysis` depends on `benefitMath` + `ssaTools`; `household` depends on `personAnalysis` + `benefitMath` + `ssaTools`. `fraLabel` takes `{years, months}` structurally rather than importing `FraResult`, and `personLabel` takes `(name, index)` rather than importing `Person`, which is what keeps `format.ts` dependency-free.

---

### Task 1: Component test harness

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Create: `src/components/DarkModeToggle.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: a jsdom Vitest project so every later component test runs via `npm run test`. Lib tests stay in the node environment.

- [ ] **Step 1: Install dev dependencies**

```bash
npm install -D @testing-library/react@^16 @testing-library/user-event@^14 jsdom@^26
```

- [ ] **Step 2: Write the failing component test**

`DarkModeToggle` is a small existing component with no dependencies, so it proves the harness without depending on any Phase 1 work.

```tsx
// src/components/DarkModeToggle.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DarkModeToggle } from './DarkModeToggle';

describe('DarkModeToggle', () => {
  it('reports pressed state and fires the toggle handler', async () => {
    const onToggle = vi.fn();
    render(<DarkModeToggle active={true} onToggle={onToggle} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test -- DarkModeToggle`
Expected: FAIL — the file is not matched by `include`, or jsdom/`document` is undefined.

- [ ] **Step 4: Split the Vitest config into two projects**

```ts
// vitest.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  // Mirror the app's alias so tests can import the vendored ssa.tools engine.
  $lib: path.resolve(__dirname, 'src/vendor/ssa-tools'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'lib',
          environment: 'node',
          include: ['src/**/*.test.ts', 'validation/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
});
```

The two projects differ only by name, environment, include glob, and the React plugin.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- DarkModeToggle`
Expected: PASS. Then run `npm run test` and confirm all 149 existing tests still pass under the `lib` project.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/components/DarkModeToggle.test.tsx
git commit -m "test: add jsdom component test project

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Configurable Playwright port

**Files:**
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `PW_PORT` environment variable, defaulting to 4173. Every later e2e task relies on this to run locally when 4173 is taken.

- [ ] **Step 1: Replace the hardcoded port**

```ts
// playwright.config.ts — replace the `useDev`/`baseURL`/`webServer` section
const useDev = !!process.env.PW_DEV;
const port = Number(process.env.PW_PORT ?? 4173);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'validation/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  // Pre-commit must be deterministic, not retried green.
  retries: 0,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: useDev
      ? `npx vite --port ${port} --strictPort`
      : `npm run build && npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: useDev,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Verify both ports work**

Run: `PW_PORT=4199 npm run test:e2e`
Expected: 18 tests pass. Then run `npm run test:e2e` and expect either 18 passes (if 4173 is free) or the "port already used" error (if not) — both confirm the default is unchanged.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "test: make the Playwright preview port configurable via PW_PORT

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1's test projects, Task 2's `PW_PORT`
- Produces: a required check on pull requests

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Unit and component tests
        run: npm run test

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - name: Install Playwright chromium
        run: npx playwright install --with-deps chromium

      - name: End-to-end tests
        run: npm run test:e2e

      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

The live ssa.tools cross-check is deliberately absent — it depends on a third party's uptime and must stay on-demand.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, tests and e2e on push and pull request

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Unit tests for the untested pure modules

**Files:**
- Create: `src/lib/auth.test.ts`
- Create: `src/lib/cpiHistory.test.ts`
- Create: `src/lib/lifeExpectancy.test.ts`
- Create: `src/lib/chartData.test.ts`

**Interfaces:**
- Consumes: nothing — these test existing modules as they stand today
- Produces: a regression net before the refactor begins. `chartData.test.ts` imports `cumulativeBenefits` transitively and will need its import updated in Task 6.

- [ ] **Step 1: Write the auth tests**

```ts
// src/lib/auth.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PASSWORD, isAuthenticated, logout, signIn } from './auth';

describe('demo auth gate', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it('starts unauthenticated', () => {
    expect(isAuthenticated()).toBe(false);
  });

  it('authenticates after signIn and clears after logout', () => {
    signIn();
    expect(isAuthenticated()).toBe(true);
    logout();
    expect(isAuthenticated()).toBe(false);
  });

  it('exposes the documented demo password', () => {
    expect(DEMO_PASSWORD).toBe('wolfpack');
  });
});
```

- [ ] **Step 2: Write the CPI tests**

```ts
// src/lib/cpiHistory.test.ts
import { describe, expect, it } from 'vitest';
import { BLS_CPI_U_ANNUAL, CPI_DEFAULT_COLA, formatPercent, getCpiLast30Years } from './cpiHistory';

describe('getCpiLast30Years', () => {
  const stats = getCpiLast30Years();

  it('ends at the most recent year present in the table', () => {
    expect(stats.endYear).toBe(Math.max(...Object.keys(BLS_CPI_U_ANNUAL).map(Number)));
  });

  it('reports min and max drawn from the included years', () => {
    const rates = stats.years.map((y) => y.rate);
    expect(stats.min).toBe(Math.min(...rates));
    expect(stats.max).toBe(Math.max(...rates));
  });

  it('places the geometric mean at or below the arithmetic mean', () => {
    expect(stats.geometricMean).toBeLessThanOrEqual(stats.arithmeticMean);
  });

  it('exports the arithmetic mean as the default COLA', () => {
    expect(CPI_DEFAULT_COLA).toBe(stats.arithmeticMean);
  });
});

describe('formatPercent', () => {
  it('formats with the requested precision', () => {
    expect(formatPercent(2.5)).toBe('2.5%');
    expect(formatPercent(2.5, 2)).toBe('2.50%');
  });
});
```

- [ ] **Step 3: Write the life expectancy tests**

```ts
// src/lib/lifeExpectancy.test.ts
import { describe, expect, it } from 'vitest';
import { genderLabel, getSuggestedLifeExpectancy } from './lifeExpectancy';

describe('getSuggestedLifeExpectancy', () => {
  it('adds SSA remaining years to the current age', () => {
    // Male at 62 has 20.4 remaining years -> 82.4, rounded to 82.
    expect(getSuggestedLifeExpectancy(62, 'male')).toBe(82);
    // Female at 62 has 22.8 remaining -> 84.8, rounded to 85.
    expect(getSuggestedLifeExpectancy(62, 'female')).toBe(85);
  });

  it('projects longer lives for women at the same age', () => {
    for (const age of [62, 70, 80]) {
      expect(getSuggestedLifeExpectancy(age, 'female')).toBeGreaterThan(
        getSuggestedLifeExpectancy(age, 'male'),
      );
    }
  });

  it('clamps ages below 62 and above 95 to the table bounds', () => {
    expect(getSuggestedLifeExpectancy(40, 'male')).toBe(getSuggestedLifeExpectancy(62, 'male'));
    expect(getSuggestedLifeExpectancy(120, 'male')).toBe(
      getSuggestedLifeExpectancy(95, 'male') + 25,
    );
  });
});

describe('genderLabel', () => {
  it('capitalizes for display', () => {
    expect(genderLabel('male')).toBe('Male');
    expect(genderLabel('female')).toBe('Female');
  });
});
```

Note on the clamp test: `lookupRemaining` clamps the *table lookup* to 62–95 but `getSuggestedLifeExpectancy` adds the remaining years to the **unclamped** `currentAgeYears`. At age 120 that yields `120 + 2.8 = 122.8 → 123`, and `getSuggestedLifeExpectancy(95,'male')` is `95 + 2.8 = 97.8 → 98`; `98 + 25 = 123`. Run the test and confirm this reasoning against actual output before adjusting either side.

- [ ] **Step 4: Write the chart data tests**

```ts
// src/lib/chartData.test.ts
import { describe, expect, it } from 'vitest';
import {
  generateHeatmapData,
  generateMonthlyRampData,
  generateOpportunityCostData,
  getHeatmapValue,
  getLivingAgeTicks,
  heatmapColorWeb,
} from './chartData';
import type { ClaimingOption } from './socialSecurity';

const options: ClaimingOption[] = [62, 67, 70].map((age) => ({
  age,
  monthlyBenefit: age === 62 ? 1750 : age === 67 ? 2500 : 3100,
  percentOfPia: age === 62 ? 70 : age === 67 ? 100 : 124,
  lifetimeBenefits: age === 62 ? 300_000 : age === 67 ? 400_000 : 380_000,
  yearsOfPayments: 0,
  isEligible: true,
  monthsFromFra: 0,
}));

describe('getLivingAgeTicks', () => {
  it('always includes both endpoints', () => {
    const ticks = getLivingAgeTicks(62, 95);
    expect(ticks[0]).toBe(62);
    expect(ticks[ticks.length - 1]).toBe(95);
  });

  it('widens the step for longer spans', () => {
    expect(getLivingAgeTicks(62, 95)[1] - 62).toBe(4);
    expect(getLivingAgeTicks(62, 68)[1] - 62).toBe(1);
  });
});

describe('generateHeatmapData', () => {
  it('emits one cell per claim age from that age through life expectancy', () => {
    const cells = generateHeatmapData(options, 65, 0);
    expect(cells.filter((c) => c.claimAge === 62)).toHaveLength(4); // 62..65
    // Claim ages above life expectancy contribute nothing.
    expect(cells.filter((c) => c.claimAge === 70)).toHaveLength(0);
  });

  it('returns null for a combination that was never generated', () => {
    expect(getHeatmapValue(generateHeatmapData(options, 65, 0), 70, 64)).toBeNull();
  });
});

describe('generateOpportunityCostData', () => {
  it('scores every age against the optimal age, which is zero', () => {
    const rows = generateOpportunityCostData(options, 67);
    expect(rows.find((r) => r.age === 67)).toMatchObject({ vsOptimal: 0, isOptimal: true });
    expect(rows.find((r) => r.age === 62)!.vsOptimal).toBe(-100_000);
  });
});

describe('generateMonthlyRampData', () => {
  it('carries monthly and %PIA through and flags the optimal age', () => {
    const rows = generateMonthlyRampData(options, 70);
    expect(rows.find((r) => r.age === 70)).toMatchObject({
      monthly: 3100,
      percentOfPia: 124,
      isOptimal: true,
    });
  });
});

describe('heatmapColorWeb', () => {
  it('clamps out-of-range ratios to the palette endpoints', () => {
    expect(heatmapColorWeb(-1)).toBe(heatmapColorWeb(0));
    expect(heatmapColorWeb(2)).toBe(heatmapColorWeb(1));
  });

  it('returns a six-digit hex color', () => {
    expect(heatmapColorWeb(0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 5: Run all four suites**

Run: `npm run test`
Expected: PASS. If the life-expectancy clamp test fails, correct the *test* to match the documented behavior above — do not change `lifeExpectancy.ts`, which is out of scope for this task.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.test.ts src/lib/cpiHistory.test.ts src/lib/lifeExpectancy.test.ts src/lib/chartData.test.ts
git commit -m "test: cover auth, CPI history, life expectancy and chart data

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Extract `format.ts`

**Files:**
- Create: `src/lib/format.ts`
- Create: `src/lib/format.test.ts`
- Modify: `src/lib/socialSecurity.ts` (re-export from the new module)

**Interfaces:**
- Consumes: nothing
- Produces: `formatCurrency(n): string`, `formatCurrencyPrecise(n): string`, `fraLabel({years, months}): string`, `formatAgeDisplay({years, months}): string`, `personLabel(name: string | undefined, index: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/format.test.ts
import { describe, expect, it } from 'vitest';
import {
  formatAgeDisplay,
  formatCurrency,
  formatCurrencyPrecise,
  fraLabel,
  personLabel,
} from './format';

describe('currency formatting', () => {
  it('rounds to whole dollars', () => {
    expect(formatCurrency(2816.4)).toBe('$2,816');
    expect(formatCurrency(1750)).toBe('$1,750');
  });

  it('keeps cents when precise', () => {
    expect(formatCurrencyPrecise(1750.5)).toBe('$1,750.50');
  });
});

describe('fraLabel', () => {
  it('omits months when the FRA is a whole year', () => {
    expect(fraLabel({ years: 67, months: 0 })).toBe('67');
  });

  it('spells out partial years', () => {
    expect(fraLabel({ years: 66, months: 10 })).toBe('66 years, 10 months');
  });
});

describe('formatAgeDisplay', () => {
  it('reads naturally at an exact birthday', () => {
    expect(formatAgeDisplay({ years: 66, months: 0 })).toBe('66 years old');
    expect(formatAgeDisplay({ years: 66, months: 3 })).toBe('66 years, 3 months');
  });
});

describe('personLabel', () => {
  it('prefers a supplied name', () => {
    expect(personLabel('Dan', 0)).toBe('Dan');
    expect(personLabel('Sarah', 1)).toBe('Sarah');
  });

  it('falls back to You and Spouse by position', () => {
    expect(personLabel(undefined, 0)).toBe('You');
    expect(personLabel(undefined, 1)).toBe('Spouse');
  });

  it('treats blank and whitespace-only names as absent', () => {
    expect(personLabel('', 0)).toBe('You');
    expect(personLabel('   ', 1)).toBe('Spouse');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- format`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 3: Create the module**

```ts
// src/lib/format.ts
/** Display formatting. Deliberately dependency-free so every layer can import it. */

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCurrencyPrecise(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Structural parameter rather than FraResult, so this module imports nothing. */
export function fraLabel(fra: { years: number; months: number }): string {
  if (fra.months === 0) return `${fra.years}`;
  return `${fra.years} years, ${fra.months} months`;
}

export function formatAgeDisplay(age: { years: number; months: number }): string {
  if (age.months === 0) return `${age.years} years old`;
  return `${age.years} years, ${age.months} months`;
}

/**
 * Resolves a person's display name. The single source of truth for the
 * You/Spouse fallback — tabs, chart legends, table headers and the PDF all
 * call this so the rule cannot drift between them.
 */
export function personLabel(name: string | undefined, index: number): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return index === 0 ? 'You' : 'Spouse';
}
```

- [ ] **Step 4: Re-export from `socialSecurity.ts` so nothing breaks yet**

Delete the `formatCurrency`, `formatCurrencyPrecise`, `fraLabel` and `formatAgeDisplay` definitions from `src/lib/socialSecurity.ts` and add at the top:

```ts
export { formatAgeDisplay, formatCurrency, formatCurrencyPrecise, fraLabel } from './format';
```

- [ ] **Step 5: Run the full suite**

Run: `npm run test && npm run lint`
Expected: PASS, all 149+ tests. No component or import changes needed yet.

- [ ] **Step 6: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts src/lib/socialSecurity.ts
git commit -m "refactor: extract display formatting into format.ts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Extract `benefitMath.ts`

**Files:**
- Create: `src/lib/benefitMath.ts`
- Create: `src/lib/benefitMath.test.ts`
- Modify: `src/lib/socialSecurity.ts`
- Modify: `src/lib/chartData.ts` and `src/lib/chartData.test.ts` (import `ClaimingOption` and `cumulativeBenefits` from the new module)

**Interfaces:**
- Consumes: nothing
- Produces: types `ClaimingOption`, `BreakEvenPair`; functions `cumulativeBenefits(monthly, claimAge, throughAge, annualCola?)`, `breakEvenAge(earlierAge, earlierMonthly, laterAge, laterMonthly, annualCola?)`, `computeBreakEvens(options, annualCola?)`, `generateCumulativeChartData(options, maxAge, annualCola?)`, constants `MIN_CLAIM_AGE = 62`, `MAX_CLAIM_AGE = 70`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/benefitMath.test.ts
import { describe, expect, it } from 'vitest';
import {
  breakEvenAge,
  computeBreakEvens,
  cumulativeBenefits,
  generateCumulativeChartData,
  MAX_CLAIM_AGE,
  MIN_CLAIM_AGE,
  type ClaimingOption,
} from './benefitMath';

const options: ClaimingOption[] = [62, 67, 70].map((age) => ({
  age,
  monthlyBenefit: age === 62 ? 1750 : age === 67 ? 2500 : 3100,
  percentOfPia: 0,
  lifetimeBenefits: 0,
  yearsOfPayments: 0,
  isEligible: true,
  monthsFromFra: 0,
}));

describe('claim age window', () => {
  it('spans 62 to 70', () => {
    expect([MIN_CLAIM_AGE, MAX_CLAIM_AGE]).toEqual([62, 70]);
  });
});

describe('cumulativeBenefits', () => {
  it('sums flat payments with no COLA', () => {
    expect(cumulativeBenefits(1000, 62, 62)).toBe(0);
    expect(cumulativeBenefits(1000, 62, 64)).toBe(24_000);
  });

  it('compounds annually when a COLA is supplied', () => {
    expect(cumulativeBenefits(1000, 62, 64, 10)).toBeCloseTo(25_200, 2);
  });

  it('never returns a negative total for an age before the claim age', () => {
    expect(cumulativeBenefits(1000, 67, 62)).toBe(0);
  });
});

describe('breakEvenAge', () => {
  it('returns null when the later benefit never overtakes without COLA', () => {
    expect(breakEvenAge(62, 2000, 70, 1500, 0)).toBeNull();
  });

  it('finds the crossover for a higher, later benefit', () => {
    const be = breakEvenAge(62, 1750, 70, 3100, 0);
    expect(be).toBeGreaterThan(79);
    expect(be).toBeLessThan(82);
  });
});

describe('computeBreakEvens', () => {
  it('produces an entry for each canonical pair', () => {
    const pairs = computeBreakEvens(options, 0).map((r) => `${r.earlierAge}-${r.laterAge}`);
    expect(pairs).toEqual(['62-67', '62-70', '67-70']);
  });

  it('is pure, so it is safe to recompute whenever COLA changes', () => {
    expect(computeBreakEvens(options, 2.5)).toEqual(computeBreakEvens(options, 2.5));
  });
});

describe('generateCumulativeChartData', () => {
  it('omits a series before its claim age and includes it after', () => {
    const data = generateCumulativeChartData(options, 70, 0);
    expect(data.find((d) => d.age === 62)!.age67).toBeUndefined();
    expect(data.find((d) => d.age === 70)!.age67).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- benefitMath`
Expected: FAIL — `Cannot find module './benefitMath'`.

- [ ] **Step 3: Create the module**

Move `ClaimingOption`, `BreakEvenPair`, `cumulativeBenefits`, `breakEvenAge`, `BREAK_EVEN_AGES`, `computeBreakEvens`, `generateCumulativeChartData`, `roundCents`, `MIN_CLAIM_AGE` and `MAX_CLAIM_AGE` out of `socialSecurity.ts` verbatim into `src/lib/benefitMath.ts`, exporting `MIN_CLAIM_AGE` and `MAX_CLAIM_AGE`. Behavior is unchanged; this is a mechanical move.

```ts
// src/lib/benefitMath.ts (header — the bodies move unchanged)
/**
 * Illustrative benefit math: cumulative totals and break-even ages.
 *
 * These are driven by the flat `annualCola` slider and are computed on the
 * client so they recompute instantly, independent of the ssa.tools engine.
 * Every dollar figure sourced from the engine already reflects SSA's own
 * cost-of-living adjustments.
 */

export const MIN_CLAIM_AGE = 62;
export const MAX_CLAIM_AGE = 70;

export interface ClaimingOption {
  age: number;
  monthlyBenefit: number;
  percentOfPia: number;
  lifetimeBenefits: number;
  yearsOfPayments: number;
  isEligible: boolean;
  monthsFromFra: number;
}

export interface BreakEvenPair {
  earlierAge: number;
  laterAge: number;
  breakEvenAge: number;
  breakEvenYears: number;
}

// ... cumulativeBenefits, breakEvenAge, computeBreakEvens,
// ... generateCumulativeChartData moved verbatim from socialSecurity.ts
```

- [ ] **Step 4: Re-export from `socialSecurity.ts` and repoint `chartData.ts`**

In `socialSecurity.ts`:

```ts
export {
  breakEvenAge,
  computeBreakEvens,
  cumulativeBenefits,
  generateCumulativeChartData,
  MAX_CLAIM_AGE,
  MIN_CLAIM_AGE,
  type BreakEvenPair,
  type ClaimingOption,
} from './benefitMath';
```

In `chartData.ts` and `chartData.test.ts`, change the imports to:

```ts
import { cumulativeBenefits, type ClaimingOption } from './benefitMath';
```

- [ ] **Step 5: Run the full suite**

Run: `npm run test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/benefitMath.ts src/lib/benefitMath.test.ts src/lib/socialSecurity.ts src/lib/chartData.ts src/lib/chartData.test.ts
git commit -m "refactor: extract cumulative and break-even math into benefitMath.ts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Thread `asOf` through the ssa.tools adapter

**Files:**
- Modify: `src/lib/ssaTools.ts`
- Modify: `src/lib/ssaTools.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: every adapter entry point takes a trailing `asOf: Date = new Date()`. New helper `monthDateFrom(asOf: Date): MonthDate`. Signatures after this task:
  - `isSsaClaimAgeEligible(recipient, claimAgeYears, asOf?)` *(unchanged shape, already had `asOf`)*
  - `lifetimeNpvToAge(recipient, filingAge, lifeExpectancy, discountRate, asOf?)`
  - `computeOptimalFilingSingle(recipient, discountRate, asOf?)`
  - `computeOptimalFilingCouple(worker, spouse, discountRate, asOf?)`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/ssaTools.test.ts
import { monthDateFrom } from './ssaTools';

describe('monthDateFrom', () => {
  it('converts a JS date to the engine month grid', () => {
    // MonthDate months are 0-indexed, matching Date.getMonth().
    const md = monthDateFrom(new Date(2026, 7, 15)); // Aug 2026
    expect(md.year()).toBe(2026);
    expect(md.monthIndex()).toBe(7);
  });
});

describe('isSsaClaimAgeEligible with an injected date', () => {
  it('treats a claim age as reached only once the reference date passes it', () => {
    const r = createPiaRecipient(1960, 6, 2500, 'female'); // born Jun 1960
    expect(isSsaClaimAgeEligible(r, 65, new Date(2024, 5, 1))).toBe(false);
    expect(isSsaClaimAgeEligible(r, 65, new Date(2026, 5, 1))).toBe(true);
  });
});
```

Add `createPiaRecipient` and `isSsaClaimAgeEligible` to the existing import list at the top of the file if they are not already there.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- ssaTools`
Expected: FAIL — `monthDateFrom` is not exported.

- [ ] **Step 3: Add the helper and thread the parameter**

```ts
// src/lib/ssaTools.ts — add near the top
/**
 * Converts a JS Date to the engine's month grid. Every "now" in this adapter
 * routes through here so callers can pin a reference date, which is what makes
 * fixtures deterministic and stops cohorts aging out of the optimizer.
 */
export function monthDateFrom(asOf: Date): MonthDate {
  return MonthDate.initFromYearsMonths({
    years: asOf.getFullYear(),
    months: asOf.getMonth(),
  });
}
```

Then replace every `MonthDate.initFromNow()` call with `monthDateFrom(asOf)` and add the parameter:

```ts
export function lifetimeNpvToAge(
  recipient: Recipient,
  filingAge: MonthDuration,
  lifeExpectancy: number,
  discountRate: number,
  asOf: Date = new Date(),
): number {
  const finalDate = recipient.birthdate.dateAtLayAge(
    MonthDuration.initFromYearsMonths({ years: lifeExpectancy, months: 0 }),
  );
  const cents = strategySumCentsSingle(
    recipient,
    finalDate,
    monthDateFrom(asOf),
    discountRate,
    filingAge,
  );
  return cents / 100;
}

export async function computeOptimalFilingSingle(
  recipient: Recipient,
  discountRate: number,
  asOf: Date = new Date(),
): Promise<{ filingAge: FilingAgeDisplay; expectedNpv: number }> {
  const deathDist = await getDeathProbabilityDistribution(recipient);
  const results = expectedNPVSingle(recipient, monthDateFrom(asOf), discountRate, deathDist);
  if (results.length === 0) {
    throw new Error('No eligible filing ages for this recipient');
  }
  return {
    filingAge: formatFilingAge(results[0].filingAge),
    expectedNpv: results[0].expectedNPVCents / 100,
  };
}

export async function computeOptimalFilingCouple(
  worker: Recipient,
  spouse: Recipient,
  discountRate: number,
  asOf: Date = new Date(),
): Promise<{
  workerFilingAge: FilingAgeDisplay;
  spouseFilingAge: FilingAgeDisplay;
  expectedNpv: number;
}> {
  const [workerDist, spouseDist] = await Promise.all([
    getDeathProbabilityDistribution(worker),
    getDeathProbabilityDistribution(spouse),
  ]);
  const results = expectedNPVCoupleOptimized(
    [worker, spouse],
    monthDateFrom(asOf),
    discountRate,
    [workerDist, spouseDist],
  );
  if (results.length === 0) {
    throw new Error('No eligible couple filing strategies');
  }
  return {
    workerFilingAge: formatFilingAge(results[0].filingAges[0]),
    spouseFilingAge: formatFilingAge(results[0].filingAges[1]),
    expectedNpv: results[0].expectedNPVCents / 100,
  };
}
```

If `MonthDate` does not expose `year()`/`monthIndex()` under those names, read `src/vendor/ssa-tools/month-time.ts` and adjust the **test** to the real accessors. Do not modify the vendored file.

- [ ] **Step 4: Run the tests**

Run: `npm run test`
Expected: PASS. Existing callers pass no `asOf` and keep today's behavior via the default.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ssaTools.ts src/lib/ssaTools.test.ts
git commit -m "feat: allow pinning a reference date in the ssa.tools adapter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Correct the spousal top-up

**Files:**
- Modify: `src/lib/ssaTools.ts`
- Modify: `src/lib/ssaTools.test.ts`

**Interfaces:**
- Consumes: Task 7's adapter
- Produces: `spousalTopUp(worker: Recipient, spouse: Recipient, spouseFilingAge: MonthDuration): number`. The old `spousalBenefitAtFra(worker, spousePia)` is removed.

The defect: `spousalBenefitAtFra` builds a throwaway spouse from the **worker's** birthdate and evaluates only at FRA, so it ignores the spouse's real age and the reduction for starting a spousal benefit early.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/ssaTools.test.ts
import { MonthDuration } from '$lib/month-time';
import { spousalTopUp } from './ssaTools';

describe('spousalTopUp', () => {
  const worker = createPiaRecipient(1960, 6, 2500, 'male');
  const fra = MonthDuration.initFromYearsMonths({ years: 67, months: 0 });

  it('tops a no-record spouse up to half the worker PIA at their FRA', () => {
    const spouse = createPiaRecipient(1962, 3, 0, 'female');
    expect(spousalTopUp(worker, spouse, fra)).toBeCloseTo(1250, 0);
  });

  it('pays nothing when the spouse own PIA already exceeds half the worker PIA', () => {
    const spouse = createPiaRecipient(1962, 3, 2000, 'female');
    expect(spousalTopUp(worker, spouse, fra)).toBe(0);
  });

  it('reduces the top-up when the spouse claims before their FRA', () => {
    const spouse = createPiaRecipient(1962, 3, 0, 'female');
    const atFra = spousalTopUp(worker, spouse, fra);
    const atSixtyTwo = spousalTopUp(
      worker,
      spouse,
      MonthDuration.initFromYearsMonths({ years: 62, months: 0 }),
    );
    expect(atSixtyTwo).toBeGreaterThan(0);
    expect(atSixtyTwo).toBeLessThan(atFra);
  });

  it('uses the spouse own birthdate, not the worker birthdate', () => {
    const sameAge = createPiaRecipient(1960, 6, 0, 'female');
    const younger = createPiaRecipient(1968, 6, 0, 'female');
    const early = MonthDuration.initFromYearsMonths({ years: 62, months: 0 });
    // Different FRA schedules produce different early-claim reductions.
    expect(spousalTopUp(worker, sameAge, early)).not.toBe(
      spousalTopUp(worker, younger, early),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- ssaTools`
Expected: FAIL — `spousalTopUp` is not exported.

- [ ] **Step 3: Implement against the real engine**

```ts
// src/lib/ssaTools.ts — replace spousalBenefitAtFra entirely
import { benefitAtAge, baseSpousalBenefit, spousalBenefitAtAge } from '$lib/benefit-calculator';

/**
 * The spousal top-up the dependent spouse actually receives if they start
 * spousal benefits at `spouseFilingAge`.
 *
 * Replaces the previous FRA-only helper, which fabricated the spouse from the
 * worker's birthdate and therefore ignored both the spouse's real age and the
 * reduction for claiming early.
 */
export function spousalTopUp(
  worker: Recipient,
  spouse: Recipient,
  spouseFilingAge: MonthDuration,
): number {
  return spousalBenefitAtAge(worker, spouse, spouseFilingAge).value();
}
```

Before writing this, open `src/vendor/ssa-tools/benefit-calculator.ts` and confirm the exported name and argument order of the age-aware spousal function. If the engine only exposes `baseSpousalBenefit(worker, spouse)` (the unreduced amount) plus a separate reduction routine, compose them here rather than inventing an export:

```ts
export function spousalTopUp(
  worker: Recipient,
  spouse: Recipient,
  spouseFilingAge: MonthDuration,
): number {
  const base = baseSpousalBenefit(worker, spouse).value();
  if (base <= 0) return 0;
  const fra = spouse.normalRetirementAge();
  const monthsEarly = fra.asMonths() - spouseFilingAge.asMonths();
  if (monthsEarly <= 0) return base; // No delayed credits apply to spousal benefits.
  // SSA spousal reduction: 25/36 of 1% for the first 36 months, then 5/12 of 1%.
  const first = Math.min(monthsEarly, 36);
  const rest = Math.max(0, monthsEarly - 36);
  const reduction = first * (25 / 36 / 100) + rest * (5 / 12 / 100);
  return Math.round(base * (1 - reduction) * 100) / 100;
}
```

Prefer the engine's own function if one exists — only fall back to the explicit formula above if it does not.

- [ ] **Step 4: Update the two obsolete tests**

Delete the old `describe('spousalBenefitAtFra', ...)` block from `src/lib/ssaTools.test.ts`; its cases are now covered by the first two `spousalTopUp` tests.

- [ ] **Step 5: Point `socialSecurity.ts` at the new function**

In `analyzeClaiming`, replace `spousalBenefitAtFra(recipient, spouseMonthlyBenefitAtFra)` with `spousalTopUp(recipient, spouse, optimalSpouseFilingAge)`, using the spouse `Recipient` already constructed in the married branch and the spouse filing age returned by the couple optimizer. This is temporary — `socialSecurity.ts` is deleted in Task 15 — but it keeps the suite green.

- [ ] **Step 6: Run the tests**

Run: `npm run test`
Expected: PASS. The golden fixture `married-1960-spouse-no-record` expects a $1,250 top-up; if the recommended spouse filing age is before their FRA the value now differs. **Do not edit the fixture in this task.** If it fails, note the scenario id and expected/actual, and resolve it in Task 21 where fixtures are migrated.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ssaTools.ts src/lib/ssaTools.test.ts src/lib/socialSecurity.ts
git commit -m "fix: compute the spousal top-up from the real spouse and filing age

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Expose ranked couple strategies

**Files:**
- Modify: `src/lib/ssaTools.ts`
- Modify: `src/lib/ssaTools.test.ts`

**Interfaces:**
- Consumes: Task 7's `asOf`
- Produces:

```ts
export interface RankedStrategy {
  filingAges: FilingAgeDisplay[];   // one per person, input order
  expectedNpv: number;
}
export function rankedSingleStrategies(r, discountRate, asOf?): Promise<RankedStrategy[]>
export function rankedCoupleStrategies(a, b, discountRate, asOf?): Promise<RankedStrategy[]>
export function findStrategyByAges(ranked: RankedStrategy[], ages: number[]): RankedStrategy | null
```

`expectedNPVCoupleOptimized` already returns **every** filing-age combination sorted descending by NPV; the adapter currently discards all but `results[0]`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/ssaTools.test.ts
import { findStrategyByAges, rankedCoupleStrategies, rankedSingleStrategies } from './ssaTools';

// This block needs the life-table fetch stub; copy the beforeAll/afterAll
// fetch stub from src/lib/socialSecurity.test.ts into this file.
describe('ranked strategies', () => {
  const asOf = new Date(2026, 0, 15);

  it('returns single strategies sorted best-first', async () => {
    const r = createPiaRecipient(1962, 6, 2500, 'female');
    const ranked = await rankedSingleStrategies(r, 0.025, asOf);
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked[0].filingAges).toHaveLength(1);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].expectedNpv).toBeGreaterThanOrEqual(ranked[i].expectedNpv);
    }
  });

  it('returns couple strategies with one filing age per person, sorted best-first', async () => {
    const a = createPiaRecipient(1962, 6, 3200, 'male');
    const b = createPiaRecipient(1964, 2, 2100, 'female');
    const ranked = await rankedCoupleStrategies(a, b, 0.025, asOf);
    expect(ranked[0].filingAges).toHaveLength(2);
    expect(ranked[0].expectedNpv).toBeGreaterThanOrEqual(ranked[1].expectedNpv);
  });

  it('finds an exact whole-year combination and returns null when absent', async () => {
    const a = createPiaRecipient(1962, 6, 3200, 'male');
    const b = createPiaRecipient(1964, 2, 2100, 'female');
    const ranked = await rankedCoupleStrategies(a, b, 0.025, asOf);

    const both70 = findStrategyByAges(ranked, [70, 70]);
    expect(both70).not.toBeNull();
    expect(both70!.filingAges[0].years).toBe(70);
    expect(both70!.filingAges[1].years).toBe(70);

    // 61 is below the SSA filing window, so no strategy uses it.
    expect(findStrategyByAges(ranked, [61, 61])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- ssaTools`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement**

```ts
// src/lib/ssaTools.ts
export interface RankedStrategy {
  filingAges: FilingAgeDisplay[];
  expectedNpv: number;
}

export async function rankedSingleStrategies(
  recipient: Recipient,
  discountRate: number,
  asOf: Date = new Date(),
): Promise<RankedStrategy[]> {
  const deathDist = await getDeathProbabilityDistribution(recipient);
  return expectedNPVSingle(recipient, monthDateFrom(asOf), discountRate, deathDist).map((r) => ({
    filingAges: [formatFilingAge(r.filingAge)],
    expectedNpv: r.expectedNPVCents / 100,
  }));
}

export async function rankedCoupleStrategies(
  a: Recipient,
  b: Recipient,
  discountRate: number,
  asOf: Date = new Date(),
): Promise<RankedStrategy[]> {
  const [distA, distB] = await Promise.all([
    getDeathProbabilityDistribution(a),
    getDeathProbabilityDistribution(b),
  ]);
  return expectedNPVCoupleOptimized([a, b], monthDateFrom(asOf), discountRate, [
    distA,
    distB,
  ]).map((r) => ({
    filingAges: [formatFilingAge(r.filingAges[0]), formatFilingAge(r.filingAges[1])],
    expectedNpv: r.expectedNPVCents / 100,
  }));
}

/** Exact whole-year match on every person's filing age; null when unavailable. */
export function findStrategyByAges(
  ranked: RankedStrategy[],
  ages: number[],
): RankedStrategy | null {
  return (
    ranked.find(
      (s) =>
        s.filingAges.length === ages.length &&
        s.filingAges.every((f, i) => f.years === ages[i] && f.months === 0),
    ) ?? null
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ssaTools.ts src/lib/ssaTools.test.ts
git commit -m "feat: expose the full ranked strategy list from the couple optimizer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: `personAnalysis.ts`

**Files:**
- Create: `src/lib/personAnalysis.ts`
- Create: `src/lib/personAnalysis.test.ts`

**Interfaces:**
- Consumes: `benefitMath` (Task 6), `ssaTools` (Tasks 7–9)
- Produces:

```ts
export type Gender = 'male' | 'female';
export interface Person {
  id: 'a' | 'b';
  name?: string;
  birthYear: number;
  birthMonth: number;   // 1-12
  gender: Gender;
  piaMonthly: number;
  lifeExpectancy: number;
}
export interface FraResult { years: number; months: number; totalMonths: number; fraDate: Date }
export interface PersonAnalysis {
  person: Person;
  fra: FraResult;
  currentAge: { years: number; months: number };
  claimingOptions: ClaimingOption[];
  recommendedFilingAge: FilingAgeDisplay;
  recommendedMonthly: number;
  breakEvens: BreakEvenPair[];
  ssaSuggestedLifeExpectancy: number;
}
export function getFullRetirementAge(birthYear: number): FraResult
export function getCurrentAge(birthYear, birthMonth, asOf?): { years: number; months: number }
export function ageToMonths(years: number, months?: number): number
export function analyzePerson(
  person: Person,
  recommendedFilingAge: FilingAgeDisplay,
  annualCola: number,
  asOf?: Date,
): PersonAnalysis
```

`analyzePerson` receives the filing age rather than computing it, because for a married couple the recommendation comes from the joint optimizer in Task 12.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/personAnalysis.test.ts
import { describe, expect, it } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import { formatFilingAge } from './ssaTools';
import {
  analyzePerson,
  getCurrentAge,
  getFullRetirementAge,
  type Person,
} from './personAnalysis';

const dan: Person = {
  id: 'a',
  name: 'Dan',
  birthYear: 1962,
  birthMonth: 4,
  gender: 'male',
  piaMonthly: 2400,
  lifeExpectancy: 85,
};

const asOf = new Date(2026, 0, 15);
const at70 = formatFilingAge(MonthDuration.initFromYearsMonths({ years: 70, months: 0 }));

describe('getFullRetirementAge', () => {
  it('matches the SSA schedule', () => {
    expect(getFullRetirementAge(1954)).toMatchObject({ years: 66, months: 0 });
    expect(getFullRetirementAge(1957)).toMatchObject({ years: 66, months: 6 });
    expect(getFullRetirementAge(1960)).toMatchObject({ years: 67, months: 0 });
  });
});

describe('getCurrentAge', () => {
  it('computes years and months against a reference date', () => {
    expect(getCurrentAge(1960, 6, new Date(2026, 5, 15))).toEqual({ years: 66, months: 0 });
    expect(getCurrentAge(1960, 1, new Date(2026, 5, 15))).toEqual({ years: 66, months: 5 });
  });

  it('never returns negatives for a future birth date', () => {
    expect(getCurrentAge(2030, 1, new Date(2026, 0, 1))).toEqual({ years: 0, months: 0 });
  });
});

describe('analyzePerson', () => {
  it('produces one claiming option per age from 62 through 70', () => {
    const a = analyzePerson(dan, at70, 2.5, asOf);
    expect(a.claimingOptions.map((o) => o.age)).toEqual([62, 63, 64, 65, 66, 67, 68, 69, 70]);
  });

  it('applies the SSA reduction and delayed credits around FRA 67', () => {
    const a = analyzePerson(dan, at70, 2.5, asOf);
    const at62 = a.claimingOptions.find((o) => o.age === 62)!;
    const atSeventy = a.claimingOptions.find((o) => o.age === 70)!;
    expect(at62.percentOfPia).toBeCloseTo(70, 1);
    expect(atSeventy.percentOfPia).toBeCloseTo(124, 1);
    expect(at62.monthlyBenefit).toBeCloseTo(1680, 0); // 2400 * 0.70
  });

  it('increases monthly benefit monotonically with claim age', () => {
    const monthlies = analyzePerson(dan, at70, 2.5, asOf).claimingOptions.map(
      (o) => o.monthlyBenefit,
    );
    for (let i = 1; i < monthlies.length; i++) {
      expect(monthlies[i]).toBeGreaterThan(monthlies[i - 1]);
    }
  });

  it('carries the supplied filing age through as the recommendation', () => {
    const a = analyzePerson(dan, at70, 2.5, asOf);
    expect(a.recommendedFilingAge.years).toBe(70);
    expect(a.recommendedMonthly).toBeCloseTo(2976, 0); // 2400 * 1.24
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- personAnalysis`
Expected: FAIL — `Cannot find module './personAnalysis'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/personAnalysis.ts
import { MonthDuration } from '$lib/month-time';
import {
  computeBreakEvens,
  MAX_CLAIM_AGE,
  MIN_CLAIM_AGE,
  type BreakEvenPair,
  type ClaimingOption,
} from './benefitMath';
import { getSuggestedLifeExpectancy, type Gender } from './lifeExpectancy';
import {
  createPiaRecipient,
  fraFromBirthYear,
  isSsaClaimAgeEligible,
  lifetimeNpvToAge,
  ssaMonthlyBenefitAtAge,
  ssaMonthlyBenefitAtFilingAge,
  type FilingAgeDisplay,
} from './ssaTools';

// Single source of truth — `lifeExpectancy.ts` owns Gender because its life
// tables are keyed by it. Re-exported so consumers import person concepts
// from one place.
export type { Gender };

export interface Person {
  id: 'a' | 'b';
  name?: string;
  birthYear: number;
  birthMonth: number;
  gender: Gender;
  piaMonthly: number;
  lifeExpectancy: number;
}

export interface FraResult {
  years: number;
  months: number;
  totalMonths: number;
  fraDate: Date;
}

export interface PersonAnalysis {
  person: Person;
  fra: FraResult;
  currentAge: { years: number; months: number };
  claimingOptions: ClaimingOption[];
  recommendedFilingAge: FilingAgeDisplay;
  recommendedMonthly: number;
  breakEvens: BreakEvenPair[];
  ssaSuggestedLifeExpectancy: number;
}

export function getFullRetirementAge(birthYear: number): FraResult {
  const fra = fraFromBirthYear(birthYear);
  return { ...fra, fraDate: new Date(birthYear + fra.years, fra.months, 1) };
}

export function getCurrentAge(
  birthYear: number,
  birthMonth: number,
  asOf: Date = new Date(),
): { years: number; months: number } {
  let years = asOf.getFullYear() - birthYear;
  let months = asOf.getMonth() + 1 - birthMonth;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months) };
}

export function ageToMonths(years: number, months = 0): number {
  return years * 12 + months;
}

export function analyzePerson(
  person: Person,
  recommendedFilingAge: FilingAgeDisplay,
  annualCola: number,
  asOf: Date = new Date(),
): PersonAnalysis {
  const recipient = createPiaRecipient(
    person.birthYear,
    person.birthMonth,
    person.piaMonthly,
    person.gender,
  );
  const currentAge = getCurrentAge(person.birthYear, person.birthMonth, asOf);

  const claimingOptions: ClaimingOption[] = [];
  for (let age = MIN_CLAIM_AGE; age <= MAX_CLAIM_AGE; age++) {
    const { benefit, percentOfPia, monthsFromFra } = ssaMonthlyBenefitAtAge(recipient, age);
    claimingOptions.push({
      age,
      monthlyBenefit: benefit,
      percentOfPia,
      lifetimeBenefits: lifetimeNpvToAge(
        recipient,
        MonthDuration.initFromYearsMonths({ years: age, months: 0 }),
        person.lifeExpectancy,
        0,
        asOf,
      ),
      yearsOfPayments: Math.max(0, person.lifeExpectancy - age),
      isEligible: isSsaClaimAgeEligible(recipient, age, asOf),
      monthsFromFra,
    });
  }

  return {
    person,
    fra: getFullRetirementAge(person.birthYear),
    currentAge,
    claimingOptions,
    recommendedFilingAge,
    recommendedMonthly: ssaMonthlyBenefitAtFilingAge(
      recipient,
      recommendedFilingAge.monthDuration,
    ).benefit,
    breakEvens: computeBreakEvens(claimingOptions, annualCola),
    ssaSuggestedLifeExpectancy: getSuggestedLifeExpectancy(currentAge.years, person.gender),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/personAnalysis.ts src/lib/personAnalysis.test.ts
git commit -m "feat: add per-person analysis module

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: `household.ts` — types and the single-person path

**Files:**
- Create: `src/lib/household.ts`
- Create: `src/lib/household.test.ts`

**Interfaces:**
- Consumes: `personAnalysis` (Task 10), `ssaTools` (Task 9)
- Produces:

```ts
export interface Assumptions { annualCola: number; discountRate: number }
export type Household =
  | { status: 'single';  people: [Person] }
  | { status: 'married'; people: [Person, Person] };
export interface HouseholdStrategy {
  key: 'earliest' | 'fra' | 'optimal' | 'latest';
  label: string;
  filingAges: FilingAgeDisplay[];
  expectedNpv: number;
  deltaVsOptimal: number;
  isOptimal: boolean;
}
export interface HouseholdAnalysis {
  status: Household['status'];
  people: PersonAnalysis[];
  optimal: HouseholdStrategy;
  comparisons: HouseholdStrategy[];
  combinedTimeline: CombinedTimelinePoint[];
  spousalTopUp?: { atFra: number; atRecommendedFilingAge: number };
  recommendation: string;
  recommendationDetail: string;
  assumptions: Assumptions;
  asOf: Date;
}
export function analyzeHousehold(h: Household, a: Assumptions, asOf?: Date): Promise<HouseholdAnalysis>
```

This task implements `status: 'single'` only. `combinedTimeline` is `[]` until Task 13.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/household.test.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, type Household } from './household';
import type { Person } from './personAnalysis';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

const asOf = new Date(2026, 0, 15);
const assumptions = { annualCola: 2.5, discountRate: 0.025 };

const dan: Person = {
  id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
  gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
};

describe('analyzeHousehold — single', () => {
  const household: Household = { status: 'single', people: [dan] };

  it('analyzes exactly one person', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.status).toBe('single');
    expect(result.people).toHaveLength(1);
    expect(result.people[0].person.name).toBe('Dan');
  });

  it('marks exactly one comparison row as optimal, with zero delta', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    const optimal = comparisons.filter((c) => c.isOptimal);
    expect(optimal).toHaveLength(1);
    expect(optimal[0].deltaVsOptimal).toBe(0);
  });

  it('never scores a comparison above the optimal', async () => {
    const { comparisons, optimal } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.expectedNpv).toBeLessThanOrEqual(optimal.expectedNpv);
      expect(c.deltaVsOptimal).toBeLessThanOrEqual(0);
    }
  });

  it('gives every comparison one filing age and a single-person label', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.filingAges).toHaveLength(1);
    }
    expect(comparisons.map((c) => c.label)).toContain('Claim at 70');
  });

  it('omits spousal data for a single claimant', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.spousalTopUp).toBeUndefined();
  });

  it('echoes the reference date and assumptions', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.asOf).toEqual(asOf);
    expect(result.assumptions).toEqual(assumptions);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- household`
Expected: FAIL — `Cannot find module './household'`.

- [ ] **Step 3: Implement the single path**

```ts
// src/lib/household.ts
import { formatCurrency } from './format';
import { analyzePerson, getFullRetirementAge, type Person, type PersonAnalysis } from './personAnalysis';
import {
  findStrategyByAges,
  rankedSingleStrategies,
  type FilingAgeDisplay,
  type RankedStrategy,
} from './ssaTools';

export interface Assumptions {
  annualCola: number;
  discountRate: number;
}

export type Household =
  | { status: 'single'; people: [Person] }
  | { status: 'married'; people: [Person, Person] };

export type StrategyKey = 'earliest' | 'fra' | 'optimal' | 'latest';

export interface HouseholdStrategy {
  key: StrategyKey;
  label: string;
  filingAges: FilingAgeDisplay[];
  expectedNpv: number;
  deltaVsOptimal: number;
  isOptimal: boolean;
}

export interface CombinedTimelinePoint {
  year: number;
  byPersonId: Record<string, number>;
  total: number;
}

export interface HouseholdAnalysis {
  status: Household['status'];
  people: PersonAnalysis[];
  optimal: HouseholdStrategy;
  comparisons: HouseholdStrategy[];
  combinedTimeline: CombinedTimelinePoint[];
  spousalTopUp?: { atFra: number; atRecommendedFilingAge: number };
  recommendation: string;
  recommendationDetail: string;
  assumptions: Assumptions;
  asOf: Date;
}

const LABELS: Record<StrategyKey, { single: string; married: string }> = {
  earliest: { single: 'Claim at 62', married: 'Both claim earliest (62)' },
  fra: { single: 'Claim at FRA', married: 'Both claim at FRA' },
  optimal: { single: 'Optimal', married: 'Optimal' },
  latest: { single: 'Claim at 70', married: 'Both delay to 70' },
};

/**
 * Builds the comparison rows from the already-ranked strategy list.
 *
 * Rows whose filing ages are unattainable given `asOf` are omitted — the
 * optimizer only returns ages at or after each person's current age. When the
 * optimum coincides with a named row, that row is marked optimal rather than
 * duplicated.
 */
function buildComparisons(
  ranked: RankedStrategy[],
  optimalStrategy: RankedStrategy,
  people: Person[],
  status: Household['status'],
): { optimal: HouseholdStrategy; comparisons: HouseholdStrategy[] } {
  const namedAges: { key: StrategyKey; ages: number[] }[] = [
    { key: 'earliest', ages: people.map(() => 62) },
    { key: 'fra', ages: people.map((p) => getFullRetirementAge(p.birthYear).years) },
    { key: 'latest', ages: people.map(() => 70) },
  ];

  const isOptimalAges = (ages: number[]) =>
    optimalStrategy.filingAges.every((f, i) => f.years === ages[i] && f.months === 0);

  const key = status === 'married' ? 'married' : 'single';

  const optimal: HouseholdStrategy = {
    key: 'optimal',
    label: LABELS.optimal[key],
    filingAges: optimalStrategy.filingAges,
    expectedNpv: optimalStrategy.expectedNpv,
    deltaVsOptimal: 0,
    isOptimal: true,
  };

  const rows: HouseholdStrategy[] = [];
  for (const named of namedAges) {
    if (isOptimalAges(named.ages)) continue; // Folded into the optimal row.
    const match = findStrategyByAges(ranked, named.ages);
    if (!match) continue; // Unattainable given asOf.
    rows.push({
      key: named.key,
      label: LABELS[named.key][key],
      filingAges: match.filingAges,
      expectedNpv: match.expectedNpv,
      deltaVsOptimal: Math.round((match.expectedNpv - optimal.expectedNpv) * 100) / 100,
      isOptimal: false,
    });
  }

  // Present ascending by filing age so the table reads earliest to latest,
  // with the optimal row in its natural position.
  const ordered = [...rows, optimal].sort(
    (a, b) => a.filingAges[0].decimalYears - b.filingAges[0].decimalYears,
  );
  return { optimal, comparisons: ordered };
}

export async function analyzeHousehold(
  household: Household,
  assumptions: Assumptions,
  asOf: Date = new Date(),
): Promise<HouseholdAnalysis> {
  if (household.status === 'married') {
    throw new Error('Married households are implemented in Task 12');
  }

  const [person] = household.people;
  const recipientRanked = await rankedSingleStrategies(
    createRecipientFor(person),
    assumptions.discountRate,
    asOf,
  );
  if (recipientRanked.length === 0) {
    throw new Error('No eligible filing ages for this person');
  }

  const { optimal, comparisons } = buildComparisons(
    recipientRanked,
    recipientRanked[0],
    household.people,
    'single',
  );

  const people = [
    analyzePerson(person, optimal.filingAges[0], assumptions.annualCola, asOf),
  ];

  return {
    status: 'single',
    people,
    optimal,
    comparisons,
    combinedTimeline: [],
    recommendation: `Claim at age ${optimal.filingAges[0].label}`,
    recommendationDetail:
      `ssa.tools recommends filing at age ${optimal.filingAges[0].label} ` +
      `(${formatCurrency(people[0].recommendedMonthly)}/month) for the highest expected ` +
      `present value, ${formatCurrency(optimal.expectedNpv)}.`,
    assumptions,
    asOf,
  };
}
```

Add the small helper next to `analyzeHousehold`:

```ts
import { createPiaRecipient } from './ssaTools';

function createRecipientFor(person: Person) {
  return createPiaRecipient(
    person.birthYear,
    person.birthMonth,
    person.piaMonthly,
    person.gender,
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- household`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/household.ts src/lib/household.test.ts
git commit -m "feat: add household analysis with the single-person path

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: `household.ts` — the married path

**Files:**
- Modify: `src/lib/household.ts`
- Modify: `src/lib/household.test.ts`

**Interfaces:**
- Consumes: Task 11's `buildComparisons`, Task 9's `rankedCoupleStrategies`, Task 8's `spousalTopUp`
- Produces: `analyzeHousehold` handling `status: 'married'`, populating `spousalTopUp` and both `PersonAnalysis` entries

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/household.test.ts
const sarah: Person = {
  id: 'b', name: 'Sarah', birthYear: 1964, birthMonth: 2,
  gender: 'female', piaMonthly: 2100, lifeExpectancy: 88,
};

describe('analyzeHousehold — married', () => {
  const household: Household = { status: 'married', people: [dan, sarah] };

  it('analyzes both people and keeps input order', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.people.map((p) => p.person.name)).toEqual(['Dan', 'Sarah']);
  });

  it('gives each comparison one filing age per person', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.filingAges).toHaveLength(2);
    }
  });

  it('uses married labels', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    expect(comparisons.map((c) => c.label)).toContain('Both delay to 70');
  });

  it('assigns each person the filing age from the joint optimum', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.people[0].recommendedFilingAge).toEqual(result.optimal.filingAges[0]);
    expect(result.people[1].recommendedFilingAge).toEqual(result.optimal.filingAges[1]);
  });

  it('reports a spousal top-up for a spouse with no record', async () => {
    const noRecord: Person = { ...sarah, piaMonthly: 0 };
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, noRecord] },
      assumptions,
      asOf,
    );
    expect(result.spousalTopUp!.atFra).toBeCloseTo(1200, 0); // half of Dan's 2400
    expect(result.spousalTopUp!.atRecommendedFilingAge).toBeGreaterThanOrEqual(0);
  });

  it('reports no top-up when both have substantial records', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.spousalTopUp!.atFra).toBe(0);
  });

  it('uses each person own gender for mortality, not an assumed opposite', async () => {
    const bothMale: Household = {
      status: 'married',
      people: [dan, { ...sarah, gender: 'male' }],
    };
    const mixed = await analyzeHousehold(household, assumptions, asOf);
    const same = await analyzeHousehold(bothMale, assumptions, asOf);
    // Different mortality tables must produce a different joint expected NPV.
    expect(same.optimal.expectedNpv).not.toBe(mixed.optimal.expectedNpv);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- household`
Expected: FAIL — "Married households are implemented in Task 12".

- [ ] **Step 3: Implement the married branch**

Replace the `throw` in `analyzeHousehold` with:

```ts
  if (household.status === 'married') {
    const [personA, personB] = household.people;
    const recipientA = createRecipientFor(personA);
    const recipientB = createRecipientFor(personB);

    const ranked = await rankedCoupleStrategies(
      recipientA,
      recipientB,
      assumptions.discountRate,
      asOf,
    );
    if (ranked.length === 0) {
      throw new Error('No eligible couple filing strategies');
    }

    const { optimal, comparisons } = buildComparisons(
      ranked,
      ranked[0],
      household.people,
      'married',
    );

    const people = household.people.map((person, i) =>
      analyzePerson(person, optimal.filingAges[i], assumptions.annualCola, asOf),
    );

    // The lower earner is the one who can receive a top-up on the other's record.
    const aIsHigher = personA.piaMonthly >= personB.piaMonthly;
    const higher = aIsHigher ? recipientA : recipientB;
    const lower = aIsHigher ? recipientB : recipientA;
    const lowerIndex = aIsHigher ? 1 : 0;
    const lowerFra = MonthDuration.initFromYearsMonths({
      years: getFullRetirementAge(household.people[lowerIndex].birthYear).years,
      months: getFullRetirementAge(household.people[lowerIndex].birthYear).months,
    });

    const labelA = personLabel(personA.name, 0);
    const labelB = personLabel(personB.name, 1);

    return {
      status: 'married',
      people,
      optimal,
      comparisons,
      combinedTimeline: [],
      spousalTopUp: {
        atFra: spousalTopUp(higher, lower, lowerFra),
        atRecommendedFilingAge: spousalTopUp(
          higher,
          lower,
          optimal.filingAges[lowerIndex].monthDuration,
        ),
      },
      recommendation:
        `${labelA} files at ${optimal.filingAges[0].label} · ` +
        `${labelB} files at ${optimal.filingAges[1].label}`,
      recommendationDetail:
        `The ssa.tools couple optimizer maximizes combined expected present value at ` +
        `${formatCurrency(optimal.expectedNpv)} when ${labelA} files at age ` +
        `${optimal.filingAges[0].label} and ${labelB} files at age ` +
        `${optimal.filingAges[1].label}.`,
      assumptions,
      asOf,
    };
  }
```

Add the imports this needs: `MonthDuration` from `$lib/month-time`, `personLabel` from `./format`, `rankedCoupleStrategies` and `spousalTopUp` from `./ssaTools`.

- [ ] **Step 4: Run the tests**

Run: `npm run test -- household`
Expected: PASS. If the "different gender produces different NPV" test fails with identical values, verify the life-table fetch stub is serving distinct `male_*`/`female_*` files before suspecting the implementation.

- [ ] **Step 5: Commit**

```bash
git add src/lib/household.ts src/lib/household.test.ts
git commit -m "feat: add the married household path with per-person gender

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Combined income timeline

**Files:**
- Modify: `src/lib/household.ts`
- Modify: `src/lib/household.test.ts`

**Interfaces:**
- Consumes: Task 12
- Produces: `combinedTimeline: CombinedTimelinePoint[]` populated for both single and married households. One point per calendar year from the earliest recommended filing year through the last year either person is expected to be alive.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/household.test.ts
describe('combinedTimeline', () => {
  it('starts no earlier than the first benefit year and rises when the second person files', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    const t = result.combinedTimeline;
    expect(t.length).toBeGreaterThan(0);

    // Totals equal the sum of the per-person amounts in every year.
    for (const point of t) {
      const summed = Object.values(point.byPersonId).reduce((a, b) => a + b, 0);
      expect(point.total).toBeCloseTo(summed, 2);
    }

    // Years increase by one with no gaps.
    for (let i = 1; i < t.length; i++) {
      expect(t[i].year).toBe(t[i - 1].year + 1);
    }

    // The household total never decreases while both are alive and filed.
    expect(t[t.length - 1].total).toBeGreaterThanOrEqual(t[0].total);
  });

  it('keys amounts by person id', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    expect(Object.keys(result.combinedTimeline[0].byPersonId).sort()).toEqual(['a', 'b']);
  });

  it('produces a single-keyed timeline for a single claimant', async () => {
    const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(Object.keys(result.combinedTimeline[0].byPersonId)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- household`
Expected: FAIL — `combinedTimeline` is an empty array.

- [ ] **Step 3: Implement**

```ts
// src/lib/household.ts
/**
 * Household income per calendar year under the recommended strategy.
 *
 * A person contributes 12 monthly payments in every year after they have
 * filed and are still within their planning horizon, so the series steps up
 * as the second person files. Amounts are nominal at the recommended benefit;
 * the COLA slider is illustrative and applied by the chart layer.
 */
function buildCombinedTimeline(people: PersonAnalysis[]): CombinedTimelinePoint[] {
  const filingYear = (p: PersonAnalysis) =>
    p.person.birthYear + p.recommendedFilingAge.years;
  const finalYear = (p: PersonAnalysis) => p.person.birthYear + p.person.lifeExpectancy;

  const start = Math.min(...people.map(filingYear));
  const end = Math.max(...people.map(finalYear));

  const points: CombinedTimelinePoint[] = [];
  for (let year = start; year <= end; year++) {
    const byPersonId: Record<string, number> = {};
    let total = 0;
    for (const p of people) {
      const active = year >= filingYear(p) && year <= finalYear(p);
      const amount = active ? Math.round(p.recommendedMonthly * 12 * 100) / 100 : 0;
      byPersonId[p.person.id] = amount;
      total += amount;
    }
    points.push({ year, byPersonId, total: Math.round(total * 100) / 100 });
  }
  return points;
}
```

Replace both `combinedTimeline: []` occurrences with `combinedTimeline: buildCombinedTimeline(people)`.

- [ ] **Step 4: Run the tests**

Run: `npm run test -- household`
Expected: PASS. The "never decreases" assertion holds only while both people are alive; if a shorter life expectancy makes the final year lower, relax that assertion to compare the first year against the peak rather than the last.

- [ ] **Step 5: Commit**

```bash
git add src/lib/household.ts src/lib/household.test.ts
git commit -m "feat: build the combined household income timeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Form state maps to a Household

**Files:**
- Modify: `src/lib/formState.ts`
- Create: `src/lib/formState.test.ts`

**Interfaces:**
- Consumes: `household` (Tasks 11–13), `personAnalysis` (Task 10)
- Produces:

```ts
export interface AnalyzerFormState {
  personA: PersonFormFields;
  personB: PersonFormFields;
  hasSpouse: boolean | null;
  lifeExpectancy: number | null;   // person A planning horizon
  annualCola: number;
  discountRate: number;
}
export interface PersonFormFields {
  name: string;
  birthYear: number | '';
  birthMonth: number | '';
  gender: Gender | null;
  monthlyBenefit: number | '';
}
export function isFormComplete(form): boolean
export function toHousehold(form): Household
export function analyzeIfComplete(form, asOf?): Promise<HouseholdAnalysis | null>
export function suggestedLifeExpectancy(form): number | null
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/formState.test.ts
import { describe, expect, it } from 'vitest';
import { BLANK_FORM, isFormComplete, toHousehold, type AnalyzerFormState } from './formState';

const completeA = {
  name: 'Dan',
  birthYear: 1962,
  birthMonth: 4,
  gender: 'male' as const,
  monthlyBenefit: 2400,
};
const completeB = {
  name: '',
  birthYear: 1964,
  birthMonth: 2,
  gender: 'female' as const,
  monthlyBenefit: 2100,
};

const single: AnalyzerFormState = {
  ...BLANK_FORM,
  personA: completeA,
  hasSpouse: false,
  lifeExpectancy: 85,
};

describe('isFormComplete', () => {
  it('accepts a complete single form', () => {
    expect(isFormComplete(single)).toBe(true);
  });

  it('rejects a blank form', () => {
    expect(isFormComplete(BLANK_FORM)).toBe(false);
  });

  it('rejects a zero or missing benefit', () => {
    expect(isFormComplete({ ...single, personA: { ...completeA, monthlyBenefit: 0 } })).toBe(false);
    expect(isFormComplete({ ...single, personA: { ...completeA, monthlyBenefit: '' } })).toBe(false);
  });

  it('rejects married until every spouse field is supplied', () => {
    const married = { ...single, hasSpouse: true, personB: BLANK_FORM.personB };
    expect(isFormComplete(married)).toBe(false);

    expect(
      isFormComplete({ ...married, personB: { ...completeB, gender: null } }),
    ).toBe(false);
    expect(
      isFormComplete({ ...married, personB: { ...completeB, birthYear: '' } }),
    ).toBe(false);

    expect(isFormComplete({ ...married, personB: completeB })).toBe(true);
  });

  it('accepts a spouse with a zero benefit, which means no work record', () => {
    const married = {
      ...single,
      hasSpouse: true,
      personB: { ...completeB, monthlyBenefit: 0 },
    };
    expect(isFormComplete(married)).toBe(true);
  });
});

describe('toHousehold', () => {
  it('builds a single household with one person keyed a', () => {
    const h = toHousehold(single);
    expect(h.status).toBe('single');
    expect(h.people).toHaveLength(1);
    expect(h.people[0].id).toBe('a');
    expect(h.people[0].name).toBe('Dan');
  });

  it('builds a married household preserving order and ids', () => {
    const h = toHousehold({ ...single, hasSpouse: true, personB: completeB });
    expect(h.status).toBe('married');
    expect(h.people.map((p) => p.id)).toEqual(['a', 'b']);
    expect(h.people[1].gender).toBe('female');
    expect(h.people[1].piaMonthly).toBe(2100);
  });

  it('never invents spouse data from the primary person', () => {
    const h = toHousehold({ ...single, hasSpouse: true, personB: completeB });
    expect(h.people[1].birthYear).toBe(1964);
    expect(h.people[1].birthYear).not.toBe(h.people[0].birthYear);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- formState`
Expected: FAIL — the new shape does not exist.

- [ ] **Step 3: Rewrite `formState.ts`**

```ts
// src/lib/formState.ts
import { CPI_DEFAULT_COLA } from './cpiHistory';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from './household';
import { getCurrentAge, type Gender, type Person } from './personAnalysis';
import { getSuggestedLifeExpectancy } from './lifeExpectancy';
import { DEFAULT_DISCOUNT_RATE } from './ssaTools';

export interface PersonFormFields {
  name: string;
  birthYear: number | '';
  birthMonth: number | '';
  gender: Gender | null;
  monthlyBenefit: number | '';
}

export interface AnalyzerFormState {
  personA: PersonFormFields;
  personB: PersonFormFields;
  hasSpouse: boolean | null;
  lifeExpectancy: number | null;
  annualCola: number;
  discountRate: number;
}

const BLANK_PERSON: PersonFormFields = {
  name: '',
  birthYear: '',
  birthMonth: '',
  gender: null,
  monthlyBenefit: '',
};

export const BLANK_FORM: AnalyzerFormState = {
  personA: BLANK_PERSON,
  personB: BLANK_PERSON,
  hasSpouse: null,
  lifeExpectancy: null,
  annualCola: CPI_DEFAULT_COLA,
  discountRate: DEFAULT_DISCOUNT_RATE,
};

/**
 * A person is complete when identity and benefit are all present.
 * `requirePositiveBenefit` is false for a spouse, where $0 legitimately means
 * "no work record of their own".
 */
function isPersonComplete(p: PersonFormFields, requirePositiveBenefit: boolean): boolean {
  if (p.birthYear === '' || p.birthMonth === '' || p.gender === null) return false;
  if (p.monthlyBenefit === '') return false;
  return requirePositiveBenefit ? p.monthlyBenefit > 0 : p.monthlyBenefit >= 0;
}

export function isFormComplete(form: AnalyzerFormState): boolean {
  if (form.hasSpouse === null || form.lifeExpectancy === null) return false;
  if (!isPersonComplete(form.personA, true)) return false;
  // Married analyses require real spouse data — never defaulted from person A.
  if (form.hasSpouse && !isPersonComplete(form.personB, false)) return false;
  return true;
}

function toPerson(fields: PersonFormFields, id: 'a' | 'b', lifeExpectancy: number): Person {
  return {
    id,
    name: fields.name.trim() || undefined,
    birthYear: fields.birthYear as number,
    birthMonth: fields.birthMonth as number,
    gender: fields.gender as Gender,
    piaMonthly: fields.monthlyBenefit as number,
    lifeExpectancy,
  };
}

export function toHousehold(form: AnalyzerFormState): Household {
  const le = form.lifeExpectancy as number;
  const personA = toPerson(form.personA, 'a', le);

  if (!form.hasSpouse) return { status: 'single', people: [personA] };

  const spouseAge = getCurrentAge(
    form.personB.birthYear as number,
    form.personB.birthMonth as number,
  ).years;
  const spouseLe = getSuggestedLifeExpectancy(spouseAge, form.personB.gender as Gender);

  return { status: 'married', people: [personA, toPerson(form.personB, 'b', spouseLe)] };
}

export async function analyzeIfComplete(
  form: AnalyzerFormState,
  asOf?: Date,
): Promise<HouseholdAnalysis | null> {
  if (!isFormComplete(form)) return null;
  return analyzeHousehold(
    toHousehold(form),
    { annualCola: form.annualCola, discountRate: form.discountRate },
    asOf,
  );
}

export function suggestedLifeExpectancy(form: AnalyzerFormState): number | null {
  const { birthYear, birthMonth, gender } = form.personA;
  if (birthYear === '' || birthMonth === '' || gender === null) return null;
  return getSuggestedLifeExpectancy(getCurrentAge(birthYear, birthMonth).years, gender);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- formState`
Expected: PASS. `Analyzer.tsx` will not compile yet — that is Task 16.

- [ ] **Step 5: Commit**

```bash
git add src/lib/formState.ts src/lib/formState.test.ts
git commit -m "feat: map form state to a household and require spouse fields

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Delete `socialSecurity.ts`

**Files:**
- Delete: `src/lib/socialSecurity.ts`, `src/lib/socialSecurity.test.ts`
- Modify: every importer — `src/components/Analyzer.tsx`, `ResultsPanel.tsx`, `BenefitChart.tsx`, `BreakEvenSection.tsx`, `OptionalCharts.tsx`, `OptionalChartsPanel.tsx`, `PdfReportDocument.tsx`, `AssumptionsPanel.tsx`, `src/lib/printReport.tsx`, `src/lib/chartData.ts`, `validation/engine/golden.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, 10, 11–13
- Produces: no module imports `socialSecurity` anywhere

Component bodies still reference the old `AnalysisResult` shape and will not typecheck until Tasks 16–19. Accept that; this task is the mechanical import move, and the build is expected to be red between here and Task 19.

- [ ] **Step 1: Find every importer**

```bash
grep -rln "socialSecurity" src validation
```

- [ ] **Step 2: Repoint each import**

| Old import from `socialSecurity` | New source |
|---|---|
| `formatCurrency`, `formatCurrencyPrecise`, `fraLabel`, `formatAgeDisplay` | `./format` |
| `cumulativeBenefits`, `breakEvenAge`, `computeBreakEvens`, `generateCumulativeChartData`, `ClaimingOption`, `BreakEvenPair` | `./benefitMath` |
| `getFullRetirementAge`, `getCurrentAge`, `ageToMonths`, `FraResult`, `Gender` | `./personAnalysis` |
| `analyzeClaiming`, `AnalysisResult`, `UserInputs` | `./household` (`analyzeHousehold`, `HouseholdAnalysis`, `Household`) |

- [ ] **Step 3: Delete the module and its test**

```bash
git rm src/lib/socialSecurity.ts src/lib/socialSecurity.test.ts
```

The deleted test's coverage now lives in `format.test.ts`, `benefitMath.test.ts`, `personAnalysis.test.ts` and `household.test.ts`. Before deleting, read through `socialSecurity.test.ts` once and confirm each of its assertions has an equivalent in one of those four files; port anything that does not.

- [ ] **Step 4: Update the golden engine suite entry point**

In `validation/engine/golden.test.ts`, change `analyzeClaiming(scenario.inputs)` to `analyzeHousehold(...)`. Full fixture migration happens in Task 21 — for now, adapt the call site so the file parses; failing assertions are expected until then.

- [ ] **Step 5: Verify no references remain**

Run: `grep -rn "socialSecurity" src validation`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove socialSecurity.ts in favor of focused modules

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Form UI for two people

**Files:**
- Modify: `src/components/Analyzer.tsx`
- Create: `src/components/PersonFields.tsx`
- Create: `src/components/PersonFields.test.tsx`

**Interfaces:**
- Consumes: Task 14's `AnalyzerFormState`
- Produces: `<PersonFields person={fields} index={0|1} onChange={(next) => void} />` rendering name, DOB, gender and benefit for one person. `Analyzer` holds `personA`/`personB` state and renders `PersonFields` twice when married.

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/PersonFields.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PersonFields } from './PersonFields';

const blank = {
  name: '', birthYear: '' as const, birthMonth: '' as const,
  gender: null, monthlyBenefit: '' as const,
};

describe('PersonFields', () => {
  it('labels the first person You and the second Spouse', () => {
    const { rerender } = render(
      <PersonFields person={blank} index={0} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('group', { name: /you/i })).toBeDefined();

    rerender(<PersonFields person={blank} index={1} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: /spouse/i })).toBeDefined();
  });

  it('prefers a supplied name in the group label', () => {
    render(<PersonFields person={{ ...blank, name: 'Sarah' }} index={1} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: /sarah/i })).toBeDefined();
  });

  it('reports gender selection to the parent', async () => {
    const onChange = vi.fn();
    render(<PersonFields person={blank} index={0} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Female' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gender: 'female' }));
  });

  it('reports the benefit amount as a number', async () => {
    const onChange = vi.fn();
    render(<PersonFields person={blank} index={0} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/benefit at full retirement age/i), '2400');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthlyBenefit: 2400 }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- PersonFields`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Build `PersonFields`**

Extract the existing DOB select pair, gender segmented control and benefit input from `Analyzer.tsx` into this component, parameterized by index. Key points:

```tsx
// src/components/PersonFields.tsx (structure)
import { personLabel } from '../lib/format';
import { genderLabel } from '../lib/lifeExpectancy';
import type { PersonFormFields } from '../lib/formState';

interface PersonFieldsProps {
  person: PersonFormFields;
  index: 0 | 1;
  onChange: (next: PersonFormFields) => void;
}

export function PersonFields({ person, index, onChange }: PersonFieldsProps) {
  const label = personLabel(person.name, index);
  const idPrefix = index === 0 ? 'a' : 'b';
  const set = (patch: Partial<PersonFormFields>) => onChange({ ...person, ...patch });

  return (
    <fieldset className="person-fields" aria-label={label}>
      <legend>{label}</legend>
      {/* name input -> set({ name }) */}
      {/* month select id={`${idPrefix}-birth-month`} aria-label={`${label} birth month`} */}
      {/* year select  id={`${idPrefix}-birth`}       aria-label={`${label} birth year`} */}
      {/* gender segmented control, role="group" aria-label={`${label} gender`} */}
      {/* benefit input id={`${idPrefix}-benefit`}, label "Benefit at full retirement age" */}
    </fieldset>
  );
}
```

Use `<fieldset>`/`<legend>`, which gives the group its accessible name for free — that is what the first test queries.

Keep stable element ids: `a-birth-month`, `a-birth`, `a-benefit`, `b-birth-month`, `b-birth`, `b-benefit`. Task 23 updates the Playwright helper to these.

- [ ] **Step 4: Rewire `Analyzer.tsx`**

Replace the eleven separate `useState` calls with two `PersonFormFields` objects plus `hasSpouse`, `lifeExpectancy`, `annualCola`, `discountRate`. Render `<PersonFields index={0}>` always and `<PersonFields index={1}>` when `hasSpouse === true`. Change the analysis effect to call `analyzeIfComplete(form)` and store a `HouseholdAnalysis`.

Delete `handleMaritalChange`'s spouse-defaulting block — copying the primary person's DOB to the spouse is the defect Task 14 fixed.

- [ ] **Step 5: Run the tests**

Run: `npm run test -- PersonFields`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/PersonFields.tsx src/components/PersonFields.test.tsx src/components/Analyzer.tsx
git commit -m "feat: collect name, DOB, gender and benefit per person

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 17: `PersonPanel` and survivor removal

**Files:**
- Create: `src/components/PersonPanel.tsx`
- Create: `src/components/PersonPanel.test.tsx`
- Delete: `src/components/ResultsPanel.tsx`

**Interfaces:**
- Consumes: `PersonAnalysis` (Task 10)
- Produces: `<PersonPanel analysis={PersonAnalysis} index={0|1} annualCola={number} />`

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/PersonPanel.test.tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersonPanel } from './PersonPanel';
import type { PersonAnalysis } from '../lib/personAnalysis';

// Minimal hand-built analysis — components take data as props and never
// call the engine, so no mocking or fixture loading is needed here.
const analysis = {
  person: { id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
            gender: 'male', piaMonthly: 2400, lifeExpectancy: 85 },
  fra: { years: 67, months: 0, totalMonths: 804, fraDate: new Date(2029, 0, 1) },
  currentAge: { years: 63, months: 9 },
  claimingOptions: [62, 67, 70].map((age) => ({
    age,
    monthlyBenefit: age === 62 ? 1680 : age === 67 ? 2400 : 2976,
    percentOfPia: age === 62 ? 70 : age === 67 ? 100 : 124,
    lifetimeBenefits: 100_000,
    yearsOfPayments: 0,
    isEligible: age <= 63,
    monthsFromFra: 0,
  })),
  recommendedFilingAge: { years: 70, months: 0, label: '70', decimalYears: 70,
                          monthDuration: null as never },
  recommendedMonthly: 2976,
  breakEvens: [],
  ssaSuggestedLifeExpectancy: 82,
} as unknown as PersonAnalysis;

describe('PersonPanel', () => {
  it('renders one table row per claiming age with monthly and %PIA', () => {
    render(<PersonPanel analysis={analysis} index={0} annualCola={2.5} />);
    const row = screen.getByTestId('claim-row-70');
    expect(within(row).getByTestId('cell-monthly')).toHaveTextContent('$2,976.00');
    expect(within(row).getByTestId('cell-percent')).toHaveTextContent('124%');
  });

  it('marks ages the person has not reached as future', () => {
    render(<PersonPanel analysis={analysis} index={0} annualCola={2.5} />);
    expect(within(screen.getByTestId('claim-row-70')).getByText('Future')).toBeDefined();
  });

  it('shows no survivor figure anywhere', () => {
    render(<PersonPanel analysis={analysis} index={0} annualCola={2.5} />);
    expect(screen.queryByText(/survivor/i)).toBeNull();
  });

  it('uses the person name in the heading', () => {
    render(<PersonPanel analysis={analysis} index={0} annualCola={2.5} />);
    expect(screen.getByRole('heading', { name: /Dan/ })).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- PersonPanel`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Build `PersonPanel` from `ResultsPanel`**

Copy `ResultsPanel.tsx` to `PersonPanel.tsx` and change:

- Props become `{ analysis: PersonAnalysis; index: 0 | 1; annualCola: number }`.
- Read `analysis.claimingOptions`, `analysis.fra`, `analysis.recommendedFilingAge`, `analysis.recommendedMonthly`.
- Heading uses `personLabel(analysis.person.name, index)`.
- **Delete the entire spousal summary card** (the `hasSpouse && spousal` block with `data-testid="summary-spousal"`).
- Keep `data-testid` values `benefit-table`, `claim-row-{age}`, `cell-monthly`, `cell-percent`, `summary-fra`, `summary-age62`, `summary-age70` — the e2e suite depends on them.
- Compare against `analysis.recommendedFilingAge` for the "Best"/"Optimal" badge instead of a separate `optimalAge` number.

Then `git rm src/components/ResultsPanel.tsx`.

- [ ] **Step 4: Remove the remaining survivor claims**

In `Analyzer.tsx`'s "How This Works" grid, replace the "Spousal & survivor benefits" entry body with text that does not assert a survivor amount, for example: *"Married households are optimized jointly by ssa.tools, including the spousal top-up. Survivor benefits are not modeled in this version."*

- [ ] **Step 5: Confirm nothing else mentions survivors**

Run: `grep -rni "survivor" src`
Expected: only the honest "not modeled" sentence and the `spousalSurvivor` chart key (renamed in Task 19 if it still renders survivor values — verify what `OptionalCharts.tsx:215` computes and delete that chart if it displays a survivor amount).

- [ ] **Step 6: Run the tests**

Run: `npm run test -- PersonPanel`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add PersonPanel and remove unmodeled survivor figures

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 18: Strategy comparison table and combined income chart

**Files:**
- Create: `src/components/StrategyComparisonTable.tsx`
- Create: `src/components/StrategyComparisonTable.test.tsx`
- Create: `src/components/CombinedIncomeChart.tsx`

**Interfaces:**
- Consumes: `HouseholdStrategy`, `CombinedTimelinePoint` (Tasks 11–13)
- Produces: `<StrategyComparisonTable comparisons={...} people={Person[]} />` and `<CombinedIncomeChart timeline={...} people={Person[]} />`

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/StrategyComparisonTable.test.tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StrategyComparisonTable } from './StrategyComparisonTable';
import type { HouseholdStrategy } from '../lib/household';
import type { Person } from '../lib/personAnalysis';

const people = [
  { id: 'a', name: 'Dan' },
  { id: 'b', name: 'Sarah' },
] as Person[];

const age = (years: number) => ({ years, months: 0, label: String(years),
  decimalYears: years, monthDuration: null as never });

const comparisons: HouseholdStrategy[] = [
  { key: 'earliest', label: 'Both claim earliest (62)', filingAges: [age(62), age(62)],
    expectedNpv: 1_018_000, deltaVsOptimal: -225_000, isOptimal: false },
  { key: 'optimal', label: 'Optimal', filingAges: [age(70), age(64)],
    expectedNpv: 1_243_000, deltaVsOptimal: 0, isOptimal: true },
  { key: 'latest', label: 'Both delay to 70', filingAges: [age(70), age(70)],
    expectedNpv: 1_221_000, deltaVsOptimal: -22_000, isOptimal: false },
];

describe('StrategyComparisonTable', () => {
  it('renders one row per strategy', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    expect(screen.getAllByTestId(/^strategy-row-/)).toHaveLength(3);
  });

  it('marks only the optimal row and shows an em dash for its delta', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    const optimal = screen.getByTestId('strategy-row-optimal');
    expect(optimal.className).toContain('row-optimal');
    expect(within(optimal).getByTestId('cell-delta')).toHaveTextContent('—');
  });

  it('shows each person filing age in its own column', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    const row = screen.getByTestId('strategy-row-optimal');
    expect(within(row).getByTestId('cell-age-a')).toHaveTextContent('70');
    expect(within(row).getByTestId('cell-age-b')).toHaveTextContent('64');
  });

  it('names the columns after the people', () => {
    render(<StrategyComparisonTable comparisons={comparisons} people={people} />);
    expect(screen.getByRole('columnheader', { name: 'Dan' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Sarah' })).toBeDefined();
  });

  it('renders a single age column for a one-person household', () => {
    const single = [{ ...comparisons[1], filingAges: [age(70)] }];
    render(<StrategyComparisonTable comparisons={single} people={[people[0]]} />);
    expect(screen.queryByTestId('cell-age-b')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- StrategyComparisonTable`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Build the table**

```tsx
// src/components/StrategyComparisonTable.tsx
import { formatCurrency, personLabel } from '../lib/format';
import type { HouseholdStrategy } from '../lib/household';
import type { Person } from '../lib/personAnalysis';

interface Props {
  comparisons: HouseholdStrategy[];
  people: Person[];
}

export function StrategyComparisonTable({ comparisons, people }: Props) {
  return (
    <div className="table-wrap">
      <table data-testid="strategy-table">
        <thead>
          <tr>
            <th>Strategy</th>
            {people.map((p, i) => (
              <th key={p.id}>{personLabel(p.name, i as 0 | 1)}</th>
            ))}
            <th>Combined PV</th>
            <th>vs. best</th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((s) => (
            <tr
              key={s.key}
              data-testid={`strategy-row-${s.key}`}
              className={s.isOptimal ? 'row-optimal' : ''}
            >
              <td>
                {s.label}
                {s.isOptimal && <span className="badge">Best</span>}
              </td>
              {s.filingAges.map((age, i) => (
                <td key={people[i].id} data-testid={`cell-age-${people[i].id}`}>
                  {age.label}
                </td>
              ))}
              <td>{formatCurrency(s.expectedNpv)}</td>
              <td data-testid="cell-delta" className={s.deltaVsOptimal < 0 ? 'negative' : ''}>
                {s.deltaVsOptimal === 0 ? '—' : formatCurrency(s.deltaVsOptimal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Build the combined income chart**

Follow the Recharts patterns already in `BenefitChart.tsx` (same `chartTheme` import, same `ResponsiveContainer` wrapper). Use a stacked `AreaChart` with one `Area` per person, `dataKey={(d) => d.byPersonId[person.id]}`, `stackId="household"`, and `personLabel` for the legend `name`.

- [ ] **Step 5: Run the tests**

Run: `npm run test -- StrategyComparisonTable`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/StrategyComparisonTable.tsx src/components/StrategyComparisonTable.test.tsx src/components/CombinedIncomeChart.tsx
git commit -m "feat: add the household strategy comparison table and income chart

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 19: `HouseholdPanel` and `HouseholdView` tabs

**Files:**
- Create: `src/components/HouseholdPanel.tsx`
- Create: `src/components/HouseholdView.tsx`
- Create: `src/components/HouseholdView.test.tsx`
- Modify: `src/components/Analyzer.tsx`

**Interfaces:**
- Consumes: `HouseholdAnalysis` (Tasks 11–13), `PersonPanel` (17), `StrategyComparisonTable` + `CombinedIncomeChart` (18)
- Produces: `<HouseholdView analysis={HouseholdAnalysis} annualCola={number} />`

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/HouseholdView.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HouseholdView } from './HouseholdView';
import type { HouseholdAnalysis } from '../lib/household';

// Build via a helper so both the single and married cases stay readable.
declare function buildAnalysis(status: 'single' | 'married'): HouseholdAnalysis;

describe('HouseholdView', () => {
  it('renders no tab strip for a single claimant', () => {
    render(<HouseholdView analysis={buildAnalysis('single')} annualCola={2.5} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('benefit-table')).toBeDefined();
  });

  it('renders three tabs for a married household, household selected first', () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Household', 'Dan', 'Sarah']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('strategy-table')).toBeDefined();
  });

  it('switches panels on click', async () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Sarah' }));
    expect(screen.getByRole('tab', { name: 'Sarah' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('strategy-table')).toBeNull();
    expect(screen.getByTestId('benefit-table')).toBeDefined();
  });

  it('moves between tabs with the arrow keys', async () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    screen.getByRole('tab', { name: 'Household' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Dan' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Household' })).toHaveAttribute('aria-selected', 'true');
  });

  it('exposes exactly one visible tabpanel', () => {
    render(<HouseholdView analysis={buildAnalysis('married')} annualCola={2.5} />);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });
});
```

Replace the `declare function buildAnalysis` line with a real factory in the test file: reuse the `PersonAnalysis` literal from `PersonPanel.test.tsx` for each person, and the `HouseholdStrategy` literals from `StrategyComparisonTable.test.tsx` for `optimal`/`comparisons`. Name the two people Dan and Sarah so the tab assertions above hold.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- HouseholdView`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Build `HouseholdPanel`**

Compose, in order: recommendation card (`analysis.recommendation` as the heading, `recommendationDetail` beneath), `StrategyComparisonTable`, `CombinedIncomeChart`, then household break-even reusing `BreakEvenSection` with `analysis.people[0].breakEvens`.

- [ ] **Step 4: Build `HouseholdView` with accessible tabs**

```tsx
// src/components/HouseholdView.tsx (tab mechanics)
const tabs = analysis.status === 'married'
  ? ['household', ...analysis.people.map((p) => p.person.id)]
  : [];
const [active, setActive] = useState(0);

function onKeyDown(e: React.KeyboardEvent) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  e.preventDefault();
  const next = e.key === 'ArrowRight'
    ? (active + 1) % tabs.length
    : (active - 1 + tabs.length) % tabs.length;
  setActive(next);
  tabRefs.current[next]?.focus();
}
```

Each tab needs `role="tab"`, `aria-selected`, `aria-controls`, `id`, and `tabIndex={i === active ? 0 : -1}` (roving tabindex). Each panel needs `role="tabpanel"`, `aria-labelledby`, and must not render when inactive so only one `tabpanel` exists.

For `status === 'single'`, return `<PersonPanel analysis={analysis.people[0]} index={0} annualCola={annualCola} />` directly with no tablist.

- [ ] **Step 5: Wire into `Analyzer.tsx`**

Replace the `ResultsPanel` + `BenefitChart` + `BreakEvenSection` + `OptionalChartsPanel` block with `<HouseholdView analysis={result} annualCola={annualCola} />`, keeping the loading, error and empty states exactly as they are (their `data-testid`s are used by e2e).

- [ ] **Step 6: Run tests and lint**

Run: `npm run test && npm run lint && npm run build`
Expected: PASS. `npm run build` must now typecheck cleanly — this is the first task since 15 where a green build is required.

- [ ] **Step 7: Commit**

```bash
git add src/components/HouseholdPanel.tsx src/components/HouseholdView.tsx src/components/HouseholdView.test.tsx src/components/Analyzer.tsx
git commit -m "feat: add the tabbed household and person results view

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 20: Split the PDF report

**Files:**
- Create: `src/components/pdf/theme.ts`, `charts.tsx`, `PersonSection.tsx`, `HouseholdSection.tsx`, `ReportDocument.tsx`
- Delete: `src/components/PdfReportDocument.tsx`
- Modify: `src/lib/printReport.tsx`

**Interfaces:**
- Consumes: `HouseholdAnalysis`
- Produces: `<ReportDocument analysis={HouseholdAnalysis} />`; `downloadPdfReport(analysis: HouseholdAnalysis): Promise<void>`

- [ ] **Step 1: Move the theme out**

Move lines 32–344 of `PdfReportDocument.tsx` (the `MONTHS` array, color constants, layout constants, `COL`, and the `styles` StyleSheet) into `src/components/pdf/theme.ts` and export each.

- [ ] **Step 2: Move the chart components out**

Move `PdfChart`, `PdfHeatmap`, `PdfOpportunityCost` and `PdfMonthlyRamp` into `src/components/pdf/charts.tsx`, importing `styles` and the color constants from `./theme`.

- [ ] **Step 3: Build `PersonSection`**

```tsx
// src/components/pdf/PersonSection.tsx
import { Page, Text, View } from '@react-pdf/renderer';
import { personLabel } from '../../lib/format';
import type { PersonAnalysis } from '../../lib/personAnalysis';
import { PdfChart, PdfHeatmap, PdfMonthlyRamp, PdfOpportunityCost } from './charts';
import { styles } from './theme';

interface Props {
  analysis: PersonAnalysis;
  index: 0 | 1;
  annualCola: number;
  footerText: string;
  pageLabel: string;
}

export function PersonSection({ analysis, index, annualCola, footerText, pageLabel }: Props) {
  const name = personLabel(analysis.person.name, index);
  // BenefitTable moves here from PdfReportDocument.tsx, retitled with `name`.
  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.h2}>{name}</Text>
      {/* summary row, BenefitTable, per-person charts */}
      <PageFooter text={`${footerText} · ${pageLabel}`} />
    </Page>
  );
}
```

Move `BenefitTable` into this file; it is only used here.

- [ ] **Step 4: Build `HouseholdSection`**

A single `<Page>` containing the recommendation, a strategy comparison table (same rows as the web table, rendered with `@react-pdf/renderer` primitives), and the combined income chart. Only rendered when `analysis.status === 'married'`.

- [ ] **Step 5: Build `ReportDocument`**

```tsx
// src/components/pdf/ReportDocument.tsx
export function ReportDocument({ analysis }: { analysis: HouseholdAnalysis }) {
  const pages = analysis.status === 'married' ? analysis.people.length + 1 : analysis.people.length;
  let page = 0;
  return (
    <Document>
      {analysis.status === 'married' && (
        <HouseholdSection analysis={analysis} pageLabel={`Page ${++page} of ${pages}`} />
      )}
      {analysis.people.map((p, i) => (
        <PersonSection
          key={p.person.id}
          analysis={p}
          index={i as 0 | 1}
          annualCola={analysis.assumptions.annualCola}
          footerText={footerText}
          pageLabel={`Page ${++page} of ${pages}`}
        />
      ))}
    </Document>
  );
}
```

Move `PageFooter` and `MethodPair` into this file and export `PageFooter` for `PersonSection`. Delete the survivor sentence from the methodology copy (`PdfReportDocument.tsx:874-876` and `:1049-1051`).

- [ ] **Step 6: Update `printReport.tsx`**

```tsx
export async function downloadPdfReport(analysis: HouseholdAnalysis): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer');
  const { ReportDocument } = await import('../components/pdf/ReportDocument');
  const blob = await pdf(<ReportDocument analysis={analysis} />).toBlob();
  // ... unchanged download logic
}
```

Update the call in `Analyzer.tsx` to `downloadPdfReport(result)`.

- [ ] **Step 7: Verify sizes and build**

Run: `wc -l src/components/pdf/*.tsx src/components/pdf/*.ts && npm run build && npm run lint`
Expected: every file under 300 lines; build and lint clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: split the PDF report into theme, charts and sections

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 21: Migrate the golden fixtures

**Files:**
- Modify: `validation/fixtures/scenarios.json`, `validation/fixtures/scenarios.ts`
- Modify: `validation/engine/golden.test.ts`
- Modify: `validation/scripts/gen-fixtures.mjs`

**Interfaces:**
- Consumes: `Household`, `HouseholdAnalysis`
- Produces: fixture schema `version: 2` with `asOf` and `people[]`:

```ts
export interface ScenarioInputs {
  asOf: string;                    // ISO date, e.g. "2026-01-15"
  status: 'single' | 'married';
  people: {
    name?: string;
    birthYear: number;
    birthMonth: number;
    gender: 'female' | 'male';
    piaMonthly: number;
    lifeExpectancy: number;
  }[];
  annualCola: number;
  discountRate: number;
}
export interface ScenarioExpected {
  fraByPerson: { years: number; months: number; label: string }[];
  monthlyByClaimAgeByPerson: Record<string, number>[];
  percentOfPiaByClaimAgeByPerson: Record<string, number>[];
  breakEvensByPerson: ExpectedBreakEven[][];
  spousalTopUpAtFra: number | null;
  optimalAgeRangeByPerson: [number, number][];
  invariants: string[];
}
```

- [ ] **Step 1: Migrate the schema mechanically, changing no expected values**

Write a one-off Node script that reads the current `scenarios.json` and emits the v2 shape: wrap each scenario's flat inputs into `people[0]`, move spouse fields into `people[1]`, wrap each expected map into a one- or two-element array, and set `asOf` to `"2026-01-15"` for every scenario. Do not touch any number.

- [ ] **Step 2: Update the loader types**

Update `validation/fixtures/scenarios.ts` to the interfaces above and bump the `version` check to 2.

- [ ] **Step 3: Update the engine suite to drive `analyzeHousehold`**

```ts
// validation/engine/golden.test.ts
function toHousehold(inputs: ScenarioInputs): Household {
  const people = inputs.people.map((p, i) => ({
    id: (i === 0 ? 'a' : 'b') as 'a' | 'b',
    name: p.name,
    birthYear: p.birthYear,
    birthMonth: p.birthMonth,
    gender: p.gender,
    piaMonthly: p.piaMonthly,
    lifeExpectancy: p.lifeExpectancy,
  }));
  return inputs.status === 'married'
    ? { status: 'married', people: [people[0], people[1]] }
    : { status: 'single', people: [people[0]] };
}

const run = (s: GoldenScenario) =>
  analyzeHousehold(
    toHousehold(s.inputs),
    { annualCola: s.inputs.annualCola, discountRate: s.inputs.discountRate },
    new Date(s.inputs.asOf),
  );
```

Assert per person by index against `result.people[i]`, and assert `result.spousalTopUp?.atFra ?? null` against `expected.spousalTopUpAtFra`.

- [ ] **Step 4: Resolve the deferred Task 8 failure**

If `married-1960-spouse-no-record` now disagrees on the spousal top-up, hand-derive the correct value: the unreduced top-up is `workerPIA / 2 − spousePIA`, reduced by 25/36 of 1% per month for the first 36 months the *spouse* claims before their own FRA and 5/12 of 1% per month beyond that. Record the derivation in the scenario's `description` and update the expected value only if your hand calculation agrees with the engine.

- [ ] **Step 5: Revive the aged-out scenario**

With `asOf` pinned, add sample household 4 back as `sample-hh4-married-1955-wide-age-gap` (worker Mar 1955 male PIA $2,800, spouse Jun 1968 female PIA $1,900) and set `asOf` to a date at which the 1955 cohort is under 70 — `"2024-01-15"` works. Mark it `mode: 'full'`. Update `validation/samples/README.md` to move HH4 from "Aged out" to "Added".

- [ ] **Step 6: Run the engine suite**

Run: `npm run test -- golden`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add validation/ && git commit -m "test: migrate golden fixtures to the household schema with pinned dates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 22: New fixtures for the corrected behavior

**Files:**
- Modify: `validation/fixtures/scenarios.json`

**Interfaces:**
- Consumes: Task 21's v2 schema
- Produces: two scenarios proving the defects are fixed

- [ ] **Step 1: Add the same-sex couple scenario**

Add `married-1962-same-sex-both-male` (person A: Apr 1962, male, PIA $3,200; person B: Feb 1964, male, PIA $2,100; `asOf` `"2026-01-15"`). Benefit amounts are gender-independent, so derive the `monthlyByClaimAgeByPerson` maps from the standard reduction/credit rules exactly as for any other scenario. The gender fix shows up in `optimalAgeRangeByPerson`, which must be derived from the male mortality table for **both** people.

- [ ] **Step 2: Add the early-spousal-claim scenario**

Add `married-1963-spouse-claims-early` (person A: Jan 1963, female, PIA $3,600; person B: Jul 1966, male, PIA $600). The unreduced top-up is `3600/2 − 600 = $1,200`. Set `spousalTopUpAtFra: 1200` and add the invariant `spousalTopUpReducedWhenClaimedEarly`.

- [ ] **Step 3: Assert the new invariant in the engine suite**

```ts
if (scenario.expected.invariants.includes('spousalTopUpReducedWhenClaimedEarly')) {
  const result = await run(scenario);
  const lowerIndex = result.people[0].person.piaMonthly >= result.people[1].person.piaMonthly ? 1 : 0;
  const filedEarly =
    result.people[lowerIndex].recommendedFilingAge.decimalYears <
    result.people[lowerIndex].fra.years + result.people[lowerIndex].fra.months / 12;
  if (filedEarly) {
    expect(result.spousalTopUp!.atRecommendedFilingAge).toBeLessThan(result.spousalTopUp!.atFra);
  }
}
```

- [ ] **Step 4: Run the suite**

Run: `npm run test -- golden`
Expected: PASS. If a hand-derived value disagrees with the engine, re-derive before changing either side.

- [ ] **Step 5: Commit**

```bash
git add validation/fixtures/scenarios.json validation/engine/golden.test.ts
git commit -m "test: add same-sex couple and early-spousal-claim fixtures

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 23: End-to-end coverage

**Files:**
- Modify: `validation/e2e/helpers/app.ts`, `validation/e2e/golden-scenarios.spec.ts`
- Create: `validation/e2e/interactions.spec.ts`

**Interfaces:**
- Consumes: Task 16's field ids, Task 19's tabs, Task 21's fixture schema
- Produces: golden UI assertions per person plus an interaction suite

- [ ] **Step 1: Update the form helper for two people**

```ts
// validation/e2e/helpers/app.ts
export async function fillScenarioForm(page: Page, inputs: ScenarioInputs) {
  await page
    .getByRole('group', { name: 'Marital status' })
    .getByRole('button', { name: inputs.status === 'married' ? 'Married' : 'Single' })
    .click();

  for (const [i, person] of inputs.people.entries()) {
    const prefix = i === 0 ? 'a' : 'b';
    if (person.name) await page.locator(`#${prefix}-name`).fill(person.name);
    await page.locator(`#${prefix}-birth-month`).selectOption(String(person.birthMonth));
    await page.locator(`#${prefix}-birth`).selectOption(String(person.birthYear));
    await page
      .getByRole('group', { name: new RegExp(`gender`, 'i') })
      .nth(i)
      .getByRole('button', { name: person.gender === 'male' ? 'Male' : 'Female', exact: true })
      .click();
    await page.locator(`#${prefix}-benefit`).fill(String(person.piaMonthly));
  }
}
```

- [ ] **Step 2: Assert per-person tables in the golden spec**

For married scenarios, click each person's tab before asserting that person's rows:

```ts
for (const [i, expectedByAge] of scenario.expected.monthlyByClaimAgeByPerson.entries()) {
  if (scenario.inputs.status === 'married') {
    await page.getByRole('tab').nth(i + 1).click(); // 0 is Household
  }
  for (const [age, monthly] of Object.entries(expectedByAge)) {
    const row = page.getByTestId(`claim-row-${age}`);
    await expect(row.getByTestId('cell-monthly')).toHaveText(tableCurrency(monthly));
  }
}
```

Also assert, on the Household tab of any married scenario, that `strategy-row-optimal` exists and carries the "Best" badge.

- [ ] **Step 3: Write the interaction spec**

```ts
// validation/e2e/interactions.spec.ts
import { expect, test } from './helpers/app';

const dan = { name: 'Dan', birthYear: 1962, birthMonth: 4, gender: 'male' as const,
              piaMonthly: 2400, lifeExpectancy: 85 };
const sarah = { name: 'Sarah', birthYear: 1964, birthMonth: 2, gender: 'female' as const,
                piaMonthly: 2100, lifeExpectancy: 88 };

const single = {
  asOf: '2026-01-15', status: 'single' as const,
  annualCola: 2.5, discountRate: 0.025, people: [dan],
};

const married = {
  asOf: '2026-01-15', status: 'married' as const,
  annualCola: 2.5, discountRate: 0.025, people: [dan, sarah],
};

test('shows no tab strip for a single claimant', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, single);
  await expect(page.getByTestId('benefit-table')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
});

test('reveals spouse fields and refuses to analyze until they are complete', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, single);
  await expect(page.getByTestId('benefit-table')).toBeVisible();

  await page.getByRole('group', { name: 'Marital status' })
    .getByRole('button', { name: 'Married' }).click();

  // Spouse fields are now required, so the previous analysis must clear.
  await expect(page.getByTestId('benefit-table')).toHaveCount(0);
  await expect(page.locator('#b-birth')).toBeVisible();
});

test('switches between household and person tabs', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, married);
  await expect(page.getByTestId('strategy-table')).toBeVisible();
  await page.getByRole('tab', { name: 'Sarah' }).click();
  await expect(page.getByTestId('benefit-table')).toBeVisible();
  await expect(page.getByTestId('strategy-table')).toHaveCount(0);
});

test('recomputes break-evens when the COLA slider moves', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, single);
  const before = await page.getByTestId('break-even-62-70').textContent();
  await page.locator('#annual-cola').fill('5');
  await expect(page.getByTestId('break-even-62-70')).not.toHaveText(before ?? '');
});

test('exports a PDF', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, single);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export PDF/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^Social-Security-Analysis-.*\.pdf$/);
});

test('gates access behind the demo password', async ({ browser }) => {
  // A fresh context without the sessionStorage seed the shared fixture applies.
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await expect(page.locator('#password')).toBeVisible();
});
```

Add `data-testid="break-even-62-70"` to the relevant row in `BreakEvenSection.tsx`, and confirm the COLA slider's id is `annual-cola` in `AssumptionsPanel.tsx` — adjust the selector to the real id if it differs.

- [ ] **Step 4: Run the full e2e suite**

Run: `PW_PORT=4199 npm run test:e2e`
Expected: all specs pass.

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run test && PW_PORT=4199 npm run test:e2e && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add validation/e2e/
git commit -m "test: assert per-person tables and add an interaction suite

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification against the spec's success criteria

Run through these before opening a pull request. Each maps to a numbered criterion in the design spec.

1. **Same-sex mortality** — `npm run test -- golden` covers `married-1962-same-sex-both-male` (Task 22); `household.test.ts` asserts differing NPV by gender (Task 12).
2. **Married validation** — `formState.test.ts` (Task 14) and the interaction spec (Task 23).
3. **Spousal top-up at real filing age** — `ssaTools.test.ts` (Task 8) and `married-1963-spouse-claims-early` (Task 22).
4. **Comparison table matches the engine** — `household.test.ts` (Task 11) and the golden UI assertion (Task 23).
5. **No survivor figure** — `grep -rni "survivor" src` returns only the "not modeled" sentence; `PersonPanel.test.tsx` asserts it (Task 17).
6. **PDF has a household section and one per person** — `ReportDocument` structure (Task 20).
7. **Every fixture pins `asOf`, HH4 revived** — Task 21.
8. **CI green on a pull request** — Task 3.
9. **`socialSecurity.ts` gone, modules under 300 lines** — Task 15; verify with `wc -l src/lib/*.ts src/components/pdf/*`.
