/**
 * Real vs. nominal dollars for the household timeline.
 *
 * `PersonalBenefitPeriods` (`src/vendor/ssa-tools/strategy/calculations/
 * recipient-personal-benefits.ts:40`) emits at most two periods per person,
 * each at a fixed amount, and applies no COLA at all — the engine handles
 * time value through the discount rate instead. So `combinedTimeline` is
 * already in constant (real) dollars, untouched.
 *
 * That is the reverse of the usual arrangement, and it is the safer one: the
 * honest view (real) needs no arithmetic of ours, and the flattering view
 * (nominal, a rising line for what may be flat purchasing power) has to
 * justify itself by being the one that requires a transform.
 */
import { roundCents } from './benefitMath';
import type { CombinedTimelinePoint } from './household';

export type DollarsMode = 'real' | 'nominal';

/**
 * `annualCola` is a PERCENT (2.5 means 2.5%) — unlike `discountRate`, which
 * is a fraction (`formBounds.ts:27`). Converted once, here; `discountRate`
 * plays no part in this module at all.
 */
function nominalFactor(annualCola: number, asOfYear: number, year: number): number {
  return Math.pow(1 + annualCola / 100, year - asOfYear);
}

function scale(amounts: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, amount] of Object.entries(amounts)) {
    out[key] = roundCents(amount * factor);
  }
  return out;
}

/**
 * Compounds `annualCola` forward from `asOfYear` to each point's own year —
 * every series and the roll-ups derived from it, so the total can never
 * disagree with its own parts. A caller wanting real dollars simply doesn't
 * call this; `combinedTimeline` is real dollars already.
 */
export function toNominal(
  timeline: CombinedTimelinePoint[],
  annualCola: number,
  asOfYear: number,
): CombinedTimelinePoint[] {
  return timeline.map((point) => {
    const factor = nominalFactor(annualCola, asOfYear, point.year);
    return {
      year: point.year,
      bySeries: scale(point.bySeries, factor),
      byPersonId: scale(point.byPersonId, factor),
      total: roundCents(point.total * factor),
    };
  });
}

/**
 * The same compounding `toNominal` applies to a timeline, for a single
 * dollar figure tied to one calendar year — the strategy table's per-row
 * survivor income, and the PDF's first-death figure preserved in prose.
 * Wraps the scalar in a one-point timeline and reuses `toNominal` itself
 * rather than re-deriving the compounding formula a second time.
 */
export function toNominalAmount(
  amount: number,
  annualCola: number,
  asOfYear: number,
  year: number,
): number {
  const [transformed] = toNominal(
    [{ year, bySeries: {}, byPersonId: {}, total: amount }],
    annualCola,
    asOfYear,
  );
  return transformed.total;
}
