/**
 * The invariant sweep runs on its own config, not as part of `npm test`.
 *
 * It analyzes thousands of households through the mortality-weighted
 * optimizer, which takes minutes rather than seconds — too slow for the
 * pre-commit suite, and its job is different: `npm test` pins known values,
 * the sweep hunts for properties that fail on households nobody wrote down.
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
    name: 'sweep',
    environment: 'jsdom',
    include: ['validation/sweep/**/*.sweep.ts', 'validation/sweep/**/*.sweep.tsx'],
    setupFiles: ['./src/testSetup.ts'],
    // A single sweep file walks thousands of households; the default 5s cap
    // is for unit tests.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
