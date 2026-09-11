import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  // Mirror the app's alias so tests can import the vendored ssa.tools engine.
  $lib: path.resolve(__dirname, 'src/vendor/ssa-tools'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'lib',
          environment: 'node',
          include: ['src/**/*.test.ts', 'validation/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/testSetup.ts'],
        },
      },
    ],
    /**
     * A floor, not a target.
     *
     * These numbers exist to make a DROP fail, not to be chased upward. The
     * distinction matters here because a percentage is easy to game and this
     * repo has proof: `resources.ts` read 100% while nothing asserted
     * anything about it, because importing a data module executes every
     * top-level statement. Coverage is a hint about where to look — it found
     * `pdfSafeText` dead at 0% — and a poor score of the tests that exist.
     *
     * Set just under the measured values rather than at them, so ordinary
     * refactoring does not trip the build on a rounding change. Raise them
     * deliberately, in a commit, when real coverage moves: `autoUpdate` is
     * deliberately OFF, because it rewrites this file from whatever run
     * happens to finish — including a partial one, which would quietly lower
     * the floor rather than raise it.
     *
     * Vitest cannot see Playwright, so several files read far lower here than
     * they are actually tested: `printReport`, `logoImage`, `useDarkMode` and
     * `ClaimingGridPanel` all have e2e coverage the number below ignores. Do
     * not "fix" those with unit tests that assert against mocks.
     *
     *   npm run coverage
     */
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/vendor/**', '**/*.test.*', 'src/**/*.d.ts'],
      thresholds: {
        autoUpdate: false,
        statements: 85,
        branches: 80,
        functions: 83,
        lines: 85,
      },
    },
  },
});
