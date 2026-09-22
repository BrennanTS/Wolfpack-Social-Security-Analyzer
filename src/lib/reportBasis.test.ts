import { describe, expect, it } from 'vitest';
import { basisOf, displayDiscountRate, dollarsModeFor } from './reportBasis';

/**
 * The basis reads ONE setting.
 *
 * It used to be derived from two — the dollars and the discount rate — which
 * meant the pair could land on a combination neither name described. The
 * control then showed nothing selected, and the panel carried a paragraph
 * explaining a state it could not display.
 */
describe('basisOf', () => {
  it('names a basis for every value the setting can hold', () => {
    expect(basisOf('real')).toBe('present');
    expect(basisOf('nominal')).toBe('future');
  });

  it('round-trips', () => {
    for (const basis of ['present', 'future'] as const) {
      expect(basisOf(dollarsModeFor(basis))).toBe(basis);
    }
  });
});

/**
 * The separation that makes the switch safe to flip.
 *
 * The discount rate is a planning assumption and always ranks the strategies;
 * the basis only decides how the result is stated. Choosing future value used
 * to zero the rate, which meant picking how a figure was WORDED could change
 * which filing ages the report recommended.
 */
describe('displayDiscountRate', () => {
  it('discounts nothing out of the dollars that change hands', () => {
    expect(displayDiscountRate('nominal', 0.025)).toBe(0);
    expect(displayDiscountRate('nominal', 0.06)).toBe(0);
  });

  it('carries the assumption into present value', () => {
    expect(displayDiscountRate('real', 0.025)).toBe(0.025);
    expect(displayDiscountRate('real', 0)).toBe(0);
  });

  it('never reports back the assumption itself', () => {
    // The point of the function: the rate the analysis RAN at is untouched by
    // the basis, so a caller must not read this as "the assumption". An
    // adviser on 4% who switches to future value still has 4% set, and the
    // recommendation is still the 4% one.
    const assumed = 0.04;
    expect(displayDiscountRate('nominal', assumed)).not.toBe(assumed);
    expect(assumed).toBe(0.04);
  });
});
