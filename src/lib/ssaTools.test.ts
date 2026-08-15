import { describe, expect, it } from 'vitest';
import {
  createPiaRecipient,
  fraFromBirthYear,
  isSsaClaimAgeEligible,
  monthDateFrom,
  nearestWholeClaimAge,
  spousalBenefitAtFra,
  ssaMonthlyBenefitAtAge,
} from './ssaTools';

describe('fraFromBirthYear (SSA full retirement age schedule)', () => {
  it('returns 66y for 1954 and earlier', () => {
    expect(fraFromBirthYear(1954)).toMatchObject({ years: 66, months: 0 });
  });

  it('adds two months per year for 1955–1959', () => {
    expect(fraFromBirthYear(1955)).toMatchObject({ years: 66, months: 2 });
    expect(fraFromBirthYear(1957)).toMatchObject({ years: 66, months: 6 });
    expect(fraFromBirthYear(1959)).toMatchObject({ years: 66, months: 10 });
  });

  it('returns 67y for 1960 and later', () => {
    expect(fraFromBirthYear(1960)).toMatchObject({ years: 67, months: 0 });
    expect(fraFromBirthYear(1975)).toMatchObject({ years: 67, months: 0 });
  });
});

describe('ssaMonthlyBenefitAtAge (reduction / delayed credits)', () => {
  // PIA of $2,500 with FRA 67 (born 1960) gives clean reference percentages.
  const recipient = createPiaRecipient(1960, 6, 2500, 'female');

  it('pays 100% of PIA at full retirement age', () => {
    const { benefit, percentOfPia } = ssaMonthlyBenefitAtAge(recipient, 67);
    expect(percentOfPia).toBeCloseTo(100, 1);
    expect(benefit).toBeCloseTo(2500, 0);
  });

  it('reduces to 70% of PIA at age 62 (5 years early)', () => {
    const { benefit, percentOfPia } = ssaMonthlyBenefitAtAge(recipient, 62);
    expect(percentOfPia).toBeCloseTo(70, 1);
    expect(benefit).toBeCloseTo(1750, 0);
  });

  it('grows to 124% of PIA at age 70 (3 years of delayed credits)', () => {
    const { benefit, percentOfPia } = ssaMonthlyBenefitAtAge(recipient, 70);
    expect(percentOfPia).toBeCloseTo(124, 1);
    expect(benefit).toBeCloseTo(3100, 0);
  });

  it('is monotonically increasing from 62 to 70', () => {
    const benefits = [62, 63, 64, 65, 66, 67, 68, 69, 70].map(
      (age) => ssaMonthlyBenefitAtAge(recipient, age).benefit,
    );
    for (let i = 1; i < benefits.length; i++) {
      expect(benefits[i]).toBeGreaterThan(benefits[i - 1]);
    }
  });
});

describe('spousalBenefitAtFra', () => {
  it('tops a no-earnings spouse up to 50% of the worker PIA', () => {
    const worker = createPiaRecipient(1960, 6, 2500, 'male');
    expect(spousalBenefitAtFra(worker, 0)).toBeCloseTo(1250, 0);
  });

  it('returns no top-up when the spouse PIA already exceeds half the worker PIA', () => {
    const worker = createPiaRecipient(1960, 6, 2500, 'male');
    expect(spousalBenefitAtFra(worker, 2000)).toBe(0);
  });
});

describe('nearestWholeClaimAge (clamps to the 62–70 filing window)', () => {
  it('rounds to the nearest whole year', () => {
    expect(nearestWholeClaimAge(68.58)).toBe(69);
    expect(nearestWholeClaimAge(67.2)).toBe(67);
  });

  it('clamps below 62 and above 70', () => {
    expect(nearestWholeClaimAge(59)).toBe(62);
    expect(nearestWholeClaimAge(73)).toBe(70);
  });
});

describe('monthDateFrom', () => {
  it('converts a JS date to the engine month grid', () => {
    // MonthDate months are 0-indexed, matching Date.getMonth().
    const md = monthDateFrom(new Date(2026, 7, 15)); // Aug 2026
    expect(md.year()).toBe(2026);
    expect(md.monthIndex()).toBe(7);
  });
});

describe('isSsaClaimAgeEligible with an injected date', () => {
  it('treats a claim age as reached only once the reference date passes it', () => {
    const r = createPiaRecipient(1960, 6, 2500, 'female'); // born Jun 1960
    expect(isSsaClaimAgeEligible(r, 65, new Date(2024, 5, 1))).toBe(false);
    expect(isSsaClaimAgeEligible(r, 65, new Date(2026, 5, 1))).toBe(true);
  });
});
