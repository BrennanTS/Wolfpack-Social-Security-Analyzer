import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Recharts joins a tooltip's name and value with " : " unless told otherwise,
 * which renders as a space before the colon. It was fixed on one chart and
 * left wrong on six others, because nothing connected them.
 *
 * A chart may opt out only by rendering its own tooltip via `content=`, which
 * bypasses the separator entirely.
 */
const DIR = join(import.meta.dirname, '.');

describe('chart tooltips', () => {
  it('never leave Recharts to pick the name/value separator', () => {
    const offenders: string[] = [];

    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
      const src = readFileSync(join(DIR, file), 'utf8');
      // Each `<Tooltip …>` element, up to the token that closes its props.
      for (const match of src.matchAll(/<Tooltip\b[\s\S]*?\/>/g)) {
        const el = match[0];
        if (el.includes('separator=') || el.includes('content=')) continue;
        offenders.push(`${file}: ${el.split('\n')[0].trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
