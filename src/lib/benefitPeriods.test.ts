import { describe, expect, it } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import { createPiaRecipient } from './ssaTools';
import { householdPeriods, monthsInYear, type BenefitBand } from './benefitPeriods';
import type { Person } from './personAnalysis';

const age = (years: number, months = 0) =>
  MonthDuration.initFromYearsMonths({ years, months });

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

describe('householdPeriods — single', () => {
  it('produces personal bands only', () => {
    const p = person('a', 1960, 6, 2500, 'male', 85);
    const { bands, survivorGap } = householdPeriods([p], [recipientFor(p)], [age(67)], ['You']);
    expect(bands.every((b) => b.type === 'personal')).toBe(true);
    expect(bands.every((b) => b.personId === 'a')).toBe(true);
    expect(survivorGap).toBeNull();
  });
});

describe('householdPeriods — dual entitlement', () => {
  // Jane (b) is the HIGHER earner and must die FIRST, because that is the
  // only direction the engine models. Her plan-to age of 80 puts her death
  // in 2040; John's 88 carries him to 2046, so he survives her by six years.
  // Getting this backwards produces no survivor band at all and every
  // assertion below fails for an unrelated reason.
  const john = person('a', 1958, 3, 1400, 'male', 88);
  const jane = person('b', 1960, 9, 3000, 'female', 80);

  const run = () =>
    householdPeriods(
      [john, jane],
      [recipientFor(john), recipientFor(jane)],
      [age(62), age(70)],
      ['John', 'Jane'],
    );

  it('emits a survivor band for the lower earner', () => {
    // Guards every assertion below: without this the others can pass
    // vacuously on an empty band list.
    expect(run().bands.filter((b) => b.type === 'survivor')).toHaveLength(1);
  });

  it("continues the survivor's own personal band past the first death", () => {
    const { bands } = run();
    const survivor = bands.find((b) => b.type === 'survivor')!;
    const personal = bands.filter((b) => b.personId === 'a' && b.type === 'personal');
    // The engine truncates personal at survivorStart - 1; the split must
    // carry it forward to the end of the survivor's own life instead.
    expect(Math.max(...personal.map((b) => b.endIndex))).toBe(survivor.endIndex);
  });

  it('splits the survivor benefit into the personal band plus a top-up', () => {
    const { bands } = run();
    const survivor = bands.find((b) => b.type === 'survivor')!;
    const johnAtDeath = bands
      .filter((b) => b.personId === 'a' && b.type === 'personal')
      .reduce((latest, b) => (b.startIndex > latest.startIndex ? b : latest));
    const janeFinal = bands
      .filter((b) => b.personId === 'b' && b.type === 'personal')
      .reduce((latest, b) => (b.startIndex > latest.startIndex ? b : latest));

    expect(survivor.monthlyAmount).toBeGreaterThan(0);
    // John is 82 when Jane dies — long past his survivor FRA — so he
    // inherits her full benefit, delayed credits included. The split must
    // preserve that total: his own band plus the top-up equals her benefit.
    expect(johnAtDeath.monthlyAmount + survivor.monthlyAmount).toBeCloseTo(
      janeFinal.monthlyAmount,
      0,
    );
  });

  it('never leaves a spousal band overlapping a survivor band', () => {
    const { bands } = run();
    const survivor = bands.find((b) => b.type === 'survivor')!;
    const spousal = bands.filter((b) => b.type === 'spousal');
    // Jane's PIA is 3000 and John's 1400, so half of hers exceeds his and a
    // spousal band genuinely exists — this does not pass by absence.
    expect(spousal.length).toBeGreaterThan(0);
    for (const band of spousal) {
      expect(band.endIndex).toBeLessThan(survivor.startIndex);
    }
  });
});

describe('householdPeriods — the January bump under a survivor band', () => {
  // Same household, but John files at 69 rather than 62. Filing past his FRA
  // in March earns delayed credits that are not paid until the following
  // January, so `PersonalBenefitPeriods` emits TWO personal periods
  // (recipient-personal-benefits.ts:115-127). The band the split must carry
  // forward is the later-starting one — that is what he is actually being
  // paid when Jane dies.
  const john = person('a', 1958, 3, 1400, 'male', 88);
  const jane = person('b', 1960, 9, 3000, 'female', 80);

  const run = () =>
    householdPeriods(
      [john, jane],
      [recipientFor(john), recipientFor(jane)],
      [age(69), age(70)],
      ['John', 'Jane'],
    );

  const johnPersonal = (bands: BenefitBand[]) =>
    bands
      .filter((b) => b.personId === 'a' && b.type === 'personal')
      .sort((x, y) => x.startIndex - y.startIndex);

  it('emits two personal bands, the later one paying more', () => {
    // Guards the tests below: without the bump there is only one band and
    // "latest-starting" would be untested.
    const personal = johnPersonal(run().bands);
    expect(personal).toHaveLength(2);
    expect(personal[1].monthlyAmount).toBeGreaterThan(personal[0].monthlyAmount);
  });

  it('carries the later band forward and leaves the earlier one alone', () => {
    const { bands } = run();
    const survivor = bands.find((b) => b.type === 'survivor')!;
    const [before, after] = johnPersonal(bands);

    expect(after.endIndex).toBe(survivor.endIndex);
    // The earlier band must not be stretched over the later one.
    expect(before.endIndex).toBeLessThan(after.startIndex);
  });

  it('nets the top-up against the amount actually being paid', () => {
    const { bands } = run();
    const survivor = bands.find((b) => b.type === 'survivor')!;
    const [, after] = johnPersonal(bands);
    const janeFinal = bands
      .filter((b) => b.personId === 'b' && b.type === 'personal')
      .reduce((latest, b) => (b.startIndex > latest.startIndex ? b : latest));

    expect(after.monthlyAmount + survivor.monthlyAmount).toBeCloseTo(janeFinal.monthlyAmount, 0);
  });
});

describe('householdPeriods — the unmodeled survivor direction', () => {
  // The engine pays survivor benefits only to the lower-PIA person. Here the
  // HIGHER earner outlives the lower one: A has the larger PIA but files at
  // 62, B files at 70, and B dies first. SSA would step A up; the engine
  // emits no survivor band at all. That must be disclosed, not computed.
  const a = person('a', 1958, 3, 2000, 'male', 88);
  const b = person('b', 1960, 9, 1600, 'female', 80);

  it('reports the gap when the survivor holds the smaller benefit', () => {
    const { bands, survivorGap } = householdPeriods(
      [a, b],
      [recipientFor(a), recipientFor(b)],
      [age(62), age(70)],
      ['Avery', 'Blake'],
    );
    // Guards the assertions below: this is the no-survivor-band case.
    expect(bands.filter((x) => x.type === 'survivor')).toHaveLength(0);

    const own = bands.find((x) => x.personId === 'a' && x.type === 'personal')!;
    const deceased = bands.find((x) => x.personId === 'b' && x.type === 'personal')!;

    expect(survivorGap).not.toBeNull();
    expect(survivorGap!.survivorLabel).toBe('Avery');
    // The disclosed figures are the engine's own, not a re-derivation.
    expect(survivorGap!.survivorOwnMonthly).toBe(own.monthlyAmount);
    expect(survivorGap!.deceasedMonthly).toBe(deceased.monthlyAmount);
    expect(survivorGap!.deceasedMonthly).toBeGreaterThan(survivorGap!.survivorOwnMonthly);
  });

  it('stays silent when the survivor already holds the larger benefit', () => {
    // Same deaths, but B's PIA is small enough that A loses nothing.
    const poorer = person('b', 1960, 9, 400, 'female', 80);
    const { survivorGap } = householdPeriods(
      [a, poorer],
      [recipientFor(a), recipientFor(poorer)],
      [age(62), age(62)],
      ['Avery', 'Blake'],
    );
    expect(survivorGap).toBeNull();
  });
});

describe('monthsInYear', () => {
  it('counts only the months the band actually covers', () => {
    // Sep 2030 (2030*12 + 8) through Mar 2032 (2032*12 + 2).
    const band: BenefitBand = {
      personId: 'a',
      type: 'personal',
      startIndex: 2030 * 12 + 8,
      endIndex: 2032 * 12 + 2,
      monthlyAmount: 100,
    };
    expect(monthsInYear(band, 2029)).toBe(0);
    expect(monthsInYear(band, 2030)).toBe(4); // Sep, Oct, Nov, Dec
    expect(monthsInYear(band, 2031)).toBe(12);
    expect(monthsInYear(band, 2032)).toBe(3); // Jan, Feb, Mar
    expect(monthsInYear(band, 2033)).toBe(0);
  });
});
