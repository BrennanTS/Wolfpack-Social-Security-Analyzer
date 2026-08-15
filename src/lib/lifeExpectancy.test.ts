import { describe, expect, it } from 'vitest';
import { genderLabel, getSuggestedLifeExpectancy } from './lifeExpectancy';

describe('getSuggestedLifeExpectancy', () => {
  it('adds SSA remaining years to the current age', () => {
    // Male at 62 has 20.4 remaining years -> 82.4, rounded to 82.
    expect(getSuggestedLifeExpectancy(62, 'male')).toBe(82);
    // Female at 62 has 22.8 remaining -> 84.8, rounded to 85.
    expect(getSuggestedLifeExpectancy(62, 'female')).toBe(85);
  });

  it('projects longer lives for women at the same age', () => {
    for (const age of [62, 70, 80]) {
      expect(getSuggestedLifeExpectancy(age, 'female')).toBeGreaterThan(
        getSuggestedLifeExpectancy(age, 'male'),
      );
    }
  });

  it('clamps only the table lookup, not the age added to it', () => {
    // Below 62: the table lookup clamps to age 62's rate (20.4), but that rate
    // is added to the real (unclamped) age of 40, not to 62.
    // 40 + 20.4 = 60.4 -> rounds to 60, not getSuggestedLifeExpectancy(62, 'male') (82).
    expect(getSuggestedLifeExpectancy(40, 'male')).toBe(60);
    // Above 95: same story. The lookup clamps to age 95's rate (2.8), added to
    // the real age of 120: 120 + 2.8 = 122.8 -> 123. That happens to equal
    // getSuggestedLifeExpectancy(95, 'male') + 25 because 95 + 2.8 = 97.8 -> 98,
    // and 98 + 25 = 123 too -- a coincidence of the rounding, not clamping of the age.
    expect(getSuggestedLifeExpectancy(120, 'male')).toBe(
      getSuggestedLifeExpectancy(95, 'male') + 25,
    );
  });
});

describe('genderLabel', () => {
  it('capitalizes for display', () => {
    expect(genderLabel('male')).toBe('Male');
    expect(genderLabel('female')).toBe('Female');
  });
});
