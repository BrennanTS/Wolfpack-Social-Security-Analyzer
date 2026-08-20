import { cumulativeBenefits, type ClaimingOption } from './benefitMath';

export interface HeatmapCell {
  claimAge: number;
  livingAge: number;
  cumulative: number;
}

export interface OpportunityCostRow {
  age: number;
  /**
   * Lifetime benefits at this age less those at the SHOWN age — positive
   * where this age would pay more. Named for the baseline it is measured
   * from, which is the selected scenario and NOT the optimizer's answer:
   * these two were the same value until scenarios made a filing age an
   * input, and the report spent a release calling a chosen age optimal
   * while six of nine rows printed a positive number against it.
   */
  vsShown: number;
  /** The baseline row itself — the age every other row is compared to. */
  isShown: boolean;
}

export interface MonthlyRampRow {
  age: number;
  monthly: number;
  percentOfPia: number;
  /** The age the charts mark — the shown scenario. See `OpportunityCostRow`. */
  isShown: boolean;
}

/** Living-age ticks for heatmap axes (keeps labels readable). */
export function getLivingAgeTicks(minAge: number, maxAge: number): number[] {
  const span = maxAge - minAge;
  const step = span > 24 ? 4 : span > 14 ? 3 : span > 8 ? 2 : 1;
  const ticks: number[] = [];
  for (let age = minAge; age <= maxAge; age += step) {
    ticks.push(age);
  }
  if (ticks[ticks.length - 1] !== maxAge) {
    ticks.push(maxAge);
  }
  return ticks;
}

/** Cumulative benefits for each claim age × living age combination. */
export function generateHeatmapData(
  options: ClaimingOption[],
  lifeExpectancy: number,
  annualCola: number,
): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (const opt of options) {
    for (let livingAge = opt.age; livingAge <= lifeExpectancy; livingAge++) {
      cells.push({
        claimAge: opt.age,
        livingAge,
        cumulative: cumulativeBenefits(
          opt.monthlyBenefit,
          opt.age,
          livingAge,
          annualCola,
        ),
      });
    }
  }
  return cells;
}

export function getHeatmapValue(
  cells: HeatmapCell[],
  claimAge: number,
  livingAge: number,
): number | null {
  const cell = cells.find((c) => c.claimAge === claimAge && c.livingAge === livingAge);
  return cell?.cumulative ?? null;
}

/** Lifetime benefit shortfall against the age the report is built on. */
export function generateOpportunityCostData(
  options: ClaimingOption[],
  shownAge: number,
): OpportunityCostRow[] {
  const shown = options.find((o) => o.age === shownAge)!;
  return options.map((o) => ({
    age: o.age,
    vsShown: o.lifetimeBenefits - shown.lifetimeBenefits,
    isShown: o.age === shownAge,
  }));
}

/** Monthly benefit ramp from 62 through 70. */
export function generateMonthlyRampData(
  options: ClaimingOption[],
  shownAge: number,
): MonthlyRampRow[] {
  return options.map((o) => ({
    age: o.age,
    monthly: o.monthlyBenefit,
    percentOfPia: o.percentOfPia,
    isShown: o.age === shownAge,
  }));
}

/**
 * The value range of each COLUMN of the lifetime heatmap, keyed by living age.
 *
 * The heatmap was shaded against one range spanning the whole matrix, and
 * cumulative benefits only ever grow with age, so the strongest gradient ran
 * left to right and said nothing but "more years alive, more money". The
 * comparison worth making is vertical — which claiming age is ahead if death
 * falls at THIS age — and on a global ramp it is the weak axis: for a
 * plan-to-79 claimant the rightmost column spans 16% of the matrix's range,
 * so nine visibly different outcomes printed as nine near-identical golds.
 *
 * Shading each column against its own range makes the winner in every column
 * plain. The cost is that color no longer compares ACROSS columns, which is
 * why the cells also carry their figures — a reader comparing two columns
 * reads the numbers, not the shade.
 */
export interface ColumnScale {
  lo: number;
  hi: number;
}

export function heatmapColumnScales(cells: readonly HeatmapCell[]): Map<number, ColumnScale> {
  const scales = new Map<number, ColumnScale>();
  for (const cell of cells) {
    const current = scales.get(cell.livingAge);
    if (current === undefined) {
      scales.set(cell.livingAge, { lo: cell.cumulative, hi: cell.cumulative });
      continue;
    }
    current.lo = Math.min(current.lo, cell.cumulative);
    current.hi = Math.max(current.hi, cell.cumulative);
  }
  return scales;
}

/**
 * Where one cell sits on the ramp within its own column, 0 (palest) to 1.
 *
 * A column with a single cell returns 0. That case is always the leftmost
 * column — the one living age only the earliest claimer has reached — and its
 * one cell is worth $0, having been claimed that very month. Shading a zero
 * the darkest on the board would be the opposite of true.
 */
export function heatmapColumnRatio(
  scales: Map<number, ColumnScale>,
  livingAge: number,
  value: number,
): number {
  const scale = scales.get(livingAge);
  if (scale === undefined || scale.hi <= scale.lo) return 0;
  return (value - scale.lo) / (scale.hi - scale.lo);
}

/**
 * Blend two hex colors, `t` from 0 (all `a`) to 1 (all `b`).
 *
 * The heat ramp this used to hard-code moved to `pdf/theme.ts`, which owns
 * the report palette and therefore knows which theme's endpoints to mix. What
 * is left here is the arithmetic, which no theme changes.
 */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `#${[r, g, bl].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
