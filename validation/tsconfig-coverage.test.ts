/**
 * Does the type checker actually see the test files?
 *
 * `tsconfig.app.json` excludes `*.test.ts(x)` and `validation/` was in no
 * tsconfig at all, so for the life of this project no test file was
 * type-checked. Three hand-built `HouseholdAnalysis` fixtures reached `main`
 * missing required fields and failed at runtime; `swapped()` in the sweep
 * returned `{ people: [undefined, person] }` for a widowed household and
 * nothing noticed.
 *
 * `tsconfig.test.json` fixes that, and this asserts it stays fixed. A config
 * that silently stops matching the files it claims to cover looks exactly
 * like a config that covers them — the same shape as a sweep that models only
 * part of a surface.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Strips comments so `JSON.parse` can read a tsconfig. */
function readTsconfig(name: string): { include?: string[]; exclude?: string[] } {
  const raw = readFileSync(path.join(root, name), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, ''));
}

/** Every file under `dir` matching `test`, relative to the repo root. */
function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, match, out);
    else if (match(entry.name)) out.push(rel);
  }
  return out;
}

describe('the type checker sees the tests', () => {
  it('is referenced from the root config, so `tsc -b` builds it', () => {
    const rootConfig = readTsconfig('tsconfig.json') as { references?: { path: string }[] };
    expect(rootConfig.references?.map((r) => r.path)).toContain('./tsconfig.test.json');
  });

  it('covers every test file under src', () => {
    const patterns = readTsconfig('tsconfig.test.json').include ?? [];
    const tests = walk('src', (f) => f.endsWith('.test.ts') || f.endsWith('.test.tsx'));
    expect(tests.length).toBeGreaterThan(20);

    // `src/**/*.test.ts` and `src/**/*.test.tsx` between them.
    for (const file of tests) {
      const covered = patterns.some((p) => {
        if (p === 'src/**/*.test.ts') return file.endsWith('.test.ts');
        if (p === 'src/**/*.test.tsx') return file.endsWith('.test.tsx');
        return false;
      });
      expect(covered, `${file} is not covered by tsconfig.test.json`).toBe(true);
    }
  });

  it('covers the validation tree, sweeps and golden fixtures included', () => {
    const patterns = readTsconfig('tsconfig.test.json').include ?? [];
    expect(patterns).toContain('validation/**/*.ts');

    const files = walk('validation', (f) => f.endsWith('.ts'));
    // The sweeps, the golden suite, the e2e specs and their helpers.
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.startsWith('validation/sweep/'))).toBe(true);
    expect(files.some((f) => f.startsWith('validation/e2e/'))).toBe(true);
  });

  it('leaves the app config excluding tests, so the two do not overlap', () => {
    // Not tidiness: the app project has `noUnusedLocals` on and the test one
    // has it off, and a file in both would be checked twice under different
    // rules.
    const app = readTsconfig('tsconfig.app.json');
    expect(app.exclude).toEqual(['src/**/*.test.ts', 'src/**/*.test.tsx']);
  });
});
