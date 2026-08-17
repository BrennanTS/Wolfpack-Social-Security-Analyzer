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
    const { bands, survivorGap } = householdPeriods([p], [recipientFor(p)], [age(67)], ['Client']);
    // Guard: `every` is vacuously true on an empty array, and an empty result
    // is exactly what a broken finalDate would produce — PersonalBenefitPeriods
    // emits zero periods, without erroring, when finalDate is at or before the
    // filing date. Without this the whole block passes on a dead dispatch.
    expect(bands.length).toBeGreaterThan(0);
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

  it('places the bands on absolute calendar months', () => {
    // Every other assertion here is relational, so a wrong epoch or offset in
    // the MonthDate -> index conversion would pass the whole suite while
    // shifting Task 2's calendar-year bucketing. These are dates, not benefit
    // amounts, so they can be hand-derived and pinned.
    //
    // John is born Mar 1958 and files at SSA age 62: Mar 1958 + 62y = Mar 2020.
    // Jane is born Sep 1960 with a plan-to age of 80, so her final month is
    // Sep 2040 inclusive, and survivor benefits begin the month after.
    // John's plan-to age of 88 puts his final month at Mar 2046.
    const { bands } = run();
    const survivor = bands.find((b) => b.type === 'survivor')!;
    const johnFirst = bands
      .filter((b) => b.personId === 'a' && b.type === 'personal')
      .reduce((first, b) => (b.startIndex < first.startIndex ? b : first));

    expect(johnFirst.startIndex).toBe(2020 * 12 + 2); // Mar 2020
    expect(survivor.startIndex).toBe(2040 * 12 + 9); // Oct 2040
    expect(survivor.endIndex).toBe(2046 * 12 + 2); // Mar 2046
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
  // The engine pays survivor benefits only to the lower-PIA dependent. Here
  // the engine's EARNER outlives the dependent: A has the larger PIA but files
  // at 62, B files at 70, and B dies first. SSA would step A up; the engine
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
    expect(survivorGap!.deceasedMonthly).toBeGreaterThan(survivorGap!.survivorOwnMonthly!);
    // Both bands genuinely cover the death month (Sep 2040) and the month
    // after it, so these two figures really are contemporaneous — the case
    // the branch below exists to distinguish this one from.
    const death = 2040 * 12 + 8;
    expect(own.startIndex).toBeLessThanOrEqual(death + 1);
    expect(own.endIndex).toBeGreaterThanOrEqual(death + 1);
    expect(deceased.endIndex).toBe(death);
    expect(survivorGap!.survivorUnder60).toBe(false);
  });

  it('quotes no amount when the survivor has not filed at the death', () => {
    // Avery files at 70 — Mar 2028 — and Blake dies Sep 2027, so Avery is
    // paid nothing at all in the month a survivor benefit would begin. The
    // amount his LAST personal band pays is $2,533, and asserting that in the
    // present tense is the C1 defect: it is a dollar figure he is not
    // receiving, printed above a chart showing him at $0.
    const shortLived = person('b', 1960, 9, 1600, 'female', 67);
    const { bands, survivorGap } = householdPeriods(
      [a, shortLived],
      [recipientFor(a), recipientFor(shortLived)],
      [age(70), age(62)],
      ['Avery', 'Blake'],
    );
    expect(bands.filter((x) => x.type === 'survivor')).toHaveLength(0);

    const own = bands.find((x) => x.personId === 'a' && x.type === 'personal')!;
    const deceased = bands.find((x) => x.personId === 'b' && x.type === 'personal')!;
    const death = 2027 * 12 + 8; // Sep 2027, Blake's final month.
    expect(deceased.endIndex).toBe(death);
    // Guard: Avery's own band starts strictly after the death month, so there
    // is genuinely nothing contemporaneous to quote.
    expect(own.startIndex).toBeGreaterThan(death + 1);
    expect(own.monthlyAmount).toBe(2533);

    expect(survivorGap).not.toBeNull();
    expect(survivorGap!.survivorLabel).toBe('Avery');
    expect(survivorGap!.survivorOwnMonthly).toBeNull();
    expect(survivorGap!.deceasedMonthly).toBe(deceased.monthlyAmount);
    expect(survivorGap!.survivorUnder60).toBe(false);
  });

  it('flags a survivor who is under 60 at the death', () => {
    // Avery (b. Jun 1985) is 42 when Blake (b. Jun 1955, plan-to 72) dies in
    // Jun 2027. No widow(er) benefit is payable to anyone under 60, so the
    // chart's $0 is right for those years and the disclosure must say when the
    // shortfall actually starts rather than assert an immediate one.
    const young = person('a', 1985, 6, 2000, 'male', 90);
    const old = person('b', 1955, 6, 1600, 'female', 72);
    const { survivorGap } = householdPeriods(
      [young, old],
      [recipientFor(young), recipientFor(old)],
      [age(62), age(62)],
      ['Avery', 'Blake'],
    );
    expect(survivorGap).not.toBeNull();
    expect(survivorGap!.survivorUnder60).toBe(true);
    expect(survivorGap!.survivorOwnMonthly).toBeNull();
    expect(survivorGap!.deceasedMonthly).toBe(1186);
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

  it('stays silent when the DEPENDENT is the survivor and the engine declined the step-up', () => {
    // The other way a couple ends up with no survivor band at all, and not a
    // gap: Blake (PIA $1,900) is the engine's dependent and outlives Avery
    // (PIA $2,000), but Blake's own $1,330 already exceeds the reduced widower
    // benefit, so `strategy-calc.ts:88-98` declines the step-up. That is the
    // engine MODELLING this direction, not failing to.
    //
    // The predicate that only asked who outlives whom fired here, claiming
    // "survivor benefits are modeled only for the lower-earning spouse, so no
    // step-up is shown for Blake" — when Blake IS the lower-earning spouse.
    // Avery's $1,433 exceeds Blake's $1,330, so the amount comparison alone
    // does not rule it out; only the earner/dependent test does.
    const earner = person('a', 1958, 6, 2000, 'male', 66);
    const dependent = person('b', 1966, 6, 1900, 'male', 85);
    const { bands, survivorGap } = householdPeriods(
      [earner, dependent],
      [recipientFor(earner), recipientFor(dependent)],
      [age(62), age(62)],
      ['Avery', 'Blake'],
    );
    expect(bands.filter((x) => x.type === 'survivor')).toHaveLength(0);
    const earnerBand = bands.find((x) => x.personId === 'a')!;
    const dependentBand = bands.find((x) => x.personId === 'b')!;
    expect(earnerBand.monthlyAmount).toBeGreaterThan(dependentBand.monthlyAmount);
    expect(survivorGap).toBeNull();
  });
});

describe('householdPeriods — spousal reduction nets against the dependent\'s own DRC-inflated benefit past NRA', () => {
  // Vendored engine branch: spousalBenefitOnDate's NRA-netting branch
  // (src/vendor/ssa-tools/benefit-calculator.ts:355). Once the dependent
  // files past their OWN normal retirement age, POMS RS 00615.694 caps the
  // combined personal + spousal benefit at half the earner's PIA by netting
  // the spousal top-up against the dependent's actual (delayed-credit-
  // inflated) benefit rather than their PIA — a materially smaller top-up
  // than the naive PIA-based subtraction would give. This is a positive
  // residual: half the earner's PIA still exceeds the dependent's inflated
  // benefit, so a top-up remains, just a reduced one.
  //
  // No golden fixture reaches this: married-1960-partial-topup is the only
  // scenario where the dependent files late, and even there the dependent's
  // filing date is still <= their own NRA, taking the early "unreduced"
  // return at benefit-calculator.ts:327-328 instead. This recreates the
  // deleted spousalTopUp suite's regression case (see git history at
  // 560f140, ssaTools.test.ts) at the householdPeriods level: worker PIA
  // $3,000 files at 62, spouse PIA $1,000 (FRA 67y0m) files at 70. Spouse's
  // own benefit at 70 is 1000 * (1 + 36 * 2/3%) = $1,240; half the worker's
  // PIA is $1,500; so the top-up nets to 1500 - 1240 = $260 — not the
  // unreduced 1500 - 1000 = $500 that netting against the PIA would give.
  // A regression that swapped the DRC-inflated benefit back for the PIA
  // would make this assert 500 and fail.
  it('reduces the top-up to the residual over the DRC-inflated benefit, not the PIA', () => {
    const worker = person('a', 1960, 6, 3000, 'male', 85);
    const spouse = person('b', 1962, 3, 1000, 'female', 85);
    const { bands } = householdPeriods(
      [worker, spouse],
      [recipientFor(worker), recipientFor(spouse)],
      [age(62), age(70)],
      ['Worker', 'Spouse'],
    );
    const spousal = bands.find((b) => b.type === 'spousal');
    expect(spousal).toBeDefined();
    expect(spousal!.monthlyAmount).toBe(260);
  });
});

describe('householdPeriods — spousal reduction beyond the first 36 months early', () => {
  // Vendored engine branch: spousalBenefitOnDate's second reduction band
  // (src/vendor/ssa-tools/benefit-calculator.ts:367-377) — 25% for the first
  // 36 months early, then 5/12 of 1% per additional month. No golden
  // scenario's spousal start lands more than 16 months before the
  // dependent's own FRA, so the >36-month branch has never run outside this
  // test.
  //
  // Worker PIA $3,000 files at 62 (Jan 2022). Spouse PIA $1,000, born Jun
  // 1963 (FRA 67y0m = Jun 2030), also files at her own 62 (Jun 2025) — later
  // than the worker's filing, so the spousal band starts on her filing date,
  // 60 months before her FRA. Base entitlement = 3000/2 - 1000 = $500.
  // Reduction = 25% (first 36 months) + 24 * 5/12% (remaining 24 months) =
  // 25% + 10% = 35%. Top-up = 500 * 0.65 = $325. A regression that applied
  // the flat 25/36%-per-month rate across all 60 months (the pre-36-month
  // formula) would give 500 * (1 - 60 * 25/3600) = 500 * 0.5833 = $291.67
  // instead, and this test would fail.
  it('applies the second reduction band beyond 36 months early', () => {
    const worker = person('a', 1960, 1, 3000, 'male', 85);
    const spouse = person('b', 1963, 6, 1000, 'female', 85);
    const { bands } = householdPeriods(
      [worker, spouse],
      [recipientFor(worker), recipientFor(spouse)],
      [age(62), age(62)],
      ['Worker', 'Spouse'],
    );
    const spousal = bands.find((b) => b.type === 'spousal');
    expect(spousal).toBeDefined();
    expect(spousal!.monthlyAmount).toBe(325);
  });
});

describe('householdPeriods — finalIndexByPersonId', () => {
  it('reports each person final month, which the bands cannot tell you', () => {
    // Jane is the higher earner and dies first, so the split extends John's
    // personal band past her death — and hers past her own death too.
    const john = person('a', 1958, 3, 1400, 'male', 88);
    const jane = person('b', 1960, 9, 3000, 'female', 80);
    const { finalIndexByPersonId } = householdPeriods(
      [john, jane],
      [recipientFor(john), recipientFor(jane)],
      [age(62), age(70)],
      ['John', 'Jane'],
    );
    // Jane born Sep 1960, plan-to 80 -> Sep 2040. John born Mar 1958,
    // plan-to 88 -> Mar 2046. Verify both against `dateAtSsaAge` yourself.
    expect(finalIndexByPersonId.b).toBe(2040 * 12 + 8);
    expect(finalIndexByPersonId.a).toBe(2046 * 12 + 2);
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
