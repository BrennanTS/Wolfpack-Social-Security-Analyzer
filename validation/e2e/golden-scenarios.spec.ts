/**
 * UI-level golden-value validation.
 *
 * Drives the real app (production build via vite preview) through each
 * 'full'-mode scenario in validation/fixtures/scenarios.json and asserts the
 * rendered benefit table and summary cards show exactly the values
 * hand-derived from SSA's published rules — the same fixture file the
 * Vitest engine suite uses, so expected values are never duplicated.
 *
 * Time-dependent outputs (lifetime totals, expected PV, optimal age,
 * break-even chart) are intentionally not asserted here; the engine suite
 * covers their invariants.
 */
import { loadScenarios } from '../fixtures/scenarios';
import {
  cardCurrency,
  expect,
  fillScenarioForm,
  tableCurrency,
  test,
} from './helpers/app';

const { scenarios } = loadScenarios();
const uiScenarios = scenarios.filter(
  (s) => s.mode === 'full' && s.e2e.assertTable,
);

for (const scenario of uiScenarios) {
  test(`renders golden values: ${scenario.id}`, async ({ page }) => {
    await page.goto('/');

    // The auth init script must have kept the password gate closed.
    await expect(page.locator('#password')).toHaveCount(0);

    await fillScenarioForm(page, scenario.inputs);

    const table = page.getByTestId('benefit-table');
    await expect(table).toBeVisible();
    await expect(page.getByTestId('analysis-loading')).toHaveCount(0);
    await expect(page.getByTestId('analysis-error')).toHaveCount(0);

    // Only person 0 (the legacy fixtures' "worker") has an asserted
    // per-claim-age table; see scenarios.ts.
    const monthlyByClaimAge = scenario.expected.monthlyByClaimAgeByPerson[0];
    const percentOfPiaByClaimAge = scenario.expected.percentOfPiaByClaimAgeByPerson[0];

    for (const [age, monthly] of Object.entries(monthlyByClaimAge)) {
      const row = page.getByTestId(`claim-row-${age}`);
      await expect(row.getByTestId('cell-monthly')).toHaveText(
        tableCurrency(monthly),
      );
      const percent = percentOfPiaByClaimAge[age];
      await expect(row.getByTestId('cell-percent')).toHaveText(`${percent}%`);
    }

    if (scenario.e2e.assertSummaryCards) {
      await expect(page.getByTestId('summary-fra')).toHaveText(
        scenario.expected.fraByPerson[0].label,
      );
      await expect(page.getByTestId('summary-age62')).toHaveText(
        cardCurrency(monthlyByClaimAge['62']),
      );
      await expect(page.getByTestId('summary-age70')).toHaveText(
        cardCurrency(monthlyByClaimAge['70']),
      );
      if (scenario.expected.spousalTopUpAtFra !== null) {
        await expect(page.getByTestId('summary-spousal')).toHaveText(
          `${cardCurrency(scenario.expected.spousalTopUpAtFra)}/mo`,
        );
      }
    }
  });
}
