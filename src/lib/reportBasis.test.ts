import { describe, expect, it } from 'vitest';
import { basisOf, settingsForBasis } from './reportBasis';
import { DEFAULT_DISCOUNT_RATE } from './ssaTools';

describe('basisOf', () => {
  it('names the two bases the report describes itself as', () => {
    expect(basisOf({ dollarsMode: 'real', discountRate: 0.025 })).toBe('present');
    expect(basisOf({ dollarsMode: 'nominal', discountRate: 0 })).toBe('future');
  });

  it('calls anything else custom rather than picking the nearer one', () => {
    // Nominal cash flows at a nominal discount rate is the textbook-correct
    // pairing and is neither preset. Real-and-undiscounted is a straight sum
    // of today's-dollar payments, also neither. A control showing one of the
    // two lit while the report is in a third state is the failure here.
    expect(basisOf({ dollarsMode: 'nominal', discountRate: 0.025 })).toBe('custom');
    expect(basisOf({ dollarsMode: 'real', discountRate: 0 })).toBe('custom');
  });

  it('holds any rate above zero to be present value', () => {
    // 4% in real dollars is still today's money. The basis is about which
    // question the figure answers, not about a particular rate.
    expect(basisOf({ dollarsMode: 'real', discountRate: 0.04 })).toBe('present');
  });
});

describe('settingsForBasis', () => {
  it('zeroes the discount for future value', () => {
    expect(settingsForBasis('future', { dollarsMode: 'real', discountRate: 0.025 })).toEqual({
      dollarsMode: 'nominal',
      discountRate: 0,
    });
  });

  it('keeps a rate the adviser chose', () => {
    // Snapping 4% back to the default would silently discard a deliberate
    // assumption — and one that changes which filing ages are recommended.
    expect(settingsForBasis('present', { dollarsMode: 'nominal', discountRate: 0.04 })).toEqual({
      dollarsMode: 'real',
      discountRate: 0.04,
    });
  });

  it('supplies a rate only when there is none', () => {
    expect(settingsForBasis('present', { dollarsMode: 'nominal', discountRate: 0 })).toEqual({
      dollarsMode: 'real',
      discountRate: DEFAULT_DISCOUNT_RATE,
    });
  });

  it('round-trips: applying a basis makes `basisOf` report it', () => {
    for (const basis of ['present', 'future'] as const) {
      for (const current of [
        { dollarsMode: 'real' as const, discountRate: 0.025 },
        { dollarsMode: 'nominal' as const, discountRate: 0 },
        { dollarsMode: 'nominal' as const, discountRate: 0.04 },
      ]) {
        expect(basisOf(settingsForBasis(basis, current))).toBe(basis);
      }
    }
  });
});
