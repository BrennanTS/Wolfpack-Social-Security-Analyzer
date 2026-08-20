import type { BenefitBand } from './benefitPeriods';
import { personLabel } from './format';
import { firstDeath } from './incomeCliff';
import type { HouseholdAnalysis } from './household';

/**
 * One moment where the household's monthly income changes, and why.
 *
 * The report currently asks a client to read a lifetime present value and a
 * chart. This is the same information as a short list of events — "in
 * February 2042 your spouse starts her own benefit, and together you have
 * $1,640 a month" — which is how every person actually thinks about the
 * decision, and how the clearest of the competing reports states it.
 */
export interface IncomeChange {
  /** Absolute month index, on the band convention. */
  monthIndex: number;
  /** What happened, in the client's words. */
  reason: string;
  /** Monthly amount per person after the change, in display order. */
  byPerson: number[];
  /** What the household receives per month after the change. */
  total: number;
}

const CENT = 0.005;

/** Total monthly income for each person in a given month. */
function monthlyAt(bands: readonly BenefitBand[], ids: readonly string[], month: number): number[] {
  return ids.map((id) =>
    bands
      .filter((b) => b.personId === id && b.startIndex <= month && month <= b.endIndex)
      .reduce((sum, b) => sum + b.monthlyAmount, 0),
  );
}

/**
 * Every month the household's income changes, with what caused it.
 *
 * Built from the bands rather than from the monthly series, because the
 * series carries an amount per month but no account of WHY it moved, and the
 * reason is the whole value of the list. Candidate months are every band
 * start (someone begins a benefit) plus the month after the first death
 * (someone stops) — a change can only happen where a band begins or ends.
 *
 * Consecutive candidates that leave the total unmoved are dropped: the
 * January delayed-credit bump splits a personal band in two without changing
 * what anybody is paid, and a row saying "nothing changed" is worse than no
 * row.
 */
export function incomeChanges(analysis: HouseholdAnalysis): IncomeChange[] {
  const ids: string[] = analysis.people.map((p) => p.person.id);
  const names = analysis.people.map((p) => p.person.name);
  const bands = analysis.periods;
  if (bands.length === 0) return [];

  // Only a two-person household has a first death to announce; `firstDeath`
  // wants the pair, so a single claimant simply has none.
  const death =
    ids.length === 2
      ? firstDeath([ids[0], ids[1]] as [string, string], analysis.finalIndexByPersonId)
      : null;
  const candidates = new Set<number>(bands.map((b) => b.startIndex));
  if (death !== null) candidates.add(death.deathMonthIndex + 1);

  const reasonFor = (month: number): string => {
    if (death !== null && month === death.deathMonthIndex + 1) {
      return 'At the first death, the survivor keeps the larger of the two';
    }
    const starting = bands.filter((b) => b.startIndex === month);
    // `personLabel`, like every other surface that names a person, rather
    // than the raw name. The name field is optional, so it arrives blank far
    // more often than it arrives missing — and `?? 'They'` caught only the
    // missing case, which is how "They starts their own benefit" reached
    // page 1 of the report. Every label it returns is singular, so the verbs
    // below agree whether or not anyone typed a name.
    const who = (b: BenefitBand) => {
      const index = ids.indexOf(b.personId);
      return personLabel(names[index], index);
    };
    const survivor = starting.find((b) => b.type === 'survivor');
    if (survivor) return `${who(survivor)} adds a survivor benefit`;
    const spousal = starting.find((b) => b.type === 'spousal');
    if (spousal) return `${who(spousal)} adds a spousal top-up`;
    const personal = starting.find((b) => b.type === 'personal');
    if (personal) return `${who(personal)} starts their own benefit`;
    return 'Income changes';
  };

  const changes: IncomeChange[] = [];
  for (const month of [...candidates].sort((a, b) => a - b)) {
    const byPerson = monthlyAt(bands, ids, month);
    const total = byPerson.reduce((a, b) => a + b, 0);
    const previous = changes[changes.length - 1];
    // Nothing to announce: the total is unmoved, and each person's share too.
    // Both are checked because a spousal top-up can shift between two people
    // without the household total moving, which IS worth a row.
    if (
      previous !== undefined &&
      Math.abs(previous.total - total) < CENT &&
      previous.byPerson.every((v, i) => Math.abs(v - byPerson[i]) < CENT)
    ) {
      continue;
    }
    if (total < CENT && changes.length === 0) continue;
    changes.push({ monthIndex: month, reason: reasonFor(month), byPerson, total });
  }
  return changes;
}
