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
import { householdAt, SWEEP_AS_OF } from './households';
import { analyze, stubLifeTableFetch, summarize, SWEEP_ASSUMPTIONS, type Finding } from './harness';

const COUNT = Number(process.env.SWEEP_COUNT ?? 1500);

/** Cent-level tolerance. Every figure here is rounded to cents at some point. */
const EPS = 0.02;
const near = (a: number, b: number, eps = EPS) => Math.abs(a - b) <= eps;

beforeAll(() => vi.stubGlobal('fetch', stubLifeTableFetch()));
afterAll(() => vi.unstubAllGlobals());

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

describe('the timeline agrees with itself', () => {
  it(`totals equal their own parts across ${COUNT} households`, async () => {
    const findings: Finding[] = [];

    for (let index = 0; index < COUNT; index++) {
      const { household, label } = householdAt(index);
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

    for (let index = 0; index < COUNT; index++) {
      const { household, label } = householdAt(index);
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

    for (let index = 0; index < COUNT; index++) {
      const { household, label } = householdAt(index);
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

describe('the dollars toggle is a pure transform', () => {
  it(`nominal differs from real by exactly the deflator (${COUNT} households)`, async () => {
    const findings: Finding[] = [];
    const { annualCola } = SWEEP_ASSUMPTIONS;
    const asOfYear = SWEEP_AS_OF.getFullYear();

    for (let index = 0; index < COUNT; index++) {
      const { household, label } = householdAt(index);
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

    for (let index = 0; index < COUNT; index++) {
      const { household, label } = householdAt(index);
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
