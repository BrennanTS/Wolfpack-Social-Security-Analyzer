import { describe, expect, it } from 'vitest';
import {
  generateHeatmapData,
  generateMonthlyRampData,
  generateOpportunityCostData,
  getHeatmapValue,
  getLivingAgeTicks,
  mixHex,
  heatmapColumnRatio,
  heatmapColumnScales,
} from './chartData';
import type { ClaimingOption } from './benefitMath';

const options: ClaimingOption[] = [62, 67, 70].map((age) => ({
  age,
  monthlyBenefit: age === 62 ? 1750 : age === 67 ? 2500 : 3100,
  percentOfPia: age === 62 ? 70 : age === 67 ? 100 : 124,
  lifetimeBenefits: age === 62 ? 300_000 : age === 67 ? 400_000 : 380_000,
  yearsOfPayments: 0,
  isEligible: true,
  monthsFromFra: 0,
}));

describe('getLivingAgeTicks', () => {
  it('always includes both endpoints', () => {
    const ticks = getLivingAgeTicks(62, 95);
    expect(ticks[0]).toBe(62);
    expect(ticks[ticks.length - 1]).toBe(95);
  });

  it('widens the step for longer spans', () => {
    expect(getLivingAgeTicks(62, 95)[1] - 62).toBe(4);
    expect(getLivingAgeTicks(62, 68)[1] - 62).toBe(1);
  });
});

describe('generateHeatmapData', () => {
  it('emits one cell per claim age from that age through life expectancy', () => {
    const cells = generateHeatmapData(options, 65, 0);
    expect(cells.filter((c) => c.claimAge === 62)).toHaveLength(4); // 62..65
    // Claim ages above life expectancy contribute nothing.
    expect(cells.filter((c) => c.claimAge === 70)).toHaveLength(0);
  });

  it('returns null for a combination that was never generated', () => {
    expect(getHeatmapValue(generateHeatmapData(options, 65, 0), 70, 64)).toBeNull();
  });
});

describe('generateOpportunityCostData', () => {
  it('scores every age against the optimal age, which is zero', () => {
    const rows = generateOpportunityCostData(options, 67);
    expect(rows.find((r) => r.age === 67)).toMatchObject({ vsShown: 0, isShown: true });
    expect(rows.find((r) => r.age === 62)!.vsShown).toBe(-100_000);
  });
});

describe('generateMonthlyRampData', () => {
  it('carries monthly and %PIA through and flags the optimal age', () => {
    const rows = generateMonthlyRampData(options, 70);
    expect(rows.find((r) => r.age === 70)).toMatchObject({
      monthly: 3100,
      percentOfPia: 124,
      isShown: true,
    });
  });
});

describe('mixHex', () => {
  it('returns each endpoint untouched at the ends of the range', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('returns a six-digit hex color in between', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('heatmapColumnScales and heatmapColumnRatio', () => {
  const cells = [
    { claimAge: 62, livingAge: 62, cumulative: 0 },
    { claimAge: 62, livingAge: 70, cumulative: 300 },
    { claimAge: 66, livingAge: 70, cumulative: 200 },
    { claimAge: 70, livingAge: 70, cumulative: 100 },
  ];

  it('ranges each column independently of the rest of the matrix', () => {
    const scales = heatmapColumnScales(cells);
    expect(scales.get(70)).toEqual({ lo: 100, hi: 300 });
    expect(scales.get(62)).toEqual({ lo: 0, hi: 0 });
  });

  it('puts the winner of a column at the dark end, whatever the matrix spans', () => {
    // The whole point: on one global ramp this column would span a third of
    // the range and print three near-identical shades. Ranged to itself, the
    // claiming age that wins at this age of death is unmistakable.
    const scales = heatmapColumnScales(cells);
    expect(heatmapColumnRatio(scales, 70, 300)).toBe(1);
    expect(heatmapColumnRatio(scales, 70, 200)).toBeCloseTo(0.5, 6);
    expect(heatmapColumnRatio(scales, 70, 100)).toBe(0);
  });

  it('leaves a one-cell column pale rather than darkest', () => {
    // That column is always the $0 diagonal — death in the month of claiming.
    // Shading a zero the darkest thing on the board is the opposite of true.
    const scales = heatmapColumnScales(cells);
    expect(heatmapColumnRatio(scales, 62, 0)).toBe(0);
  });

  it('returns 0 for a column that is not in the matrix', () => {
    expect(heatmapColumnRatio(heatmapColumnScales(cells), 99, 500)).toBe(0);
  });
});
