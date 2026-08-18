import { describe, expect, it } from 'vitest';
import { widowedBenefitsOverlap, widowedStages } from './widowedStages';
import type { BenefitBand } from './benefitPeriods';
import type { Person } from './personAnalysis';

const john: Person = {
  id: 'a', name: 'John', birthYear: 1967, birthMonth: 1,
  gender: 'male', piaMonthly: 3000, lifeExpectancy: 82,
};
/** Absolute month index for a year/month, the `BenefitBand` convention. */
const at = (year: number, month: number) => year * 12 + (month - 1);

const band = (
  type: BenefitBand['type'],
  from: [number, number],
  to: [number, number],
  monthlyAmount: number,
): BenefitBand => ({
  personId: 'a', type, startIndex: at(...from), endIndex: at(...to), monthlyAmount,
});

describe('widowedStages — benefits that do not overlap', () => {
  // The reported household: own PIA 3,000 against a deceased 2,000. His own
  // benefit is the larger, so the engine ENDS the survivor band the month his
  // own record starts. The three-figure split reported "Survivor increment,
  // from 60: $0.00" for this — the survivor benefit was $1,430 and was his
  // entire income for ten years.
  const periods = [
    band('survivor', [2027, 1], [2036, 12], 1430),
    band('personal', [2037, 1], [2049, 1], 3720),
  ];

  it('states each benefit at what it actually pays', () => {
    expect(widowedStages(periods, john)).toEqual([
      { startIndex: at(2027, 1), ageLabel: '60', monthly: 1430, types: ['survivor'] },
      { startIndex: at(2037, 1), ageLabel: '70', monthly: 3720, types: ['personal'] },
    ]);
  });

  it('never reports the larger benefit as an increment of zero', () => {
    const stages = widowedStages(periods, john);
    expect(stages.map((s) => s.monthly)).not.toContain(0);
    expect(stages.find((s) => s.types.includes('survivor'))?.monthly).toBe(1430);
  });

  it('reports no overlap, so the caption can stop claiming one', () => {
    expect(widowedBenefitsOverlap(periods)).toBe(false);
  });
});

describe('widowedStages — benefits that do overlap', () => {
  // The mirror case, and the one the split was built for: a low-PIA widow
  // whose own benefit runs first and whose survivor benefit stacks on top.
  const mary: Person = { ...john, name: 'Mary', birthYear: 1964, birthMonth: 6, piaMonthly: 1200 };
  const periods = [
    band('personal', [2026, 7], [2054, 6], 845),
    band('survivor', [2031, 6], [2054, 6], 1630),
  ];

  it('states the total at each stage, not the increment', () => {
    // 2,475 is what she is paid from 67 — the sum. An "increment" figure of
    // 1,630 beside it is the number she must not be handed as her income.
    expect(widowedStages(periods, mary)).toEqual([
      { startIndex: at(2026, 7), ageLabel: '62 years, 1 month', monthly: 845, types: ['personal'] },
      {
        startIndex: at(2031, 6),
        ageLabel: '67',
        monthly: 2475,
        types: ['personal', 'survivor'],
      },
    ]);
  });

  it('reports the overlap', () => {
    expect(widowedBenefitsOverlap(periods)).toBe(true);
  });
});

describe('widowedStages — the shapes that must not open a stage', () => {
  it('opens none at all for a household with no bands', () => {
    // `widowedBands` legitimately returns nothing: a $0 own PIA against a $0
    // recovered PIA, or a death after the survivor's plan-to age.
    expect(widowedStages([], john)).toEqual([]);
    expect(widowedBenefitsOverlap([])).toBe(false);
  });

  it('skips a gap between two benefits rather than printing $0', () => {
    const periods = [
      band('survivor', [2027, 1], [2029, 12], 1430),
      band('personal', [2037, 1], [2049, 1], 3720),
    ];
    const stages = widowedStages(periods, john);
    expect(stages.map((s) => s.ageLabel)).toEqual(['60', '70']);
    expect(stages.map((s) => s.monthly)).not.toContain(0);
  });

  it('skips a band that exists but pays nothing', () => {
    // A spousal entitlement fully absorbed by delayed credits is the married
    // analogue; the engine can emit a zero-amount band rather than omit it.
    const periods = [
      band('personal', [2037, 1], [2049, 1], 3720),
      band('survivor', [2037, 1], [2049, 1], 0),
    ];
    expect(widowedStages(periods, john)).toEqual([
      { startIndex: at(2037, 1), ageLabel: '70', monthly: 3720, types: ['personal', 'survivor'] },
    ]);
  });

  it('merges consecutive spans paying the same total from the same benefits', () => {
    // Two adjacent survivor bands at one amount are one stage to a reader.
    const periods = [
      band('survivor', [2027, 1], [2030, 12], 1430),
      band('survivor', [2031, 1], [2036, 12], 1430),
    ];
    expect(widowedStages(periods, john)).toHaveLength(1);
  });

  it('does not merge across a change in which benefits are paying', () => {
    // Same money, different sources: the reader is being told something new.
    const periods = [
      band('survivor', [2027, 1], [2030, 12], 1430),
      band('personal', [2031, 1], [2036, 12], 1430),
    ];
    expect(widowedStages(periods, john).map((s) => s.types)).toEqual([
      ['survivor'],
      ['personal'],
    ]);
  });
});

describe('the age labels', () => {
  it('drop the months on a whole year and keep them otherwise', () => {
    const periods = [band('personal', [2029, 2], [2049, 1], 100)];
    // John, born January 1967, is 62 years 1 month in February 2029.
    expect(widowedStages(periods, john)[0].ageLabel).toBe('62 years, 1 month');
  });

  it('never say "1 months"', () => {
    // The plural-of-one defect this project has already shipped once, at the
    // single most commonly recommended filing age there is.
    const periods = [band('personal', [2029, 2], [2049, 1], 100)];
    expect(widowedStages(periods, john)[0].ageLabel).not.toMatch(/\b1 months\b/);
  });
});
