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
