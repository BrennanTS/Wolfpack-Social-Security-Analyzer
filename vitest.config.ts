import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the app's alias so tests can import the vendored ssa.tools engine.
      $lib: path.resolve(__dirname, 'src/vendor/ssa-tools'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'validation/**/*.test.ts'],
  },
});
