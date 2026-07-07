import type { ClaimingOption } from './socialSecurity';
import { cumulativeBenefits } from './socialSecurity';

export interface HeatmapCell {
  claimAge: number;
  livingAge: number;
  cumulative: number;
}

export interface OpportunityCostRow {
  age: number;
  vsOptimal: number;
  isOptimal: boolean;
}

export interface MonthlyRampRow {
  age: number;
  monthly: number;
  percentOfPia: number;
  isOptimal: boolean;
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

/** Lifetime benefit shortfall vs the optimal claiming age. */
export function generateOpportunityCostData(
  options: ClaimingOption[],
  optimalAge: number,
): OpportunityCostRow[] {
  const optimal = options.find((o) => o.age === optimalAge)!;
  return options.map((o) => ({
    age: o.age,
    vsOptimal: o.lifetimeBenefits - optimal.lifetimeBenefits,
    isOptimal: o.age === optimalAge,
  }));
}

/** Monthly benefit ramp from 62 through 70. */
export function generateMonthlyRampData(
  options: ClaimingOption[],
  optimalAge: number,
): MonthlyRampRow[] {
  return options.map((o) => ({
    age: o.age,
    monthly: o.monthlyBenefit,
    percentOfPia: o.percentOfPia,
    isOptimal: o.age === optimalAge,
  }));
}

/** Interpolate hex colors for heatmap cells (ratio 0–1). */
export function heatmapColorWeb(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  if (t < 0.55) {
    return mixHex('#f0eeea', '#8a8a8a', t / 0.55);
  }
  return mixHex('#8a8a8a', '#b8965a', (t - 0.55) / 0.45);
}

/** PDF heatmap palette — matches web (cream → grey → gold). */
export function heatmapColorPdf(ratio: number): string {
  return heatmapColorWeb(ratio);
}

function mixHex(a: string, b: string, t: number): string {
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
