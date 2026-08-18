import type { BandType, BenefitBand } from './benefitPeriods';
import { yearsMonthsLabel } from './format';
import type { Person } from './personAnalysis';

/**
 * A widow(er)'s income as the STAGES they will actually live through, derived
 * from the engine's bands rather than from the two recommended dates.
 *
 * This replaces a three-figure "own record + survivor increment = together"
 * split, which quietly assumed the two benefits stack. They stack only when
 * the survivor benefit exceeds this person's own; when their own is the larger
 * — a high earner widowed by a lower one — the engine ends the survivor band
 * the month their own record starts, and the two never overlap at all.
 *
 * For one real household (own PIA 3,000, deceased 2,000) the split reported
 * **"Survivor increment, from 60: $0.00"**. The survivor benefit was $1,430 a
 * month and was that person's ENTIRE income for the ten years from 60 to 70 —
 * a true number under a label that was not true of it, which is this project's
 * signature defect.
 *
 * Stages cannot produce that: each one states what is actually paid over a
 * span, and a benefit that pays nothing extra simply never opens a stage.
 */
export interface WidowedStage {
  /** Absolute month index this stage begins — the `BenefitBand` convention. */
  startIndex: number;
  /** The person's age then: "60", "62 years, 1 month". */
  ageLabel: string;
  /** Total monthly income throughout the stage. */
  monthly: number;
  /** Which benefits are live, ascending by type for a stable label. */
  types: BandType[];
}

/**
 * The person's age at an absolute month index, as a label.
 *
 * Plain month arithmetic rather than the engine's `ageAtSsaDate`. Every
 * recipient this app builds shares one birth day (`DEFAULT_BIRTH_DAY`), so no
 * SSA day-of-month adjustment can separate the two — verified against
 * `survivorClaimDate.age`, which does go through the engine, on the households
 * that produce both.
 */
function ageLabelAt(person: Person, monthIndex: number): string {
  const months = monthIndex - (person.birthYear * 12 + person.birthMonth - 1);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? String(years) : yearsMonthsLabel(years, rest);
}

/**
 * Every distinct income stage, in order.
 *
 * Built by walking the band boundaries: a stage begins wherever the set of
 * live bands changes, and consecutive spans paying the same total are merged
 * — a survivor band ending exactly as an equal-paying one begins is one stage
 * to a reader, not two. Spans paying nothing open no stage at all, which is
 * what keeps a gap between the two benefits from printing as "$0 from 64".
 */
export function widowedStages(periods: BenefitBand[], person: Person): WidowedStage[] {
  if (periods.length === 0) return [];

  // Every month where the live set can change: a band's first month, and the
  // month after a band's last.
  const boundaries = [
    ...new Set(periods.flatMap((b) => [b.startIndex, b.endIndex + 1])),
  ].sort((a, b) => a - b);

  const stages: WidowedStage[] = [];
  for (const startIndex of boundaries) {
    const live = periods.filter((b) => b.startIndex <= startIndex && startIndex <= b.endIndex);
    if (live.length === 0) continue; // Before anything starts, or after everything ends.

    const monthly = Math.round(live.reduce((total, b) => total + b.monthlyAmount, 0) * 100) / 100;
    if (monthly === 0) continue; // A band exists but pays nothing — no stage to state.

    const types = [...new Set(live.map((b) => b.type))].sort();
    const previous = stages[stages.length - 1];
    // Merge: same money and same sources means the reader sees no change.
    if (previous && previous.monthly === monthly && previous.types.join() === types.join()) {
      continue;
    }
    stages.push({ startIndex, ageLabel: ageLabelAt(person, startIndex), monthly, types });
  }

  return stages;
}

/**
 * Whether any month pays a personal band and a survivor band at once.
 *
 * The chart's caption claims a survivor segment is "the increment above the
 * personal band beneath it". With no overlap there is no band beneath it, and
 * the sentence describes a stacking that does not happen — the same
 * conditional-caption problem `combinedIncomeCaption` already handles for a
 * survivor gap.
 */
export function widowedBenefitsOverlap(periods: BenefitBand[]): boolean {
  const personal = periods.filter((b) => b.type === 'personal');
  const survivor = periods.filter((b) => b.type === 'survivor');
  return personal.some((p) =>
    survivor.some((s) => p.startIndex <= s.endIndex && s.startIndex <= p.endIndex),
  );
}
