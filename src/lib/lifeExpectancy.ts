/** SSA 2021 Period Life Table — remaining years of life at exact age. Source: ssa.gov/oact/STATS/table4c6.html */

export type Gender = 'male' | 'female';

const MALE_REMAINING: Record<number, number> = {
  62: 20.4, 63: 19.7, 64: 18.9, 65: 18.1, 66: 17.4, 67: 16.6, 68: 15.9, 69: 15.1, 70: 14.4,
  71: 13.7, 72: 13.0, 73: 12.3, 74: 11.6, 75: 10.9, 76: 10.3, 77: 9.7, 78: 9.1, 79: 8.5,
  80: 8.0, 81: 7.5, 82: 7.0, 83: 6.5, 84: 6.1, 85: 5.7, 86: 5.3, 87: 4.9, 88: 4.6, 89: 4.3,
  90: 4.0, 91: 3.7, 92: 3.5, 93: 3.2, 94: 3.0, 95: 2.8,
};

const FEMALE_REMAINING: Record<number, number> = {
  62: 22.8, 63: 22.0, 64: 21.2, 65: 20.4, 66: 19.6, 67: 18.8, 68: 18.0, 69: 17.2, 70: 16.4,
  71: 15.7, 72: 14.9, 73: 14.2, 74: 13.5, 75: 12.8, 76: 12.1, 77: 11.4, 78: 10.8, 79: 10.2,
  80: 9.6, 81: 9.0, 82: 8.5, 83: 8.0, 84: 7.5, 85: 7.0, 86: 6.6, 87: 6.2, 88: 5.8, 89: 5.4,
  90: 5.1, 91: 4.8, 92: 4.5, 93: 4.2, 94: 4.0, 95: 3.7,
};

export const SSA_LIFE_TABLE_URL =
  'https://www.ssa.gov/oact/STATS/table4c6.html';

function lookupRemaining(age: number, gender: Gender): number {
  const table = gender === 'male' ? MALE_REMAINING : FEMALE_REMAINING;
  const clamped = Math.max(62, Math.min(95, Math.round(age)));
  return table[clamped] ?? (gender === 'male' ? 10 : 12);
}

/** Suggested plan-to age using SSA period life expectancy at current age. */
export function getSuggestedLifeExpectancy(currentAgeYears: number, gender: Gender): number {
  const remaining = lookupRemaining(currentAgeYears, gender);
  return Math.round(currentAgeYears + remaining);
}

export function genderLabel(gender: Gender): string {
  return gender === 'male' ? 'Male' : 'Female';
}
