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

test('reveals the deceased fields when Widowed is chosen', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, single);
  await expect(page.getByTestId('benefit-table')).toBeVisible();

  await page
    .getByRole('group', { name: 'Marital status' })
    .getByRole('button', { name: 'Widowed' })
    .click();

  // The deceased's fields are now required, so the previous analysis must clear.
  await expect(page.getByTestId('benefit-table')).toHaveCount(0);
  // A CSS locator rather than `getByLabel`, matching the "reveals spouse
  // fields" test above: `DeceasedFields` mirrors `PersonFields`' date-of-birth
  // markup exactly, where the year select carries its own `aria-label`
  // ("Deceased spouse death year") alongside the `<label for>` reading "Date
  // of Death". Per the accessible-name spec an element's `aria-label`
  // overrides an associated `<label>`, so the browser's computed name for
  // that select is the aria-label, not "Date of Death" — `getByLabel` would
  // never find it here, in production markup or in `PersonFields`' own.
  await expect(page.locator('#dec-death')).toBeVisible();
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

test('keeps the "vs. best" column on a phone-sized viewport', async ({ page }) => {
  // Regression: the <=720px rule that hides the benefit table's decorative
  // "Status" column was written against `.table-wrap table`, which also
  // matched the strategy comparison table. A married household's 5th column
  // there is "vs. best" — the whole reason that table exists — so it silently
  // disappeared on phones and portrait tablets.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await fillScenarioForm(page, married);

  const strategyTable = page.getByTestId('strategy-table');
  await expect(strategyTable).toBeVisible();
  await expect(strategyTable.getByRole('columnheader', { name: 'vs. best' })).toBeVisible();
  await expect(strategyTable.getByTestId('cell-delta').first()).toBeVisible();

  // The narrow-screen trim is still in force where it was intended.
  await page.getByRole('tab', { name: 'Sarah' }).click();
  const benefitTable = page.getByTestId('benefit-table');
  await expect(benefitTable).toBeVisible();
  await expect(benefitTable.getByRole('columnheader', { name: 'Status' })).toBeHidden();
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

/**
 * The cliff sentence's own "...to $X/yr the year after..." figure, pulled
 * out so it can be compared directly against the survivor-income column's
 * cell — the two are computed independently (`incomeCliff` off
 * `displayAnalysis`'s timeline vs. `nominalComparisons`' per-row scalar
 * transform in `HouseholdPanel`) and must still agree, in both modes, since
 * they describe the same household total in the same year.
 */
function cliffAfterFigure(sentence: string | null): string {
  const match = sentence?.match(/to (\$[\d,]+)\/yr the year after/);
  if (!match) throw new Error(`Could not find the "after" figure in: ${sentence}`);
  return match[1];
}

/**
 * The chart's own y-axis tick labels — a figure the chart draws from ITS
 * data (`HouseholdPanel`'s `displayMonthlySeries`, built via
 * `buildMonthlyIncomeSeries` + `toNominalMonthly`), not one shared with the
 * cliff callout or the survivor-income cell (those read `displayTimeline`,
 * built via `buildCombinedTimeline` + `toNominal` — a parallel, not the same,
 * computation). Before the chart moved to its own monthly series, this test
 * proved the chart moved with the toggle only because it consumed the exact
 * same `displayTimeline` the cliff callout did; that link no longer exists,
 * so this reads a value Recharts itself renders, in the real browser (jsdom
 * never mounts Recharts — see `CombinedIncomeChart.test.tsx`), the only place
 * `toNominalMonthly`'s wiring is exercised end to end at all.
 */
async function chartYAxisTicks(page: import('@playwright/test').Page): Promise<string[]> {
  return page
    .locator('.chart-surface .recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')
    .allTextContents();
}

test('toggles dollars mode and moves the chart, the income-cliff callout and the survivor-income column together', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, married);
  await expect(page.getByTestId('strategy-table')).toBeVisible();

  // Real is the default — the honest view needs no arithmetic, so it's the
  // one the reader sees without asking.
  const dollarsGroup = page.getByRole('group', { name: 'Dollars' });
  const realBtn = dollarsGroup.getByRole('button', { name: /today/i });
  const nominalBtn = dollarsGroup.getByRole('button', { name: /future/i });
  await expect(realBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(nominalBtn).toHaveAttribute('aria-pressed', 'false');

  const captionBefore = await page.getByTestId('combined-income-caveat').textContent();
  const cliffBefore = await page.getByTestId('income-cliff-sentence').textContent();
  const survivorCellBefore = await page.getByTestId('cell-survivor-optimal').textContent();
  const chartTicksBefore = await chartYAxisTicks(page);
  expect(captionBefore).toContain('today’s dollars');
  // The two independently-computed figures must already agree in real mode,
  // not just after toggling — otherwise a nominal-mode-only assertion below
  // would prove nothing about whether they agree "by construction" versus
  // by coincidence of the one household under test.
  expect(survivorCellBefore).toBe(cliffAfterFigure(cliffBefore));
  // Guard: an empty tick set would make every assertion below pass
  // vacuously — there would be no chart-drawn figure to have moved at all.
  expect(chartTicksBefore.length).toBeGreaterThan(0);

  await nominalBtn.click();

  await expect(nominalBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(realBtn).toHaveAttribute('aria-pressed', 'false');

  // Every figure the toggle governs must move together — a chart in nominal
  // beside a callout still in real would be the same defect class as a wrong
  // caption, just harder to spot.
  const captionAfter = await page.getByTestId('combined-income-caveat').textContent();
  expect(captionAfter).toContain('nominal');
  expect(captionAfter).not.toBe(captionBefore);

  const cliffAfter = await page.getByTestId('income-cliff-sentence').textContent();
  expect(cliffAfter).not.toBe(cliffBefore);

  const survivorCellAfter = await page.getByTestId('cell-survivor-optimal').textContent();
  expect(survivorCellAfter).not.toBe(survivorCellBefore);
  // The standing guarantee: the cliff callout's "after" figure and the
  // strategy table's survivor-income cell must still be the exact same
  // number in nominal mode, not just each individually different from real.
  expect(survivorCellAfter).toBe(cliffAfterFigure(cliffAfter));

  // The chart itself moves too — read straight off Recharts' own rendered
  // y-axis, not off anything the cliff callout or the survivor cell also
  // read. This is the one assertion in this test that would fail if the
  // chart's `toNominalMonthly` wiring in `HouseholdPanel` were ever silently
  // dropped while every other figure on the page kept moving correctly.
  const chartTicksAfter = await chartYAxisTicks(page);
  expect(chartTicksAfter).not.toEqual(chartTicksBefore);

  // Toggling back restores every figure exactly, not just the button state.
  await realBtn.click();
  await expect(realBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('combined-income-caveat')).toHaveText(captionBefore ?? '');
  await expect(page.getByTestId('income-cliff-sentence')).toHaveText(cliffBefore ?? '');
  await expect(page.getByTestId('cell-survivor-optimal')).toHaveText(survivorCellBefore ?? '');
  await expect(async () => {
    expect(await chartYAxisTicks(page)).toEqual(chartTicksBefore);
  }).toPass();
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

test('hydrates the form from a shared link and clears the query string', async ({ page }) => {
  await page.goto('/?ay=1962&am=4&ag=m&ab=2400&m=0&le=85');

  await expect(page.getByTestId('benefit-table')).toBeVisible();
  await expect(page.locator('#a-benefit')).toHaveValue('2400');
  // The address bar must not retain client data after hydration.
  expect(new URL(page.url()).search).toBe('');
});

test('ignores an out-of-range parameter rather than clamping it', async ({ page }) => {
  await page.goto('/?ay=1962&am=4&ag=m&ab=99999&m=0&le=85');

  // The benefit is dropped, so the field is empty and no analysis runs.
  await expect(page.locator('#a-benefit')).toHaveValue('');
  await expect(page.getByTestId('benefit-table')).toHaveCount(0);
});

// The spec calls this out specifically: the gate renders before the analyzer
// and keys off sessionStorage without navigating, so parameters should survive
// sign-in. It is exactly the kind of interaction that breaks silently.
test('a shared link still hydrates after the password gate', async ({ browser }) => {
  // A fresh context, without the shared fixture's sessionStorage seeding —
  // see the "gates access" test above for why.
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('/?ay=1962&am=4&ag=m&ab=2400&m=0&le=85');

    await expect(page.locator('#password')).toBeVisible();
    await page.locator('#password').fill('wolfpack');
    // The gate's submit button reads "Continue", not "enter/sign in/unlock".
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByTestId('benefit-table')).toBeVisible();
    await expect(page.locator('#a-benefit')).toHaveValue('2400');
  } finally {
    await context.close();
  }
});

test('gives each spouse their own life-expectancy slider', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, married);

  const a = page.locator('#life-0');
  const b = page.locator('#life-1');
  await expect(a).toHaveAttribute('type', 'range');
  await expect(b).toHaveAttribute('type', 'range');

  // The two must be independent: moving B's must not move A's.
  const aBefore = await a.inputValue();
  await b.fill('100');
  await expect(a).toHaveValue(aBefore);
  await expect(b).toHaveValue('100');
});

test('offers to convert a yearly benefit figure', async ({ page }) => {
  await page.goto('/');
  await page.locator('#a-benefit').fill('36000');

  const nudge = page.getByTestId('yearly-entry-nudge');
  await expect(nudge).toBeVisible();
  await page.getByRole('button', { name: /use \$3,000/i }).click();
  await expect(page.locator('#a-benefit')).toHaveValue('3000');
  await expect(nudge).toHaveCount(0);
});

test('drives the whole report from a scenario edited in the comparison table', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, married);

  const eyebrow = page.locator('.rec-label').first();
  await expect(eyebrow).toHaveText(/Recommended Strategy/);
  const optimalPv = await page
    .getByTestId('strategy-row-optimal')
    .locator('td')
    .nth(3)
    .textContent();

  // View mode carries no controls.
  await expect(page.getByTestId('scenario-edit-toggle')).toHaveText('Edit');
  await expect(page.getByTestId('scenario-add')).toHaveCount(0);

  await page.getByTestId('scenario-edit-toggle').click();
  await page.getByTestId('scenario-add').click();
  await expect(page.getByTestId('strategy-row-s1')).toBeVisible();
  await page.getByTestId('scenario-years-s1-0').selectOption('65');

  // The whole surface follows the edited row, and the optimum keeps its own
  // figure — the money columns are still on screen while editing.
  await expect(eyebrow).toHaveText(/Selected Scenario/);
  await expect(page.getByTestId('strategy-row-s1')).toContainText('Shown');
  await expect(page.getByTestId('strategy-row-optimal').locator('td').nth(4)).toHaveText(
    optimalPv ?? '',
  );

  // Hiding a row takes it off the table; Optimal has no eye to hide it with.
  await expect(page.getByTestId('scenario-eye-optimal')).toHaveCount(0);
  await page.getByTestId('scenario-eye-latest').click();
  await expect(page.getByTestId('hidden-count')).toHaveText('1 hidden');
  await page.getByTestId('scenario-edit-toggle').click();
  await expect(page.getByTestId('strategy-row-latest')).toHaveCount(0);

  // Reset restores the hidden row and the recommendation together.
  await page.getByTestId('scenario-edit-toggle').click();
  await page.getByTestId('scenario-reset').click();
  await page.getByTestId('scenario-edit-toggle').click();
  await expect(page.getByTestId('strategy-row-latest')).toBeVisible();
  await expect(page.getByTestId('strategy-row-s1')).toHaveCount(0);
  await expect(eyebrow).toHaveText(/Recommended Strategy/);
});
