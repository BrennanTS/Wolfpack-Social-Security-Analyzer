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

/** The tables start at the earliest claiming age; younger lookups clamp here. */
const MIN_TABLE_AGE = 62;

function lookupRemaining(age: number, gender: Gender): number {
  const table = gender === 'male' ? MALE_REMAINING : FEMALE_REMAINING;
  const clamped = Math.max(MIN_TABLE_AGE, Math.min(95, Math.round(age)));
  return table[clamped] ?? (gender === 'male' ? 10 : 12);
}

/**
 * Suggested plan-to age using SSA period life expectancy at current age.
 *
 * Below 62 the lookup is clamped to the age-62 row, but the remaining years
 * it returns were being added to the person's *actual* age — projecting a
 * 45-year-old man to age 65 and a 40-year-old to 60, i.e. death at or before
 * the earliest claiming age. That is reachable: the form accepts birth years
 * back to age 18, and wide age gaps are a headline use case (person B's life
 * expectancy is derived from this function with no control of its own, and
 * it is printed in the client PDF).
 *
 * Rule: the age-62 projection (62 + remaining years at 62) is a floor.
 *
 * Rationale — this tool only ever answers "when should you claim?", a
 * question that presupposes reaching 62. SSA's e(x) is a *conditional*
 * expectation, so 62 + e(62) is exactly the expected age at death of someone
 * who reaches the claiming window. A younger person's unconditional
 * expectation sits lower only because some of them die before claiming,
 * which is not the branch being planned for. Expressing it as a floor rather
 * than a replacement keeps the result non-decreasing in age and can never
 * pull down a projection that came from a real in-table row.
 */
export function getSuggestedLifeExpectancy(currentAgeYears: number, gender: Gender): number {
  const projected = Math.round(currentAgeYears + lookupRemaining(currentAgeYears, gender));
  const floorAtClaimingAge = Math.round(
    MIN_TABLE_AGE + lookupRemaining(MIN_TABLE_AGE, gender),
  );
  return Math.max(projected, floorAtClaimingAge);
}

export function genderLabel(gender: Gender): string {
  return gender === 'male' ? 'Male' : 'Female';
}
