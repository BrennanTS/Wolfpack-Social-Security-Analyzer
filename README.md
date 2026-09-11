# Wolfpack Social Security Analyzer

Client-facing Social Security claiming analysis tool for **Wolfpack | Planning Team**.

## Features

- SSA-aligned benefit projections (ages 62–70)
- Optimal claiming age recommendation with break-even analysis
- COLA / inflation assumptions with BLS CPI history
- Life expectancy modeling (SSA period life tables)
- Household modeling for singles and couples: each person analyzed on their own
  record, filing ages chosen by the ssa.tools joint couple optimizer
- Strategy comparison showing what the optimizer rejected and by how much
- Spousal top-up and survivor benefit projections for couples, taken from the
  ssa.tools engine's own typed benefit periods
- Interactive charts (heatmap, opportunity cost, monthly ramp, and more)
- PDF export for client meetings
- Password-gated demo access

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Demo password: `wolfpack`

## Build

```bash
npm run build
```

Output is in `dist/` — deploy to Vercel, Netlify, or any static host.

## Testing and validation

Six layers, each answering a question the others cannot.

| Command | What it checks | On commit? |
| --- | --- | --- |
| `npm test` | Unit and component tests (vitest). Pins known values and rendered output. | yes |
| `npm run test:e2e` | The real app in a browser (Playwright), including PDF downloads and the logo upload, which jsdom cannot run. | yes |
| `npm run coverage` | Coverage against a floor in `vitest.config.ts`. A drop fails; the number is a hint, not a target. | no |
| `npm run sweep` | Invariants over thousands of generated households — properties that must hold for cases nobody wrote down. | no, too slow |
| `npm run crosscheck:ssatools` | Every golden scenario against the live ssa.tools site. | no, needs the network |
| `npm run copy:corpus` + `/review-copy` | Every client-facing sentence, reviewed against a written rubric. | no, see below |

The pre-commit hook (`.githooks/pre-commit`) runs typecheck, lint and `npm
test` in parallel, then `npm run test:e2e`. `SKIP_E2E=1 git commit` skips only
the browser suite while iterating; never `--no-verify`.

`npm run validate` runs typecheck, lint, unit and e2e together.

### Golden fixtures

`validation/fixtures/scenarios.json` holds worked households with expected
figures derived **independently** from SSA's published rules by
`validation/scripts/gen-fixtures.mjs` — not copied from the engine. A handful
of values have no published closed form (the optimizer's chosen filing ages,
the survivor-claim search); those are engine-recorded, and the generator
*preserves* them per scenario id rather than re-deriving. **Never re-record
one to make the suite pass** — a moved filing age is the regression the field
exists to catch.

Regenerate with `npm run fixtures:gen`, which also refreshes
`src/lib/validationSummary.json`, the artifact the app's own
Menu → Reference → "How this is checked" panel renders.

Scenarios expire: `validation/engine/aging-out.test.ts` fails twelve months
before a household's oldest member turns 70, because the Playwright suite
drives the live app against wall-clock time.

### Reviewing the copy

This project's defects are overwhelmingly in its prose, so the copy gets its
own review loop. Mechanical faults — duplicate sentences on one surface,
banned jargon, screen and print disagreeing — are deterministic tests in
`validation/sweep/copy.sweep.ts`. Judgment is not, so it is a separate,
on-demand step:

```bash
npm run copy:corpus     # renders every client-facing sentence over 500 households
```

That writes `validation/copy/corpus.md`: real sentences with real interpolated
figures, tagged with the component that rendered them. Sentences differing
only in their numbers collapse to one entry with a count, which is what keeps
it reviewable rather than a dump.

Then run `/review-copy` in Claude Code. It reads the corpus and
`validation/copy/RUBRIC.md` — the versioned standard, so changing what
"good" means is a commit somebody can argue with — and writes a dated report
to `validation/copy/`. The command changes no source file; a human decides
what to act on.

**Deliberately not in CI.** An LLM judgment is not deterministic, and a
blocking test that fails differently on identical input teaches people to
ignore the suite.

## Stack

React 19 · TypeScript · Vite · Recharts · @react-pdf/renderer

## Disclaimer

For educational planning purposes only. Not affiliated with the Social Security Administration.
