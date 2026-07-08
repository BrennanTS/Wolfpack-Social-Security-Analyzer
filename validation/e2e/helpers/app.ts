import { test as base, expect, type Page } from '@playwright/test';
import type { ScenarioInputs } from '../../fixtures/scenarios';

/**
 * Test fixture that bypasses the demo password gate. The gate keys off
 * sessionStorage, which Playwright's storageState does not cover, so it is
 * seeded before any page script runs.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('ssa-demo-auth', 'true');
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture, not a React hook
    await use(page);
  },
});

export { expect };

/**
 * Fill the settings drawer for a golden scenario. The drawer is open on
 * load and the analysis runs reactively once the form is complete — there
 * is no Calculate button, so callers should await the results table after
 * this returns.
 */
export async function fillScenarioForm(page: Page, inputs: ScenarioInputs) {
  await page.locator('#birth-month').selectOption(String(inputs.birthMonth));
  await page.locator('#birth').selectOption(String(inputs.birthYear));

  const genderName = inputs.gender === 'male' ? 'Male' : 'Female';
  await page
    .getByRole('group', { name: 'Gender' })
    .getByRole('button', { name: genderName, exact: true })
    .click();

  const marital = page.getByRole('group', { name: 'Marital status' });
  await marital
    .getByRole('button', { name: inputs.hasSpouse ? 'Married' : 'Single' })
    .click();

  if (inputs.hasSpouse) {
    if (inputs.spouseBirthMonth !== undefined) {
      await page
        .getByLabel('Spouse birth month')
        .selectOption(String(inputs.spouseBirthMonth));
    }
    if (inputs.spouseBirthYear !== undefined) {
      await page
        .getByLabel('Spouse birth year')
        .selectOption(String(inputs.spouseBirthYear));
    }
    await page
      .locator('#spouse-benefit')
      .fill(String(inputs.spouseMonthlyBenefitAtFra ?? 0));
  }

  await page.locator('#benefit').fill(String(inputs.monthlyBenefitAtFra));
}

/** Format a whole-dollar amount the way the benefit table renders it ("$1,750.00"). */
export function tableCurrency(amount: number): string {
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format a whole-dollar amount the way the summary cards render it ("$1,750"). */
export function cardCurrency(amount: number): string {
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
