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

function alternativeFor(people: Person[], filingAges: MonthDuration[], labels: string[]) {
  const recipients = people.map(recipientFor);
  const { bands, survivorGap, finalIndexByPersonId } = householdPeriods(
    people,
    recipients,
    filingAges,
    labels,
  );
  return survivorClaimAlternative(
    people,
    recipients,
    filingAges,
    bands,
    finalIndexByPersonId,
    survivorGap,
    labels,
  );
}

function run(filingAges: [MonthDuration, MonthDuration]) {
  return alternativeFor([dan, sarah], filingAges, ['Dan', 'Sarah']);
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
    expect(result.baselineHasSurvivorBand).toBe(true);
  });

  it('claims at survivor-FRA when that beats every month up to the own filing date', () => {
    // THE test for the `hi = survivor-FRA` decision. Sarah here is born May
    // 1974 and files at 63 (May 2037, index 24448); her survivor-FRA is 67
    // (May 2041, index 24496), four years LATER than her own filing. The
    // engine starts her survivor benefit at her filing date and permanently
    // reduces it to 0.715 + 0.285 x 36/84 = 0.837143 of the $3,040 base =
    // $2,544, for 349 months = $887,856.
    //
    // Waiting to survivor-FRA takes the base unreduced. She lives on her own
    // $900 (PIA $1,200 claimed 48 months early) for the 48 months in between:
    //   48 x $900 + 301 x $3,040 = $43,200 + $915,040 = $958,240.
    // Gain $70,384.
    //
    // Had the search stopped at her own filing date, its best candidate would
    // have been that very month, worth exactly the baseline, and this whole
    // household would have returned null.
    const younger = person('b', 1974, 5, 1200, 'female', 92);
    const result = alternativeFor([dan, younger], [age(70), age(63)], ['Dan', 'Sarah'])!;
    expect(result.claimIndex).toBe(2041 * 12 + 4); // May 2041, survivor-FRA
    expect(result.claimIndex).toBeGreaterThan(2037 * 12 + 4); // beyond her own filing
    expect(result.claimAge).toBe('67');
    expect(result.baselineTotal).toBe(887856);
    expect(result.bestTotal).toBe(958240);
    expect(result.gain).toBe(70384);
  });

  it("counts the survivor's own benefit in months the engine deleted their personal band", () => {
    // The engine emits NO personal band for a survivor whose filing date is
    // also its survivor start, which is most of this module's population. The
    // survivor's own retirement benefit still has to be counted in those
    // months, or an early reduced widow(er) benefit looks better than it is.
    //
    // Here Sarah (b. May 1978, PIA $2,000) files at 70 — $2,480/mo from May
    // 2048 — and holds no personal band at all. Claiming the survivor benefit
    // at 60 (May 2038) takes 0.715 x $3,040 = $2,173 for the 120 months to her
    // own filing, then her own larger $2,480 for the remaining 241:
    //   120 x $2,173 + 241 x $2,480 = $260,760 + $597,680 = $858,440,
    // against a baseline of 241 x $3,040 = $732,640. Gain $125,800.
    //
    // Blind to her own benefit those last 241 months score $2,173 rather than
    // $2,480, which makes waiting look better than claiming at 60 and moves
    // the answer 75 months later.
    const younger = person('b', 1978, 5, 2000, 'female', 90);
    const result = alternativeFor([dan, younger], [age(70), age(70)], ['Dan', 'Sarah'])!;
    expect(result.claimIndex).toBe(2038 * 12 + 4); // May 2038, SSA age 60
    expect(result.claimAge).toBe('60');
    expect(result.baselineTotal).toBe(732640);
    expect(result.bestTotal).toBe(858440);
    expect(result.gain).toBe(125800);
  });

  it('picks a strictly interior claim month, on neither end of the range', () => {
    // The only fixture in this file whose optimum is neither `lo` nor `hi`, so
    // the only one that can catch a search that merely compares the two ends.
    // Sarah b. May 1978, PIA $1,200, files at 70 — SSA age 60 is May 2038
    // (24460), survivor-FRA May 2045 (24544), optimum Aug 2044 (24535).
    //
    // She holds no personal band, and her own $1,488 at 70 never beats the
    // widow's benefit, so the trade is purely months-against-reduction:
    // claiming at c pays 0.715 + 0.285 x (c - 24460)/84 of the $3,040 base for
    // every month from c to her death in May 2068.
    //   at 24460 (lo):  120 x $2,173 + 241 x $2,173 = $784,453
    //   at 24535:        45 x $2,947 + 241 x $2,947 = $842,842  <- best
    //   at 24544 (hi):   36 x $3,040 + 241 x $3,040 = $842,080
    // Against a baseline of 241 x $3,040 = $732,640, the gain is $110,202.
    const younger = person('b', 1978, 5, 1200, 'female', 90);
    const result = alternativeFor([dan, younger], [age(70), age(70)], ['Dan', 'Sarah'])!;
    expect(result.claimIndex).toBe(2044 * 12 + 7); // Aug 2044
    expect(result.claimIndex).toBeGreaterThan(2038 * 12 + 4); // strictly above lo
    expect(result.claimIndex).toBeLessThan(2045 * 12 + 4); // strictly below hi
    expect(result.claimAge).toBe('66 years, 3 months');
    expect(result.baselineTotal).toBe(732640);
    expect(result.bestTotal).toBe(842842);
    expect(result.gain).toBe(110202);
  });

  it('takes the pre-bump personal band at its own amount, not the post-bump figure', () => {
    // `ownFiled` is read a year after filing, so it is always the post-January
    // bump amount, while the engine emits the filing year at the PRE-bump
    // amount. A max() of the two would never select the band and would quietly
    // lift those months — so where a band exists it must simply win.
    //
    // Bob b. May 1975, PIA $2,400, files at 68 (May 2043): the engine emits 8
    // months at $2,528 then $2,592 for life. His wife dies at 62 in May 2027
    // having never filed, so there is no survivor band and his personal bands
    // survive. His widower's benefit at 60 is 0.715 x her $1,200 PIA = $858,
    // paid for the 96 months from May 2035 to his own filing:
    //   baseline 8 x $2,528 + 257 x $2,592 = $686,368
    //   best     $686,368 + 96 x $858      = $768,736,  gain $82,368.
    // Under the max() those 8 months scored $2,592 and the gain read $82,880 —
    // $512 the app never displays.
    const early = person('a', 1965, 5, 1200, 'female', 62);
    const later = person('b', 1975, 5, 2400, 'male', 90);
    const result = alternativeFor([early, later], [age(70), age(68)], ['Ann', 'Bob'])!;
    expect(result.claimIndex).toBe(2035 * 12 + 4); // May 2035, SSA age 60
    expect(result.baselineTotal).toBe(686368);
    expect(result.bestTotal).toBe(768736);
    expect(result.gain).toBe(82368);
  });

  it('flags a household whose displayed baseline holds no survivor benefit at all', () => {
    // The engine pays survivor benefits in one direction only. Here the LOWER
    // earner dies first at 62 having never filed, so `detectSurvivorGap` stays
    // silent — it has no amount to quote — and no survivor band is emitted for
    // anyone. The widower's entitlement is real (0.715 x his late wife's
    // $1,200 PIA = $858 from his age 60 in May 2035 to his own filing at 70 in
    // May 2045, 120 months = $102,960), so it is reported rather than
    // suppressed. But there is no survivor benefit on screen for it to be
    // "earlier" than, and the flag is how a caller can tell.
    const early = person('a', 1965, 5, 1200, 'female', 62);
    const later = person('b', 1975, 5, 2400, 'male', 90);
    const result = alternativeFor([early, later], [age(70), age(70)], ['Ann', 'Bob'])!;
    expect(result.baselineHasSurvivorBand).toBe(false);
    expect(result.survivorLabel).toBe('Bob');
    expect(result.gain).toBe(102960);
  });

  it("returns null when the engine's unmodelled survivor direction is already disclosed", () => {
    // The higher earner outlives the dependent, and the dependent HAS filed,
    // so `detectSurvivorGap` fires. That disclosure is the app's answer for
    // this household; a claim-month search alongside it would answer the same
    // question a second time, differently.
    const older = person('a', 1958, 2, 1200, 'male', 78);
    const younger = person('b', 1975, 5, 2400, 'female', 90);
    expect(alternativeFor([older, younger], [age(62), age(70)], ['Ann', 'Bob'])).toBeNull();
  });

  it('returns null on an exact tie in the two plan-to months', () => {
    // Same birth month and same plan-to age: neither person is established as
    // the survivor, so `firstDeath` declines to pick one.
    const twinA = person('a', 1958, 2, 2400, 'male', 85);
    const twinB = person('b', 1958, 2, 1200, 'female', 85);
    expect(alternativeFor([twinA, twinB], [age(70), age(70)], ['A', 'B'])).toBeNull();
  });

  it('returns null when the survivor already claims early enough to gain nothing', () => {
    // Sarah files at 62y1m, well before Dan's death, so the engine already
    // starts her survivor benefit at the death and there is nothing to move.
    expect(run([age(70), age(62, 1)])).toBeNull();
  });
});
