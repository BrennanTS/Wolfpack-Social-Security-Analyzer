import { test as base, expect, type Page } from '@playwright/test';
import type { ScenarioInputs } from '../../fixtures/scenarios';

/**
 * Test fixture that bypasses the demo password gate. The gate keys off
 * sessionStorage, which Playwright's storageState does not cover, so it is
 * seeded before any page script runs.
 *
 * Tests that need to exercise the gate itself (e.g. asserting it appears for
 * a fresh visitor) must not use this fixture's `page` — instead open a fresh
 * `browser.newContext()` so the init script is never installed. See
 * interactions.spec.ts's password-gate test.
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
 * Fill the settings drawer for a scenario. The drawer is open on load and
 * the analysis runs reactively once the form is complete — there is no
 * Calculate button, so callers should await the results after this returns.
 *
 * Field ids are `#a-*` for the first person and `#b-*` for the second
 * (Task 16). Each person's fieldset carries the person's label
 * (`personLabel`) as its accessible name, and the gender control's
 * accessible name is person-scoped ("Client gender" / "Spouse gender", or
 * "<name> gender" once a name is typed) — so a bare `role=group` query for
 * "Gender" would match nothing; we scope by index instead.
 */
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
      .getByRole('group', { name: /gender/i })
      .nth(i)
      .getByRole('button', { name: person.gender === 'male' ? 'Male' : 'Female', exact: true })
      .click();
    await page.locator(`#${prefix}-benefit`).fill(String(person.piaMonthly));
  }
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
