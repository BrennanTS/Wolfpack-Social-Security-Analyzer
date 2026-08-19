import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { PdfRampBar } from './charts';

/** Every `fill` in a rendered element tree, in order. */
function fills(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(fills);
  const props = ((node as ReactElement).props ?? {}) as Record<string, unknown>;
  const own = typeof props.fill === 'string' ? [props.fill] : [];
  return [...own, ...fills(props.children)];
}

describe('PdfRampBar', () => {
  it('draws a ramp, not a block of one colour', () => {
    // The bar printed as flat gold between the words "Behind" and "Ahead" —
    // a key with a single colour on it, explaining nothing. react-pdf gives a
    // `View` no gradient, so the steps ARE the ramp, and nothing in a text
    // walk can see whether they are there.
    const drawn = fills(PdfRampBar({}));
    expect(drawn.length).toBeGreaterThan(8);
    expect(new Set(drawn).size).toBeGreaterThan(8);
  });

  it('runs from the pale end to the dark end', () => {
    const drawn = fills(PdfRampBar({}));
    expect(drawn[0]).not.toBe(drawn[drawn.length - 1]);
  });

  it('does not divide by zero on a single step', () => {
    expect(fills(PdfRampBar({ steps: 1 }))).toHaveLength(1);
  });
});
