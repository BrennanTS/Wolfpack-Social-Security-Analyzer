/**
 * Deterministic household generation for the invariant sweep.
 *
 * The golden corpus is thirty hand-written scenarios that share a shape: both
 * people plan to age 85, ages cluster, PIAs never tie. That shape makes whole
 * behaviours bit-exact and therefore invisible — see
 * `docs/reference/survivor-start-impact.md` §3 and the `married-1964-dual-high-earners`
 * note in `order-independence-runs-deep`. This generator exists to leave that
 * shape deliberately.
 *
 * Everything here is seeded. A sweep failure must reproduce from its index
 * alone, so no wall-clock and no `Math.random`.
 */
import type { Person, Gender } from '../../src/lib/personAnalysis';
import type { Household } from '../../src/lib/household';
import type { Deceased, DeceasedRecord, YearMonth } from '../../src/lib/deceased';
import type { AlreadyClaimed } from '../../src/lib/widowed';

/** The date every sweep household is evaluated as-of. Pinned, never `new Date()`. */
export const SWEEP_AS_OF = new Date(2026, 0, 15);

/**
 * mulberry32. Small, fast, and — the only property that matters here —
 * identical on every machine and every run.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const between = (r: () => number, lo: number, hi: number): number =>
  lo + Math.floor(r() * (hi - lo + 1));

/**
 * Birth years the 'full' optimizer accepts as-of `SWEEP_AS_OF`: everyone must
 * be under 70, and old enough that a prospective filing age exists. 1957-1975
 * spans three FRA cohorts (66y6m through 67) without aging anyone out.
 */
const BIRTH_YEARS = [1957, 1958, 1959, 1960, 1961, 1962, 1963, 1964, 1965, 1968, 1971, 1975];
const GENDERS: readonly Gender[] = ['male', 'female'];

/**
 * PIAs chosen to hit the boundaries, not to be realistic. The repeated values
 * are load-bearing: an exact PIA tie is what exposed the engine's positional
 * tie resolution, and no golden scenario outside `married-1964-dual-high-earners`
 * produces one.
 */
const PIAS = [0, 500, 1200, 2000, 2400, 2400, 3000, 3000, 3500, 4200, 5000];

/**
 * Life expectancies that differ between spouses. The golden corpus uses 85 for
 * everyone, which makes the survivor-start behaviour bit-exact across every
 * filing-age combination the optimizer considers — the exact blindness that
 * hid the Phase 3A defect.
 */
const LIFE_EXPECTANCIES = [72, 78, 81, 84, 85, 88, 92, 95];

export interface SweepHousehold {
  /** Reproduces this household on its own: `householdAt(index)`. */
  index: number;
  household: Household;
  /** One line, enough to paste into a bug report. */
  label: string;
}

/**
 * Names travel with the human, not with the slot — `id` is the slot. Swapping
 * entry order must not change what the analysis says about a given person, and
 * a name that changed with the slot would make every label difference look
 * like a real finding.
 */
function personAt(r: () => number, id: 'a' | 'b'): Person {
  return {
    id,
    name: id === 'a' ? 'Alpha' : 'Beta',
    birthYear: pick(r, BIRTH_YEARS),
    birthMonth: between(r, 1, 12),
    gender: pick(r, GENDERS),
    piaMonthly: pick(r, PIAS),
    lifeExpectancy: pick(r, LIFE_EXPECTANCIES),
  };
}

const describePerson = (p: Person) =>
  `${p.birthYear}-${String(p.birthMonth).padStart(2, '0')} ${p.gender[0]} PIA ${p.piaMonthly} LE ${p.lifeExpectancy}`;

/**
 * The household at `index`. Pure and total: the same index always yields the
 * same household, on any machine, forever. Married households outnumber single
 * ones 3:1 because every cross-person invariant needs two people.
 */
export function householdAt(index: number): SweepHousehold {
  const r = rng(index * 2654435761);
  const married = index % 4 !== 0;

  if (!married) {
    const person = personAt(r, 'a');
    return {
      index,
      household: { status: 'single', people: [person] },
      label: `#${index} single — ${describePerson(person)}`,
    };
  }

  const a = personAt(r, 'a');
  const b = personAt(r, 'b');
  return {
    index,
    household: { status: 'married', people: [a, b] },
    label: `#${index} married — A: ${describePerson(a)} | B: ${describePerson(b)}`,
  };
}

/** `count` households starting at `from`. */
export function households(count: number, from = 0): SweepHousehold[] {
  return Array.from({ length: count }, (_, i) => householdAt(from + i));
}

/**
 * Swaps entry order. `id` is the slot, so it stays behind; `name` is the
 * human, so it travels. After a swap, Beta occupies slot 'a'.
 */
export function swapped(household: Household): Household {
  if (household.status === 'single') return household;
  const [a, b] = household.people;
  return { status: 'married', people: [{ ...b, id: 'a' }, { ...a, id: 'b' }] };
}

/* ------------------------------------------------------------------ *
 * Widowed households
 *
 * A SEPARATE generator with its own index space, not a third bucket inside
 * `householdAt`. Two reasons, both practical rather than aesthetic:
 *
 *  - Folding a third status into the existing modulo would reshuffle every
 *    married and single household in the corpus, and several invariants are
 *    pinned to what that corpus currently reaches (`copy.sweep.ts`'s
 *    reachability assertion pins the `earliest` row as unreachable, which is
 *    a deliberate tripwire).
 *  - A widowed household needs a deceased record, a death date, a filing date
 *    and up to two already-claimed dates, each constrained by the others.
 *    That is a different generator, not a different branch of this one.
 *
 * Every household this produces must be one the app would actually accept:
 * `widowedErrors` must return `{}` for it. `households.sweep.ts` asserts that
 * directly, because a generator that quietly emits illegal households would
 * make every downstream invariant vacuous over them.
 * ------------------------------------------------------------------ */

/** Whole months from a birth to a later year/month. */
const monthsFrom = (birth: YearMonth, at: YearMonth): number =>
  (at.year * 12 + at.month - 1) - (birth.year * 12 + birth.month - 1);

/** `n` whole months after a birth, as a year/month pair. */
const monthsAfter = (birth: YearMonth, months: number): YearMonth => {
  const total = birth.year * 12 + (birth.month - 1) + months;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
};

const AS_OF_YM: YearMonth = {
  year: SWEEP_AS_OF.getFullYear(),
  month: SWEEP_AS_OF.getMonth() + 1,
};

/**
 * The deceased is drawn from an EARLIER range than the living. They are dead,
 * so nothing bounds them from above the way "must be under 70 today" bounds a
 * claimant, and a spouse who died in their sixties having been born in the
 * forties is the commonest real case.
 */
const DECEASED_BIRTH_YEARS = [1940, 1945, 1950, 1953, 1956, 1958, 1960, 1962, 1964];

/**
 * Check amounts kept well inside what a real PIA can produce. `deceasedPia`
 * recovers a PIA by bisection and THROWS when no PIA in its bracket pays the
 * amount — an out-of-range value here would make the generator emit
 * households the app rejects, which is the one thing it must not do.
 */
const CHECK_AMOUNTS = [900, 1400, 1800, 2200, 2600];

/**
 * A widowed household at `index`. Pure and total, like `householdAt`.
 *
 * The constraint chain, in the order it has to be satisfied:
 *
 *  1. The deceased is born, reaches 62, and may or may not have filed.
 *  2. They die — after any filing, and not after `SWEEP_AS_OF`.
 *  3. The survivor may already have claimed the survivor benefit, from the
 *     later of the month after the death and their own 60th birthday.
 *  4. The survivor may already have filed on their own record, from their
 *     62nd birthday — independently of the death, which is the case Phase
 *     3B-ii-a's spec got wrong and which is the commonest widowed profile
 *     there is.
 */
export function widowedHouseholdAt(index: number): SweepHousehold {
  const r = rng(index * 40503 + 7);

  const survivor: Person = { ...personAt(r, 'a'), name: 'Alpha' };
  const survivorBirth: YearMonth = { year: survivor.birthYear, month: survivor.birthMonth };

  const decBirth: YearMonth = {
    year: pick(r, DECEASED_BIRTH_YEARS),
    month: between(r, 1, 12),
  };

  // Filing: from the deceased's 62nd birthday, and never after `asOf`. A
  // filing after the death is impossible, which the death window below
  // enforces by starting at the filing month.
  const decSixtyTwo = monthsAfter(decBirth, 62 * 12);
  const filingCeiling = Math.min(
    monthsFrom(decBirth, AS_OF_YM),
    62 * 12 + 8 * 12, // never past 70 — the engine has no filing age beyond it
  );
  const hadFiled = filingCeiling >= 62 * 12 && r() < 0.75;
  const filedMonths = hadFiled ? between(r, 62 * 12, filingCeiling) : null;
  const filed = filedMonths === null ? null : monthsAfter(decBirth, filedMonths);

  // Death: at or after any filing, and at or before `asOf`.
  const deathFloor = Math.max(filedMonths ?? 0, monthsFrom(decBirth, decSixtyTwo) - 24 * 12);
  const deathCeiling = monthsFrom(decBirth, AS_OF_YM);
  const deathMonths = between(r, Math.min(deathFloor, deathCeiling), deathCeiling);
  const death = monthsAfter(decBirth, deathMonths);

  const record: DeceasedRecord =
    filed !== null && r() < 0.35
      ? { kind: 'checkAmount', monthlyAmount: pick(r, CHECK_AMOUNTS), filed }
      : { kind: 'pia', piaMonthly: pick(r, PIAS.filter((p) => p > 0)), filed };

  const deceased: Deceased = {
    birthYear: decBirth.year,
    birthMonth: decBirth.month,
    deathYear: death.year,
    deathMonth: death.month,
    record,
  };

  // Already-claimed: the survivor axis no earlier than the month AFTER the
  // death and no earlier than age 60; the own axis no earlier than 62 and
  // deliberately unconstrained by the death.
  const survivorFloor = Math.max(
    monthsFrom(survivorBirth, monthsAfter(death, 1)),
    60 * 12,
  );
  const survivorCeiling = monthsFrom(survivorBirth, AS_OF_YM);
  const survivorSince =
    survivorFloor <= survivorCeiling && r() < 0.3
      ? monthsAfter(survivorBirth, between(r, survivorFloor, survivorCeiling))
      : null;

  const ownCeiling = monthsFrom(survivorBirth, AS_OF_YM);
  const ownSince =
    ownCeiling >= 62 * 12 && r() < 0.3
      ? monthsAfter(survivorBirth, between(r, 62 * 12, ownCeiling))
      : null;

  const alreadyClaimed: AlreadyClaimed = { survivorSince, ownSince };

  const recordLabel =
    record.kind === 'checkAmount'
      ? `check ${record.monthlyAmount}`
      : `PIA ${record.piaMonthly}`;
  const ym = (v: YearMonth | null) =>
    v === null ? 'none' : `${v.year}-${String(v.month).padStart(2, '0')}`;

  return {
    index,
    household: { status: 'widowed', people: [survivor], deceased, alreadyClaimed },
    label:
      `#${index} widowed — survivor ${describePerson(survivor)} | ` +
      `deceased ${ym(decBirth)} d.${ym(death)} ${recordLabel} filed ${ym(filed)} | ` +
      `claimed S:${ym(survivorSince)} O:${ym(ownSince)}`,
  };
}

/** `count` widowed households starting at `from`. */
export function widowedHouseholds(count: number, from = 0): SweepHousehold[] {
  return Array.from({ length: count }, (_, i) => widowedHouseholdAt(from + i));
}
