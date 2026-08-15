import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HouseholdPanel } from './HouseholdPanel';
import type { HouseholdAnalysis } from '../lib/household';
import type { PersonAnalysis } from '../lib/personAnalysis';

// Minimal hand-built fixtures — HouseholdPanel takes data as props and never
// calls the engine, so no mocking is needed. `claimingOptions` only needs the
// three break-even ages (62/67/70; see `BREAK_EVEN_AGES` in benefitMath.ts)
// with strictly increasing monthly benefits, since flat-COLA compounding only
// produces a *different* break-even age (not just a different value clamped
// to the same age) when there's real growth to compound over years of gap.
function buildPersonAnalysis(id: 'a' | 'b', name: string): PersonAnalysis {
  return {
    person: { id, name, birthYear: 1962, birthMonth: 4,
              gender: id === 'a' ? 'male' : 'female', piaMonthly: 2400, lifeExpectancy: 85 },
    fra: { years: 67, months: 0, totalMonths: 804, fraDate: new Date(2029, 0, 1) },
    currentAge: { years: 63, months: 9 },
    claimingOptions: [
      { age: 62, monthlyBenefit: 1680, percentOfPia: 70, lifetimeBenefits: 378_000,
        yearsOfPayments: 23, isEligible: true, monthsFromFra: -60 },
      { age: 67, monthlyBenefit: 2400, percentOfPia: 100, lifetimeBenefits: 460_800,
        yearsOfPayments: 18, isEligible: true, monthsFromFra: 0 },
      { age: 70, monthlyBenefit: 2976, percentOfPia: 124, lifetimeBenefits: 535_680,
        yearsOfPayments: 15, isEligible: true, monthsFromFra: 36 },
    ],
    recommendedFilingAge: {
      years: 70, months: 0, label: '70', decimalYears: 70, monthDuration: null as never,
    },
    recommendedMonthly: 2976,
    // Deliberately stale relative to whatever `annualCola` a test passes in —
    // the whole point of the fix under test is that HouseholdPanel must NOT
    // read this field for its break-even section.
    breakEvens: [{ earlierAge: 62, laterAge: 70, breakEvenAge: 999, breakEvenYears: 999 }],
    ssaSuggestedLifeExpectancy: 82,
  } as unknown as PersonAnalysis;
}

function buildAnalysis(): HouseholdAnalysis {
  const personA = buildPersonAnalysis('a', 'Dan');
  const age = (years: number) => ({ years, months: 0, label: String(years),
    decimalYears: years, monthDuration: null as never });
  const optimal = {
    key: 'optimal' as const,
    label: 'Claim at 70',
    filingAges: [age(70)],
    expectedNpv: 535_680,
    deltaVsOptimal: 0,
    isOptimal: true,
  };

  return {
    status: 'single',
    people: [personA],
    optimal,
    comparisons: [optimal],
    combinedTimeline: [{ year: 2032, byPersonId: { a: 35_712 }, total: 35_712 }],
    recommendation: 'Claim at age 70',
    recommendationDetail: 'ssa.tools recommends filing at age 70.',
    assumptions: { annualCola: 0, discountRate: 3 },
    asOf: new Date(2026, 7, 15),
  };
}

describe('HouseholdPanel', () => {
  it('recomputes break-even ages live from the annualCola prop, not the stale analysis.people[0].breakEvens', () => {
    const analysis = buildAnalysis();

    const zeroCola = render(<HouseholdPanel analysis={analysis} annualCola={0} />);
    const zeroAges = Array.from(
      zeroCola.container.querySelectorAll('.be-age-value'),
    ).map((el) => el.textContent);
    zeroCola.unmount();

    const highCola = render(<HouseholdPanel analysis={analysis} annualCola={8} />);
    const highAges = Array.from(
      highCola.container.querySelectorAll('.be-age-value'),
    ).map((el) => el.textContent);
    highCola.unmount();

    // Neither render shows the stale 999 placeholder baked into
    // `analysis.people[0].breakEvens` — proves the component recomputes
    // rather than reading that field.
    expect(zeroAges).not.toContain('999');
    expect(highAges).not.toContain('999');

    // A higher COLA compounds the later, larger benefit faster, pulling the
    // break-even age earlier — the two renders must differ.
    expect(highAges).not.toEqual(zeroAges);
  });
});
