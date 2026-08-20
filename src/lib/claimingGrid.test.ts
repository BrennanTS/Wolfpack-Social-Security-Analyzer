import { describe, expect, it } from 'vitest';
import { MonthDuration } from '$lib/month-time';
import {
  buildClaimingGrid,
  cellsWithin,
  gridKey,
  gridRatio,
  percentOfBest,
  sameCellAges,
} from './claimingGrid';
import { formatFilingAge, type RankedStrategy } from './ssaTools';

const at = (years: number, months = 0) =>
  formatFilingAge(MonthDuration.initFromYearsMonths({ years, months }));

const pair = (a: [number, number], b: [number, number], npv: number): RankedStrategy => ({
  filingAges: [at(a[0], a[1]), at(b[0], b[1])],
  expectedNpv: npv,
});

describe('buildClaimingGrid', () => {
  it('takes the best month combination inside each pair of years', () => {
    // Two month-pairs inside the same 67/67 square. The square must carry the
    // better one, and must name the exact ages that achieve it — a square
    // labeled "67" while quoting the value of 67y11m would misstate what an
    // adviser is being shown.
    const grid = buildClaimingGrid([
      pair([67, 0], [67, 0], 100),
      pair([67, 0], [67, 11], 140),
      pair([70, 0], [70, 0], 120),
    ])!;
    expect(grid.cells).toHaveLength(2);
    const cell = grid.cells.find((c) => c.years[0] === 67 && c.years[1] === 67)!;
    expect(cell.value).toBe(140);
    expect(cell.ages[1]).toEqual({ years: 67, months: 11 });
    expect(grid.max).toBe(140);
    expect(grid.min).toBe(120);
  });

  it('keeps the earlier-listed strategy on a tie', () => {
    // `ranked` arrives sorted best-first, so a tie must not depend on which
    // equal entry the reduce happens to see last.
    const grid = buildClaimingGrid([
      pair([67, 0], [67, 2], 100),
      pair([67, 0], [67, 9], 100),
    ])!;
    expect(grid.cells[0].ages[1].months).toBe(2);
  });

  it('lists each person’s attainable whole ages, ascending', () => {
    const grid = buildClaimingGrid([
      pair([70, 0], [64, 0], 10),
      pair([68, 0], [66, 0], 20),
      pair([68, 0], [64, 0], 30),
    ])!;
    expect(grid.years[0]).toEqual([68, 70]);
    expect(grid.years[1]).toEqual([64, 66]);
  });

  it('applies the display permutation to both axes and to every cell', () => {
    // `ranked` is in ENGINE order. A grid whose axes depended on which spouse
    // was typed in first is the order-dependence this project closed
    // everywhere else — and it would silently transpose the whole board.
    const swap = <T,>(p: readonly T[]): [T, T] => [p[1], p[0]];
    const grid = buildClaimingGrid([pair([70, 0], [63, 5], 99)], swap)!;
    expect(grid.years).toEqual([[63], [70]]);
    expect(grid.cells[0].years).toEqual([63, 70]);
    expect(grid.cells[0].ages).toEqual([
      { years: 63, months: 5 },
      { years: 70, months: 0 },
    ]);
  });

  it('returns null for anything that is not two claimants', () => {
    expect(buildClaimingGrid([])).toBeNull();
    expect(
      buildClaimingGrid([{ filingAges: [at(67)], expectedNpv: 10 } as RankedStrategy]),
    ).toBeNull();
  });
});

describe('cellsWithin', () => {
  const grid = buildClaimingGrid([
    pair([62, 0], [62, 0], 900),
    pair([66, 0], [66, 0], 995),
    pair([70, 0], [70, 0], 1000),
  ])!;

  it('measures against the best, not against the spread', () => {
    // 995 is 0.5% below 1000, so it qualifies at 1% however far the worst
    // cell happens to be from the best.
    expect(cellsWithin(grid, 1)).toEqual(new Set([gridKey(66, 66), gridKey(70, 70)]));
  });

  it('includes a cell exactly on the boundary', () => {
    // 900 is exactly 10% below. A strict comparison would drop the cell the
    // adviser just dialed the tolerance to reach.
    expect(cellsWithin(grid, 10).has(gridKey(62, 62))).toBe(true);
  });

  it('holds only the best at zero tolerance, and everything at a wide one', () => {
    expect(cellsWithin(grid, 0)).toEqual(new Set([gridKey(70, 70)]));
    expect(cellsWithin(grid, 100).size).toBe(3);
  });

  it('treats a negative tolerance as zero rather than excluding the best', () => {
    expect(cellsWithin(grid, -5)).toEqual(new Set([gridKey(70, 70)]));
  });
});

describe('gridRatio and percentOfBest', () => {
  const grid = buildClaimingGrid([
    pair([62, 0], [62, 0], 900),
    pair([66, 0], [66, 0], 950),
    pair([70, 0], [70, 0], 1000),
  ])!;

  it('stretches the ramp across the grid’s own range', () => {
    // Anchored at zero, every cell here would sit within 10% of every other
    // and the whole board would render one shade.
    expect(gridRatio(grid, 900)).toBe(0);
    expect(gridRatio(grid, 950)).toBeCloseTo(0.5, 6);
    expect(gridRatio(grid, 1000)).toBe(1);
  });

  it('does not divide by zero when every combination pays the same', () => {
    const flat = buildClaimingGrid([pair([67, 0], [67, 0], 500)])!;
    expect(gridRatio(flat, 500)).toBe(1);
  });

  it('prints a share of the best, which is what each square shows', () => {
    expect(percentOfBest(grid, 1000)).toBe(100);
    expect(percentOfBest(grid, 950)).toBe(95);
  });

  it('rounds down, so only the best square can print 100.0', () => {
    // 999.6 is 99.96% — normal rounding prints 100.0 and puts two maxima on
    // one board. Flooring reads as "at least this much", true of every cell.
    expect(percentOfBest(grid, 999.6)).toBe(99.9);
    expect(percentOfBest(grid, 999.99)).toBe(99.9);
  });
});

describe('sameCellAges', () => {
  const grid = buildClaimingGrid([pair([70, 0], [67, 11], 100)])!;
  const cell = grid.cells[0];

  it('matches on exact months, not on the whole year', () => {
    // The selected scenario carries 67y11m. A whole-year comparison would
    // mark the 67 square selected for any month in that year, including ones
    // the report is not built on.
    expect(sameCellAges(cell, [{ years: 70, months: 0 }, { years: 67, months: 11 }])).toBe(true);
    expect(sameCellAges(cell, [{ years: 70, months: 0 }, { years: 67, months: 0 }])).toBe(false);
  });

  it('is false for a filing-age list of the wrong length', () => {
    expect(sameCellAges(cell, [{ years: 70, months: 0 }])).toBe(false);
  });
});
