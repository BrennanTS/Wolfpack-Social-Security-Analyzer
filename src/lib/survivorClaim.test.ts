import { describe, expect, it } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import { createPiaRecipient } from './ssaTools';
import { householdPeriods } from './benefitPeriods';
import { survivorClaimAlternative } from './survivorClaim';
import type { Person } from './personAnalysis';

const age = (years: number, months = 0) => MonthDuration.initFromYearsMonths({ years, months });

const person = (
  id: 'a' | 'b',
  birthYear: number,
  birthMonth: number,
  pia: number,
  gender: 'male' | 'female',
  lifeExpectancy: number,
): Person => ({ id, birthYear, birthMonth, gender, piaMonthly: pia, lifeExpectancy });

const recipientFor = (p: Person) =>
  createPiaRecipient(p.birthYear, p.birthMonth, p.piaMonthly, p.gender);

/**
 * An older higher earner with a much younger spouse — the shape the engine's
 * survivor-start rule mishandles, and the one the impact measurement found
 * the false $0 in. Dan dies at 78 (Feb 2036); Sarah is 67 then but does not
 * file until 70 under a delay strategy, so the engine pays her nothing for
 * those years.
 */
const dan = person('a', 1958, 2, 2400, 'male', 78);
const sarah = person('b', 1968, 5, 1200, 'female', 90);

function run(filingAges: [MonthDuration, MonthDuration]) {
  const people = [dan, sarah];
  const recipients = people.map(recipientFor);
  const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
    people,
    recipients,
    filingAges,
    ['Dan', 'Sarah'],
  );
  return survivorClaimAlternative(
    people,
    recipients,
    filingAges,
    bands,
    finalIndexByPersonId,
    survivorGap,
    ['Dan', 'Sarah'],
  );
}

describe('survivorClaimAlternative', () => {
  it('finds a gain when the survivor files long after the first death', () => {
    const result = run([age(70), age(70)]);
    expect(result).not.toBeNull();
    expect(result!.gain).toBeGreaterThan(0);
    expect(result!.bestTotal).toBe(result!.baselineTotal + result!.gain);
    expect(result!.survivorLabel).toBe('Sarah');
  });

  it('never claims before the death or before SSA age 60', () => {
    const result = run([age(70), age(70)])!;
    // Dan dies Feb 2036; Sarah reaches SSA age 60 in May 2028. The death is
    // later, so the floor here is the death month + 1.
    const deathIndex = 2036 * 12 + 1; // Feb 2036
    expect(result.claimIndex).toBeGreaterThan(deathIndex);
  });

  it('returns null for a single claimant', () => {
    const recipients = [recipientFor(dan)];
    const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
      [dan],
      recipients,
      [age(67)],
      ['Dan'],
    );
    expect(
      survivorClaimAlternative(
        [dan],
        recipients,
        [age(67)],
        bands,
        finalIndexByPersonId,
        survivorGap,
        ['Dan'],
      ),
    ).toBeNull();
  });

  it('pins the headline household, hand-derived', () => {
    const result = run([age(70), age(70)])!;
    // Dan files at 70 (Feb 2028) and dies Feb 2036, so the survivor base is
    // max(0.825 x 2400, his own $3,040) = $3,040. Sarah's survivor-FRA is 67
    // (May 2035), already past when Dan dies, so there is no reduction at any
    // claim month in range and the best month is the earliest: Mar 2036.
    // The engine instead starts her survivor benefit at her own filing date,
    // May 2038 — 26 months later. 26 x $3,040 = $79,040.
    expect(result.claimIndex).toBe(2036 * 12 + 2); // Mar 2036
    expect(result.claimAge).toBe('67 years, 10 months');
    expect(result.baselineTotal).toBe(732640); // 241 months x $3,040
    expect(result.bestTotal).toBe(811680); // 267 months x $3,040
    expect(result.gain).toBe(79040);
  });

  it('searches the whole range up to survivor-FRA when the survivor is under 60 at the death', () => {
    // A 20-year age gap: Sarah reaches SSA age 60 in May 2038, after Dan's
    // Feb 2036 death, and her survivor-FRA is May 2045. So the floor is the
    // age-60 month, not the death, and the ceiling is 84 months above it —
    // the range in which the 71.5%-to-100% reduction is actually live.
    const younger = person('b', 1978, 5, 1200, 'female', 90);
    const people = [dan, younger];
    const recipients = people.map(recipientFor);
    const filingAges = [age(70), age(70)];
    const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
      people,
      recipients,
      filingAges,
      ['Dan', 'Sarah'],
    );
    const result = survivorClaimAlternative(
      people,
      recipients,
      filingAges,
      bands,
      finalIndexByPersonId,
      survivorGap,
      ['Dan', 'Sarah'],
    )!;
    expect(result).not.toBeNull();
    expect(result.claimIndex).toBeGreaterThanOrEqual(2038 * 12 + 4); // SSA age 60
    expect(result.claimIndex).toBeLessThanOrEqual(2045 * 12 + 4); // survivor-FRA
    expect(result.gain).toBeGreaterThan(0);
  });

  it('returns null on an exact tie in the two plan-to months', () => {
    // Same birth month and same plan-to age: neither person is established as
    // the survivor, so `firstDeath` declines to pick one.
    const twinA = person('a', 1958, 2, 2400, 'male', 85);
    const twinB = person('b', 1958, 2, 1200, 'female', 85);
    const people = [twinA, twinB];
    const recipients = people.map(recipientFor);
    const filingAges = [age(70), age(70)];
    const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
      people,
      recipients,
      filingAges,
      ['A', 'B'],
    );
    expect(
      survivorClaimAlternative(
        people,
        recipients,
        filingAges,
        bands,
        finalIndexByPersonId,
        survivorGap,
        ['A', 'B'],
      ),
    ).toBeNull();
  });

  it('returns null when the survivor already claims early enough to gain nothing', () => {
    // Sarah files at 62y1m, well before Dan's death, so the engine already
    // starts her survivor benefit at the death and there is nothing to move.
    expect(run([age(70), age(62, 1)])).toBeNull();
  });
});
