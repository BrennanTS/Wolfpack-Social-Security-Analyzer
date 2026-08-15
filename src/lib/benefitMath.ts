/**
 * Illustrative benefit math: cumulative totals and break-even ages.
 *
 * These are driven by the flat `annualCola` slider and are computed on the
 * client so they recompute instantly, independent of the ssa.tools engine.
 * Every dollar figure sourced from the engine already reflects SSA's own
 * cost-of-living adjustments.
 */

export const MIN_CLAIM_AGE = 62;
export const MAX_CLAIM_AGE = 70;

export interface ClaimingOption {
  age: number;
  monthlyBenefit: number;
  percentOfPia: number;
  lifetimeBenefits: number;
  yearsOfPayments: number;
  isEligible: boolean;
  monthsFromFra: number;
}

export interface BreakEvenPair {
  earlierAge: number;
  laterAge: number;
  breakEvenAge: number;
  breakEvenYears: number;
}

export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sum of nominal monthly benefits from `claimAge` through `throughAge`,
 * optionally grown by a flat `annualCola`. Used only for the illustrative
 * cumulative charts and break-even math — not for the ssa.tools totals.
 */
export function cumulativeBenefits(
  monthlyBenefit: number,
  claimAge: number,
  throughAge: number,
  annualCola = 0,
): number {
  const years = Math.max(0, throughAge - claimAge);
  if (years === 0) return 0;

  if (annualCola === 0) {
    return roundCents(monthlyBenefit * years * 12);
  }

  const rate = annualCola / 100;
  let total = 0;
  for (let y = 0; y < years; y++) {
    total += monthlyBenefit * 12 * Math.pow(1 + rate, y);
  }
  return roundCents(total);
}

export function breakEvenAge(
  earlierAge: number,
  earlierMonthly: number,
  laterAge: number,
  laterMonthly: number,
  annualCola = 0,
): number | null {
  if (laterMonthly <= earlierMonthly && annualCola === 0) return null;

  for (let t = laterAge * 10; t <= 1200; t++) {
    const age = t / 10;
    const cumEarlier = cumulativeBenefits(earlierMonthly, earlierAge, age, annualCola);
    const cumLater = cumulativeBenefits(laterMonthly, laterAge, age, annualCola);
    if (cumLater >= cumEarlier) {
      return Math.round(age * 10) / 10;
    }
  }
  return null;
}

/** Claiming ages compared pairwise for break-even analysis (early / FRA-ish / max). */
const BREAK_EVEN_AGES = [62, 67, 70];

/**
 * Break-even ages for the canonical claiming-age pairs. This is illustrative and
 * driven by the flat `annualCola` slider, so it is computed on the client and
 * recomputed instantly when COLA changes — no need to re-run the ssa.tools engine.
 */
export function computeBreakEvens(
  claimingOptions: ClaimingOption[],
  annualCola = 0,
): BreakEvenPair[] {
  const breakEvens: BreakEvenPair[] = [];
  const ages = BREAK_EVEN_AGES.filter((a) => a >= MIN_CLAIM_AGE && a <= MAX_CLAIM_AGE);

  for (let i = 0; i < ages.length; i++) {
    for (let j = i + 1; j < ages.length; j++) {
      const earlier = claimingOptions.find((o) => o.age === ages[i]);
      const later = claimingOptions.find((o) => o.age === ages[j]);
      if (!earlier || !later) continue;

      const be = breakEvenAge(
        earlier.age,
        earlier.monthlyBenefit,
        later.age,
        later.monthlyBenefit,
        annualCola,
      );
      if (be !== null) {
        breakEvens.push({
          earlierAge: earlier.age,
          laterAge: later.age,
          breakEvenAge: be,
          breakEvenYears: Math.round((be - later.age) * 10) / 10,
        });
      }
    }
  }

  return breakEvens;
}

export function generateCumulativeChartData(
  options: ClaimingOption[],
  maxAge: number,
  annualCola = 0,
): { age: number; [key: string]: number }[] {
  const data: { age: number; [key: string]: number }[] = [];

  for (let age = MIN_CLAIM_AGE; age <= maxAge; age++) {
    const point: { age: number; [key: string]: number } = { age };
    for (const opt of options) {
      if (age >= opt.age) {
        point[`age${opt.age}`] = cumulativeBenefits(
          opt.monthlyBenefit,
          opt.age,
          age,
          annualCola,
        );
      }
    }
    data.push(point);
  }

  return data;
}
