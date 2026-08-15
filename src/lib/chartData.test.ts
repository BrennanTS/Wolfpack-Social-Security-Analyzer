import { describe, expect, it } from 'vitest';
import {
  generateHeatmapData,
  generateMonthlyRampData,
  generateOpportunityCostData,
  getHeatmapValue,
  getLivingAgeTicks,
  heatmapColorWeb,
} from './chartData';
import type { ClaimingOption } from './socialSecurity';

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
    expect(rows.find((r) => r.age === 67)).toMatchObject({ vsOptimal: 0, isOptimal: true });
    expect(rows.find((r) => r.age === 62)!.vsOptimal).toBe(-100_000);
  });
});

describe('generateMonthlyRampData', () => {
  it('carries monthly and %PIA through and flags the optimal age', () => {
    const rows = generateMonthlyRampData(options, 70);
    expect(rows.find((r) => r.age === 70)).toMatchObject({
      monthly: 3100,
      percentOfPia: 124,
      isOptimal: true,
    });
  });
});

describe('heatmapColorWeb', () => {
  it('clamps out-of-range ratios to the palette endpoints', () => {
    expect(heatmapColorWeb(-1)).toBe(heatmapColorWeb(0));
    expect(heatmapColorWeb(2)).toBe(heatmapColorWeb(1));
  });

  it('returns a six-digit hex color', () => {
    expect(heatmapColorWeb(0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
