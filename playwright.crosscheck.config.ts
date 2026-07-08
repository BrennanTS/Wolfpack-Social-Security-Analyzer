import { defineConfig } from '@playwright/test';

/**
 * On-demand cross-check against the LIVE https://ssa.tools site. Compares
 * their displayed benefit numbers to our golden fixtures. Network-dependent
 * and intentionally NOT part of the pre-commit hook — run manually:
 *
 *   npm run crosscheck:ssatools
 */
export default defineConfig({
  testDir: 'validation/crosscheck',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
