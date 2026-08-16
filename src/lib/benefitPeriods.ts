/**
 * Adapter over the vendored ssa.tools engine's typed benefit periods.
 *
 * The engine already computes the decomposition this app used to rebuild by
 * hand: every benefit, with its type, its inclusive start and end month, its
 * amount and its recipient. This module normalizes that output into the app's
 * band shape and performs exactly one transformation on it — the
 * dual-entitlement split described below. It re-derives no benefit rule.
 *
 * The periods carry no COLA: each amount is fixed for its period, so the bands
 * are in constant (real) dollars.
 */
import type { MonthDate } from '$lib/month-time';
import { MonthDuration } from '$lib/month-time';
import type { Recipient } from '$lib/recipient';
import { type BenefitPeriod, BenefitType } from '$lib/strategy/calculations/benefit-period';
import {
  strategySumPeriodsCouple,
  strategySumPeriodsSingle,
} from '$lib/strategy/calculations/strategy-calc';
import type { Person } from './personAnalysis';

export type BandType = 'personal' | 'spousal' | 'survivor';

export interface BenefitBand {
  personId: string;
  type: BandType;
  /** Inclusive absolute month index: calendarYear * 12 + (month - 1), month 1-12. */
  startIndex: number;
  /** Inclusive. */
  endIndex: number;
  monthlyAmount: number;
}

/**
 * Set when the engine cannot model the survivor direction this household
 * would actually experience — the higher earner outliving the lower earner
 * while holding the smaller benefit. Null when there is nothing to disclose.
 */
export interface SurvivorGap {
  survivorLabel: string;
  survivorOwnMonthly: number;
  deceasedMonthly: number;
}

export interface HouseholdPeriods {
  bands: BenefitBand[];
  survivorGap: SurvivorGap | null;
}

/**
 * The month a person reaches their plan-to age, inclusive — the engine's
 * `finalDate`. Month-precise rather than year-precise: someone born in June
 * with a plan-to age of 85 collects six payments in 2045, not twelve.
 */
function finalDateFor(recipient: Recipient, person: Person): MonthDate {
  return recipient.birthdate.dateAtSsaAge(
    MonthDuration.initFromYearsMonths({ years: person.lifeExpectancy, months: 0 }),
  );
}

/** The band index convention, read off the engine's own accessors. */
function monthIndexOf(date: MonthDate): number {
  return date.year() * 12 + date.monthIndex();
}

// Keyed on the engine's enum rather than `string`, so a new BenefitType member
// becomes a type error here instead of an `undefined` band type at runtime.
const BAND_TYPE: Record<BenefitType, BandType> = {
  [BenefitType.Personal]: 'personal',
  [BenefitType.Spousal]: 'spousal',
  [BenefitType.Survivor]: 'survivor',
};

function toBand(period: BenefitPeriod, people: Person[]): BenefitBand {
  return {
    personId: people[period.recipientIndex].id,
    type: BAND_TYPE[period.benefitType],
    startIndex: monthIndexOf(period.startDate),
    endIndex: monthIndexOf(period.endDate),
    monthlyAmount: period.amount.value(),
  };
}

/**
 * The personal band a person was actually receiving at the end of their
 * personal entitlement. `PersonalBenefitPeriods` emits at most two — the
 * delayed-January-bump amount and the amount for the rest of life
 * (`src/vendor/ssa-tools/strategy/calculations/recipient-personal-benefits.ts:115-127`)
 * — so the later-starting one is the live amount. Undefined when the person
 * has no personal band at all, which happens when the engine truncates their
 * personal entitlement to nothing (survivor benefits starting the month they
 * would have filed).
 *
 * Known imprecision, deliberately not fixed: when the engine truncates the
 * dependent's personal entitlement *inside* their filing calendar year, only
 * the pre-January-bump band exists, so the split carries that lower figure
 * forward and the survivor top-up absorbs the difference. The household total
 * stays exactly right — it is the engine's own survivor amount either way —
 * and only the personal/survivor composition is off by the bump. The
 * post-bump figure is not exposed on that path, so recovering it would mean
 * recomputing a benefit rule, which is precisely what this module exists to
 * avoid.
 */
function latestPersonalBand(bands: BenefitBand[], personId: string): BenefitBand | undefined {
  return bands
    .filter((b) => b.personId === personId && b.type === 'personal')
    .reduce<BenefitBand | undefined>(
      (latest, b) => (latest === undefined || b.startIndex > latest.startIndex ? b : latest),
      undefined,
    );
}

/**
 * SSA administers survivor benefits as dual entitlement: the widow(er) keeps
 * their own retirement benefit and receives a survivor benefit equal to the
 * difference. The engine models the same total as a replacement — it truncates
 * the personal period at `survivorStartDate - 1` and emits one Survivor period
 * carrying the whole amount (`strategy-calc.ts:114-141`).
 *
 * This restores the composition: carry the personal band forward at the amount
 * it was already paying, and make the survivor band the difference. It is
 * arithmetic on the engine's own figures — the personal benefit is fixed after
 * filing, so carrying it forward invents nothing.
 */
function splitDualEntitlement(bands: BenefitBand[]): BenefitBand[] {
  // The personal band each survivor band is paired with, resolved before
  // anything is rewritten. Absent when the person has no personal band, in
  // which case the survivor band already is the whole of what they receive.
  const ownBand = new Map<BenefitBand, BenefitBand>();
  const carryForwardTo = new Map<BenefitBand, number>();
  for (const survivor of bands.filter((b) => b.type === 'survivor')) {
    const personal = latestPersonalBand(bands, survivor.personId);
    if (personal === undefined) continue;
    ownBand.set(survivor, personal);
    // Replaces the engine's truncation at survivorStart - 1.
    carryForwardTo.set(personal, survivor.endIndex);
  }

  return bands.flatMap((band) => {
    if (band.type !== 'survivor') {
      const endIndex = carryForwardTo.get(band);
      return [endIndex === undefined ? band : { ...band, endIndex }];
    }
    const personal = ownBand.get(band);
    if (personal === undefined) return [band];
    // The engine only emits a survivor period when it exceeds the personal
    // benefit, so this is normally positive; an equal-amounts household must
    // not render an empty band.
    const topUp = band.monthlyAmount - personal.monthlyAmount;
    return topUp > 0 ? [{ ...band, monthlyAmount: topUp }] : [];
  });
}

/**
 * The engine pays survivor benefits in one direction only — the higher-PIA
 * earner "will never have spousal or survivor benefits" (`strategy-calc.ts:104`).
 * When the dependent dies first, no survivor band is emitted for anyone, and
 * if the dependent was holding the larger benefit the household's real
 * survivor income is higher than anything on screen.
 *
 * This detects that case rather than computing it: it compares two figures the
 * engine already produced and adds no benefit rule of its own.
 *
 * Takes the NORMALIZED bands, before the dual-entitlement split — the split is
 * allowed to drop a survivor band and must not be able to turn that into a
 * disclosure. Only `monthlyAmount` is read, which the split leaves untouched
 * on personal bands.
 */
function detectSurvivorGap(
  normalized: BenefitBand[],
  people: Person[],
  finalIndexes: number[],
  labels: string[],
): SurvivorGap | null {
  if (people.length !== 2) return null;
  if (normalized.some((b) => b.type === 'survivor')) return null;

  // Whoever outlives the other is the person the engine left unmodelled.
  const survivorIdx = finalIndexes[0] > finalIndexes[1] ? 0 : 1;
  const deceasedIdx = 1 - survivorIdx;
  if (finalIndexes[survivorIdx] === finalIndexes[deceasedIdx]) return null;

  const survivorOwn = latestPersonalBand(normalized, people[survivorIdx].id);
  const deceased = latestPersonalBand(normalized, people[deceasedIdx].id);
  if (survivorOwn === undefined || deceased === undefined) return null;

  // A survivor benefit derives from the deceased's own retirement benefit;
  // spousal entitlement ends at death, so only the personal band counts.
  if (deceased.monthlyAmount <= survivorOwn.monthlyAmount) return null;

  return {
    survivorLabel: labels[survivorIdx],
    survivorOwnMonthly: survivorOwn.monthlyAmount,
    deceasedMonthly: deceased.monthlyAmount,
  };
}

/**
 * Every benefit the household receives, as dated bands.
 *
 * Accepts one or two people; `recipients`, `filingAges` and `labels` are
 * parallel to `people`.
 */
export function householdPeriods(
  people: Person[],
  recipients: Recipient[],
  filingAges: MonthDuration[],
  labels: string[],
): HouseholdPeriods {
  const finalDates = people.map((person, i) => finalDateFor(recipients[i], person));

  const periods: BenefitPeriod[] =
    people.length === 1
      ? strategySumPeriodsSingle(recipients[0], finalDates[0], filingAges[0])
      : strategySumPeriodsCouple(
          [recipients[0], recipients[1]],
          [finalDates[0], finalDates[1]],
          [filingAges[0], filingAges[1]],
        );

  const normalized = periods.map((p) => toBand(p, people));
  // Gap detection reads the engine's own output, not the split's. The split
  // can drop a survivor band whose top-up is not positive, and that is a
  // display decision — it must not be able to manufacture a disclosure.
  const survivorGap = detectSurvivorGap(normalized, people, finalDates.map(monthIndexOf), labels);

  return { bands: splitDualEntitlement(normalized), survivorGap };
}

/** Payment months this band contributes to a given calendar year. */
export function monthsInYear(band: BenefitBand, year: number): number {
  const start = Math.max(band.startIndex, year * 12);
  const end = Math.min(band.endIndex, year * 12 + 11);
  return Math.max(0, end - start + 1);
}
