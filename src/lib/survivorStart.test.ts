import { describe, expect, it } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import { createPiaRecipient } from './ssaTools';
import { householdPeriods, type BenefitBand } from './benefitPeriods';
import { applySurvivorStart } from './survivorStart';
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
): Person => ({
  id,
  birthYear,
  birthMonth,
  birthDay: 15,
  gender,
  piaMonthly: pia,
  lifeExpectancy,
});
const recipientFor = (p: Person) =>
  createPiaRecipient(p.birthYear, p.birthMonth, p.birthDay, p.piaMonthly, p.gender);

/**
 * The household `survivorClaim.test.ts` derives by hand: John dies Feb 2036;
 * Jane (b. May 1980, PIA $2,000) files at 70 in May 2050 and holds no
 * personal band before then. SSA pays her a widow's benefit from age 60,
 * May 2040: 0.715 x $3,040 = $2,173 a month for 120 months, then her own
 * larger $2,480 from May 2050, under which no survivor increment remains.
 */
const john = person('a', 1958, 2, 2400, 'male', 78);
const jane = person('b', 1980, 5, 2000, 'female', 90);

function redraw(people: Person[], filingAges: MonthDuration[]) {
  const labels = ['John', 'Jane'];
  const recipients = people.map(recipientFor);
  const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
    people,
    recipients,
    filingAges,
    labels,
  );
  const alternative = survivorClaimAlternative(
    people, recipients, filingAges, bands, finalIndexByPersonId, survivorGap, labels,
  );
  const start = applySurvivorStart(
    people, recipients, filingAges, bands, finalIndexByPersonId, survivorGap, labels,
  );
  return { before: bands, alternative, start, finalIndexByPersonId };
}

const total = (bands: BenefitBand[], personId: string, from: number, to: number) => {
  let sum = 0;
  for (let m = from; m <= to; m++) {
    for (const b of bands) {
      if (b.personId === personId && b.startIndex <= m && m <= b.endIndex) sum += b.monthlyAmount;
    }
  }
  return Math.round(sum);
};

describe('applySurvivorStart', () => {
  it('starts the survivor benefit at age 60, not at the survivor’s own filing date', () => {
    const { start } = redraw([john, jane], [age(70), age(70)]);
    expect(start).not.toBeNull();
    expect(start!.claimIndex).toBe(2040 * 12 + 4); // May 2040, SSA age 60
    expect(start!.claimAge).toBe('60');
    const survivor = start!.bands.filter((b) => b.personId === 'b' && b.type === 'survivor');
    expect(survivor).toHaveLength(1);
    expect(survivor[0].startIndex).toBe(2040 * 12 + 4);
    // Ends the month before her own $2,480 starts: from then on her own
    // record pays more, and SSA pays the larger, so nothing is added.
    expect(survivor[0].endIndex).toBe(2050 * 12 + 3);
    expect(Math.abs(survivor[0].monthlyAmount - 2173)).toBeLessThan(1);
  });

  it('pays what the claim-month search priced, to within the filing-year bump', () => {
    // The search prices the survivor's own benefit at its post-January-bump
    // amount for every month; the engine's own personal band carries the
    // filing year at the pre-bump amount for up to eleven months. The redraw
    // uses the band, so it is the more exact of the two, and the two agree
    // to within that bump. `survivorClaim.ts` measured it at $576 on a
    // $77,796 gain.
    const { start, alternative, finalIndexByPersonId } = redraw([john, jane], [age(70), age(70)]);
    const deathPlusOne = finalIndexByPersonId.a + 1;
    const paid = total(start!.bands, 'b', deathPlusOne, finalIndexByPersonId.b);
    expect(Math.abs(paid - alternative!.bestTotal)).toBeLessThan(700);
    expect(paid).toBeGreaterThan(alternative!.baselineTotal);
  });

  it('leaves the other person’s bands alone, and restores the survivor’s own', () => {
    // The engine emitted no personal band for Jane at all: her survivor start
    // coincided with her own filing, and the couple path truncated her personal
    // period out of existence. Her own $2,480 from May 2050 is money SSA pays,
    // so the redraw puts it back, from the engine's own single-person path.
    const { before, start } = redraw([john, jane], [age(70), age(70)]);
    const johns = (bands: BenefitBand[]) => bands.filter((b) => b.personId === 'a');
    expect(johns(start!.bands)).toEqual(johns(before));
    expect(before.filter((b) => b.personId === 'b' && b.type === 'personal')).toHaveLength(0);
    const own = start!.bands.filter((b) => b.personId === 'b' && b.type === 'personal');
    expect(own.length).toBeGreaterThan(0);
    expect(own[0].startIndex).toBe(2050 * 12 + 4);
    expect(Math.abs(own[own.length - 1].monthlyAmount - 2480)).toBeLessThan(1);
  });

  it('draws the increment above the survivor’s own benefit, not the whole amount, once both run', () => {
    // A survivor whose own benefit is smaller than the widow's benefit keeps
    // both running: her own band, plus a survivor band for the difference.
    const smaller = person('b', 1980, 5, 1200, 'female', 90);
    const { start } = redraw([john, smaller], [age(70), age(62, 1)]);
    expect(start).not.toBeNull();
    const own = start!.bands.filter((b) => b.personId === 'b' && b.type === 'personal');
    const survivor = start!.bands.filter((b) => b.personId === 'b' && b.type === 'survivor');
    expect(own.length).toBeGreaterThan(0);
    expect(survivor.length).toBeGreaterThan(0);
    // In any month both run, own + increment equals one survivor amount.
    const m = survivor[survivor.length - 1].startIndex;
    const ownAt = own.find((b) => b.startIndex <= m && m <= b.endIndex);
    expect(ownAt).toBeDefined();
    expect(ownAt!.monthlyAmount + survivor[survivor.length - 1].monthlyAmount).toBeGreaterThan(
      ownAt!.monthlyAmount,
    );
  });

  it('is null wherever the claim-month search has nothing to offer', () => {
    // A single claimant has no survivor; the bands are the engine's own.
    const single = [person('a', 1962, 4, 2400, 'male', 85)];
    const recipients = single.map(recipientFor);
    const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(single, recipients, [age(70)], ['Priya']);
    expect(
      applySurvivorStart(single, recipients, [age(70)], bands, finalIndexByPersonId, survivorGap, ['Priya']),
    ).toBeNull();
  });
});
