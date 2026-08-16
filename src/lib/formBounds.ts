/**
 * Every field's valid range, in one place.
 *
 * The URL parser, the form's own validation and the assumption sliders all
 * read from here. Duplicating a bound is how a link ends up carrying a value
 * a slider cannot represent, or a field marking something invalid that the
 * submission gate happily accepts — both of which this app has had before.
 *
 * Both people share the benefit range. The primary person used to have a $500
 * floor, which caught values that were too *low* while the realistic
 * data-entry error (typing a yearly figure) makes the number too *high*. It
 * blocked nothing real and rejected genuine low-earner PIAs.
 *
 * $5,000 is a tripwire, not a wall: it sits above the maximum PIA attainable
 * at full retirement age today, and SSA's maximum rises each year. When this
 * needs raising, `formBounds.test.ts` is where it is written down.
 */

export const MIN_BENEFIT = 0;
export const MAX_BENEFIT = 5000;

export const LIFE_EXPECTANCY_BOUNDS = { min: 75, max: 100 } as const;

/**
 * UNITS — these two differ, and getting it wrong is silent.
 *
 * `annualCola` is stored as a percent (2.5 means 2.5%), and its slider binds
 * to it directly.
 *
 * `discountRate` is stored as a FRACTION (0.025 means 2.5%). Its slider works
 * in percent and converts on both sides: `value={discountRate * 100}` and
 * `onChange={... / 100}` in AssumptionsPanel.
 *
 * DISCOUNT_BOUNDS_PERCENT is therefore expressed in PERCENT, to match the slider.
 * Anything validating `form.discountRate` against it must multiply by 100
 * first — comparing the raw fraction would accept 5.0, i.e. a 500% rate.
 */
export const COLA_BOUNDS = { min: 0, max: 8, step: 0.1 } as const;
export const DISCOUNT_BOUNDS_PERCENT = { min: 0, max: 6, step: 0.1 } as const;

export function isInBounds(value: number, bounds: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}

export function isBenefitInRange(benefit: number): boolean {
  return isInBounds(benefit, { min: MIN_BENEFIT, max: MAX_BENEFIT });
}

/** Takes the stored fraction (0.025), not the slider's percent. */
export function isDiscountRateInBounds(fraction: number): boolean {
  return isInBounds(fraction * 100, DISCOUNT_BOUNDS_PERCENT);
}
