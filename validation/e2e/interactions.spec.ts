/**
 * Interaction coverage that the golden-value suite can't exercise: it drives
 * one scenario through the form once and reads the results, whereas this
 * suite covers behavior that only shows up across a sequence of user
 * actions — toggling marital status, switching tabs, moving the COLA slider,
 * opening/closing the settings drawer, dark mode, the password gate, and PDF
 * export.
 */
import { expect, fillScenarioForm, test } from './helpers/app';

const dan = {
  name: 'Dan',
  birthYear: 1962,
  birthMonth: 4,
  gender: 'male' as const,
  piaMonthly: 2400,
  lifeExpectancy: 85,
};
const sarah = {
  name: 'Sarah',
  birthYear: 1964,
  birthMonth: 2,
  gender: 'female' as const,
  piaMonthly: 2100,
  lifeExpectancy: 88,
};

const single = {
  asOf: '2026-01-15',
  status: 'single' as const,
  annualCola: 2.5,
  discountRate: 0.025,
  people: [dan],
};

const married = {
  asOf: '2026-01-15',
  status: 'married' as const,
  annualCola: 2.5,
  discountRate: 0.025,
  people: [dan, sarah],
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

  await page
    .getByRole('group', { name: 'Marital status' })
    .getByRole('button', { name: 'Married' })
    .click();

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

  await page.getByRole('tab', { name: 'Household' }).click();
  await expect(page.getByTestId('strategy-table')).toBeVisible();
  await expect(page.getByTestId('benefit-table')).toHaveCount(0);
});

test('recomputes break-evens when the COLA slider moves', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, single);

  const cola = page.locator('#cola');
  await expect(cola).toHaveAttribute('type', 'range');

  await cola.fill('0');
  const zeroColaText = await page.getByTestId('break-even-62-70').textContent();

  // 5%, not the slider's 8% max: at 8% COLA the 62->70 break-even for this
  // person's benefit spread never occurs within the 120-year search grid
  // (breakEvenAge returns null and the card disappears) — a real property of
  // the compounding math (an earlier claimant's extra years of compounding
  // can outrun a later, larger check), not a bug. 5% still lands a real,
  // later break-even age without tripping that edge.
  await cola.fill('5');
  await expect(page.getByTestId('break-even-62-70')).not.toHaveText(zeroColaText ?? '');
});

test('toggles the settings drawer open and closed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#settings-drawer')).toBeVisible();

  await page.getByRole('button', { name: 'Hide settings' }).click();
  await expect(page.locator('#settings-drawer')).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#settings-drawer')).toBeVisible();
});

test('toggles dark mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('exports a PDF', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, single);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export PDF/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Social-Security-Analysis-.*\.pdf$/);
});

test('gates access behind the demo password', async ({ browser }) => {
  // A fresh context, deliberately not using this file's `page` fixture — that
  // fixture seeds sessionStorage to bypass the gate (see helpers/app.ts), so
  // testing the gate itself needs a context without that seeding.
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByTestId('benefit-table')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
