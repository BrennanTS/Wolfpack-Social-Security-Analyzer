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
import { classifyEarnerDependent } from '$lib/strategy/calculations/earner-dependent';
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
 * would actually experience — the engine's *earner* outliving the dependent
 * while holding the smaller benefit. Null when there is nothing to disclose.
 *
 * Every figure here is read at the month of the death being described, never
 * at the end of life. An earlier version compared the two people's LAST
 * personal bands with no date test at all, so it quoted survivors an amount
 * that does not begin until decades after the death, asserted in the present
 * tense over years in which the chart directly beneath rendered $0. Over 2,400
 * sampled households it named a figure the survivor was not being paid in 81%
 * of the cases it fired on.
 */
export interface SurvivorGap {
  survivorLabel: string;
  /** The deceased's own monthly benefit in their final month. */
  deceasedMonthly: number;
  /**
   * What the survivor is paid on their own record in the month after the
   * death. **Null when they hold no personal band that month** — they have
   * not filed yet, there is no amount to quote, and the chart's zero is
   * correct. Modelled as null rather than 0 so each surface has to say which
   * of the two it means.
   */
  survivorOwnMonthly: number | null;
  /**
   * True when the survivor has not reached SSA age 60 in the month after the
   * death. No widow(er) benefit is payable before then, so the chart's zero
   * is right for those months and the disclosure must not claim an immediate
   * permanent shortfall. This is a date comparison against the engine's own
   * SSA-age arithmetic (`birthdate.dateAtSsaAge`), not a benefit computation.
   */
  survivorUnder60: boolean;
}

export interface HouseholdPeriods {
  bands: BenefitBand[];
  survivorGap: SurvivorGap | null;
  /**
   * Each person's inclusive final month index — the month they reach their
   * plan-to age. NOT derivable from the bands: a person who dies before
   * filing holds no band at all, so their death month is nowhere in the band
   * ends to be read. (An earlier version of this note claimed the reason was
   * that `splitDualEntitlement` extends the DECEASED's personal band to the
   * survivor's death. It does not — it carries forward
   * `latestPersonalBand(bands, survivor.personId)`, the survivor's own band,
   * and the engine already ends the earner's personal periods at
   * `earnerFinalDate`, `strategy-calc.ts:104-110`. The field is still needed,
   * for the reason stated above.)
   */
  finalIndexByPersonId: Record<string, number>;
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

/** The personal band paying a given person in a given month, if any. */
function personalBandAt(
  bands: BenefitBand[],
  personId: string,
  monthIndex: number,
): BenefitBand | null {
  return (
    bands.find(
      (b) =>
        b.personId === personId &&
        b.type === 'personal' &&
        b.startIndex <= monthIndex &&
        monthIndex <= b.endIndex,
    ) ?? null
  );
}

/** The month the recipient attains SSA age 60, on the band index convention. */
function ssaAge60Index(recipient: Recipient): number {
  return monthIndexOf(
    recipient.birthdate.dateAtSsaAge(MonthDuration.initFromYearsMonths({ years: 60, months: 0 })),
  );
}

/**
 * The engine pays survivor benefits in one direction only — the higher-PIA
 * earner "will never have spousal or survivor benefits" (`strategy-calc.ts:104`).
 * When the *dependent* dies first, no survivor band is emitted for anyone, and
 * if the dependent was holding the larger benefit the household's real
 * survivor income is higher than anything on screen.
 *
 * It fires only when the survivor is the engine's own `earner`. The engine
 * ALSO emits no Survivor period in the modelled direction when the dependent
 * survives and their own benefit already exceeds the survivor benefit
 * (`strategy-calc.ts:88-98`) — that is the engine modelling the direction and
 * declining the step-up, not failing to model it, and disclosing a gap there
 * would be false. `classifyEarnerDependent` is the engine's own classifier
 * (strict `>` on PIA), deliberately used in preference to `household.ts`'s
 * `>=`, so an exact PIA tie cannot make the two disagree.
 *
 * Both disclosed figures are read at the month of the death, not at the end of
 * life: the survivor's "own" benefit is whatever band covers `deathIndex + 1`,
 * which is often none at all. Comparing end-of-life bands is what let this
 * quote a survivor an amount they were not being paid.
 *
 * Takes the NORMALIZED bands, before the dual-entitlement split — the split is
 * allowed to drop a survivor band and must not be able to turn that into a
 * disclosure. Only `monthlyAmount` and the dates are read, which the split
 * leaves untouched on personal bands in a household with no survivor band.
 */
function detectSurvivorGap(
  normalized: BenefitBand[],
  people: Person[],
  recipients: Recipient[],
  finalIndexes: number[],
  labels: string[],
): SurvivorGap | null {
  if (people.length !== 2) return null;
  if (normalized.some((b) => b.type === 'survivor')) return null;

  // Whoever outlives the other is the candidate survivor.
  const survivorIdx = finalIndexes[0] > finalIndexes[1] ? 0 : 1;
  const deceasedIdx = 1 - survivorIdx;
  if (finalIndexes[survivorIdx] === finalIndexes[deceasedIdx]) return null;

  // The unmodelled direction is specifically the earner outliving the
  // dependent. The other no-survivor-band case is a modelled decision.
  const { earnerIndex } = classifyEarnerDependent([recipients[0], recipients[1]]);
  if (survivorIdx !== earnerIndex) return null;

  const deathIndex = finalIndexes[deceasedIdx];
  // A survivor benefit derives from the deceased's own retirement benefit;
  // spousal entitlement ends at death, so only the personal band counts.
  const deceased = personalBandAt(normalized, people[deceasedIdx].id, deathIndex);
  if (deceased === null) return null;

  const survivorOwn = personalBandAt(normalized, people[survivorIdx].id, deathIndex + 1);
  // No band that month means they are being paid nothing that month, so the
  // comparison is against $0 — and the disclosure must not quote an amount.
  if (deceased.monthlyAmount <= (survivorOwn?.monthlyAmount ?? 0)) return null;

  return {
    survivorLabel: labels[survivorIdx],
    deceasedMonthly: deceased.monthlyAmount,
    survivorOwnMonthly: survivorOwn?.monthlyAmount ?? null,
    survivorUnder60: deathIndex + 1 < ssaAge60Index(recipients[survivorIdx]),
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
  const survivorGap = detectSurvivorGap(
    normalized,
    people,
    recipients,
    finalDates.map(monthIndexOf),
    labels,
  );

  const finalIndexByPersonId: Record<string, number> = {};
  people.forEach((p, i) => {
    finalIndexByPersonId[p.id] = monthIndexOf(finalDates[i]);
  });

  return { bands: splitDualEntitlement(normalized), survivorGap, finalIndexByPersonId };
}

/** Payment months this band contributes to a given calendar year. */
export function monthsInYear(band: BenefitBand, year: number): number {
  const start = Math.max(band.startIndex, year * 12);
  const end = Math.min(band.endIndex, year * 12 + 11);
  return Math.max(0, end - start + 1);
}
