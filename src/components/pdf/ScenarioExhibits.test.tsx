import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from '../../lib/household';
import { formatCurrency } from '../../lib/format';
import {
  CumulativeOverTimeBlock,
  ScenarioCumulativeBarBlock,
  ScenarioYearlyBlock,
} from './ScenarioExhibits';

/** Walks the element tree without a renderer, as the sibling PDF tests do. */
function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectText);
  const element = node as ReactElement<{ children?: unknown }>;
  if (typeof element === 'object' && 'props' in element) {
    return collectText(element.props?.children);
  }
  return [];
}

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public');
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

const COUPLE: Household = {
  status: 'married',
  people: [
    { id: 'a', name: 'Vernetta', birthYear: 1961, birthMonth: 11, birthDay: 11, gender: 'female', piaMonthly: 3497, lifeExpectancy: 95 },
    { id: 'b', name: 'Terrell', birthYear: 1963, birthMonth: 4, birthDay: 7, gender: 'male', piaMonthly: 3548, lifeExpectancy: 95 },
  ],
};

/**
 * The comparison preset's basis: no discount, which is what makes a plain
 * running total land on the printed household value.
 */
const BASIS = { discountRate: 0, asOfYear: 2026 };
/** The app's default basis, where the two running totals diverge. */
const DISCOUNTED = { discountRate: 0.025, asOfYear: 2026 };

describe('the comparison exhibits', () => {
  let analysis: HouseholdAnalysis;
  beforeAll(async () => {
    // Real pipeline output, so the figures asserted below are the ones the
    // report would actually print rather than a fixture that cannot disagree
    // with the table it is supposed to match.
    analysis = await analyzeHousehold(COUPLE, { annualCola: 2.54, discountRate: 0 }, new Date('2026-09-21'));
  });

  it('adds up to the figure the strategy table prints, undiscounted', () => {
    // The whole reason these read `timeline` rather than recomputing: with no
    // discount applied, the last running total in a strategy's table IS its
    // household value. An adviser who adds up the column must land on the
    // number above it. (`analysis` here is built at discountRate 0, which is
    // what the comparison preset sets and what these exhibits are for.)
    const el = ScenarioYearlyBlock({
      comparisons: analysis.comparisons,
      people: analysis.people.map((p) => p.person),
      basis: BASIS,
    });
    const text = collectText(el).join(' ');
    for (const c of analysis.comparisons) {
      const run = c.timeline.reduce((sum, p) => sum + p.total, 0);
      expect(run, `${c.label}: the stream must sum to its printed value`).toBeCloseTo(
        c.householdValue,
        2,
      );
      expect(text, `${c.label} must print its own household value`).toContain(
        formatCurrency(c.householdValue),
      );
    }
  });

  it('keeps the rows and the heading in the SAME dollars', async () => {
    // The bug a rendered PDF caught and the suite did not: the heading was
    // re-summed into nominal while the rows underneath stayed real, because
    // only the total was converted and not the stream it came from. Asserting
    // it here in the mode where the two differ.
    const { comparisonsInDollarsMode } = await import('../../lib/displayDollars');
    const nominal = comparisonsInDollarsMode(
      analysis.comparisons,
      analysis.people,
      analysis.finalIndexByPersonId,
      { dollarsMode: 'nominal', annualCola: 2.54, discountRate: 0, asOfYear: 2026 },
    );
    for (const c of nominal) {
      const run = c.timeline.reduce((sum, p) => sum + p.total, 0);
      expect(run, `${c.label}: nominal rows must sum to the nominal heading`).toBeCloseTo(
        c.householdValue,
        0,
      );
      // And it must actually be a different number from the real one, or the
      // assertion above would pass on an unconverted stream.
      const real = analysis.comparisons.find((o) => o.key === c.key)!;
      expect(c.householdValue).toBeGreaterThan(real.householdValue);
    }
  });

  it('prints a row for every year in the stream', () => {
    const best = analysis.comparisons.find((c) => c.isOptimal)!;
    const el = ScenarioYearlyBlock({
      comparisons: [best],
      people: analysis.people.map((p) => p.person),
      basis: BASIS,
    });
    const text = collectText(el).join(' ');
    for (const point of best.timeline) {
      expect(text, `year ${point.year} must appear`).toContain(String(point.year));
    }
  });

  it('names every strategy in the bar chart, and marks the best one', () => {
    const el = ScenarioCumulativeBarBlock({ comparisons: analysis.comparisons });
    const text = collectText(el).join(' ');
    for (const c of analysis.comparisons) expect(text).toContain(c.label);
    expect(text).toContain('best');
  });

  it('names every strategy in the cumulative chart', () => {
    const el = CumulativeOverTimeBlock({ comparisons: analysis.comparisons, basis: BASIS });
    const text = collectText(el).join(' ');
    for (const c of analysis.comparisons) expect(text).toContain(c.label);
  });

  it('renders nothing rather than an empty frame when no strategy has a stream', () => {
    // A widowed household reaches these with `timeline: []` on every row.
    // Drawing axes around no data is worse than omitting the block.
    const empty = analysis.comparisons.map((c) => ({ ...c, timeline: [] }));
    const people = analysis.people.map((p) => p.person);
    expect(ScenarioYearlyBlock({ comparisons: empty, people, basis: BASIS })).toBeNull();
    expect(ScenarioCumulativeBarBlock({ comparisons: empty })).toBeNull();
    expect(CumulativeOverTimeBlock({ comparisons: empty, basis: BASIS })).toBeNull();
  });
});

/**
 * The reconciliation the second column exists for.
 *
 * In the app's default basis the undiscounted running total ran 1.44–1.56×
 * ahead of the household value printed directly above it — correct, since one
 * is cash received and the other is that cash discounted, but not something a
 * client reads past. So the table now carries both, and the discounted one has
 * to land on the headline exactly.
 */
describe('the year-by-year table at a discount', () => {
  let discounted: HouseholdAnalysis;
  beforeAll(async () => {
    discounted = await analyzeHousehold(
      COUPLE,
      { annualCola: 2.54, discountRate: DISCOUNTED.discountRate },
      new Date('2026-09-21'),
    );
  });

  it('ends its discounted column on the household value, not above it', async () => {
    const { discountFactor } = await import('../../lib/lifetimeValue');
    const people = discounted.people.map((p) => p.person);
    const text = collectText(
      ScenarioYearlyBlock({ comparisons: discounted.comparisons, people, basis: DISCOUNTED }),
    );

    for (const c of discounted.comparisons) {
      let run = 0;
      let pv = 0;
      for (const point of c.timeline) {
        run += point.total;
        pv += point.total * discountFactor(point.year, DISCOUNTED.asOfYear, DISCOUNTED.discountRate);
      }
      // The identity: the analysis summed this from the same stream, so the
      // exhibit's own rule has to reproduce it to the cent.
      expect(pv, `${c.label}: the discounted stream must sum to the printed value`).toBeCloseTo(
        c.householdValue,
        2,
      );
      // And the gap is real — otherwise the column below would be proving
      // nothing that the old single column did not already prove.
      expect(run, `${c.label}: undiscounted cash must run ahead of it`).toBeGreaterThan(
        c.householdValue * 1.1,
      );

      // Rendered, in the last row: the running total then the discounted one,
      // side by side, the second landing on the headline.
      const last = text.lastIndexOf(formatCurrency(run));
      expect(last, `${c.label}: its final running total must be printed`).toBeGreaterThan(-1);
      expect(text[last + 1], `${c.label}: the discounted column must follow it`).toBe(
        formatCurrency(c.householdValue),
      );
    }
  });

  it('prints one running total when nothing is discounted, and two when something is', () => {
    const people = discounted.people.map((p) => p.person);
    const withRate = collectText(
      ScenarioYearlyBlock({ comparisons: discounted.comparisons, people, basis: DISCOUNTED }),
    ).join(' ');
    const without = collectText(
      ScenarioYearlyBlock({ comparisons: discounted.comparisons, people, basis: BASIS }),
    ).join(' ');
    expect(withRate).toContain('Discounted total');
    expect(withRate).toContain('2.50% less per year');
    // At a zero discount the two columns would hold identical figures, and a
    // duplicated column is worse than one — the comparison preset's tables
    // must look exactly as they did.
    expect(without).not.toContain('Discounted total');
    expect(without).toContain('Running total');
  });
});
