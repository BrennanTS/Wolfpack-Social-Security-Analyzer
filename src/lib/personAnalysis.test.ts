import { describe, expect, it } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import { formatFilingAge } from './ssaTools';
import {
  analyzePerson,
  getCurrentAge,
  getFullRetirementAge,
  type Person,
} from './personAnalysis';

const dan: Person = {
  id: 'a',
  name: 'Dan',
  birthYear: 1962,
  birthMonth: 4,
  gender: 'male',
  piaMonthly: 2400,
  lifeExpectancy: 85,
};

const asOf = new Date(2026, 0, 15);
const at70 = formatFilingAge(MonthDuration.initFromYearsMonths({ years: 70, months: 0 }));

describe('getFullRetirementAge', () => {
  it('matches the SSA schedule', () => {
    expect(getFullRetirementAge(1954)).toMatchObject({ years: 66, months: 0 });
    expect(getFullRetirementAge(1957)).toMatchObject({ years: 66, months: 6 });
    expect(getFullRetirementAge(1960)).toMatchObject({ years: 67, months: 0 });
  });
});

describe('getCurrentAge', () => {
  it('computes years and months against a reference date', () => {
    expect(getCurrentAge(1960, 6, new Date(2026, 5, 15))).toEqual({ years: 66, months: 0 });
    expect(getCurrentAge(1960, 1, new Date(2026, 5, 15))).toEqual({ years: 66, months: 5 });
  });

  it('never returns negatives for a future birth date', () => {
    expect(getCurrentAge(2030, 1, new Date(2026, 0, 1))).toEqual({ years: 0, months: 0 });
  });
});

describe('analyzePerson', () => {
  it('produces one claiming option per age from 62 through 70', () => {
    const a = analyzePerson(dan, at70, 2.5, asOf);
    expect(a.claimingOptions.map((o) => o.age)).toEqual([62, 63, 64, 65, 66, 67, 68, 69, 70]);
  });

  it('applies the SSA reduction and delayed credits around FRA 67', () => {
    const a = analyzePerson(dan, at70, 2.5, asOf);
    const at62 = a.claimingOptions.find((o) => o.age === 62)!;
    const atSeventy = a.claimingOptions.find((o) => o.age === 70)!;
    expect(at62.percentOfPia).toBeCloseTo(70, 1);
    expect(atSeventy.percentOfPia).toBeCloseTo(124, 1);
    expect(at62.monthlyBenefit).toBeCloseTo(1680, 0); // 2400 * 0.70
  });

  it('increases monthly benefit monotonically with claim age', () => {
    const monthlies = analyzePerson(dan, at70, 2.5, asOf).claimingOptions.map(
      (o) => o.monthlyBenefit,
    );
    for (let i = 1; i < monthlies.length; i++) {
      expect(monthlies[i]).toBeGreaterThan(monthlies[i - 1]);
    }
  });

  it('carries the supplied filing age through as the recommendation', () => {
    const a = analyzePerson(dan, at70, 2.5, asOf);
    expect(a.recommendedFilingAge.years).toBe(70);
    expect(a.recommendedMonthly).toBeCloseTo(2976, 0); // 2400 * 1.24
  });
});
