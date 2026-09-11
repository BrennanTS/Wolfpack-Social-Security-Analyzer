/**
 * The copy corpus and the compliance schedule, on their own config.
 *
 * It shares the sweep's TypeScript setup, life-table stubbing and long
 * timeout, but it is not a sweep: it asserts nothing and it WRITES a tracked
 * file. Excluded from `npm run sweep` so checking the invariants never
 * dirties the working tree, and given its own entry point here so it stays
 * one command rather than a flag people have to remember.
 *
 *   npm run copy:corpus
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alias = { $lib: path.resolve(__dirname, 'src/vendor/ssa-tools') };

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    name: 'corpus',
    environment: 'jsdom',
    include: [
      'validation/sweep/corpus.sweep.ts',
      'validation/sweep/schedule.sweep.ts',
      'validation/sweep/samples.sweep.tsx',
    ],
    setupFiles: ['./src/testSetup.ts'],
    // These write files and report what they wrote; the summary is the point.
    disableConsoleIntercept: true,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
