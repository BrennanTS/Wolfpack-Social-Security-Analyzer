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
 * break-even chart, "Future" eligibility badges) are intentionally not
 * asserted here — fixtures pin `asOf`, but the running app evaluates against
 * the real wall-clock date, so those can legitimately differ from the
 * fixture's hand-derivation. Per-claim-age monthly amounts and %PIA are
 * date-independent (pure functions of birth year/month and PIA) and assert
 * cleanly regardless. The engine suite (validation/engine/golden.test.ts)
 * covers the date-dependent invariants directly against the pinned `asOf`.
 *
 * For a married scenario, the benefit table lives on each person's own tab
 * (the Household tab shows the strategy comparison, not a benefit table), so
 * each asserted person's tab is selected before reading their rows.
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

    if (scenario.inputs.status === 'married') {
      await expect(page.getByTestId('strategy-table')).toBeVisible();

      // Household tab: the optimizer always picks exactly one strategy, and
      // it must be flagged as such.
      const optimalRow = page.getByTestId('strategy-row-optimal');
      await expect(optimalRow).toBeVisible();
      await expect(optimalRow.getByText('Best')).toBeVisible();
    } else {
      await expect(page.getByTestId('benefit-table')).toBeVisible();
    }
    await expect(page.getByTestId('analysis-loading')).toHaveCount(0);
    await expect(page.getByTestId('analysis-error')).toHaveCount(0);

    // Only the person(s) covered by the fixture's expected arrays are
    // asserted — most married scenarios cover just person A ("the worker" in
    // legacy terms); two newer scenarios (Task 22) opt person B in too. See
    // scenarios.ts / the fixture's "conventions" field.
    for (const [i, monthlyByClaimAge] of scenario.expected.monthlyByClaimAgeByPerson.entries()) {
      if (scenario.inputs.status === 'married') {
        await page.getByRole('tab').nth(i + 1).click(); // tab 0 is Household
      }

      const table = page.getByTestId('benefit-table');
      await expect(table).toBeVisible();

      const percentOfPiaByClaimAge = scenario.expected.percentOfPiaByClaimAgeByPerson[i];
      for (const [age, monthly] of Object.entries(monthlyByClaimAge)) {
        const row = page.getByTestId(`claim-row-${age}`);
        await expect(row.getByTestId('cell-monthly')).toHaveText(
          tableCurrency(monthly),
        );
        const percent = percentOfPiaByClaimAge[age];
        await expect(row.getByTestId('cell-percent')).toHaveText(`${percent}%`);
      }

      // Summary cards (FRA / age-62 / age-70) are only fixture-checked for
      // the first asserted person, matching the historical "worker" scope of
      // scenario.e2e.assertSummaryCards.
      if (i === 0 && scenario.e2e.assertSummaryCards) {
        await expect(page.getByTestId('summary-fra')).toHaveText(
          scenario.expected.fraByPerson[0].label,
        );
        await expect(page.getByTestId('summary-age62')).toHaveText(
          cardCurrency(monthlyByClaimAge['62']),
        );
        await expect(page.getByTestId('summary-age70')).toHaveText(
          cardCurrency(monthlyByClaimAge['70']),
        );
      }
    }
  });
}
