/**
 * Live cross-check against https://ssa.tools.
 *
 * For each 'full'-mode golden scenario, loads ssa.tools' calculator report and
 * diffs its figures against our fixtures (crosscheckUsd tolerance). Because the
 * PIA is entered directly, ssa.tools applies no COLA, so its numbers match our
 * engine's dollar-floor convention exactly (deltas are $0 today).
 *
 * Run on demand (never in pre-commit):  npm run crosscheck:ssatools
 *
 * Approach: ssa.tools' calculator is URL-prefillable (the report itself
 * advertises `/calculator#pia1=…&dob1=…[&pia2=…&dob2=…]` as the "reload these
 * inputs" link). We navigate there directly — no multi-step form — and read
 * the machine-readable "Copy for AI assistant" markdown report:
 *   - the worker's ("Self") "Monthly benefit by filing age" table, and
 *   - for married scenarios, the "Spousal benefits" section's FRA top-up.
 * The birth day is fixed at the 2nd so the "62y 0m" row is present (SSA's
 * "eligible the whole month" rule omits it for later-in-month birthdays); the
 * whole-year factors are day-independent, so no value changes.
 *
 * Only 'full' scenarios are cross-checked (they carry the birth month and have
 * unambiguous PIA-driven values). If the report can't be read or parsed (a site
 * redesign), the scenario soft-skips rather than reporting a false failure.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { loadScenarios, type GoldenScenario } from '../fixtures/scenarios';

const { tolerances, scenarios } = loadScenarios();

interface AgeDelta {
  age: number;
  ours: number;
  theirs: number | null;
  delta: number | null;
  withinTolerance: boolean | null;
}

interface ScenarioReport {
  id: string;
  implemented: boolean;
  deltas: AgeDelta[];
  spousal?: { ours: number; theirs: number | null; delta: number | null };
}

interface LiveResult {
  workerByAge: Record<string, number>;
  spousalTopupAtFra: number | null;
}

const reports: ScenarioReport[] = [];

function isoDob(year: number, month: number): string {
  // Day fixed at the 2nd (see file header).
  return `${year}-${String(month).padStart(2, '0')}-02`;
}

function calculatorUrl(scenario: GoldenScenario): string {
  const { inputs } = scenario;
  const [person, spouse] = inputs.people;
  let url = `https://ssa.tools/calculator#pia1=${person.piaMonthly}&dob1=${isoDob(person.birthYear, person.birthMonth)}`;
  if (inputs.status === 'married' && spouse) {
    url += `&pia2=${spouse.piaMonthly}&dob2=${isoDob(spouse.birthYear, spouse.birthMonth)}`;
  }
  return url;
}

/**
 * Load ssa.tools' report for one scenario and extract the worker's benefit
 * table and (for couples) the FRA spousal top-up. Returns null if the report
 * can't be read/parsed.
 */
async function fetchSsaTools(page: Page, scenario: GoldenScenario): Promise<LiveResult | null> {
  await page.goto(calculatorUrl(scenario));
  const copyBtn = page.getByRole('button', { name: /Copy for AI assistant/i }).first();
  await copyBtn.waitFor({ state: 'visible' });
  await copyBtn.click();
  const pre = page.getByRole('dialog').first().locator('pre').first();
  await pre.waitFor({ state: 'visible' });
  const md = await pre.innerText();

  const tables = parseBenefitTables(md);
  if (!tables.length) return null;

  // A couple report has two "Monthly benefit by filing age" tables and may
  // list the higher earner first, so pick the worker's by whichever table best
  // fits our expected values rather than by position. (This only decides WHICH
  // person is the worker; the per-age assertions below still compare that table
  // to the independently-derived fixtures, so a real discrepancy is not masked.
  // Robust to non-integer FRA, where "benefit at FRA == PIA" does not hold.)
  const workerByAge = tables.length === 1 ? tables[0] : pickClosestTable(tables, scenario);

  return {
    workerByAge,
    spousalTopupAtFra: scenario.inputs.status === 'married' ? parseSpousalTopup(md) : null,
  };
}

/**
 * Of several benefit tables, return the one whose whole-year values deviate
 * least from the scenario's expected worker benefits (sum of absolute diffs;
 * a missing age is heavily penalized). Used to identify the worker's table in
 * a couple report regardless of the order ssa.tools lists the two people.
 */
function pickClosestTable(
  tables: Record<string, number>[],
  scenario: GoldenScenario,
): Record<string, number> {
  const expected = scenario.expected.monthlyByClaimAgeByPerson[0];
  const deviation = (t: Record<string, number>) =>
    Object.entries(expected).reduce(
      (sum, [age, v]) => sum + (age in t ? Math.abs(t[age] - v) : 1e9),
      0,
    );
  return [...tables].sort((a, b) => deviation(a) - deviation(b))[0];
}

/**
 * Parse every "## Monthly benefit by filing age" table in the report into its
 * own { "62": 1750, … } map of whole-year rows. Tables under other headings
 * (e.g. the "Spousal top-up / month" table) are excluded.
 */
function parseBenefitTables(md: string): Record<string, number>[] {
  const header = '## Monthly benefit by filing age';
  const tables: Record<string, number>[] = [];
  for (let i = md.indexOf(header); i >= 0; i = md.indexOf(header, i + header.length)) {
    const rest = md.slice(i + header.length);
    const endRel = rest.search(/\n#{1,2}\s/); // next heading terminates the table
    const tableMd = endRel >= 0 ? rest.slice(0, endRel) : rest;
    const t: Record<string, number> = {};
    for (const line of tableMd.split('\n')) {
      const m = line.match(/\|\s*(\d{2})y\s*0m\s*\|\s*\$([\d,]+)\s*\|/);
      if (m) t[m[1]] = Number(m[2].replace(/,/g, ''));
    }
    if (Object.keys(t).length) tables.push(t);
  }
  return tables;
}

/**
 * FRA spousal top-up from the "Spousal benefits" section's summary line
 * ("… = $250 / month"). Null if the section is absent (e.g. no top-up applies).
 */
function parseSpousalTopup(md: string): number | null {
  const start = md.indexOf('## Spousal benefits');
  if (start < 0) return null;
  const end = md.indexOf('## Survivor benefits', start);
  const section = md.slice(start, end < 0 ? undefined : end);
  const m = section.match(/=\s*\$([\d,]+)\s*\/\s*month/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

const crossScenarios = scenarios.filter((s) => s.mode === 'full');

test.describe('ssa.tools live cross-check', () => {
  for (const scenario of crossScenarios) {
    test(`cross-check: ${scenario.id}`, async ({ page }) => {
      const live = await fetchSsaTools(page, scenario);

      if (live === null) {
        reports.push({ id: scenario.id, implemented: false, deltas: [] });
        test.skip(
          true,
          'Could not read ssa.tools report — the live site may have changed; re-record with `npm run record:ssatools`',
        );
        return;
      }

      const deltas: AgeDelta[] = Object.entries(scenario.expected.monthlyByClaimAgeByPerson[0]).map(
        ([age, ours]) => {
          const theirs = live.workerByAge[age] ?? null;
          const delta = theirs === null ? null : theirs - ours;
          return {
            age: Number(age),
            ours,
            theirs,
            delta,
            withinTolerance: delta === null ? null : Math.abs(delta) <= tolerances.crosscheckUsd,
          };
        },
      );

      // Cross-check the spousal top-up only for the unambiguous case where the
      // worker is the higher earner (fixture top-up > 0); role-flipped/zero
      // cases are covered by the engine + UI suites.
      const expectedSpousal = scenario.expected.spousalTopUpAtFra;
      const report: ScenarioReport = { id: scenario.id, implemented: true, deltas };
      if (expectedSpousal !== null && expectedSpousal > 0) {
        const theirs = live.spousalTopupAtFra;
        report.spousal = {
          ours: expectedSpousal,
          theirs,
          delta: theirs === null ? null : theirs - expectedSpousal,
        };
      }
      reports.push(report);

      for (const d of deltas) {
        expect.soft(d.theirs, `age ${d.age}: ssa.tools showed no value`).not.toBeNull();
        if (d.delta !== null) {
          expect
            .soft(
              Math.abs(d.delta),
              `age ${d.age}: ours $${d.ours} vs ssa.tools $${d.theirs} (Δ $${d.delta})`,
            )
            .toBeLessThanOrEqual(tolerances.crosscheckUsd);
        }
      }

      if (report.spousal) {
        expect
          .soft(report.spousal.theirs, 'ssa.tools did not report a spousal top-up')
          .not.toBeNull();
        if (report.spousal.delta !== null) {
          expect
            .soft(
              Math.abs(report.spousal.delta),
              `spousal top-up at FRA: ours $${report.spousal.ours} vs ssa.tools $${report.spousal.theirs}`,
            )
            .toBeLessThanOrEqual(tolerances.crosscheckUsd);
        }
      }
    });
  }

  test.afterAll(() => {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const reportPath = fileURLToPath(new URL(`./report-${ts}.json`, import.meta.url));
    writeFileSync(reportPath, JSON.stringify({ tolerances, reports }, null, 2));
    console.log(`\nCross-check report written to ${reportPath}`);
    for (const r of reports) {
      if (!r.implemented) {
        console.log(`  ${r.id}: SKIPPED (report not readable)`);
        continue;
      }
      console.log(`\n${r.id}${r.spousal ? `  [spousal top-up: ours $${r.spousal.ours} / theirs $${r.spousal.theirs}]` : ''}`);
      console.table(r.deltas);
    }
  });
});
