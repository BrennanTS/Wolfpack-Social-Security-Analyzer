import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://ssa.tools/');
  await page.getByRole('button', { name: 'Get Started Free' }).click();
  await page.getByRole('button', { name: 'Alternative data entry options' }).click();
  await page.getByRole('spinbutton', { name: 'Primary Insurance Amount:' }).click();
  await page.getByRole('spinbutton', { name: 'Primary Insurance Amount:' }).fill('4000');
  await page.getByRole('button', { name: '✓ Submit' }).click();
  await page.getByRole('textbox', { name: 'Month' }).click();
  await page.getByRole('textbox', { name: 'Month' }).fill('02');
  await page.getByRole('textbox', { name: 'Day' }).fill('02');
  await page.getByRole('textbox', { name: 'Year' }).fill('1965');
  await page.getByRole('button', { name: '✓ Next' }).click();
  await page.getByRole('button', { name: '🧑 No, Continue' }).click();
  await page.getByRole('link', { name: 'Open the strategy optimizer' }).click();
  await page.getByRole('button', { name: 'Continue →' }).click();
});