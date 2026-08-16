import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, visibleBenefitSeries, type Household } from './household';
import type { Person } from './personAnalysis';

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
    expect(comparisons.map((c) => c.label)).toContain('Claim at 70');
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
    expect(comparisons.map((c) => c.label)).toContain('Both delay to 70');
  });

  it('assigns each person the filing age from the joint optimum', async () => {
    const result = await analyzeHousehold(household, assumptions, asOf);
    expect(result.people[0].recommendedFilingAge).toEqual(result.optimal.filingAges[0]);
    expect(result.people[1].recommendedFilingAge).toEqual(result.optimal.filingAges[1]);
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
    expect(result.people[0].recommendedFilingAge.label).toBe('68 years, 10 months');
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

  it('falls back to You/Spouse when a person is unnamed', async () => {
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

  it('uses each person own gender for mortality, not an assumed opposite', async () => {
    const bothMale: Household = {
      status: 'married',
      people: [dan, { ...sarah, gender: 'male' }],
    };
    const mixed = await analyzeHousehold(household, assumptions, asOf);
    const same = await analyzeHousehold(bothMale, assumptions, asOf);
    // Different mortality tables must produce a different joint expected NPV.
    expect(same.optimal.expectedNpv).not.toBe(mixed.optimal.expectedNpv);
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
  // person 0 used to draw it in person 0's colour under person 0's name — a
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
    // The old timeline credited 12 payments in every year from the filing
    // year to the plan-to year inclusive. Dan is born in April with a plan-to
    // age of 85, so his last calendar year pays four months, not twelve.
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
    // recommendedMonthly-driven timeline showed her as $0 forever.
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
    // 68y10m earns more delayed credits than the younger spouse filing at
    // 68y3m against an FRA of 67. None of the golden scenarios hit this, which
    // is why it needs pinning here.
    //
    // Avery's plan-to age of 85 (rather than the 75 this fixture used to
    // carry) puts her death in Mar 2042 — AFTER Blake files in Dec 2038 — so
    // both disclosed figures are genuinely contemporaneous. The 75 variant is
    // covered as its own branch in methodologyCopy.test.ts.
    const older: Person = {
      id: 'a', name: 'Avery', birthYear: 1957, birthMonth: 3,
      gender: 'female', piaMonthly: 1500, lifeExpectancy: 85,
    };
    const younger: Person = {
      id: 'b', name: 'Blake', birthYear: 1970, birthMonth: 9,
      gender: 'male', piaMonthly: 1600, lifeExpectancy: 100,
    };
    const result = await analyzeHousehold(
      { status: 'married', people: [older, younger] },
      { annualCola: 0, discountRate: 0.025 },
      asOf,
    );

    // Guards: this is only the gap case if no survivor band exists at all.
    expect(result.periods.some((b) => b.type === 'survivor')).toBe(false);
    expect(result.survivorGap).not.toBeNull();
    expect(result.survivorGap!.survivorLabel).toBe('Blake');
    // The disclosed figures are the engine's own, and the survivor really is
    // the one holding the smaller benefit.
    expect(result.survivorGap!.deceasedMonthly).toBeGreaterThan(
      result.survivorGap!.survivorOwnMonthly!,
    );
    // Read at the month of the death, not at the end of life: the band paying
    // each person in Mar 2042 (Avery's final month) and Apr 2042 (the month a
    // survivor benefit would begin).
    const death = (1957 + 85) * 12 + 2;
    const paidAt = (id: string, monthIndex: number) =>
      result.periods.find(
        (b) =>
          b.personId === id &&
          b.type === 'personal' &&
          b.startIndex <= monthIndex &&
          monthIndex <= b.endIndex,
      )!;
    expect(result.survivorGap!.survivorOwnMonthly).toBe(paidAt('b', death + 1).monthlyAmount);
    expect(result.survivorGap!.deceasedMonthly).toBe(paidAt('a', death).monthlyAmount);
    expect(result.survivorGap!.survivorUnder60).toBe(false);
  });

  it("matches each person's recommendedMonthly to their final personal band", async () => {
    // `analyzePerson` still computes `recommendedMonthly` independently of the
    // periods. The two must not drift: the amount a person is paid on their
    // own record after any delayed-credit January bump is their last personal
    // band. (They are not the whole story — the bands also carry spousal and
    // survivor amounts, which `recommendedMonthly` has never included.)
    const result = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    for (const p of result.people) {
      const last = result.periods
        .filter((b) => b.personId === p.person.id && b.type === 'personal')
        .reduce((latest, b) => (b.startIndex > latest.startIndex ? b : latest));
      expect(last.monthlyAmount).toBeCloseTo(p.recommendedMonthly, 2);
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
    const avery: Person = {
      id: 'a', name: 'Avery', birthYear: 1960, birthMonth: 6,
      gender: 'male', piaMonthly: 3000, lifeExpectancy: 85,
    };
    const blythe: Person = {
      id: 'b', name: 'Blythe', birthYear: 1958, birthMonth: 3,
      gender: 'female', piaMonthly: 1400, lifeExpectancy: 90,
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
    // Avery files at 70 — Jun 2030 — when Blythe is 72y3m. The start is
    // reported rather than suppressed: the entitlement exists and does begin.
    expect(topUp.startsAtSpouseAge).toBe('72 years, 3 months');
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

    // `earliest` (exactly 62 years, 0 months) is unreachable for every
    // household this app can produce: `createPiaRecipient` fixes every
    // recipient's birth day at `DEFAULT_BIRTH_DAY = 15` (`ssaTools.ts`), and
    // `Birthdate.earliestFilingMonth()` rounds anyone not born on the 1st or
    // 2nd of the month up to 62 years *1* month (`birthday.ts:207-213`) — one
    // month past the exact age the `earliest` row's `namedAges` entry asks
    // `findStrategyByAges` to match (`household.ts`: `{ years: 62, months: 0
    // }`). Asserted directly, rather than left as a silent `if (earliest &&
    // latest)` guard around the real assertion below: the day someone fixes
    // the row so `earliest` starts appearing, this line fails and says so,
    // instead of the guard quietly starting to fire for the first time with
    // no one having decided that was safe.
    const earliest = result.comparisons.find((s) => s.key === 'earliest');
    expect(earliest).toBeUndefined();

    // `fra` and `latest` are both reliably present for this fixture, so this
    // is the assertion that actually exercises the column's thesis —
    // delaying raises the survivor's income. Presence is asserted first so
    // this cannot go vacuous if either ever folds into `optimal`, which
    // `household.ts` does whenever a named row's ages coincide with the
    // optimum's.
    const fra = result.comparisons.find((s) => s.key === 'fra');
    const latest = result.comparisons.find((s) => s.key === 'latest');
    expect(fra).toBeDefined();
    expect(latest).toBeDefined();
    expect(latest!.survivorIncome!).toBeGreaterThan(fra!.survivorIncome!);
  });

  it('leaves survivor income null for a single claimant', async () => {
    const result = await analyzeHousehold({ status: 'single', people: [dan] }, assumptions, asOf);
    expect(result.comparisons.every((s) => s.survivorIncome === null)).toBe(true);
  });
});
