import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two defects this app shipped, both because nothing tied the charts together.
 *
 * `separator` — Recharts joins a row's name and value with " : " unless told
 * otherwise, a space before the colon. Fixed on one chart, left wrong on six.
 *
 * `itemStyle` — Recharts paints each row in its SERIES colour, and against
 * this app's near-black tooltip most of those score under 3:1: `CHART_INK`
 * managed 1.6:1, so the figures were simply invisible.
 *
 * A chart opts out of both only by rendering its own tooltip via `content=`.
 */
const DIR = join(import.meta.dirname, '.');

describe('chart tooltips', () => {
  it('never leave Recharts to pick the separator or the text colour', () => {
    const offenders: string[] = [];

    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
      const src = readFileSync(join(DIR, file), 'utf8');
      // Each `<Tooltip …>` element, up to the token that closes its props.
      for (const match of src.matchAll(/<Tooltip\b[\s\S]*?\/>/g)) {
        const el = match[0];
        if (el.includes('content=')) continue;
        const missing = (['separator=', 'itemStyle=', 'labelStyle='] as const).filter(
          (prop) => !el.includes(prop),
        );
        if (missing.length === 0) continue;
        offenders.push(`${file}: <Tooltip> missing ${missing.join(', ')}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
