/**
 * The engine's brand name must not reappear in the app's own source.
 *
 * This reads FILES, not rendered output, and that is the point. The sweep's
 * `names no calculation engine on the analysis surface` guard walks
 * `screenSurface`/`pdfSurface`, which model `methodologyCopy`'s computed
 * sentences and the two recommendation strings — nothing else. Sixteen of the
 * cleanup's replacement sites are plain JSX string literals, which no surface
 * model reaches, so eleven of them (including all three PDF sites) could be
 * restored individually with a fully green suite.
 *
 * The two guards are complementary and both are load-bearing. This one sees
 * every literal in the tree but cannot reason about a sentence assembled at
 * run time; the sweep runs real analyses and sees exactly those.
 *
 * Exemption is by PATH, never by an allowlist of permitted strings — an
 * allowlist would quietly bless a reintroduced parenthetical that happened to
 * match. `about.ts` and `resources.ts` need no exemption at all: they are
 * simply not in the scanned set.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Every component renders to screen or to PDF; none may name the engine. */
const SCANNED_DIRS = ['src/components'];

/**
 * The two `src/lib` modules that build rendered prose. `household.ts` composes
 * `recommendationDetail`, which lands on both surfaces; `formState.ts` builds
 * the input-summary line. Every other `src/lib` module either computes numbers
 * or is itself reference content.
 */
const SCANNED_FILES = ['src/lib/household.ts', 'src/lib/formState.ts', 'src/lib/ssaTools.ts'];

/**
 * The two panels whose entire purpose is naming the engine. Exempt by path:
 * anything they say is deliberate, and the alternative — listing the exact
 * sentences they are allowed to contain — would pass a parenthetical smuggled
 * in beside them.
 */
const EXEMPT_PATHS = new Set([
  'src/components/AboutPanel.tsx',
  'src/components/ResourcesPanel.tsx',
]);

const BRAND = /ssa\.tools/i;

function collect(dir: string, into: string[]) {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      collect(rel, into);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    // Two mock fixtures carry the pre-cleanup wording as opaque props that no
    // assertion reads. Those are test data, not rendered copy.
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    if (EXEMPT_PATHS.has(rel)) continue;
    into.push(rel);
  }
}

function scannedFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCANNED_DIRS) collect(dir, files);
  files.push(...SCANNED_FILES);
  return files.sort();
}

type Mode = 'code' | 'line' | 'block' | "'" | '"' | '`';

/**
 * Remove `//` and block comments, leaving string and template literals intact.
 *
 * Both halves matter. Source comments explaining why the app defers to the
 * engine were deliberately kept, so a raw grep is useless; and a line-oriented
 * stripper would eat `'https://ssa.tools/'` inside a string, hiding exactly
 * the regression this file exists to catch. Newlines inside comments are
 * preserved so reported line numbers stay true.
 */
export function stripComments(source: string): string {
  let out = '';
  let mode: Mode = 'code';

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];

    if (mode === 'code') {
      if (c === '/' && next === '/') {
        mode = 'line';
        i++;
      } else if (c === '/' && next === '*') {
        mode = 'block';
        i++;
      } else {
        if (c === "'" || c === '"' || c === '`') mode = c;
        out += c;
      }
    } else if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
        out += c;
      }
    } else if (mode === 'block') {
      if (c === '*' && next === '/') {
        mode = 'code';
        i++;
      } else if (c === '\n') {
        out += c;
      }
    } else if (c === '\\') {
      out += c;
      i++;
      if (i < source.length) out += source[i];
    } else if (c === mode) {
      mode = 'code';
      out += c;
    } else {
      out += c;
    }
  }

  return out;
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

function hits(file: string, source: string): Hit[] {
  return source
    .split('\n')
    .map((text, i) => ({ file, line: i + 1, text: text.trim() }))
    .filter((h) => BRAND.test(h.text));
}

describe('stripComments', () => {
  it('drops comments and keeps string literals', () => {
    const stripped = stripComments(
      [
        '// a comment naming ssa.tools',
        '/* a block',
        ' * also naming ssa.tools',
        ' */',
        "const href = 'https://ssa.tools/';",
        'const el = <a href="https://ssa.tools/">link</a>;',
        'const t = `an ssa.tools template`;',
        "const apostrophe = `you don't lose the rest`; // ssa.tools",
      ].join('\n'),
    );

    // Three survivors, one per literal — and the comment on the last line
    // goes even though an unbalanced apostrophe precedes it.
    expect(stripped.match(/ssa\.tools/g)).toHaveLength(3);
    expect(stripped).toContain("const href = 'https://ssa.tools/';");
    expect(stripped).toContain('href="https://ssa.tools/"');
    expect(stripped).toContain('`an ssa.tools template`');
    expect(stripped).not.toContain('a comment naming');
    expect(stripped).not.toContain('also naming');
  });

  it('preserves line numbers across a multi-line comment', () => {
    const stripped = stripComments('a\n/* x\n y */\nb');
    expect(stripped.split('\n')).toHaveLength(4);
    expect(stripped.split('\n')[3]).toBe('b');
  });

  // Positive controls against real files, not a hand-written fixture. Neither
  // is scanned, and both name the engine only in live code — `resources.ts` in
  // quoted strings including a URL, `ResourcesPanel.tsx` in JSX text. If the
  // stripper ever started eating either, these go quiet.
  it.each(['src/lib/resources.ts', 'src/components/ResourcesPanel.tsx'])(
    'leaves the engine name standing in %s, which states it outside comments',
    (file) => {
      const stripped = stripComments(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
      expect(BRAND.test(stripped)).toBe(true);
    },
  );
});

describe('the engine brand in app source', () => {
  it('scans the components tree and the two prose-building lib modules', () => {
    const files = scannedFiles();

    // A broken walk that silently returns nothing would make the assertion
    // below vacuous, so pin the shape of the set itself.
    expect(files.length).toBeGreaterThan(20);
    for (const expected of [
      'src/components/Analyzer.tsx',
      'src/components/AssumptionsPanel.tsx',
      'src/components/HouseholdPanel.tsx',
      'src/components/PersonPanel.tsx',
      'src/components/pdf/PersonSection.tsx',
      'src/components/pdf/HouseholdSection.tsx',
      'src/components/pdf/ReportDocument.tsx',
      'src/lib/household.ts',
      'src/lib/formState.ts',
    ]) {
      expect(files).toContain(expected);
    }
    expect(files).not.toContain('src/components/AboutPanel.tsx');
    expect(files).not.toContain('src/components/ResourcesPanel.tsx');
    expect(files.filter((f) => /\.test\.tsx?$/.test(f))).toEqual([]);
  });

  it('names the calculation engine nowhere outside About and Resources', () => {
    const found: string[] = [];

    for (const file of scannedFiles()) {
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      for (const hit of hits(file, stripComments(source))) {
        found.push(`${hit.file}:${hit.line}: ${hit.text}`);
      }
    }

    expect(found).toEqual([]);
  });

  // Independent of the lexer, by a different rule: shape of the line. If the
  // stripper ever mis-tracked a quote and swallowed live code, a mention would
  // vanish from the check above without anything failing. This catches that —
  // anything the stripper hides must sit on a line that reads as a comment.
  it('hides the engine name only where the line really is a comment', () => {
    const suspicious: string[] = [];

    for (const file of scannedFiles()) {
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const stripped = new Set(hits(file, stripComments(source)).map((h) => h.line));

      for (const hit of hits(file, source)) {
        if (stripped.has(hit.line)) continue;
        if (/^(\/\/|\/\*|\*)/.test(hit.text)) continue;
        suspicious.push(`${hit.file}:${hit.line}: ${hit.text}`);
      }
    }

    expect(suspicious).toEqual([]);
  });
});
