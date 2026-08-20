import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  analyzeHousehold,
  buildMonthlyIncomeSeries,
  householdDisplayShape,
  showSurvivorIncomeColumn,
  survivorIncomeRisesWithDelay,
  visibleBenefitSeries,
  type Household,
  type HouseholdAnalysis,
} from './household';
import type { BenefitBand } from './benefitPeriods';
import { incomeCliff } from './incomeCliff';
import type { Person } from './personAnalysis';
import { createPiaRecipient, ssaMonthlyBenefitAtFilingAge } from './ssaTools';
import { survivorIncomeCaption } from '../components/methodologyCopy';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

const asOf = new Date(2026, 0, 15);
const assumptions = { annualCola: 2.5, discountRate: 0.025 };

const dan: Person = {
  id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
  gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
};

describe('analyzeHousehold — single', () => {
  const household: Household = { status: 'single', people: [dan] };

  it('analyzes exactly one person', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.status).toBe('single');
    expect(result.people).toHaveLength(1);
    expect(result.people[0].person.name).toBe('Dan');
  });

  it('marks exactly one comparison row as optimal, with zero delta', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    const optimal = comparisons.filter((c) => c.isOptimal);
    expect(optimal).toHaveLength(1);
    expect(optimal[0].deltaVsOptimal).toBe(0);
  });

  it('never scores a comparison above the optimal', async () => {
    const { comparisons, optimal } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.expectedNpv).toBeLessThanOrEqual(optimal.expectedNpv);
      expect(c.deltaVsOptimal).toBeLessThanOrEqual(0);
    }
  });

  it('gives every comparison one filing age and a single-person label', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.filingAges).toHaveLength(1);
    }
    expect(comparisons.map((c) => c.label)).toContain('Wait until 70');
  });

  it('omits spousal data for a single claimant', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.spousalTopUp).toBeUndefined();
  });

  it('echoes the reference date and assumptions', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.asOf).toEqual(asOf);
    expect(result.assumptions).toEqual(assumptions);
  });

  it('folds a named row into optimal instead of duplicating it when their ages collide', async () => {
    // At a 0% discount rate, deferred credits dominate and the optimum for
    // this fixture lands exactly on the `latest` (70) row. That row must be
    // folded into `optimal`, not duplicated alongside it.
    const { comparisons } = await analyzeHousehold(
      household,
      { annualCola: 2.5, discountRate: 0 },
      asOf,
    );

    const seen = new Set<string>();
    for (const c of comparisons) {
      const ageKey = c.filingAges.map((f) => `${f.years}y${f.months}m`).join('|');
      expect(seen.has(ageKey)).toBe(false);
      seen.add(ageKey);
    }

    const optimalRows = comparisons.filter((c) => c.isOptimal);
    expect(optimalRows).toHaveLength(1);
    expect(optimalRows[0].key).toBe('optimal');

    const latestRows = comparisons.filter((c) => c.key === 'latest');
    expect(latestRows).toHaveLength(0);
  });
});

const sarah: Person = {
  id: 'b', name: 'Sarah', birthYear: 1964, birthMonth: 2,
  gender: 'female', piaMonthly: 2100, lifeExpectancy: 88,
};

describe('analyzeHousehold — married', () => {
  const household: Household = { status: 'married', people: [dan, sarah] };

  it('analyzes both people and keeps input order', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.people.map((p) => p.person.name)).toEqual(['Dan', 'Sarah']);
  });

  it('gives each comparison one filing age per person', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.filingAges).toHaveLength(2);
    }
  });

  it('uses married labels', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    expect(comparisons.map((c) => c.label)).toContain('Both wait until 70');
  });

  it('assigns each person the filing age from the joint optimum', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.people[0].filingAge).toEqual(result.optimal.filingAges[0]);
    expect(result.people[1].filingAge).toEqual(result.optimal.filingAges[1]);
  });

  it('reports a spousal top-up for a spouse with no record', async () => {
    const noRecord: Person = { ...sarah, piaMonthly: 0 };
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, noRecord] },
      assumptions,
      asOf,
    );
    expect(result.spousalTopUp!.atFra).toBeCloseTo(1200, 0); // half of Dan's 2400
    // Pinned, not bounded: `Money` clamps every negative path to zero, so
    // `>= 0` could not fail — forcing `spousalFiguresFrom` to return 0 used to
    // pass this whole file. The figure is exactly derivable. Dan files at
    // 68y10m (Apr 1962 + 68y10m = Feb 2031). Sarah has no record of her own,
    // so `strategy-calc.ts:63-69` moves her filing date up to his, and the
    // spousal band starts at max(Feb 2031, Feb 2031) = Feb 2031 — when she is
    // exactly 67y0m (Feb 1964 + 67y = Feb 2031), her own FRA. Zero months
    // early, and delayed credits never apply to a spousal benefit, so the
    // $1,200 entitlement is paid unreduced.
    expect(result.spousalTopUp!.atRecommendedFilingAge).toBe(1200);
    expect(result.spousalTopUp!.startsAtSpouseAge).toBe('67');
    expect(result.people[0].filingAge.label).toBe('68 years, 10 months');
    expect(result.spousalTopUp!.lowerEarnerLabel).toBe('Sarah');
  });

  it('names the lower earner even when person B out-earns person A', async () => {
    const bigEarnerSpouse: Person = { ...sarah, piaMonthly: 4000 };
    const result = await analyzeHousehold(
      { status: 'married', people: [{ ...dan, piaMonthly: 1000 }, bigEarnerSpouse] },
      assumptions,
      asOf,
    );
    // Half of Sarah's 4000 (2000) less Dan's own 1000.
    expect(result.spousalTopUp!.atFra).toBeCloseTo(1000, 0);
    expect(result.spousalTopUp!.lowerEarnerLabel).toBe('Dan');
  });

  it('falls back to Client/Spouse when a person is unnamed', async () => {
    const result = await analyzeHousehold(
      {
        status: 'married',
        people: [{ ...dan, name: undefined }, { ...sarah, name: undefined, piaMonthly: 0 }],
      },
      assumptions,
      asOf,
    );
    expect(result.spousalTopUp!.lowerEarnerLabel).toBe('Spouse');
  });

  it('reports no top-up when both have substantial records', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.spousalTopUp!.atFra).toBe(0);
  });

  it('does not start the spousal benefit before the higher earner files', async () => {
    const noRecord: Person = { ...sarah, piaMonthly: 0 };
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, noRecord] },
      assumptions,
      asOf,
    );
    const spousal = result.spousalTopUp!;
    const higherIndex = dan.piaMonthly >= noRecord.piaMonthly ? 0 : 1;
    const lowerIndex = higherIndex === 0 ? 1 : 0;

    // The benefit cannot begin before the higher earner files, so the spouse's
    // age at start must be at least her age when he files.
    const higherFilesAtYear =
      result.people[higherIndex].person.birthYear +
      result.optimal.filingAges[higherIndex].years;
    const spouseAgeThen = higherFilesAtYear - result.people[lowerIndex].person.birthYear;

    // This household genuinely has a spousal band, so a start date must be
    // present — asserting that before parsing it, rather than letting a null
    // fall through into the numeric comparison as NaN.
    expect(spousal.startsAtSpouseAge).not.toBeNull();
    const startYears = Number(spousal.startsAtSpouseAge!.split(' ')[0]);
    expect(startYears).toBeGreaterThanOrEqual(spouseAgeThen - 1);

    // And it must be at least her own filing age too — the start is the later
    // of the two, never the earlier.
    expect(startYears).toBeGreaterThanOrEqual(result.optimal.filingAges[lowerIndex].years);
  });

  it('reports the unreduced entitlement separately from what is paid', async () => {
    const noRecord: Person = { ...sarah, piaMonthly: 0 };
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, noRecord] },
      assumptions,
      asOf,
    );
    const spousal = result.spousalTopUp!;
    // Half of Dan's PIA, since she has no record of her own.
    expect(spousal.atFra).toBeCloseTo(dan.piaMonthly / 2, 0);
    // `<= atFra` was satisfied by zero, so this too passed with the paid
    // figure forced to 0. Pinned instead — the band starts exactly at Sarah's
    // own FRA, so the two figures coincide here and the reduction is nil (see
    // the derivation in "reports a spousal top-up for a spouse with no
    // record"). They are still two distinct quantities: `atFra` is dateless,
    // `atRecommendedFilingAge` is read off the engine's Spousal band.
    expect(spousal.atRecommendedFilingAge).toBe(1200);
    expect(spousal.atFra).toBe(1200);
  });

  it('takes its horizon from the plan-to age, not from gender', async () => {
    // This used to assert the OPPOSITE — that two genders give two different
    // joint values — because the optimizer weighted by gender-specific SSA
    // mortality tables. It no longer does: the horizon is each person's
    // plan-to age (see `planToAgeDistribution`), so two people planning to
    // the same age are the same to the optimizer whatever their gender.
    //
    // Gender is not inert. It seeds `ssaSuggestedLifeExpectancy`, which is
    // the plan-to slider's DEFAULT — so it still reaches the recommendation,
    // one step further up, through a number the adviser can see and change.
    const bothMale: Household = {
      status: 'married',
      people: [dan, { ...sarah, gender: 'male' }],
    };
    const mixed = await analyzeHousehold(household, assumptions, asOf);
    const same = await analyzeHousehold(bothMale, assumptions, asOf);
    expect(same.optimal.expectedNpv).toBe(mixed.optimal.expectedNpv);
    expect(same.optimal.filingAges.map((f) => f.label)).toEqual(
      mixed.optimal.filingAges.map((f) => f.label),
    );

    // And the plan-to age does move it, which is the property that replaced
    // the one above.
    const longerLived = await analyzeHousehold(
      { status: 'married', people: [{ ...dan, lifeExpectancy: 95 }, sarah] },
      assumptions,
      asOf,
    );
    expect(longerLived.optimal.expectedNpv).not.toBe(mixed.optimal.expectedNpv);
  });
});

describe('combinedTimeline', () => {
  it('starts no earlier than the first benefit year and rises when the second person files', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    const t = result.combinedTimeline;
    expect(t.length).toBeGreaterThan(0);

    // Totals equal the sum of the per-person amounts in every year.
    for (const point of t) {
      const summed = Object.values(point.byPersonId).reduce((a, b) => a + b, 0);
      expect(point.total).toBeCloseTo(summed, 2);
    }

    // Years increase by one with no gaps.
    for (let i = 1; i < t.length; i++) {
      expect(t[i].year).toBe(t[i - 1].year + 1);
    }

    // The household total rises once the second person starts filing: the
    // peak (both filed, both alive) must exceed the very first year (only
    // the earlier filer contributing). The tail can fall below the peak once
    // someone outlives their life expectancy, so we deliberately don't assert
    // the last year against the first.
    const peak = Math.max(...t.map((p) => p.total));
    expect(peak).toBeGreaterThan(t[0].total);
  });

  it('keys amounts by person id', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    expect(Object.keys(result.combinedTimeline[0].byPersonId).sort()).toEqual(['a', 'b']);
  });

  it('produces a single-keyed timeline for a single claimant', async () => {
    const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(Object.keys(result.combinedTimeline[0].byPersonId)).toEqual(['a']);
  });

  it('keys the timeline by person and benefit type', async () => {
    // dan/sarah both have substantial records and produce no spousal band
    // (see "reports no spousal start when there is no entitlement at all"
    // below), so this needs a pairing that genuinely has one: sarah with no
    // record of her own draws a spousal band on dan's record.
    const noRecord: Person = { ...sarah, piaMonthly: 0 };
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, noRecord] },
      assumptions,
      asOf,
    );
    const withSpousal = result.periods.find((b) => b.type === 'spousal');
    // Guard: without this, `withSpousal!` below would index `undefined` and
    // fail for an unrelated reason rather than testing anything.
    expect(withSpousal).toBeDefined();
    const point = result.combinedTimeline.find(
      (p) => p.year === Math.floor(withSpousal!.startIndex / 12) + 1,
    )!;
    expect(point.bySeries[`${withSpousal!.personId}:spousal`]).toBeGreaterThan(0);
  });

  it('rolls series up to the same per-person totals', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    for (const point of result.combinedTimeline) {
      for (const person of result.people) {
        const id = person.person.id;
        const summed = Object.entries(point.bySeries)
          .filter(([key]) => key.startsWith(`${id}:`))
          .reduce((acc, [, value]) => acc + value, 0);
        expect(point.byPersonId[id]).toBeCloseTo(summed, 2);
      }
    }
  });
});

describe('buildMonthlyIncomeSeries', () => {
  it('returns one point per month, seeded for every person', () => {
    const bands: BenefitBand[] = [
      { personId: 'a', type: 'personal', startIndex: 0, endIndex: 2, monthlyAmount: 2000 },
    ];
    const points = buildMonthlyIncomeSeries(bands, [{ ...dan, id: 'a' }, { ...sarah, id: 'b' }]);
    expect(points.map((p) => p.monthIndex)).toEqual([0, 1, 2]);
    for (const p of points) {
      expect(Object.keys(p.byPersonId).sort()).toEqual(['a', 'b']);
      expect(p.byPersonId.b).toBe(0);
    }
  });

  it('is flat at the annual rate for every month a band pays, with no ramp at either end', () => {
    const bands: BenefitBand[] = [
      { personId: 'a', type: 'personal', startIndex: 10, endIndex: 15, monthlyAmount: 2500 },
    ];
    const points = buildMonthlyIncomeSeries(bands, [{ ...dan, id: 'a' }]);
    // Every month the band pays — first, middle, and last alike — carries
    // the SAME figure: the full annual rate. Nothing prorates the edges.
    for (const p of points) {
      expect(p.total).toBeCloseTo(2500 * 12, 2);
    }
  });

  // The exact regression this test file exists to pin: a household where a
  // band ends the month before another band (for a DIFFERENT person, or a
  // different type on the SAME person) begins right after it — the precise
  // shape of a first death, where the deceased's final personal payment and
  // the survivor's first step-up payment are adjacent but never
  // simultaneous. Task 8's second attempt (crediting a band's full annual
  // rate to every YEAR it touched) summed both bands' full rates into the
  // one calendar year they shared, spiking the household above anything it
  // ever actually received. At monthly resolution nothing can double up: a
  // given month has exactly the bands active that month.
  it('never sums two bands in the same month that were never both live at once', () => {
    const bands: BenefitBand[] = [
      // Dan's personal band ends month 11 (his death).
      { personId: 'a', type: 'personal', startIndex: 0, endIndex: 11, monthlyAmount: 3800 },
      // Sarah's own personal band runs the whole span.
      { personId: 'b', type: 'personal', startIndex: 0, endIndex: 23, monthlyAmount: 1844 },
      // Sarah's survivor step-up starts the very next month.
      { personId: 'b', type: 'survivor', startIndex: 12, endIndex: 23, monthlyAmount: 1956 },
    ];
    const points = buildMonthlyIncomeSeries(bands, [{ ...dan, id: 'a' }, { ...sarah, id: 'b' }]);

    const lastMonthAlive = points.find((p) => p.monthIndex === 11)!;
    const firstMonthAfter = points.find((p) => p.monthIndex === 12)!;

    // The last month Dan is alive: his personal band plus Sarah's personal
    // band, and nothing from a survivor band that hasn't started yet.
    expect(lastMonthAlive.bySeries['a:personal']).toBeCloseTo(3800 * 12, 2);
    expect(lastMonthAlive.bySeries['b:survivor']).toBeUndefined();
    expect(lastMonthAlive.total).toBeCloseTo((3800 + 1844) * 12, 2);

    // The month right after: Sarah's personal band plus her survivor
    // step-up, and NOTHING from Dan — not a trace of his rate carried into
    // a month he never lived to see.
    expect(firstMonthAfter.bySeries['a:personal']).toBeUndefined();
    expect(firstMonthAfter.byPersonId.a).toBe(0);
    expect(firstMonthAfter.total).toBeCloseTo((1844 + 1956) * 12, 2);

    // The critical invariant: no month's total ever reaches the sum of ALL
    // THREE bands at once — that sum is what the double-counting bug would
    // have produced at the transition month.
    const allThreeAtOnce = (3800 + 1844 + 1956) * 12;
    for (const p of points) {
      expect(p.total).toBeLessThan(allThreeAtOnce);
    }
  });

  // The exact household the coordinator reported the double-counting spike
  // on: Client (b. Feb 1958, PIA $3,000, plan-to 84) dies February 2042;
  // Spouse (b. Mar 1960, PIA $2,000, plan-to 86) survives. Run through the
  // real engine end to end, not a hand-built band fixture, so this pins the
  // fix against `analyzeHousehold`'s actual output rather than an
  // idealization of it.
  it('does not spike the household above its real combined rate at the first death (real household)', async () => {
    const client: Person = {
      id: 'a', name: 'Client', birthYear: 1958, birthMonth: 2,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 84,
    };
    const spouse: Person = {
      id: 'b', name: 'Spouse', birthYear: 1960, birthMonth: 3,
      gender: 'female', piaMonthly: 2000, lifeExpectancy: 86,
    };
    const result = await analyzeHousehold(
      { status: 'married', people: [client, spouse] },
      assumptions,
      asOf,
    );
    const people = result.people.map((p) => p.person);
    const monthly = buildMonthlyIncomeSeries(result.periods, people);

    const deathMonthIndex = Math.min(
      result.finalIndexByPersonId.a,
      result.finalIndexByPersonId.b,
    );
    // Guard: this fixture is only the regression it's meant to be if Client
    // really does die first, mid-way through the couple's timeline.
    expect(deathMonthIndex).toBe(result.finalIndexByPersonId.a);

    const beforeSteadyState = monthly.find((p) => p.monthIndex === deathMonthIndex - 12)!.total;
    const maxTotal = Math.max(...monthly.map((p) => p.total));
    // The bug reported ~$99k — well above the ~$68k the household actually
    // ever receives. The maximum monthly figure anywhere in the series must
    // be no more than the household's own steady-state combined rate before
    // the death (Client's own band never runs alongside Sarah's survivor
    // band, so nothing else can exceed it either).
    expect(maxTotal).toBeCloseTo(beforeSteadyState, 2);
    expect(maxTotal).toBeLessThan(90000);

    // The month Client dies still pays his full rate plus Spouse's own —
    // flat, not prorated down.
    const lastMonth = monthly.find((p) => p.monthIndex === deathMonthIndex)!;
    expect(lastMonth.total).toBeCloseTo(beforeSteadyState, 2);

    // The very next month drops to Spouse's own-plus-survivor total, in one
    // clean step — never both totals at once.
    const nextMonth = monthly.find((p) => p.monthIndex === deathMonthIndex + 1)!;
    expect(nextMonth.byPersonId.a).toBe(0);
    expect(nextMonth.total).toBeLessThan(lastMonth.total);
  });
});

describe('visibleBenefitSeries', () => {
  const a: Person = { ...dan };
  const b: Person = { ...sarah };

  it('drops a series that is zero at every point', () => {
    const timeline = [
      { year: 2030, bySeries: { 'a:personal': 12000, 'b:spousal': 0 }, byPersonId: { a: 12000, b: 0 }, total: 12000 },
      { year: 2031, bySeries: { 'a:personal': 12000, 'b:spousal': 0 }, byPersonId: { a: 12000, b: 0 }, total: 12000 },
    ];
    const series = visibleBenefitSeries(timeline, [a, b]);
    expect(series.map((s) => s.key)).toEqual(['a:personal']);
  });

  it('keeps a series that is nonzero in at least one point', () => {
    const timeline = [
      { year: 2030, bySeries: { 'a:personal': 12000, 'b:spousal': 0 }, byPersonId: { a: 12000, b: 0 }, total: 12000 },
      { year: 2031, bySeries: { 'a:personal': 12000, 'b:spousal': 400 }, byPersonId: { a: 12000, b: 400 }, total: 12400 },
    ];
    const series = visibleBenefitSeries(timeline, [a, b]);
    expect(series.map((s) => s.key).sort()).toEqual(['a:personal', 'b:spousal']);
  });

  it('orders each person own-band first, then spousal, then survivor', () => {
    const timeline = [
      {
        year: 2030,
        bySeries: { 'b:survivor': 500, 'a:personal': 12000, 'b:spousal': 200, 'b:personal': 100 },
        byPersonId: { a: 12000, b: 800 },
        total: 12800,
      },
    ];
    const series = visibleBenefitSeries(timeline, [a, b]);
    expect(series.map((s) => s.key)).toEqual([
      'a:personal',
      'b:personal',
      'b:spousal',
      'b:survivor',
    ]);
  });

  // A `bySeries` key naming someone absent from `people` means the two
  // arguments are inconsistent with each other. Defaulting that series to
  // person 0 used to draw it in person 0's color under person 0's name — a
  // wrong label with no visible error. This must fail loudly instead.
  it('throws rather than silently attributing an unrecognized personId to person 0', () => {
    const timeline = [
      { year: 2030, bySeries: { 'c:personal': 1000 }, byPersonId: { c: 1000 }, total: 1000 },
    ];
    expect(() => visibleBenefitSeries(timeline, [a, b])).toThrow(/c/);
  });
});

describe('engine periods', () => {
  it('exposes the engine periods on the analysis', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    // Guard: `every`/`some` below are vacuously true/false on an empty
    // array, and an empty periods list is exactly what a broken wire-up to
    // householdPeriods() would produce without erroring.
    expect(result.periods.length).toBeGreaterThan(0);
    expect(result.periods.every((b) => b.monthlyAmount >= 0)).toBe(true);
    // Both people must actually be represented, each holding at least one
    // personal band — the one band type every recipient is guaranteed. A
    // regression that dropped a person, or mapped every recipientIndex onto
    // the same personId (the exact defect `personId` exists to catch), would
    // leave one of these false while still passing the length/amount checks
    // above.
    expect(result.periods.some((b) => b.personId === 'a' && b.type === 'personal')).toBe(true);
    expect(result.periods.some((b) => b.personId === 'b' && b.type === 'personal')).toBe(true);
    // For this fixture Sarah survives Dan under the engine's one modeled
    // direction (see benefitPeriods.ts), so her personal band is carried
    // forward into a genuine survivor band rather than truncated — pinning
    // that the periods array reflects real structure, not just personal
    // bands relabeled.
    expect(result.periods.some((b) => b.personId === 'b' && b.type === 'survivor')).toBe(true);
  });

  it('credits only the months a person is actually paid, not a flat twelve', async () => {
    // `buildCombinedTimeline` (calendar-year sums, read only by `incomeCliff`
    // and `survivorIncome`) credits 12 payments only for a year a band fully
    // covers. Dan is born in April with a plan-to age of 85, so his last
    // calendar year pays four months, not twelve. The chart itself no longer
    // reads this function at all — see `buildMonthlyIncomeSeries` below —
    // but this one still has to stay calendar-year-precise for the readers
    // that do.
    //
    // The partial year asserted here is the *last* one rather than the first:
    // the optimizer's chosen filing age for this fixture lands in January
    // (delayed credits are paid from January, so January filings dominate),
    // which makes his first calendar year a genuinely full one.
    const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);

    const end = Math.max(...result.periods.map((b) => b.endIndex));
    const lastYear = Math.floor(end / 12);
    const monthsPaid = (end % 12) + 1;
    expect(lastYear).toBe(dan.birthYear + dan.lifeExpectancy);
    expect(monthsPaid).toBe(dan.birthMonth); // April → Jan–Apr

    const point = result.combinedTimeline.find((p) => p.year === lastYear)!;
    const prior = result.combinedTimeline.find((p) => p.year === lastYear - 1)!;
    expect(point.total).toBeLessThan(prior.total);
    // And short by exactly the months he is not paid, not some other amount.
    expect(point.total).toBeCloseTo((prior.total / 12) * monthsPaid, 2);
  });

  it('sums every band into the year totals, spousal included', async () => {
    // A spouse with no record of her own receives nothing but the spousal
    // top-up, so her timeline row is exactly the spousal band. The old
    // monthlyAtFilingAge-driven timeline showed her as $0 forever.
    const noRecord: Person = { ...sarah, piaMonthly: 0 };
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, noRecord] },
      assumptions,
      asOf,
    );
    const spousal = result.periods.filter((b) => b.type === 'spousal');
    expect(spousal).toHaveLength(1);
    expect(spousal[0].monthlyAmount).toBeGreaterThan(0);

    // A full calendar year strictly inside the spousal band pays 12 months of
    // it and nothing else, since she has no personal benefit.
    const fullYear = Math.floor(spousal[0].startIndex / 12) + 1;
    const point = result.combinedTimeline.find((p) => p.year === fullYear)!;
    expect(point.byPersonId.b).toBeCloseTo(spousal[0].monthlyAmount * 12, 2);
  });

  it('reports no survivor gap when the engine models the survivor direction', async () => {
    // Dan out-earns Sarah and she outlives him (85 vs 88), so the engine's
    // one-directional survivor model is the direction this household needs.
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    expect(result.survivorGap).toBeNull();
    expect(result.periods.some((b) => b.type === 'survivor')).toBe(true);
  });

  it('has no survivor gap for a single claimant', async () => {
    const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(result.survivorGap).toBeNull();
  });

  it('reports the survivor gap the optimizer can actually produce', async () => {
    // The engine pays survivor benefits only to the lower-PIA dependent, so
    // when the EARNER outlives the dependent no survivor band exists — and if
    // that survivor holds the smaller benefit, the chart understates them.
    //
    // Reaching it through the optimizer needs the two benefits close and the
    // person with the LARGER benefit to die first. An older spouse with a
    // slightly lower PIA does it: born Mar 1957 (FRA 66y6m), so filing at
    // Re-homed when the optimizer moved to a plan-to-age horizon: the old
    // couple no longer lands on this branch at all. This one was found by
    // `find-candidates.sweep.ts` under the NEW methodology
    // (`SWEEP_FIND=survivor-gap-filed`), which searches the real pipeline —
    // the only reliable way to author a case that reaches a branch, and the
    // reason that tool exists.
    //
    // Both disclosed figures are contemporaneous here: the survivor has
    // already filed, so `survivorOwnMonthly` is a live amount rather than
    // null. The under-60 variant is its own branch.
    const older: Person = {
      id: 'a', name: 'Avery', birthYear: 1975, birthMonth: 1,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 72,
    };
    const younger: Person = {
      id: 'b', name: 'Blake', birthYear: 1962, birthMonth: 12,
      gender: 'female', piaMonthly: 2400, lifeExpectancy: 84,
    };
    const result = await analyzeHousehold(
      { status: 'married', people: [older, younger] },
      { annualCola: 2.5, discountRate: 0.025 },
      asOf,
    );

    // Guards: this is only the gap case if no survivor band exists at all.
    expect(result.periods.some((b) => b.type === 'survivor')).toBe(false);
    expect(result.survivorGap).not.toBeNull();
    expect(result.survivorGap!.survivorLabel).toBe('Avery');
    expect(result.survivorGap!.survivorUnder60).toBe(false);
    expect(result.survivorGap!.survivorOwnMonthly).not.toBeNull();
    expect(result.survivorGap!.deceasedMonthly).toBeGreaterThan(
      result.survivorGap!.survivorOwnMonthly!,
    );
    // Read at the month of the death, not at the end of life: the band paying
    // each person in Mar 2042 (Avery's final month) and Apr 2042 (the month a
    // survivor benefit would begin).
    // Blake (b. Dec 1962, plan-to 84) reaches that age in Dec 2046 and dies
    // first; Avery (b. Jan 1975, plan-to 72) survives them. Both figures are
    // read off the engine's own bands rather than restated, so a change to
    // either the bands or the gap breaks this rather than only one of them.
    const death = (1962 + 84) * 12 + 11;
    const paidAt = (id: string, monthIndex: number) =>
      result.periods.find(
        (b) =>
          b.personId === id &&
          b.type === 'personal' &&
          b.startIndex <= monthIndex &&
          monthIndex <= b.endIndex,
      )!;
    expect(result.survivorGap!.survivorOwnMonthly).toBe(paidAt('a', death + 1).monthlyAmount);
    expect(result.survivorGap!.deceasedMonthly).toBe(paidAt('b', death).monthlyAmount);
  });

  it("matches each person's monthlyAtFilingAge to their final personal band", async () => {
    // `analyzePerson` still computes `monthlyAtFilingAge` independently of the
    // periods. The two must not drift: the amount a person is paid on their
    // own record after any delayed-credit January bump is their last personal
    // band. (They are not the whole story — the bands also carry spousal and
    // survivor amounts, which `monthlyAtFilingAge` has never included.)
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    for (const p of result.people) {
      const last = result.periods
        .filter((b) => b.personId === p.person.id && b.type === 'personal')
        .reduce((latest, b) => (b.startIndex > latest.startIndex ? b : latest));
      expect(last.monthlyAmount).toBeCloseTo(p.monthlyAtFilingAge, 2);
    }
  });

  it('keeps the start date of a spousal entitlement that is fully absorbed', async () => {
    // The engine pushes a Spousal period on date validity alone, so it can
    // carry $0.00: `eligibleForSpousalBenefit` tests half the earner's PIA
    // against the dependent's PIA, while `spousalBenefitOnDate` re-tests it
    // against the dependent's delayed-credit-inflated *benefit*.
    //
    // Blythe (b. Mar 1958, FRA 66y8m, PIA $1,400) is entitled to $100 at her
    // own FRA — half of Avery's $3,000 less her own PIA. The optimizer files
    // her at 67y10m, 14 months past her FRA, so her own benefit is
    // 1400 × (1 + 14 × 2/3%) = $1,530.67, already above the $1,500 combined
    // cap. Nothing is payable, but the entitlement is real and it begins the
    // month Avery files.
    // Plan-to ages lowered from 85/90 when the optimizer moved to a
    // plan-to-age horizon: the same couple with the old ages no longer files
    // Blythe past her FRA, and the $0-band case needs her delayed credits to
    // have absorbed the whole entitlement. The PIAs and birth dates — which
    // are what make the entitlement $100 and the cap bite — are unchanged.
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1960, birthMonth: 6,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 72,
    };
    const blythe: Person = {
      id: 'b', name: 'Blythe', birthYear: 1958, birthMonth: 3,
      gender: 'female', piaMonthly: 1400, lifeExpectancy: 72,
    };
    const result = await analyzeHousehold(
      { status: 'married', people: [avery, blythe] },
      { annualCola: 0, discountRate: 0.025 },
      asOf,
    );

    // Guards everything below — if the optimizer ever stopped filing her past
    // her own FRA, this scenario would no longer be the $0-band case at all.
    const spousal = result.periods.filter((b) => b.type === 'spousal');
    expect(spousal).toHaveLength(1);
    expect(spousal[0].monthlyAmount).toBe(0);

    const topUp = result.spousalTopUp!;
    expect(topUp.atFra).toBeCloseTo(100, 2);
    expect(topUp.atRecommendedFilingAge).toBe(0);
    // The start is reported rather than suppressed: the entitlement exists
    // and does begin, even though it pays nothing. Read off the band rather
    // than restated, so the date and the amount cannot drift apart.
    expect(topUp.startsAtSpouseAge).toBe('67 years, 10 months');
  });

  it('reports no spousal start when there is no entitlement at all', async () => {
    // Both earn enough that half of the higher PIA never exceeds the lower
    // one, so the engine emits no Spousal period. There is no start to state.
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    expect(result.periods.some((b) => b.type === 'spousal')).toBe(false);
    expect(result.spousalTopUp!.atFra).toBe(0);
    expect(result.spousalTopUp!.atRecommendedFilingAge).toBe(0);
    // Null, not a placeholder string. A display glyph chosen here escaped
    // into the PDF unguarded; the type now forces each surface to decide.
    expect(result.spousalTopUp!.startsAtSpouseAge).toBeNull();
  });

  it('reports no spousal start when the lower earner dies before the higher earner files', async () => {
    // A positive entitlement with no band at all. `strategy-calc.ts:158`
    // pushes the Spousal period only when `endDate >= startDate`, and here
    // Blythe's plan-to age of 75 (Jun 2033) precedes Avery's filing, so she
    // is eligible and never collects. This is why `atFra > 0` cannot be used
    // as a proxy for "there is a start date".
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1976, birthMonth: 6,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 85,
    };
    const blythe: Person = {
      id: 'b', name: 'Blythe', birthYear: 1958, birthMonth: 6,
      gender: 'female', piaMonthly: 500, lifeExpectancy: 75,
    };
    const result = await analyzeHousehold(
      { status: 'married', people: [avery, blythe] },
      assumptions,
      asOf,
    );
    expect(result.spousalTopUp!.atFra).toBeCloseTo(1000, 2); // 3000/2 − 500
    expect(result.periods.some((b) => b.type === 'spousal')).toBe(false);
    expect(result.spousalTopUp!.startsAtSpouseAge).toBeNull();
  });
});

describe('analyzeHousehold — survivor income per strategy', () => {
  it('reports survivor income for every compared strategy', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    expect(result.comparisons.every((s) => s.survivorIncome !== null)).toBe(true);

    // `earliest` used to be unreachable for every household this app can
    // produce, and this line asserted its absence as a tripwire: the row
    // asked `findStrategyByAges` for exactly 62 years 0 months, while
    // `createPiaRecipient` fixes every birth day at `DEFAULT_BIRTH_DAY = 15`
    // and `Birthdate.earliestFilingMonth()` rounds anyone not born on the
    // 1st or 2nd up to 62 years *1* month. The tripwire fired as designed
    // when `resolveScenario` started reading each person's own floor off the
    // engine's attainable set instead of a constant. It is now the FULL
    // ordering that is asserted, which is the thing the column exists to
    // show and could never be checked while the earliest row was missing.
    const earliest = result.comparisons.find((s) => s.key === 'earliest');
    const fra = result.comparisons.find((s) => s.key === 'fra');
    const latest = result.comparisons.find((s) => s.key === 'latest');
    expect(earliest).toBeDefined();
    expect(fra).toBeDefined();
    expect(latest).toBeDefined();
    // Delaying raises the survivor's income, at every step.
    expect(fra!.survivorIncome!).toBeGreaterThan(earliest!.survivorIncome!);
    expect(latest!.survivorIncome!).toBeGreaterThan(fra!.survivorIncome!);
  });

  it('leaves survivor income null for a single claimant', async () => {
    const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(result.comparisons.every((s) => s.survivorIncome === null)).toBe(true);
  });

  it('leaves survivor income null for every row when the two final months tie', async () => {
    // Same birth month, same plan-to age: `firstDeath` returns null rather
    // than inventing a survivor, so no row has a figure and both surfaces
    // hide the column and its caption (I3).
    const twinB: Person = { ...sarah, birthYear: dan.birthYear, birthMonth: dan.birthMonth,
      lifeExpectancy: dan.lifeExpectancy };
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, twinB] },
      assumptions,
      asOf,
    );
    expect(result.comparisons.every((s) => s.survivorIncome === null)).toBe(true);
    expect(showSurvivorIncomeColumn(result.comparisons, result.people.length)).toBe(false);
  });
});

/**
 * The permanent counter-example to the survivor-income column's old caption,
 * which asserted "Delaying raises this every year the survivor lives through
 * it" unbranched, in the no-gap case — the common case.
 *
 * An older higher earner with a much younger, lower-earning spouse is the
 * archetype this whole analysis exists for, not an edge case: under "both
 * delay to 70" Sarah has not filed by the year after Dan's death, so the
 * household's survivor income that year is $0, against $36,480 under the
 * optimum. `survivorGap` is null throughout — nothing else in the caption
 * would have caught it.
 */
describe('analyzeHousehold — survivor income can FALL with a later filing age', () => {
  const older: Person = {
    id: 'a', name: 'Dan', birthYear: 1958, birthMonth: 4,
    gender: 'male', piaMonthly: 2400, lifeExpectancy: 78,
  };
  const younger: Person = {
    id: 'b', name: 'Sarah', birthYear: 1968, birthMonth: 2,
    gender: 'female', piaMonthly: 1200, lifeExpectancy: 90,
  };

  it('pays the survivor nothing under "both delay to 70" and $36,480 under the optimum', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [older, younger] },
      assumptions,
      asOf,
    );
    // No gap: the modeled survivor is the lower-PIA dependent, so the engine
    // does model her step-up. The old caption had no branch for this.
    expect(result.survivorGap).toBeNull();

    const latest = result.comparisons.find((s) => s.key === 'latest');
    const optimal = result.comparisons.find((s) => s.isOptimal);
    expect(latest).toBeDefined();
    expect(optimal).toBeDefined();
    expect(latest!.filingAges.map((f) => f.label)).toEqual(['70', '70']);
    expect(latest!.survivorIncome).toBe(0);
    expect(optimal!.survivorIncome).toBe(36480);
  });

  it('reports that the column does not rise, and the caption states the composition fact', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [older, younger] },
      assumptions,
      asOf,
    );
    expect(survivorIncomeRisesWithDelay(result.comparisons)).toBe(false);

    // The claim is falsifiable BY THE DATA, end to end: real engine output
    // into the real caption, no hand-built rows in between.
    const caption = survivorIncomeCaption(result.comparisons, result.survivorGap);
    expect(caption).not.toContain('Delaying raises');
    expect(caption).toContain('not simply larger for later filing');
  });

  it('still reports a rise for a household where delaying genuinely does raise it', async () => {
    // Guard against a check that returns false for everything: Dan/Sarah's
    // own figures do rise, and their caption keeps the delay claim.
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    expect(survivorIncomeRisesWithDelay(result.comparisons)).toBe(true);
    expect(survivorIncomeCaption(result.comparisons, result.survivorGap)).toContain(
      'Delaying raises this figure for this household',
    );
  });
});

/**
 * The whole analysis, reduced to something two entry orders can be compared
 * on directly.
 *
 * The previous swap tests asserted a handful of fields — filing-age labels,
 * timeline totals, `lowerEarnerLabel` — and the equal-PIA pair asserted only
 * that `lowerEarnerLabel` was null. That is why an exact PIA tie could return
 * "Dan 63y9m / Sarah 70" one way round and "Dan 70 / Sarah 62y1m" the other,
 * with a $1,179/mo survivor band in one and none in the other, while every
 * test passed: nothing compared the periods, the cliff, the row order or the
 * filing ages themselves.
 *
 * Person ids are positional ('a' then 'b'), so a swapped household's ids are
 * attached to the other people. Everything id-keyed is therefore re-keyed
 * onto the person's NAME, which travels with the person, and every collection
 * is sorted into a canonical order so a difference in array position cannot
 * masquerade as a difference in content.
 */
function canonicalize(analysis: HouseholdAnalysis) {
  const nameById: Record<string, string> = {};
  for (const p of analysis.people) nameById[p.person.id] = p.person.name ?? p.person.id;
  const byName = <T>(record: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [id, value] of Object.entries(record)) out[nameById[id] ?? id] = value;
    return out;
  };

  return {
    // Filing ages keyed by person, not by slot.
    filingAges: Object.fromEntries(
      analysis.people.map((p, i) => [
        nameById[p.person.id],
        analysis.optimal.filingAges[i].label,
      ]),
    ),
    expectedNpv: Math.round(analysis.optimal.expectedNpv * 100) / 100,
    // Row ORDER included deliberately: the row carrying the "Best" badge
    // moved between entry orders (I5), which no assertion caught.
    comparisons: analysis.comparisons.map((c) => ({
      key: c.key,
      isOptimal: c.isOptimal,
      survivorIncome: c.survivorIncome,
      ages: [...c.filingAges.map((f) => f.label)].sort(),
    })),
    periods: analysis.periods
      .map((b) => ({ ...b, personId: nameById[b.personId] ?? b.personId }))
      .sort(
        (x, y) =>
          x.personId.localeCompare(y.personId) ||
          x.type.localeCompare(y.type) ||
          x.startIndex - y.startIndex,
      ),
    combinedTimeline: analysis.combinedTimeline.map((point) => ({
      year: point.year,
      total: point.total,
      byPerson: byName(point.byPersonId),
      bySeries: Object.fromEntries(
        Object.entries(point.bySeries).map(([key, value]) => {
          const idx = key.lastIndexOf(':');
          return [`${nameById[key.slice(0, idx)] ?? key.slice(0, idx)}${key.slice(idx)}`, value];
        }),
      ),
    })),
    finalIndexes: byName(analysis.finalIndexByPersonId),
    incomeCliff: incomeCliff(analysis),
    survivorGap: analysis.survivorGap,
    // `survivorLabel` inside is already a name, not a slot — nothing else to
    // re-key. Included so the existing swap tests below cover Task 2's wiring
    // for free: a `survivorClaimAlternative` call fed display-order arrays
    // would compute the wrong household's numbers, and this catches it the
    // same way it caught the periods/cliff/row-order defects it was written
    // for.
    survivorClaim: analysis.survivorClaim,
    spousalTopUp: analysis.spousalTopUp,
    // Split and sorted: the sentence names the people in display order by
    // design, so only its per-person clauses are comparable across orders.
    recommendation: [...analysis.recommendation.split(' · ')].sort(),
  };
}

/**
 * `analyzeHousehold`'s wiring of Task 1's `survivorClaimAlternative` — that
 * it is called at all, with the household's real recommended filing ages,
 * and that it is null where there is nothing to show.
 *
 * The household below is a real, deterministic one (not a hand-built
 * `SurvivorClaimAlternative`) chosen because ssa.tools' own optimizer happens
 * to file Ann early enough, and Bob late enough, that Bob's own recommended
 * filing date lands after Ann's death. Its exact figures are pinned so a
 * future engine or `household.ts` change that quietly moves them fails a test
 * here, not just in `survivorClaim.test.ts`'s hand-derived unit fixtures —
 * and outside the golden suite this is the only optimizer-driven check of the
 * `baselineHasSurvivorBand: false` population at all.
 *
 * The pinned figures are OPTIMIZER-DRIVEN and are not the forced-age ones.
 * `survivorClaim.test.ts`'s own `baselineHasSurvivorBand: false` case runs the
 * same two people at a hand-picked [70, 70] and gets $102,960; that figure
 * does not transfer here, because the optimizer files Bob at 68y8m, not 70.
 * Derivation, all of it a consequence of the recorded filing ages (Ann 65y9m,
 * Bob 68y8m) and the two plan-to ages:
 *
 *  - Ann dies May 2027 at 62, before her own 65y9m filing date, so no band of
 *    hers is ever emitted and her survivor base is her full $1,200 PIA.
 *  - Bob files at 68y8m = Jan 2044 and holds a $2,720/mo personal band from
 *    there to his plan-to month, May 2065: 257 months x $2,720 = $699,040.
 *    That band is the WHOLE displayed baseline — no survivor band exists, so
 *    `baselineHasSurvivorBand` is false and this is the population the flag
 *    is for.
 *  - The search's best month is his SSA age 60, May 2035 (claimAge '60'),
 *    paying 0.715 x $1,200 = $858/mo. It is worth having only until his own
 *    $2,720 starts: May 2035 through Dec 2043 = 104 months x $858 = $89,232,
 *    which is the gain, and $699,040 + $89,232 = $788,272 the best total.
 *
 * A moved optimizer recommendation moves all three, which is the point: the
 * previous version of this test asserted only `gain > 0` and
 * `bestTotal === baselineTotal + gain` — and the latter is how
 * `survivorClaim.ts:241-243` computes `gain` in the first place, so it could
 * not fail for any household at all.
 *
 * Ann's `lifeExpectancy: 62` is below this app's own input floor
 * (`LIFE_EXPECTANCY_BOUNDS.min = 75`, `formBounds.ts`) — deliberately, to get
 * a real death from the live optimizer without hand-building bands, exactly
 * as `survivorClaim.test.ts`'s own fixtures do. That makes this a valid
 * WIRING test but not a representative one: it is not "the population this
 * module exists for" the way a household built from the app's own bounds
 * would be, and `methodologyCopy.ts`'s `survivorClaimNote` docstring's
 * reachability proof (that a non-null `survivorClaim` implies a non-null
 * `incomeCliff`) explicitly does not cover it.
 */
describe('analyzeHousehold — survivor claim alternative', () => {
  const ann: Person = {
    id: 'a', name: 'Ann', birthYear: 1965, birthMonth: 5,
    gender: 'female', piaMonthly: 1200, lifeExpectancy: 62,
  };
  const bob: Person = {
    id: 'b', name: 'Bob', birthYear: 1975, birthMonth: 5,
    gender: 'male', piaMonthly: 2400, lifeExpectancy: 90,
  };

  it('carries a survivor claim alternative onto the analysis', async () => {
    // Re-homed when the optimizer moved to a plan-to-age horizon — the old
    // Ann/Bob couple no longer reaches this branch at ANY plan-to combination
    // (121 pairs searched). This household came from
    // `find-candidates.sweep.ts` (`SWEEP_FIND=survivor-no-band`), which
    // searches the real pipeline rather than a hand-guessed shape.
    //
    // The two PIAs are equal. That is not incidental and it is not a problem:
    // on a tie `compareForEngine` canonicalizes on the plan-to age, so the
    // engine slot is a fact about the household rather than about typing
    // order, and the order-independence sweep covers it. What matters here is
    // that the long-lived spouse has a real age-60 entitlement the baseline
    // bands show nothing of.
    const longLived: Person = {
      id: 'a', name: 'Ann', birthYear: 1964, birthMonth: 1,
      gender: 'male', piaMonthly: 2400, lifeExpectancy: 72,
    };
    const survivor: Person = {
      id: 'b', name: 'Bob', birthYear: 1975, birthMonth: 12,
      gender: 'female', piaMonthly: 2400, lifeExpectancy: 88,
    };
    const result = await analyzeHousehold(
      { status: 'married', people: [longLived, survivor] },
      assumptions,
      asOf,
    );
    expect(result.survivorClaim).not.toBeNull();
    expect(result.survivorClaim!.survivorLabel).toBe('Bob');
    // The whole point of the alternative: the recommended strategy's own
    // bands carry no survivor band, so nothing on the chart shows this money.
    expect(result.survivorClaim!.baselineHasSurvivorBand).toBe(false);
    expect(result.survivorClaim!.claimAge).toBe('60 years, 2 months');
    expect(result.survivorClaim!.baselineTotal).toBe(645_792);
    expect(result.survivorClaim!.bestTotal).toBe(814_414);
    // Stated as the subtraction it is, so a change to either total that left
    // the difference intact still fails.
    expect(result.survivorClaim!.gain).toBe(
      result.survivorClaim!.bestTotal - result.survivorClaim!.baselineTotal,
    );
    expect(result.survivorClaim!.gain).toBe(168_622);
  });

  it('sets survivorClaim to null for a single claimant', async () => {
    const result = await analyzeHousehold({ status: 'single', people: [bob] }, assumptions, asOf);
    expect(result.survivorClaim).toBeNull();
  });

  it('computes the same survivor claim alternative whichever spouse is entered first', async () => {
    // The exact defect this wiring must not reintroduce: `survivorClaim.ts`
    // fed display-order arrays instead of the canonicalized engine-order ones
    // would compute a different household's numbers depending on typing
    // order, even though `survivorLabel` itself is name-keyed and would look
    // plausible either way.
    const forward = await analyzeHousehold(
      { status: 'married', people: [ann, bob] },
      assumptions,
      asOf,
    );
    const swapped = await analyzeHousehold(
      { status: 'married', people: [{ ...bob, id: 'a' }, { ...ann, id: 'b' }] },
      assumptions,
      asOf,
    );
    expect(swapped.survivorClaim).toEqual(forward.survivorClaim);
  });
});

describe('analyzeHousehold — entry order', () => {
  /**
   * Entry order is a data-entry accident, not a fact about the household. An
   * adviser must not have to put the older, younger, higher- or lower-earning
   * person first.
   *
   * Dan (PIA 2400) and Sarah (PIA 2100) have unequal PIAs, so this does NOT
   * exercise the `personA.piaMonthly >= personB.piaMonthly` seam at
   * `household.ts` — a strict `>` and a `>=` agree whenever the two values
   * differ. It only proves that a REAL asymmetry (an actual higher/lower
   * earner) survives a swap. The equal-PIA case below is what exercises the
   * seam itself.
   */
  it('produces the same analysis whichever person is entered first', async () => {
    const forward = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    const swapped = await analyzeHousehold(
      { status: 'married', people: [{ ...sarah, id: 'a' }, { ...dan, id: 'b' }] },
      assumptions,
      asOf,
    );

    // The optimum is a property of the household, so the same two ages come
    // back — attached to the other slot.
    expect(swapped.optimal.filingAges[0].label).toBe(forward.optimal.filingAges[1].label);
    expect(swapped.optimal.filingAges[1].label).toBe(forward.optimal.filingAges[0].label);
    expect(swapped.optimal.expectedNpv).toBeCloseTo(forward.optimal.expectedNpv, 2);

    // Same money, same years, whichever way round.
    expect(swapped.combinedTimeline.map((p) => p.total)).toEqual(
      forward.combinedTimeline.map((p) => p.total),
    );

    // The spousal top-up accrues to a person, not to a slot.
    expect(swapped.spousalTopUp?.atRecommendedFilingAge).toBe(
      forward.spousalTopUp?.atRecommendedFilingAge,
    );
    expect(swapped.spousalTopUp?.lowerEarnerLabel).toBe(forward.spousalTopUp?.lowerEarnerLabel);

    // And the whole analysis, not just the fields someone thought to list.
    // This one line is what would have caught the tie defect below on its
    // first run.
    expect(canonicalize(swapped)).toEqual(canonicalize(forward));
  });

  it('orders the comparison rows the same way whichever person is entered first', async () => {
    // `buildComparisons` sorted on `filingAges[0]` — person A's slot, not a
    // property of the strategy. Dan/Sarah have unequal PIAs, so this is not a
    // tie artefact: the rows came back `fra, latest, optimal` one way and
    // `optimal, fra, latest` the other, moving the row that carries the
    // "Best" badge.
    const forward = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    const swapped = await analyzeHousehold(
      { status: 'married', people: [{ ...sarah, id: 'a' }, { ...dan, id: 'b' }] },
      assumptions,
      asOf,
    );
    expect(swapped.comparisons.map((c) => c.key)).toEqual(forward.comparisons.map((c) => c.key));
    // Not vacuous: there really are several rows, and one of them is best.
    expect(forward.comparisons.length).toBeGreaterThan(1);
    expect(forward.comparisons.filter((c) => c.isOptimal)).toHaveLength(1);
  });

  it('names the same survivor whichever person is entered first', async () => {
    // Same birth month, same plan-to age: their final months are identical, so
    // the old tie-break picked whoever happened to be entered first.
    const twinA = { ...dan, id: 'a' as const, lifeExpectancy: 85 };
    const twinB = {
      ...sarah,
      id: 'b' as const,
      birthYear: dan.birthYear,
      birthMonth: dan.birthMonth,
      lifeExpectancy: 85,
    };

    const forward = await analyzeHousehold(
      { status: 'married', people: [twinA, twinB] },
      assumptions,
      asOf,
    );
    const swapped = await analyzeHousehold(
      { status: 'married', people: [{ ...twinB, id: 'a' }, { ...twinA, id: 'b' }] },
      assumptions,
      asOf,
    );
    expect(incomeCliff(swapped)).toEqual(incomeCliff(forward));
  });

  // Dan and Sarah's PIAs above differ, so neither test above can exercise
  // `household.ts`'s `personA.piaMonthly >= personB.piaMonthly` seam — a
  // strict `>` and a non-strict `>=` never disagree except on an exact tie.
  // This pair is identical in PIA (and otherwise arbitrary) to force that
  // tie.
  describe('equal-PIA tie', () => {
    const equalA: Person = { ...dan, id: 'a', piaMonthly: 2200 };
    const equalB: Person = { ...sarah, id: 'b', piaMonthly: 2200 };

    // `higherEarningsThan` (the engine's own comparison, `benefit-calculator.ts`)
    // is a strict `>`. On an exact tie it is false BOTH ways, so the engine's
    // `classifyEarnerDependent` still has to return some slot — and it always
    // returns the same one (`earner-dependent.ts:15-28` falls through to a
    // fixed `else`), regardless of which physical person occupies it. That
    // slot is not a fact about either person: swap who is in it and the SAME
    // slot still "wins". There genuinely is no lower earner for this
    // household, so `lowerEarnerLabel` must be null rather than whichever
    // name the classifier's positional default happens to attach to.
    it('reports no lower earner — null, not a name from either slot', async () => {
      const result = await analyzeHousehold(
        { status: 'married', people: [equalA, equalB] },
        assumptions,
        asOf,
      );
      // Half of equal PIAs cancels out, so this is a genuine tie: no amount
      // changes whichever way the classifier would have broken it.
      expect(result.spousalTopUp!.atFra).toBe(0);
      expect(result.spousalTopUp!.atRecommendedFilingAge).toBe(0);
      expect(result.spousalTopUp!.lowerEarnerLabel).toBeNull();
    });

    // The actual regression: a prior version of this fix left `household.ts`
    // agreeing with the engine's classifier, which made it internally
    // consistent but still order-dependent — the classifier's positional
    // default meant whichever physical person was entered first got named
    // "the lower earner". Confirmed at the data level, in both directions,
    // so `lowerEarnerLabel` cannot merely mirror production's own slot
    // arithmetic. The stronger check — that the rendered COPY is identical
    // in both directions and never leaks a name — lives in
    // `methodologyCopy.test.ts` (`spousalMethodologyCopy`), since that is the
    // surface the defect was actually visible on.
    it('reports no lower earner whichever spouse is entered first', async () => {
      const forward = await analyzeHousehold(
        { status: 'married', people: [equalA, equalB] },
        assumptions,
        asOf,
      );
      const swapped = await analyzeHousehold(
        { status: 'married', people: [{ ...equalB, id: 'a' }, { ...equalA, id: 'b' }] },
        assumptions,
        asOf,
      );
      expect(forward.spousalTopUp!.lowerEarnerLabel).toBeNull();
      expect(swapped.spousalTopUp!.lowerEarnerLabel).toBeNull();
    });

    /**
     * The defect the label fix did not reach. `classifyEarnerDependent`'s
     * positional default (slot 1 becomes the earner) reaches the engine
     * through BOTH `rankedCoupleStrategies` and `strategySumPeriodsCouple`,
     * so on a tie the typing order decided the recommended filing ages,
     * whether a Survivor period existed at all, and therefore the chart and
     * the income cliff:
     *
     *   entered [Dan, Sarah] → Dan 63y9m, Sarah 70, no survivor band,
     *                          cliff $53,520 → $32,736 (−38.8%)
     *   entered [Sarah, Dan] → Dan 70, Sarah 62y1m, survivor $1,179/mo,
     *                          cliff $51,324 → $32,736 (−36.2%)
     *
     * `survivorGap` was null both ways, so nothing on screen disclosed it.
     * The assertion is the whole analysis, not a field list — a field list is
     * how this survived the previous pass.
     */
    it('produces one analysis — ages, periods, cliff and all — whichever spouse is entered first', async () => {
      const forward = await analyzeHousehold(
        { status: 'married', people: [equalA, equalB] },
        assumptions,
        asOf,
      );
      const swapped = await analyzeHousehold(
        { status: 'married', people: [{ ...equalB, id: 'a' }, { ...equalA, id: 'b' }] },
        assumptions,
        asOf,
      );
      expect(canonicalize(swapped)).toEqual(canonicalize(forward));
    });

    it('does not call the shown figure THE maximum when two models are admissible', async () => {
      // On a tie the engine can model either spouse as the dependent, and the
      // two models need not agree — on a same-age equal-PIA couple the model
      // this app does not show scored $288 (0.04%) higher. "The optimizer
      // maximizes combined expected present value at $X" states as a fact
      // something true only inside the framing `compareForEngine` picked.
      const result = await analyzeHousehold(
        { status: 'married', people: [equalA, equalB] },
        assumptions,
        asOf,
      );
      expect(result.recommendationDetail).not.toContain('optimizer maximizes');
      expect(result.recommendationDetail).toContain('Both spouses have the same PIA');
      expect(result.recommendationDetail).toContain('Under the model shown here');
      expect(result.recommendationDetail).toContain('The other model is equally admissible');
      // Still names the figure and both ages — the qualifier replaces the
      // claim about the figure, not the figure.
      expect(result.recommendationDetail).toContain(
        `${result.optimal.filingAges[0].label}`,
      );
    });

    it('keeps the unqualified sentence for a household with a real higher earner', async () => {
      // Guard: the qualifier must not have leaked onto every married report.
      const result = await analyzeHousehold(
        { status: 'married', people: [dan, sarah] },
        assumptions,
        asOf,
      );
      // Says the figure is the best available, and on what assumption —
      // without a term the client would have to be taught first.
      expect(result.recommendationDetail).toContain('more than any other pair of ages');
      expect(result.recommendationDetail).toContain('assuming each lives to the age set for them');
      expect(result.recommendationDetail).not.toMatch(/optimi[sz]er|present value/i);
      // The word that had to go when the optimizer stopped weighting by
      // mortality: the figure is for one assumed future, not an expectation
      // across how long someone might live.
      expect(result.recommendationDetail).not.toContain('expected present value');
      expect(result.recommendationDetail).not.toContain('Both spouses have the same full benefit');
    });

    it('gives the projected survivor the slot the engine can pay a survivor benefit to', async () => {
      // Not an accident of the ordering keys but the reason for one of them:
      // the engine pays survivor benefits only to its `dependent`, which on a
      // tie is whichever person sits in slot 0. `compareForEngine` puts the
      // person the household's own plan-to inputs say outlives the other
      // there. Sarah's plan-to age is 88 against Dan's 85, so she is the
      // modeled survivor and the band is hers.
      const result = await analyzeHousehold(
        { status: 'married', people: [equalA, equalB] },
        assumptions,
        asOf,
      );
      const survivorBands = result.periods.filter((b) => b.type === 'survivor');
      expect(survivorBands).toHaveLength(1);
      expect(survivorBands[0].personId).toBe('b'); // Sarah, entered second here.
    });
  });
});

describe('householdDisplayShape', () => {
  it('gives every status its own shape', () => {
    expect(householdDisplayShape('single')).toBe('oneClaimant');
    expect(householdDisplayShape('married')).toBe('twoClaimants');
    expect(householdDisplayShape('widowed')).toBe('widowed');
  });

  it('never collapses widowed into either of the other two', () => {
    // The whole point, and the reason this used to throw rather than return.
    // `status === 'married'` as a boolean silently routed widowed into the
    // one-claimant path on both surfaces — a view that omits the survivor
    // benefit entirely, understates the recommended monthly income, and
    // (since `analyzeWidowed` empties `claimingOptions`) throws on the
    // age-62 summary card. A widow(er) is one claimant but not one benefit.
    const shape = householdDisplayShape('widowed');
    expect(shape).not.toBe('oneClaimant');
    expect(shape).not.toBe('twoClaimants');
  });
});

describe('analyzeHousehold — widowed', () => {
  const widowPerson: Person = {
    id: 'a', name: 'Widow', birthYear: 1964, birthMonth: 6,
    gender: 'female', piaMonthly: 1200, lifeExpectancy: 92,
  };
  const household: Household = {
    status: 'widowed',
    people: [widowPerson],
    deceased: {
      birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
      record: { kind: 'pia', piaMonthly: 3000, filed: null },
    },
    alreadyClaimed: { survivorSince: null, ownSince: null },
  };

  // A fixture chosen so the true optimum sits at neither of the two "extreme
  // corner" pairs the named rows probe (survivor-earliest/own-70, and
  // survivor-FRA/own-earliest) — found by search over PIA combinations. With
  // this fixture ALL FOUR rows (optimal, survivorFirst, ownFirst,
  // bothEarliest) appear as distinct comparisons, which is what lets the
  // label test and the `survivorClaimDate` tests below see `survivorFirst`
  // and `ownFirst` side by side.
  const richHousehold: Household = {
    status: 'widowed',
    people: [{ ...widowPerson, piaMonthly: 2400, lifeExpectancy: 70 }],
    deceased: {
      birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
      record: { kind: 'pia', piaMonthly: 2450, filed: null },
    },
    alreadyClaimed: { survivorSince: null, ownSince: null },
  };

  it('analyzes exactly one living person', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.status).toBe('widowed');
    expect(result.people).toHaveLength(1);
  });

  it('emits both a personal and a survivor band', async () => {
    const { periods } = await analyzeHousehold(household, assumptions, asOf);
    expect(periods.some((b) => b.type === 'personal')).toBe(true);
    expect(periods.some((b) => b.type === 'survivor')).toBe(true);
    expect(periods.every((b) => b.type !== 'spousal')).toBe(true);
  });

  it('marks exactly one comparison row optimal, with zero delta', async () => {
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    const optimal = comparisons.filter((c) => c.isOptimal);
    expect(optimal).toHaveLength(1);
    expect(optimal[0].deltaVsOptimal).toBe(0);
  });

  it('never scores a comparison above the optimal', async () => {
    const { comparisons, optimal } = await analyzeHousehold(household, assumptions, asOf);
    for (const c of comparisons) {
      expect(c.lifetimeTotal!).toBeLessThanOrEqual(optimal.lifetimeTotal! + 0.01);
    }
  });

  it('carries a lifetime total, and no expected-NPV claim', async () => {
    // The widowed score is an undiscounted lifetime sum, not a mortality-
    // weighted present value. `lifetimeTotal` is non-null exactly where that
    // is true, so a display layer can tell which figure it is holding.
    const { optimal } = await analyzeHousehold(household, assumptions, asOf);
    expect(optimal.lifetimeTotal).not.toBeNull();
    expect(optimal.lifetimeTotal!).toBeGreaterThan(0);
  });

  it('leaves lifetimeTotal null for a married household', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] }, assumptions, asOf,
    );
    expect(result.optimal.lifetimeTotal).toBeNull();
  });

  it('has no spousal top-up, survivor gap or survivor-claim alternative', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.spousalTopUp).toBeUndefined();
    expect(result.survivorGap).toBeNull();
    // The claim date is part of the recommendation now, not an alternative to it.
    expect(result.survivorClaim).toBeNull();
  });

  // --- Review findings (Task 3, round 2) ---

  it('carries a non-null lifetimeTotal on EVERY widowed row, not just the optimal', async () => {
    // Regression for a mutant that survived round 1: mutating the married
    // branch's `lifetimeTotal: null` to a non-null value left every test
    // passing because only `optimal.lifetimeTotal` was ever checked. The
    // invariant is "non-null exactly for widowed rows", so it has to be
    // checked across every row of both a widowed AND a married household —
    // see the next test for the married half.
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    expect(comparisons.length).toBeGreaterThan(1);
    for (const c of comparisons) {
      expect(c.lifetimeTotal).not.toBeNull();
      expect(c.lifetimeTotal!).toBeGreaterThan(0);
    }
  });

  it('leaves lifetimeTotal null on EVERY row of a married household', async () => {
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] }, assumptions, asOf,
    );
    expect(result.comparisons.length).toBeGreaterThan(1);
    for (const c of result.comparisons) {
      expect(c.lifetimeTotal).toBeNull();
    }
  });

  it('gives every non-optimal widowed row a strictly negative delta', async () => {
    // Regression for a second surviving mutant: flipping the subtraction
    // order in `deltaVsOptimal: roundCents(outcome.lifetimeTotal -
    // best.lifetimeTotal)` left every test passing, because the only
    // assertion in play (`marks exactly one comparison row optimal, with
    // zero delta`, above) checks the OPTIMAL row's delta is 0 — a value
    // that is sign-invariant under that flip. A non-optimal row's delta is
    // the only place the sign is observable.
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    const nonOptimal = comparisons.filter((c) => !c.isOptimal);
    expect(nonOptimal.length).toBeGreaterThan(0);
    for (const c of nonOptimal) {
      expect(c.deltaVsOptimal).toBeLessThan(0);
    }
  });

  it('names the comparison rows explicitly, folding the named pair that coincides with the optimum', async () => {
    // Regression for a third surviving mutant: deleting the dedupe
    // `continue` left every test passing, because nothing asserted WHICH
    // keys made it into `comparisons`, only counts and inequalities. For
    // this fixture the optimum's (survivor-claim, own-filing) pair is
    // exactly `ownFirst`'s pair, so `ownFirst` must be folded away and only
    // `optimal`, `survivorFirst` and `bothEarliest` should remain, in that
    // (push) order.
    const { comparisons } = await analyzeHousehold(household, assumptions, asOf);
    expect(comparisons.map((c) => c.key)).toEqual(['optimal', 'survivorFirst', 'bothEarliest']);
  });

  it('dedupes named rows when alreadyClaimed collapses a range to one point', async () => {
    // Regression for the reviewer's third Important finding: with
    // `ownSince` set, `widowedSearchRanges` collapses the OWN range to a
    // single point, so `survivorFirst`'s pair and `bothEarliest`'s pair
    // become identical (`[ranges.survivor[0], f]` both), and separately
    // `ownFirst`'s pair coincides with the optimum. Before the fix these
    // printed as two rows with the same filing age and the same
    // `lifetimeTotal`, differing only by label.
    const ownSinceHousehold: Household = {
      ...household,
      alreadyClaimed: { survivorSince: null, ownSince: { year: 2030, month: 1 } },
    };
    const { comparisons } = await analyzeHousehold(ownSinceHousehold, assumptions, asOf);
    expect(comparisons.map((c) => c.key)).toEqual(['optimal', 'survivorFirst']);

    // General form of the same check, independent of this fixture's exact
    // keys: no two rows share the underlying (survivor-claim, own-filing)
    // pair, read off `survivorClaimDate.monthIndex` + `filingAges[0]`.
    const pairKeys = comparisons.map(
      (c) => `${c.survivorClaimDate?.monthIndex}:${c.filingAges[0].years}y${c.filingAges[0].months}m`,
    );
    expect(new Set(pairKeys).size).toBe(pairKeys.length);
  });

  it('labels a named row from the dates that row actually carries', async () => {
    // The labels were constants: "Survivor benefit first, own at 70" and
    // "Own benefit first, survivor at FRA". Neither age is a property of the
    // row — `ranges.own[1]` is age 70 only while `alreadyClaimed.ownSince` is
    // null. With `ownSince = Jan 2030` the app printed a row labeled
    // "...own at 70" beside its own filing age of "65 years, 7 months".
    //
    // This reads the LABEL. The dedupe test above asserts which rows appear
    // and never looks at their text, which is why the mismatch survived every
    // round of review on the same fixture.
    const ownSinceHousehold: Household = {
      ...household,
      alreadyClaimed: { survivorSince: null, ownSince: { year: 2030, month: 1 } },
    };
    const { comparisons } = await analyzeHousehold(ownSinceHousehold, assumptions, asOf);
    const survivorFirst = comparisons.find((c) => c.key === 'survivorFirst');
    expect(survivorFirst).toBeDefined();
    expect(survivorFirst!.filingAges[0].label).toBe('65 years, 7 months');
    expect(survivorFirst!.label).toBe('Survivor benefit first, own at 65 years, 7 months');
    expect(survivorFirst!.label).not.toContain('70');
  });

  it('keeps every named row’s label consistent with its own two dates', async () => {
    // The general form, over a household where all four rows are distinct, so
    // `ownFirst`'s half of the rule is exercised too: its label must name the
    // survivor-claim age the row carries rather than the word "FRA", which
    // stops being true the moment `survivorSince` is set or survivor-FRA has
    // already passed.
    const { comparisons } = await analyzeHousehold(richHousehold, assumptions, asOf);
    const byKey = Object.fromEntries(comparisons.map((c) => [c.key, c]));
    expect(byKey.survivorFirst).toBeDefined();
    expect(byKey.ownFirst).toBeDefined();
    for (const c of comparisons) {
      if (c.key === 'survivorFirst') {
        expect(c.label).toBe(`Survivor benefit first, own at ${c.filingAges[0].label}`);
      }
      if (c.key === 'ownFirst') {
        expect(c.label).toBe(`Own benefit first, survivor at ${c.survivorClaimDate!.age}`);
      }
    }
  });

  it('keeps a finite finalIndexByPersonId when every benefit computes to zero', async () => {
    // Regression for the reviewer's second Important finding:
    // `widowedBands` omits a band entirely whenever its amount rounds to
    // zero, so `bands` can legitimately be empty — a zero own PIA and a
    // zero recovered deceased PIA is one real route there. The old
    // `Math.max(...bands.map((b) => b.endIndex))` is `-Infinity` over an
    // empty array, which `JSON.stringify` silently turns into `null`.
    const zeroPerson: Person = { ...widowPerson, piaMonthly: 0 };
    const zeroHousehold: Household = {
      status: 'widowed',
      people: [zeroPerson],
      deceased: {
        birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
        record: { kind: 'pia', piaMonthly: 0, filed: null },
      },
      alreadyClaimed: { survivorSince: null, ownSince: null },
    };
    const result = await analyzeHousehold(zeroHousehold, assumptions, asOf);
    expect(result.periods).toHaveLength(0);
    expect(Number.isFinite(result.finalIndexByPersonId[zeroPerson.id])).toBe(true);
  });

  describe('survivorClaimDate', () => {
    it('gives the survivorFirst and ownFirst rows different survivor-claim months', async () => {
      const { comparisons } = await analyzeHousehold(richHousehold, assumptions, asOf);
      const byKey = Object.fromEntries(comparisons.map((c) => [c.key, c]));
      expect(byKey.survivorFirst).toBeDefined();
      expect(byKey.ownFirst).toBeDefined();
      expect(byKey.survivorFirst.survivorClaimDate).not.toBeNull();
      expect(byKey.ownFirst.survivorClaimDate).not.toBeNull();
      expect(byKey.survivorFirst.survivorClaimDate!.monthIndex).not.toBe(
        byKey.ownFirst.survivorClaimDate!.monthIndex,
      );
    });

    it('is null on every row of a married household', async () => {
      const result = await analyzeHousehold(
        { status: 'married', people: [dan, sarah] }, assumptions, asOf,
      );
      expect(result.comparisons.length).toBeGreaterThan(1);
      for (const c of result.comparisons) {
        expect(c.survivorClaimDate).toBeNull();
      }
    });
  });

  it('publishes no own-record claiming options or break-evens for a widow', async () => {
    // Her own benefit may be smaller than the survivor benefit in EVERY month
    // she is alive, so a table of "what you'd get claiming at 62 through 70"
    // describes income she would never receive, and a break-even between two
    // of those ages compares two irrelevant quantities. Empty rather than
    // wrong: `BreakEvenSection` renders nothing on an empty array, so the
    // misleading section disappears by construction.
    const { people } = await analyzeHousehold(household, assumptions, asOf);
    expect(people[0].claimingOptions).toEqual([]);
    expect(people[0].breakEvens).toEqual([]);
  });

  it('still publishes them for single and married households', async () => {
    // The guard above must be scoped to widowed. An implementation that
    // returns empty for every status would satisfy the previous test.
    const single = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(single.people[0].claimingOptions.length).toBeGreaterThan(0);
    expect(single.people[0].breakEvens.length).toBeGreaterThan(0);

    const married = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] }, assumptions, asOf,
    );
    expect(married.people[0].claimingOptions.length).toBeGreaterThan(0);
  });

  it('reports the income she is actually recommended to receive', async () => {
    // Steady state: the month the LATER of the two recommended dates falls,
    // once both benefits are running. Equal to the summed bands at that month,
    // which stack to max(own, survivor) by construction.
    const result = await analyzeHousehold(household, assumptions, asOf);
    const { optimal, periods, people } = result;
    const steadyMonth = Math.max(
      optimal.survivorClaimDate!.monthIndex,
      optimal.filingAges[0].monthDuration.asMonths() +
        (household.people[0].birthYear * 12 + (household.people[0].birthMonth - 1)),
    );
    const banded = periods
      .filter((b) => b.startIndex <= steadyMonth && steadyMonth <= b.endIndex)
      .reduce((t, b) => t + b.monthlyAmount, 0);
    expect(banded).toBeGreaterThan(0);
    expect(people[0].monthlyAtFilingAge).toBeCloseTo(banded, 2);
  });

  it('does not report her own-record benefit as the recommended monthly', async () => {
    // The defect this replaces: `analyzePerson` returned her benefit at her own
    // filing age, which omits the survivor benefit entirely. For this fixture
    // the survivor benefit dominates, so the two differ.
    const { people } = await analyzeHousehold(household, assumptions, asOf);
    const ownRecordOnly = ssaMonthlyBenefitAtFilingAge(
      createPiaRecipient(
        household.people[0].birthYear,
        household.people[0].birthMonth,
        household.people[0].piaMonthly,
        household.people[0].gender,
      ),
      people[0].filingAge.monthDuration,
    ).benefit;
    expect(people[0].monthlyAtFilingAge).toBeGreaterThan(ownRecordOnly);
  });

  it('reports the LATER of the two dates when it is her own filing', async () => {
    // The spec's own worked example, and the shape SSA's published guidance
    // leads with: claim the survivor benefit as early as it can still be
    // claimed, then switch up to a larger own record at 70. Ten years of
    // survivor-only income come FIRST, and the steady-state figure is the one
    // after the switch.
    //
    // Every other widowed fixture in this file has the survivor claim as the
    // later date, so `Math.max(survivorClaimIndex, ownFilingIndex)` was
    // indistinguishable from `survivorClaimIndex` alone — that mutation left
    // the whole suite green. This is the golden corpus's
    // `widowed-1964-survivor-first-then-own-70` household, the case where
    // showing the earlier month's amount is the misleading answer the spec
    // forbids: it would print ten years of reduced survivor benefit as
    // "what you will be getting".
    const ownLaterHousehold: Household = {
      status: 'widowed',
      people: [{ ...widowPerson, piaMonthly: 2400, lifeExpectancy: 90 }],
      deceased: {
        birthYear: 1959, birthMonth: 3, deathYear: 2023, deathMonth: 9,
        record: { kind: 'pia', piaMonthly: 1800, filed: null },
      },
      alreadyClaimed: { survivorSince: null, ownSince: null },
    };

    const { optimal, periods, people } = await analyzeHousehold(
      ownLaterHousehold, assumptions, asOf,
    );

    const birthIndex = widowPerson.birthYear * 12 + (widowPerson.birthMonth - 1);
    const survivorClaimIndex = optimal.survivorClaimDate!.monthIndex;
    const ownFilingIndex = birthIndex + optimal.filingAges[0].monthDuration.asMonths();
    // The premise of this test. If the optimizer ever stops preferring this
    // shape for this household, this says so rather than quietly reverting to
    // the same coincidence every other fixture has.
    expect(ownFilingIndex).toBeGreaterThan(survivorClaimIndex);

    const bandedAt = (month: number) =>
      periods
        .filter((b) => b.startIndex <= month && month <= b.endIndex)
        .reduce((t, b) => t + b.monthlyAmount, 0);

    expect(people[0].monthlyAtFilingAge).toBeCloseTo(bandedAt(ownFilingIndex), 2);
    // And is NOT the earlier month's income — the survivor benefit alone,
    // which she receives for the eight years before she files.
    expect(bandedAt(survivorClaimIndex)).toBeGreaterThan(0);
    expect(people[0].monthlyAtFilingAge).not.toBeCloseTo(bandedAt(survivorClaimIndex), 2);
  });

  it('carries whether the deceased PIA was estimated', async () => {
    const known = await analyzeHousehold(household, assumptions, asOf);
    expect(known.piaEstimated).toBe(false);

    const fromCheck = await analyzeHousehold(
      {
        ...household,
        deceased: {
          ...household.deceased,
          record: { kind: 'checkAmount', monthlyAmount: 2400, filed: { year: 2022, month: 5 } },
        },
      },
      assumptions,
      asOf,
    );
    expect(fromCheck.piaEstimated).toBe(true);
  });

  it('leaves piaEstimated null where there is no deceased record', async () => {
    const single = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(single.piaEstimated).toBeNull();
  });
});
