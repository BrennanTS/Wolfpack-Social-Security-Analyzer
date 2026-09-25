/**
 * Invariants 3 and 4 — everything derived from the bands must agree with the
 * bands, and the dollars toggle must be a pure transform.
 *
 * The defect this targets shipped once already: the combined-income chart
 * credited a full annual rate to every year a band merely touched, so three
 * bands each claimed the death year and a household showed ~$99k against a
 * true ~$68.7k. It was caught from a screenshot, not by a test.
 *
 * Every check here compares two things the app derives independently from the
 * same source. A disagreement means one of them is wrong.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildMonthlyIncomeSeries, type HouseholdAnalysis } from '../../src/lib/household';
import { toNominal, toNominalAmount } from '../../src/lib/dollarsMode';
import { incomeCliff } from '../../src/lib/incomeCliff';
import { SWEEP_AS_OF } from './households';
import {
  analyze,
  stubLifeTableFetch,
  summarize,
  sweepCorpus,
  SWEEP_ASSUMPTIONS,
  type Finding,
} from './harness';

const COUNT = Number(process.env.SWEEP_COUNT ?? 1500);
const WIDOWED_COUNT = Number(process.env.SWEEP_WIDOWED_COUNT ?? Math.ceil(COUNT / 4));

/**
 * Both corpora. Every check below is about bands, timelines and roll-ups,
 * which a widowed household has exactly as much as a married one — its bands
 * are its own record and the survivor increment above it.
 */
const corpus = () => sweepCorpus(COUNT, WIDOWED_COUNT);

/** Cent-level tolerance. Every figure here is rounded to cents at some point. */
const EPS = 0.02;
const near = (a: number, b: number, eps = EPS) => Math.abs(a - b) <= eps;

beforeAll(() => vi.stubGlobal('fetch', stubLifeTableFetch()));
afterAll(() => vi.unstubAllGlobals());

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

describe('the timeline agrees with itself', () => {
  it(`totals equal their own parts across ${COUNT} households`, async () => {
    const findings: Finding[] = [];

    for (const { index, household, label } of corpus()) {
      const analysis = await analyze(household);

      for (const point of analysis.combinedTimeline) {
        const bySeries = sum(Object.values(point.bySeries));
        const byPerson = sum(Object.values(point.byPersonId));
        if (!near(point.total, bySeries)) {
          findings.push({
            index,
            label,
            detail: `${point.year}: total ${point.total} != sum(bySeries) ${bySeries}`,
          });
        }
        if (!near(point.total, byPerson)) {
          findings.push({
            index,
            label,
            detail: `${point.year}: total ${point.total} != sum(byPersonId) ${byPerson}`,
          });
        }
      }
    }

    console.log(summarize('timeline roll-ups', findings));
    expect(findings).toEqual([]);
  });

  it(`the monthly series matches the bands that are live each month (${COUNT} households)`, async () => {
    const findings: Finding[] = [];

    for (const { index, household, label } of corpus()) {
      const analysis = await analyze(household);
      const people = analysis.people.map((p) => p.person);
      const series = buildMonthlyIncomeSeries(analysis.periods, people);

      for (const point of series) {
        // Independently: every band covering this month, at its annual rate.
        const expected = sum(
          analysis.periods
            .filter((b) => b.startIndex <= point.monthIndex && point.monthIndex <= b.endIndex)
            .map((b) => b.monthlyAmount * 12),
        );
        if (!near(point.total, expected, 0.5)) {
          findings.push({
            index,
            label,
            detail: `month ${point.monthIndex}: series ${point.total} != live bands ${expected}`,
          });
          break; // one report per household is enough to act on
        }
      }
    }

    console.log(summarize('monthly series vs bands', findings));
    expect(findings).toEqual([]);
  });

  it(`the income cliff reads the timeline it claims to read (${COUNT} households)`, async () => {
    const findings: Finding[] = [];

    for (const { index, household, label } of corpus()) {
      const analysis = await analyze(household);
      const cliff = incomeCliff(analysis);
      if (!cliff) continue;

      const at = (year: number) =>
        analysis.combinedTimeline.find((p) => p.year === year)?.total ?? null;

      const before = at(cliff.deathYear - 1);
      const after = at(cliff.deathYear + 1);
      if (before !== null && !near(cliff.before, before)) {
        findings.push({
          index,
          label,
          detail: `cliff.before ${cliff.before} != timeline ${cliff.deathYear - 1} total ${before}`,
        });
      }
      if (after !== null && !near(cliff.after, after)) {
        findings.push({
          index,
          label,
          detail: `cliff.after ${cliff.after} != timeline ${cliff.deathYear + 1} total ${after}`,
        });
      }

      // The stated percentage must be the one the two figures imply.
      const implied = cliff.before > 0 ? ((cliff.before - cliff.after) / cliff.before) * 100 : 0;
      const stated = cliff.dropPercent;
      if (implied > 0 && !near(stated, implied, 0.05)) {
        findings.push({
          index,
          label,
          detail: `dropPercent ${stated} != implied ${implied.toFixed(3)} from ${cliff.before}/${cliff.after}`,
        });
      }
    }

    console.log(summarize('income cliff vs timeline', findings));
    expect(findings).toEqual([]);
  });
});

describe('the strategy table agrees with itself', () => {
  it(`ranks, deltas and the optimal flag are consistent (${COUNT} households)`, async () => {
    const findings: Finding[] = [];

    for (const { index, household, label } of corpus()) {
      const analysis = await analyze(household);
      const { comparisons, optimal } = analysis;

      const flagged = comparisons.filter((c) => c.isOptimal);
      if (flagged.length !== 1) {
        findings.push({ index, label, detail: `${flagged.length} rows flagged optimal, expected 1` });
      }
      const best = flagged[0] ?? optimal;

      for (const c of comparisons) {
        // The engine still RANKS, so no row may beat the optimum on its terms.
        if (c.expectedNpv > optimal.expectedNpv + EPS) {
          findings.push({
            index,
            label,
            detail: `${c.key} NPV ${c.expectedNpv} exceeds the optimum ${optimal.expectedNpv}`,
          });
        }
        // But the table PRINTS `householdValue`, and "vs. best" is the
        // distance in the printed figure (`withTimelineDerived`), not in
        // `expectedNpv`: the two differ by the six-month seam. Checking it
        // against `expectedNpv` reported 3,704 findings that were all this.
        const implied = Math.round((c.householdValue - best.householdValue) * 100) / 100;
        if (!near(c.deltaVsOptimal, implied)) {
          findings.push({
            index,
            label,
            detail: `${c.key} deltaVsOptimal ${c.deltaVsOptimal} != ${implied}`,
          });
        }
        if (c.filingAges.length !== analysis.people.length) {
          findings.push({
            index,
            label,
            detail: `${c.key} has ${c.filingAges.length} filing ages for ${analysis.people.length} people`,
          });
        }
      }
    }

    console.log(summarize('strategy table consistency', findings));
    expect(findings).toEqual([]);
  });

  /**
   * PARKED DEFECT, pinned so a fix and a regression both flip it.
   *
   * The Best row is chosen by `expectedNpv` but printed as `householdValue`.
   * The engine prices six months past each plan-to age that the printed
   * stream does not contain (`lifetimeValue.ts`), and those six months are
   * worth most to whoever filed latest. So the engine can crown a later pair
   * while an earlier one is worth more in the dollars on the page: the table
   * then prints a positive "vs. best" beside a row that is not Best, and the
   * grid's 100% square is not the Best row's square.
   *
   * Measured when found (seeded corpus, 1,500 + 375 widowed): always the
   * `earliest` row, in 106 households (72 married, 34 single), 42 of them by
   * more than `MATERIAL_MARGIN`, largest +$25,509; and 230 of 1,125 grids.
   * Widowed households are unaffected, because they are ranked and printed
   * on one figure.
   *
   * Waiting on a decision about which figure should rank. When it is fixed,
   * these counts go to zero: replace the pins with `toEqual([])`.
   */
  it(`no row prints ahead of the Best row (${COUNT} households)`, async () => {
    const rows: Finding[] = [];
    const grids: Finding[] = [];
    let gridCount = 0;

    for (const { index, household, label } of corpus()) {
      const analysis = await analyze(household);
      const best = analysis.comparisons.find((c) => c.isOptimal);
      if (!best) continue; // reported by the consistency check above

      for (const c of analysis.comparisons) {
        if (c.householdValue > best.householdValue + EPS) {
          rows.push({
            index,
            label,
            detail: `${c.key} prints ${c.householdValue} > Best ${best.householdValue}`,
          });
        }
      }

      const grid = analysis.claimingGrid;
      if (grid) {
        gridCount++;
        if (grid.max > best.householdValue + EPS) {
          grids.push({
            index,
            label,
            detail: `grid max ${grid.max} > Best ${best.householdValue}`,
          });
        }
      }
    }

    console.log(summarize('rows printing ahead of Best [PARKED]', rows));
    console.log(summarize(`grids peaking above Best of ${gridCount} [PARKED]`, grids));
    // The class, not just the count: a row other than `earliest`, or a
    // widowed household, is a new defect rather than this one.
    expect(rows.filter((f) => !f.detail.startsWith('earliest '))).toEqual([]);
    expect(rows.filter((f) => f.label.includes('widowed'))).toEqual([]);
    if (COUNT === 1500 && WIDOWED_COUNT === 375) {
      expect(rows).toHaveLength(106);
      expect(grids).toHaveLength(230);
    }
  });
});

describe('the dollars toggle is a pure transform', () => {
  it(`nominal differs from real by exactly the deflator (${COUNT} households)`, async () => {
    const findings: Finding[] = [];
    const { annualCola } = SWEEP_ASSUMPTIONS;
    const asOfYear = SWEEP_AS_OF.getFullYear();

    for (const { index, household, label } of corpus()) {
      const analysis: HouseholdAnalysis = await analyze(household);
      const real = analysis.combinedTimeline;
      const nominal = toNominal(real, annualCola, asOfYear);

      if (nominal.length !== real.length) {
        findings.push({ index, label, detail: `length ${nominal.length} != ${real.length}` });
        continue;
      }

      for (let i = 0; i < real.length; i++) {
        const factor = Math.pow(1 + annualCola / 100, real[i].year - asOfYear);
        const expected = real[i].total * factor;
        if (!near(nominal[i].total, expected, 0.05)) {
          findings.push({
            index,
            label,
            detail: `${real[i].year}: nominal ${nominal[i].total} != real*${factor.toFixed(4)} = ${expected.toFixed(2)}`,
          });
          break;
        }
        // The transform must not reorder or re-key anything.
        if (nominal[i].year !== real[i].year) {
          findings.push({ index, label, detail: `year moved: ${real[i].year} -> ${nominal[i].year}` });
          break;
        }
        const realKeys = Object.keys(real[i].bySeries).sort().join('|');
        const nominalKeys = Object.keys(nominal[i].bySeries).sort().join('|');
        if (realKeys !== nominalKeys) {
          findings.push({
            index,
            label,
            detail: `${real[i].year}: series keys changed: ${realKeys} -> ${nominalKeys}`,
          });
          break;
        }
      }
    }

    console.log(summarize('nominal vs real', findings));
    expect(findings).toEqual([]);
  });

  it(`the scalar and the timeline use the same deflator (${COUNT} households)`, async () => {
    // `toNominalAmount` and `toNominal` must not drift: the strategy table's
    // survivor income and the chart beneath it are read together.
    const findings: Finding[] = [];
    const { annualCola } = SWEEP_ASSUMPTIONS;
    const asOfYear = SWEEP_AS_OF.getFullYear();

    for (const { index, household, label } of corpus()) {
      const analysis = await analyze(household);
      const nominal = toNominal(analysis.combinedTimeline, annualCola, asOfYear);

      for (let i = 0; i < analysis.combinedTimeline.length; i++) {
        const point = analysis.combinedTimeline[i];
        const scalar = toNominalAmount(point.total, annualCola, asOfYear, point.year);
        if (!near(scalar, nominal[i].total, 0.02)) {
          findings.push({
            index,
            label,
            detail: `${point.year}: toNominalAmount ${scalar} != toNominal ${nominal[i].total}`,
          });
          break;
        }
      }
    }

    console.log(summarize('scalar vs timeline deflator', findings));
    expect(findings).toEqual([]);
  });
});
