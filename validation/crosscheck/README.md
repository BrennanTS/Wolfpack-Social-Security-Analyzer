# Calculation Validation Harness

Everything under `validation/` verifies that the app's Social Security math
matches known-correct values. It is separate from the app source (`src/`) and
runs automatically before every commit.

## The three layers

| Layer | What it checks | When it runs | Command |
|---|---|---|---|
| Engine golden suite (`validation/engine/golden.test.ts`, Vitest) | `analyzeClaiming()` output vs. hand-derived SSA-rule values | every commit | `npm test` |
| UI golden suite (`validation/e2e/`, Playwright) | The rendered benefit table & summary cards vs. the same fixtures, against the production build | every commit | `npm run test:e2e` |
| Live ssa.tools cross-check (`validation/crosscheck/`, Playwright) | Our fixtures vs. numbers displayed on https://ssa.tools | on demand only | `npm run crosscheck:ssatools` |

All three read the single fixture file
[`validation/fixtures/scenarios.json`](../fixtures/scenarios.json) (23
scenarios spanning FRA cohorts 1943→1966, PIAs $500–$5,000, both genders, and
single/married with several spousal shapes). Expected values are **derived
independently from SSA's published rules** — not copied from the engine — by
[`validation/scripts/gen-fixtures.mjs`](../scripts/gen-fixtures.mjs)
(reduction of 5/9 of 1%/month for the first 36 months early plus 5/12 of
1%/month beyond; delayed credits of 2/3 of 1%/month to age 70). Regenerate
with `npm run fixtures:gen`. That an independent formula implementation, the
vendored ssa.tools engine, and the live ssa.tools site all agree to the dollar
is the validation. **Edit `gen-fixtures.mjs` (add a spec, re-derive a rule),
never hand-edit `scenarios.json`, and never copy engine output into it.**

### Scenario modes

- `"mode": "full"` — runs the complete pipeline (optimizer + mortality
  tables) and the UI suite. Only valid while the cohort is under 70; the
  scenario description notes when each ages out.
- `"mode": "factorsOnly"` — validates the deterministic benefit-factor math
  only. Never ages out; used for older cohorts (FRA 66, FRA 66y6m) that keep
  the SSA schedule covered.

## Pre-commit hook

`.githooks/pre-commit` runs oxlint → Vitest → Playwright (~45–60s, dominated
by the production build). It is activated by `npm install` (the `prepare`
script sets `git config core.hooksPath .githooks`).

Escape hatches:

```sh
SKIP_E2E=1 git commit -m "…"   # skip only the Playwright UI suite
git commit --no-verify -m "…"  # skip the entire hook
```

Faster e2e iteration while writing tests (dev server, no build):

```sh
PW_DEV=1 npx playwright test
```

## How the live cross-check works

`npm run crosscheck:ssatools` diffs every `full`-mode scenario against
https://ssa.tools (`$1` tolerance), writing `report-<timestamp>.json` here.
The flow (`fetchSsaTools` in [`ssatools-live.spec.ts`](./ssatools-live.spec.ts)):

1. ssa.tools' calculator is **URL-prefillable** (the report itself advertises
   `/calculator#pia1=…&dob1=…[&pia2=…&dob2=…]` as the "reload these inputs"
   link), so we navigate there directly — no multi-step form. Direct-PIA entry
   applies no COLA, so ssa.tools' figures match our engine's dollar-floor
   convention exactly (all deltas are `$0` today).
2. Read the machine-readable **"Copy for AI assistant"** markdown report
   (`<pre>` in the dialog) and parse its "Monthly benefit by filing age"
   table(s) — far more stable than the interactive slider.

The birth day is fixed at the 2nd so the `62y 0m` row is present (SSA's
"eligible the whole month" rule drops it for later-in-month birthdays); the
whole-year factors are day-independent, so no value changes. If the report
can't be read/parsed (a site redesign), the scenario soft-skips with a
"re-record" message rather than reporting a false calculation failure.

### Married scenarios

Couples are cross-checked the same way. The couple report contains a separate
"Monthly benefit by filing age" table per person plus a **"Spousal benefits"**
section, so the cross-check validates both:

- the **worker's** benefit-by-age table — selected as whichever of the two
  tables best fits our expected values (robust to ssa.tools listing the higher
  earner first, and to non-integer FRAs where "benefit at FRA == PIA" doesn't
  hold; this only decides which person is the worker — the per-age assertions
  still compare against the independently-derived fixtures), and
- the **spousal top-up at FRA** (from the "Spousal benefits" summary line),
  compared to our `max(0, workerPIA/2 − spousePIA)`, for scenarios where the
  worker is the higher earner (top-up > 0). Zero / role-flipped top-ups are
  left to the engine + UI suites.

ssa.tools' couple *strategy optimizer* (`/strategy#…`) additionally produces a
mortality-weighted optimal filing recommendation and a death-age heatmap;
those are time/mortality-dependent, so they are not asserted here.

### Re-recording after a site change

1. `npm run record:ssatools` — opens Playwright codegen on https://ssa.tools.
   Redo the entry flow; the recording auto-saves to
   `validation/recordings/ssatools-<timestamp>.spec.ts`.
2. Ask Claude to refine the recording back into `fillSsaToolsScenario`.

`npm run record:app` records against the local app instead (starts the dev
server if needed). Type the demo password once when the recorder opens —
those steps are stripped during refinement.
