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

  it('never projects someone under 62 to die before the age-62 projection', () => {
    // The table starts at 62, so a younger lookup clamps to the age-62 row.
    // Adding that row's *remaining* years to the person's actual age used to
    // project a 45-year-old man to 65 and a 40-year-old to 60 — death at or
    // before the earliest claiming age. The age-62 projection is the floor.
    for (const age of [18, 30, 40, 45, 55, 61]) {
      expect(getSuggestedLifeExpectancy(age, 'male')).toBe(82);
      expect(getSuggestedLifeExpectancy(age, 'female')).toBe(85);
    }
  });

  it('never decreases as the person gets older', () => {
    for (const gender of ['male', 'female'] as const) {
      for (let age = 18; age < 100; age++) {
        expect(getSuggestedLifeExpectancy(age + 1, gender)).toBeGreaterThanOrEqual(
          getSuggestedLifeExpectancy(age, gender),
        );
      }
    }
  });

  it('leaves in-table ages untouched — the floor never pulls a projection down', () => {
    // 70 + 14.4 = 84.4 -> 84 for a man; 70 + 16.4 = 86.4 -> 86 for a woman.
    expect(getSuggestedLifeExpectancy(70, 'male')).toBe(84);
    expect(getSuggestedLifeExpectancy(70, 'female')).toBe(86);
  });

  it('still adds the age-95 rate to the real age above the top of the table', () => {
    // Above 95 the lookup clamps to age 95's remaining (2.8 for a man), added
    // to the real age: 120 + 2.8 = 122.8 -> 123. The age-62 floor is
    // irrelevant here, which is the point of applying it as a floor.
    expect(getSuggestedLifeExpectancy(120, 'male')).toBe(123);
  });
});

describe('genderLabel', () => {
  it('capitalizes for display', () => {
    expect(genderLabel('male')).toBe('Male');
    expect(genderLabel('female')).toBe('Female');
  });
});
