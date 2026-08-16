import { describe, expect, it } from 'vitest';
import { detectYearlyEntry } from './benefitEntry';

describe('detectYearlyEntry', () => {
  it('flags a plain yearly figure and suggests the monthly equivalent', () => {
    expect(detectYearlyEntry(36_000)).toEqual({ entered: 36_000, monthly: 3000 });
  });

  it('flags a yearly figure that divides to a non-round monthly amount', () => {
    // 30,000 / 12 = 2,500 exactly; 31,000 / 12 = 2,583.33 -> rounded to the cent.
    expect(detectYearlyEntry(31_000)?.monthly).toBeCloseTo(2583.33, 2);
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
    // 5,001 is barely over the ceiling; 5,001/12 = 416.75 is plausible, so this
    // IS flagged. Documented deliberately: a near-ceiling typo is rare, and a
    // dismissible suggestion costs the user nothing.
    expect(detectYearlyEntry(5001)).not.toBeNull();
  });

  it('ignores non-finite input', () => {
    expect(detectYearlyEntry(Number.NaN)).toBeNull();
  });
});
