import { describe, expect, it } from 'vitest';
import { toNominal, toNominalAmount } from './dollarsMode';
import type { CombinedTimelinePoint } from './household';

const point = (year: number, total: number): CombinedTimelinePoint => ({
  year,
  bySeries: { 'a:personal': total },
  byPersonId: { a: total },
  total,
});

describe('toNominal', () => {
  it('leaves the base year untouched', () => {
    const out = toNominal([point(2026, 1000)], 2.5, 2026);
    expect(out[0].total).toBeCloseTo(1000, 2);
  });

  it('compounds the COLA forward', () => {
    // Ten years at 2.5%: 1000 * 1.025^10 = 1280.08.
    const out = toNominal([point(2036, 1000)], 2.5, 2026);
    expect(out[0].total).toBeCloseTo(1280.08, 1);
  });

  it('is the identity at a zero COLA', () => {
    const input = [point(2026, 1000), point(2046, 2000)];
    expect(toNominal(input, 0, 2026)).toEqual(input);
  });

  it('scales every series, not just the total', () => {
    const out = toNominal([point(2036, 1000)], 2.5, 2026);
    expect(out[0].bySeries['a:personal']).toBeCloseTo(1280.08, 1);
    expect(out[0].byPersonId.a).toBeCloseTo(1280.08, 1);
  });
});

describe('toNominalAmount', () => {
  it('agrees with toNominal for the same scalar wrapped as a one-point timeline', () => {
    const viaTimeline = toNominal([point(2036, 1000)], 2.5, 2026)[0].total;
    expect(toNominalAmount(1000, 2.5, 2026, 2036)).toBeCloseTo(viaTimeline, 6);
  });

  it('is the identity at a zero COLA', () => {
    expect(toNominalAmount(1000, 0, 2026, 2046)).toBe(1000);
  });
});
