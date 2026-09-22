import { describe, expect, it } from 'vitest';
import { leadMargin, MATERIAL_MARGIN } from './materiality';
import { MATERIAL_MARGIN as FROM_LONGEVITY } from './longevity';

describe('MATERIAL_MARGIN', () => {
  it('is half a percent, and is one number for both pages', () => {
    // The reduction page and the longevity page both answer "does the answer
    // change". Two constants at the same value would drift apart the first
    // time either page was tuned, and a client reading both would get two
    // different standards of evidence without being told.
    expect(MATERIAL_MARGIN).toBe(0.005);
    expect(FROM_LONGEVITY).toBe(MATERIAL_MARGIN);
  });
});

describe('leadMargin', () => {
  it('measures the leader’s lead as a share of the leader', () => {
    expect(leadMargin([100, 90])).toBeCloseTo(0.1, 10);
    // The case this was written for: $3,046 ahead on $626,949.
    expect(leadMargin([626_949, 623_903, 622_498, 608_620])).toBeCloseTo(0.004858, 6);
    expect(leadMargin([626_949, 623_903, 622_498, 608_620])).toBeLessThan(MATERIAL_MARGIN);
  });

  it('does not care which order the values arrive in', () => {
    expect(leadMargin([608_620, 626_949, 622_498, 623_903])).toBeCloseTo(
      leadMargin([626_949, 623_903, 622_498, 608_620]),
      12,
    );
  });

  it('calls a tie immaterial rather than dividing by it', () => {
    expect(leadMargin([500, 500])).toBe(0);
    // A non-positive leader is not a base to take a proportion of. Zero reads
    // as "not ahead by a meaningful amount", which is the safe answer.
    expect(leadMargin([0, 0])).toBe(0);
    expect(leadMargin([-10, -20])).toBe(0);
  });

  it('treats a single value as infinitely ahead, having nothing to beat', () => {
    expect(leadMargin([100])).toBe(Infinity);
    expect(leadMargin([])).toBe(Infinity);
  });
});
