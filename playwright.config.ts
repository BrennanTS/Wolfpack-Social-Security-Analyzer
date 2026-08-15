import { defineConfig } from '@playwright/test';

/**
 * UI validation suite: asserts the rendered analysis matches the golden
 * fixtures in validation/fixtures/scenarios.json.
 *
 * By default this builds the app and serves the production bundle via
 * `vite preview` (what the pre-commit hook runs). Set PW_DEV=1 to reuse a
 * fast dev server instead while authoring tests:
 *
 *   PW_DEV=1 npx playwright test
 *
 * The live ssa.tools cross-check has its own config:
 * playwright.crosscheck.config.ts.
 */
const useDev = !!process.env.PW_DEV;
const port = Number(process.env.PW_PORT ?? 4173);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'validation/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  // Pre-commit must be deterministic, not retried green.
  retries: 0,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: useDev
      ? `npx vite --port ${port} --strictPort`
      : `npm run build && npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: useDev,
    timeout: 120_000,
  },
});
