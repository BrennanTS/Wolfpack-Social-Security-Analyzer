import { describe, expect, it } from 'vitest';
import { detectYearlyEntry } from './benefitEntry';

describe('detectYearlyEntry', () => {
  it('flags a plain yearly figure and suggests the monthly equivalent', () => {
    expect(detectYearlyEntry(36_000)).toEqual({ entered: 36_000, monthly: 3000 });
  });

  // Whole dollars, not cents: the nudge button is labelled with the
  // zero-decimal `formatCurrency`, so a cent-precise suggestion made the
  // control read "Use $2,583/month" while entering 2583.33. The benefit field
  // is digits-only by construction too, so cents could only ever get in
  // through this button.
  it('rounds a figure that does not divide evenly to a whole dollar', () => {
    // 31,000 / 12 = 2,583.33...
    expect(detectYearlyEntry(31_000)?.monthly).toBe(2583);
  });

  it('rounds up when the remainder warrants it', () => {
    // 31,400 / 12 = 2,616.67 -> 2,617
    expect(detectYearlyEntry(31_400)?.monthly).toBe(2617);
  });

  it('always suggests a whole number of dollars', () => {
    for (const entered of [31_000, 31_400, 5001, 5555, 47_999, 60_000]) {
      const monthly = detectYearlyEntry(entered)?.monthly;
      expect(monthly).toBeDefined();
      expect(Number.isInteger(monthly)).toBe(true);
    }
  });

  it('says nothing about a plausible monthly benefit', () => {
    expect(detectYearlyEntry(3000)).toBeNull();
    expect(detectYearlyEntry(4800)).toBeNull();
    expect(detectYearlyEntry(5000)).toBeNull();
  });

  it('says nothing about zero', () => {
    expect(detectYearlyEntry(0)).toBeNull();
  });

  it('says nothing when the monthly equivalent is also implausible', () => {
    // 999,999 / 12 = 83,333 — still far above the ceiling, so there is no
    // useful suggestion to offer. Out of range, but not a yearly-entry error.
    expect(detectYearlyEntry(999_999)).toBeNull();
  });

  it('flags when the monthly equivalent is plausible even if barely', () => {
    // 5,001 is barely over the ceiling; 5,001/12 = 416.75 -> $417 is
    // plausible, so this IS flagged. Documented deliberately: a near-ceiling
    // typo is rare, and a dismissible suggestion costs the user nothing.
    expect(detectYearlyEntry(5001)?.monthly).toBe(417);
  });

  it('ignores non-finite input', () => {
    expect(detectYearlyEntry(Number.NaN)).toBeNull();
  });
});
