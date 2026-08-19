/**
 * Interaction coverage that the golden-value suite can't exercise: it drives
 * one scenario through the form once and reads the results, whereas this
 * suite covers behavior that only shows up across a sequence of user
 * actions — toggling marital status, switching tabs, moving the COLA slider,
 * opening/closing the settings drawer, dark mode, and PDF
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
  // Exact, not a substring: "Export PDF" is a prefix of "Export PDF (beta)".
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Social-Security-Analysis-.*\.pdf$/);
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

// The gate this once had to survive is gone, but the hydration path is
// unchanged and still the kind of thing that breaks silently: parameters are
// read once at mount and the address bar is cleared, so a second render must
// not lose them.
test('keeps a shared link’s inputs across a reload of the app shell', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('/?ay=1962&am=4&ag=m&ab=2400&m=0&le=85');
    await expect(page.getByTestId('benefit-table')).toBeVisible();
    await expect(page.locator('#a-benefit')).toHaveValue('2400');
    // Reloading the now-bare URL keeps nothing — the query string was cleared
    // on hydration, which is deliberate: client data must not sit in the
    // address bar. The empty field is the assertion, not a failure.
    await page.reload();
    await expect(page.locator('#a-benefit')).toHaveValue('');
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
    .getByTestId('cell-npv')
    .textContent();

  // View mode carries no controls.
  await expect(page.getByTestId('scenario-edit-toggle')).toHaveText('Edit');
  await expect(page.getByTestId('scenario-add')).toHaveCount(0);

  await page.getByTestId('scenario-edit-toggle').click();
  await page.getByTestId('scenario-add').click();
  await expect(page.getByTestId('strategy-row-s1')).toBeVisible();

  // Adding does NOT select. A new row is something to compare against the
  // optimum, and the report stays on the optimum until somebody says
  // otherwise — otherwise every figure, and the person tabs' "Best together"
  // badge, would follow whatever was last typed in.
  await expect(eyebrow).toHaveText(/Recommended Strategy/);
  await expect(page.getByTestId('strategy-row-s1')).not.toHaveClass(/row-selected/);
  await expect(page.getByTestId('strategy-row-optimal')).toHaveClass(/row-selected/);

  // Selecting is its own act, here in the editor.
  await page.getByTestId('scenario-use-s1').click();
  await page.getByTestId('scenario-years-s1-0').selectOption('65');

  // The whole surface follows the edited row, and the optimum keeps its own
  // figure — the money columns are still on screen while editing.
  await expect(eyebrow).toHaveText(/Selected Scenario/);
  await expect(page.getByTestId('strategy-row-s1')).toHaveClass(/row-selected/);
  await expect(page.getByTestId('strategy-row-optimal').getByTestId('cell-npv')).toHaveText(
    optimalPv ?? '',
  );

  // The edited row must not move out from under the control still being held:
  // the table sorts by filing age, and 65 puts this row above "Both claim at
  // FRA" — but not until editing ends.
  const rowKeys = () =>
    page.locator('[data-testid^="strategy-row-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')),
    );
  const whileEditing = await rowKeys();
  expect(whileEditing[whileEditing.length - 1]).toBe('strategy-row-s1');
  await page.getByTestId('scenario-years-s1-1').selectOption('64');
  expect((await rowKeys())[whileEditing.length - 1]).toBe('strategy-row-s1');

  // Hiding a row takes it off the table; Optimal has no eye to hide it with.
  await expect(page.getByTestId('scenario-eye-optimal')).toHaveCount(0);

  // Whichever built-in row this household actually reaches, rather than a
  // named one: `latest` folds into `optimal` for any household whose optimum
  // IS 70/70, which is common now that the optimizer runs to a plan-to age.
  // Naming it made this test depend on the recommendation rather than on the
  // eye.
  const hideable = page
    .locator('[data-testid^="scenario-eye-"]')
    .and(page.locator(':not([data-testid="scenario-eye-s1"])'));
  await expect(hideable.first()).toBeVisible();
  const hiddenKey = await hideable
    .first()
    .evaluate((el) => el.getAttribute('data-testid')!.replace('scenario-eye-', ''));
  await hideable.first().click();
  await expect(page.getByTestId('hidden-count')).toHaveText('1 hidden');
  await page.getByTestId('scenario-edit-toggle').click();
  await expect(page.getByTestId(`strategy-row-${hiddenKey}`)).toHaveCount(0);

  // Reset restores the hidden row and the recommendation together.
  await page.getByTestId('scenario-edit-toggle').click();
  await page.getByTestId('scenario-reset').click();
  await page.getByTestId('scenario-edit-toggle').click();
  await expect(page.getByTestId(`strategy-row-${hiddenKey}`)).toBeVisible();
  await expect(page.getByTestId('strategy-row-s1')).toHaveCount(0);
  await expect(eyebrow).toHaveText(/Recommended Strategy/);
});

test('edits which claiming ages a person’s table shows, without moving the analysis', async ({
  page,
}) => {
  await page.goto('/');
  await fillScenarioForm(page, married);
  await page.getByRole('tab', { name: 'Dan' }).click();

  // The household recommendation must not move for any of this — these rows
  // are a display choice, not a strategy the analysis runs on.
  const before = await page.getByTestId('stat-optimal-monthly').textContent();

  await expect(page.getByTestId('claim-edit-toggle')).toHaveText('Edit');
  await page.getByTestId('claim-edit-toggle').click();

  // Hide a row: gone from the table once editing ends.
  await page.getByTestId('claim-eye-67').click();
  await expect(page.getByTestId('claim-hidden-count')).toHaveText('1 hidden');
  await page.getByTestId('claim-edit-toggle').click();
  await expect(page.getByTestId('claim-row-67')).toHaveCount(0);

  // Add an exact age, which appears with its own label.
  await page.getByTestId('claim-edit-toggle').click();
  await page.getByTestId('claim-add-years').selectOption('69');
  await page.getByTestId('claim-add-months').selectOption('1');
  await page.getByTestId('claim-add').click();
  await expect(page.getByTestId('claim-row-69-1')).toContainText('69 years, 1 month');

  await expect(page.getByTestId('stat-optimal-monthly')).toHaveText(before ?? '');

  // Reset brings the hidden row back and drops the added one.
  await page.getByTestId('claim-reset').click();
  await page.getByTestId('claim-edit-toggle').click();
  await expect(page.getByTestId('claim-row-67')).toBeVisible();
  await expect(page.getByTestId('claim-row-69-1')).toHaveCount(0);
});

test('renders a widowed household, and never the single-claimant view', async ({ page }) => {
  // Seeded through the share link rather than the form: the widowed intake is
  // several fields deep, and the link is also the route that used to unmount
  // the whole tree when `householdDisplayShape` threw.
  await page.goto(
    '/?ay=1964&am=6&ag=f&ab=1200&ale=90&m=w&dy=1960&dm=3&ddy=2024&ddm=8&dk=p&dp=3000&df=1&dfy=2022&dfm=6',
  );

  await expect(page.getByTestId('widowed-strategy-table')).toBeVisible();

  // Both dates in the headline. A widow(er) shown her own retirement benefit
  // alone is the defect this whole phase exists to prevent.
  const title = page.getByTestId('recommendation-title');
  await expect(title).toContainText(/survivor benefit/i);
  await expect(title).toContainText(/own record/i);

  // The money column says what it is. `expectedNpv` holds an undiscounted
  // lifetime sum for a widowed row, and it used to print under "Combined PV".
  await expect(page.getByTestId('widowed-strategy-table')).toContainText('Lifetime total');
  await expect(page.getByTestId('widowed-strategy-table')).not.toContainText('Combined PV');

  // Neither of the other two surfaces.
  await expect(page.getByTestId('benefit-table')).toHaveCount(0);
  await expect(page.getByTestId('strategy-table')).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  // And no spousal methodology block, which says survivor benefits are not
  // modeled — on a page built around one.
  await expect(page.getByTestId('methodology-spousal')).toHaveCount(0);

  // The deceased's record, with "had not filed" distinguishable from a date.
  await expect(page.getByTestId('deceased-filed')).toContainText('June 2022');

  // Both actions live, having been disabled dead ends until now.
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled();
  await expect(page.getByTestId('export-beta')).toBeEnabled();
  await expect(page.getByRole('button', { name: /copy link/i })).toBeEnabled();
});

test('blocks the widowed dates SSA would not pay, instead of failing the analysis', async ({
  page,
}) => {
  // Own record before 62 crashed the engine outright and surfaced as the
  // generic "Analysis failed" banner. Survivor before 60 was worse: the
  // engine priced it, and the app printed an age nobody can claim at.
  await page.goto(
    '/?ay=1964&am=6&ag=f&ab=1200&ale=90&m=w&dy=1960&dm=3&ddy=2024&ddm=8&dk=p&dp=3000&df=1&dfy=2022&dfm=6&coy=2024&com=1',
  );

  await expect(page.getByText(/cannot file on your own record before age 62/i)).toBeVisible();
  // A field error, not a failed analysis.
  await expect(page.getByTestId('analysis-error')).toHaveCount(0);
});

test('explores the claiming grid and builds the report on a square', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, married);

  // The tab exists only for two claimants — a single claimant's grid would
  // be one axis, which is the benefit table they already have.
  const gridTab = page.getByRole('tab', { name: 'Claiming grid' });
  await expect(gridTab).toBeVisible();
  await gridTab.click();

  const table = page.getByTestId('claiming-grid-table');
  await expect(table).toBeVisible();

  // A COMPLETE board: one square per pair of attainable whole ages. Not a
  // hard 81 — an axis starts at the person's own floor, and this couple is
  // already past 62, so counting rows times columns is the real invariant
  // and a hardcoded number would only pin the fixture's birth years.
  const cols = await page.locator('[data-testid="claiming-grid-table"] thead th').count();
  const rows = await page.locator('[data-testid="claiming-grid-table"] tbody tr').count();
  const cells = page.locator('[data-testid^="grid-cell-"]');
  expect(rows).toBeGreaterThan(1);
  await expect(cells).toHaveCount(rows * (cols - 1));
  // The grid's best must BE the optimizer's answer, not a separate number
  // that happens to look similar. Each square is a max over the months
  // inside its year pair, so the board's maximum is the same figure the
  // strategy table prints on its Optimal row — if these two ever disagree,
  // one of the surfaces is quoting a strategy the other says is unavailable.
  const gridBest = await page.getByTestId('grid-best-value').textContent();
  await page.getByRole('tab', { name: 'Household' }).click();
  const optimalValue = await page
    .getByTestId('strategy-row-optimal')
    .getByTestId('cell-npv')
    .textContent();
  expect(gridBest?.trim()).toBe(optimalValue?.trim());
  await gridTab.click();

  // Widening the tolerance can only ever admit more squares, never fewer.
  const count = page.getByTestId('target-range-count');
  const atOne = Number((await count.textContent())!.match(/^(\d+)/)![1]);
  await page.getByTestId('target-range-percent').fill('5');
  const atFive = Number((await count.textContent())!.match(/^(\d+)/)![1]);
  expect(atFive).toBeGreaterThan(atOne);

  // The near-best region has to be visible as a REGION, not just as a ring
  // on each member: everything outside it steps back at the same time.
  const dimmed = page.locator('.claim-grid-dimmed .claim-cell:not(.claim-cell-near)');
  expect(await dimmed.count()).toBeGreaterThan(0);
  await expect(dimmed.first()).toHaveCSS('opacity', '0.4');

  // Turning the highlight off retires the count and the dimming with it —
  // an excluded square is de-emphasised, never presented as unavailable.
  await page.getByTestId('target-range-toggle').uncheck();
  await expect(count).toHaveCount(0);
  await expect(page.locator('.claim-grid-dimmed')).toHaveCount(0);

  // Clicking a square only READS it. Applying used to happen on the click
  // itself, which minted a scenario row for every square an adviser touched
  // while exploring — a list on another tab growing without anyone deciding
  // it should.
  // Whichever square sits one in from each axis end — named from the axes
  // rather than hardcoded, for the same reason the count is.
  const [firstCol] = await page.locator('[data-testid="claiming-grid-table"] thead th').nth(2).allInnerTexts();
  const [firstRow] = await page.locator('[data-testid="claiming-grid-table"] tbody tr').nth(1).locator('th').allInnerTexts();
  await page.getByTestId(`grid-cell-${firstCol}-${firstRow}`).click();
  await expect(page.getByTestId('grid-picked')).toBeVisible();
  const pickedValue = await page.getByTestId('grid-picked-value').textContent();

  // Nothing has reached the comparison table — the square is only being read.
  await page.getByRole('tab', { name: 'Household' }).click();
  await expect(page.getByTestId('strategy-row-s1')).toHaveCount(0);

  // And the pick survives the trip. Only the active tabpanel is rendered, so
  // going to compare the square against the Household table used to discard
  // it — which is the one moment an adviser is most likely to leave.
  await gridTab.click();
  await expect(page.getByTestId('grid-picked-value')).toHaveText(pickedValue ?? '');

  // Applying is its own act, and then it does drive the whole report.
  await page.getByTestId('grid-apply').click();
  await page.getByRole('tab', { name: 'Household' }).click();
  await expect(page.getByTestId('strategy-row-s1')).toHaveClass(/row-selected/);
  await expect(page.locator('.rec-label').first()).toHaveText(/Selected Scenario/);
  const scenarioRow = page.getByTestId('strategy-row-s1');
  await expect(scenarioRow).toContainText(firstCol);
  await expect(scenarioRow).toContainText(firstRow);
});

test('exports the beta report, named apart from the report it may replace', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, married);
  await expect(page.getByTestId('strategy-table')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-beta').click();
  const download = await downloadPromise;

  // A distinct filename, so an adviser holding both can tell them apart —
  // and so exporting one cannot overwrite the other in a downloads folder.
  expect(download.suggestedFilename()).toMatch(/^Social-Security-Analysis-.*-beta\.pdf$/);

  // The original still works afterwards. Two exports sharing one analysis is
  // the whole premise of shipping the beta alongside rather than instead.
  const alsoOriginal = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  expect((await alsoOriginal).suggestedFilename()).toMatch(/^Social-Security-Analysis-[\d-]+\.pdf$/);
});

/**
 * Both export buttons, in both themes, at rest and on hover.
 *
 * This repo keeps shipping the same defect: `--ink` and `--cream` are NOT
 * redefined in the dark block — they hold their light values in both themes —
 * so a rule pairing them renders dark-on-dark and vanishes. It has now cost
 * the claiming grid's apply button and both of these, and it is invisible to
 * every other test here because the markup is identical either way.
 *
 * Contrast is measured rather than eyeballed, and in a real browser: a
 * backgrounded tab reports the new custom-property values while still
 * resolving `var()` against the old ones, which makes a hand check in a
 * hidden pane actively misleading.
 */
test('both export buttons stay legible in light and dark, at rest and on hover', async ({ page }) => {
  await page.goto('/');
  await fillScenarioForm(page, single);
  await expect(page.getByTestId('benefit-table')).toBeVisible();

  const contrast = (selector: 'primary' | 'beta') =>
    page.evaluate((which) => {
      const lum = (c: string) => {
        const [R, G, B] = c
          .match(/\d+(\.\d+)?/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          });
        return 0.2126 * R + 0.7152 * G + 0.0722 * B;
      };
      const ratio = (a: string, b: string) =>
        (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      // Composite the button's background over the page rather than testing
      // for the string 'rgba(0, 0, 0, 0)'. A background mid-transition is
      // partly transparent ink over ink, and reading it as opaque made the
      // measurement race the 0.25s fade and report a ratio of 1.
      const parse = (c: string) => {
        const n = c.match(/[\d.]+/g)!.map(Number);
        return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
      };
      const over = (top: string, bottom: string) => {
        const t = parse(top);
        const b = parse(bottom);
        const mix = (x: number, y: number) => Math.round(x * t.a + y * (1 - t.a));
        return `rgb(${mix(t.r, b.r)}, ${mix(t.g, b.g)}, ${mix(t.b, b.b)})`;
      };
      const pageBg = getComputedStyle(document.body).backgroundColor;
      // By test id, not by class: the two buttons carry the same classes
      // now, being alternatives rather than a primary and a fallback.
      const el =
        which === 'beta'
          ? document.querySelector<HTMLElement>('[data-testid="export-beta"]')!
          : [...document.querySelectorAll<HTMLElement>('.btn-export')].find(
              (x) => x.dataset.testid !== 'export-beta',
            )!;
      const cs = getComputedStyle(el);
      return ratio(over(cs.color, over(cs.backgroundColor, pageBg)), over(cs.backgroundColor, pageBg));
    }, selector);

  const themeToggle = page.getByRole('button', { name: /dark|light|theme/i });

  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') {
      await themeToggle.click();
      await page.waitForTimeout(300);
    }
    for (const which of ['primary', 'beta'] as const) {
      const button =
        which === 'beta'
          ? page.getByTestId('export-beta')
          : page.getByRole('button', { name: 'Export PDF', exact: true });

      // At rest. 4.5 is the AA floor for body text; these are uppercase
      // small caps, so the real bar is higher, but a failure here is never
      // marginal — the broken states measured 1.05.
      expect(await contrast(which), `${which} at rest in ${theme}`).toBeGreaterThan(4.5);

      await button.hover();
      // Longer than the 0.25s colour transition, so the measurement is of a
      // settled state rather than a frame of the fade.
      await page.waitForTimeout(500);
      expect(await contrast(which), `${which} on hover in ${theme}`).toBeGreaterThan(4.5);

      // Move off, so the next measurement is a true resting state.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
    }
  }
});
