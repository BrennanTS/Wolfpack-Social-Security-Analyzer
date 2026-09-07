/**
 * The survivor benefit, started when SSA would start it.
 *
 * The engine begins a widow(er)'s benefit at the later of the death and the
 * survivor's OWN filing date (`strategy-calc.ts:71-77`). SSA pays it from the
 * later of the death and age 60, whatever the survivor has done on their own
 * record, and pays the larger of the two benefits each month. For a survivor
 * who delays their own filing, the engine's shape shows them receiving
 * nothing for years in which SSA would be paying them.
 *
 * `survivorClaim.ts` already prices that difference and reports the best
 * claim month as an alternative beside the plan. This module takes the next
 * step: it rebuilds the survivor's bands so the plan itself pays the survivor
 * benefit from that month. Every dollar still comes from the engine's own
 * `survivorBenefit` and from the personal bands it emitted; nothing here
 * computes a benefit rule, it only redraws when one starts.
 *
 * Not yet wired into the analysis. The bands this produces change the
 * timeline, the income-cliff figure, the survivor-income column and the
 * printed report for every household where the claim month moves, and the
 * golden fixtures record those figures. Wiring it is a sanctioned re-record
 * of every value it moves, with a note on each, and that is its own job.
 */
import { survivorBenefit } from '$lib/benefit-calculator';
import { MonthDuration } from '$lib/month-time';
import type { Recipient } from '$lib/recipient';
import { roundCents } from './benefitMath';
import { householdPeriods, monthDateAt, type BenefitBand, type SurvivorGap } from './benefitPeriods';
import { firstDeath } from './incomeCliff';
import type { Person } from './personAnalysis';
import { survivorClaimAlternative } from './survivorClaim';

export interface SurvivorStart {
  /** Inclusive absolute month index the survivor benefit is paid from. */
  claimIndex: number;
  /** The survivor's age at that month, as `survivorClaim` labels it. */
  claimAge: string;
  survivorLabel: string;
  /** The household's bands with the survivor's redrawn. */
  bands: BenefitBand[];
}

/** Sum of every band covering `monthIndex`, or null when none does. */
function bandAmountAt(bands: BenefitBand[], monthIndex: number): number | null {
  let total = 0;
  let covered = false;
  for (const band of bands) {
    if (band.startIndex <= monthIndex && monthIndex <= band.endIndex) {
      total += band.monthlyAmount;
      covered = true;
    }
  }
  return covered ? total : null;
}

/**
 * The household's bands with the survivor benefit starting on its best
 * month, or null when there is nothing to redraw.
 *
 * Null exactly when `survivorClaimAlternative` is null: no second person, a
 * survivor direction the engine cannot model (already disclosed as a gap),
 * an exact tie in the two plan-to months, or a claim month that beats what
 * is already on screen by nothing. In every one of those the engine's own
 * bands are the right ones to show.
 */
export function applySurvivorStart(
  people: Person[],
  recipients: Recipient[],
  filingAges: MonthDuration[],
  bands: BenefitBand[],
  finalIndexByPersonId: Record<string, number>,
  survivorGap: SurvivorGap | null,
  labels: string[],
): SurvivorStart | null {
  const alternative = survivorClaimAlternative(
    people,
    recipients,
    filingAges,
    bands,
    finalIndexByPersonId,
    survivorGap,
    labels,
  );
  if (alternative === null) return null;

  const death = firstDeath([people[0].id, people[1].id], finalIndexByPersonId);
  if (death === null) return null;
  const survivorIndex = death.survivorIndex;
  const deceasedIndex = survivorIndex === 0 ? 1 : 0;
  const survivorId = people[survivorIndex].id;
  const survivorFinal = finalIndexByPersonId[survivorId];

  // The amount is fixed by the claim month, exactly as the search priced it.
  const amount = survivorBenefit(
    recipients[survivorIndex],
    recipients[deceasedIndex],
    recipients[deceasedIndex].birthdate.dateAtSsaAge(filingAges[deceasedIndex]),
    monthDateAt(death.deathMonthIndex),
    monthDateAt(alternative.claimIndex),
  ).value();

  // The survivor's own benefit after the death, as the engine emits it for a
  // person on their own. The couple path truncates the survivor's personal
  // period at the month before its own survivor start, and when the two
  // coincide it emits no personal band for them at all, so the couple bands
  // cannot say what the survivor is paid on their own record after the
  // death. The single path has no survivor concept and emits exactly that,
  // January bump and all.
  const firstMonth = death.deathMonthIndex + 1;
  const standalone = householdPeriods(
    [people[survivorIndex]],
    [recipients[survivorIndex]],
    [filingAges[survivorIndex]],
    [labels[survivorIndex]],
  ).bands.filter((b) => b.type === 'personal' && b.endIndex >= firstMonth);
  const personal: BenefitBand[] = standalone.map((b) => ({
    ...b,
    startIndex: Math.max(b.startIndex, firstMonth),
  }));

  // Everyone else's bands stay as they are, and so does everything the
  // survivor was paid up to the death. From the month after it, the
  // survivor's own record is the standalone band above and the survivor
  // band is redrawn below.
  const kept: BenefitBand[] = [];
  for (const band of bands) {
    if (band.personId !== survivorId) {
      kept.push(band);
      continue;
    }
    if (band.type === 'survivor') continue;
    if (band.type === 'personal' && band.endIndex >= firstMonth) {
      if (band.startIndex < firstMonth) kept.push({ ...band, endIndex: firstMonth - 1 });
      continue;
    }
    kept.push(band);
  }
  kept.push(...personal);

  // Dual entitlement: the survivor keeps their own benefit and the survivor
  // band is the increment above it. Where they have not filed on their own
  // record yet, the increment is the whole survivor amount. A new band is cut
  // wherever the increment changes, which is wherever the personal amount
  // does.
  const redrawn: BenefitBand[] = [];
  let open: BenefitBand | null = null;
  for (let m = alternative.claimIndex; m <= survivorFinal; m++) {
    const own = bandAmountAt(personal, m) ?? 0;
    const increment = roundCents(Math.max(0, amount - own));
    if (increment <= 0) {
      if (open !== null) redrawn.push(open);
      open = null;
      continue;
    }
    if (open !== null && open.monthlyAmount === increment) {
      open.endIndex = m;
      continue;
    }
    if (open !== null) redrawn.push(open);
    open = { personId: survivorId, type: 'survivor', startIndex: m, endIndex: m, monthlyAmount: increment };
  }
  if (open !== null) redrawn.push(open);

  return {
    claimIndex: alternative.claimIndex,
    claimAge: alternative.claimAge,
    survivorLabel: alternative.survivorLabel,
    bands: [...kept, ...redrawn],
  };
}
