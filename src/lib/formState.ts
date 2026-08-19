import { CPI_DEFAULT_COLA } from './cpiHistory';
import type { DollarsMode } from './dollarsMode';
import { DEFAULT_PLAN_TO_AGE, isBenefitInRange } from './formBounds';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from './household';
import { getCurrentAge, type Gender, type Person } from './personAnalysis';
import { getSuggestedLifeExpectancy } from './lifeExpectancy';
import { longevitySensitivity, type LongevitySensitivity } from './longevity';
import { DEFAULT_SCENARIO_SET, type ScenarioSet } from './scenario';
import { DEFAULT_DISCOUNT_RATE } from './ssaTools';
import {
  BLANK_ALREADY_CLAIMED,
  BLANK_DECEASED,
  isWidowedComplete,
  toAlreadyClaimed,
  toDeceased,
  widowedErrors,
  type AlreadyClaimedFormFields,
  type DeceasedFormFields,
} from './widowedForm';

export interface PersonFormFields {
  name: string;
  birthYear: number | '';
  birthMonth: number | '';
  gender: Gender | null;
  monthlyBenefit: number | '';
  /**
   * Plan-to age, and since the optimizer began taking its horizon from it
   * (`planToAgeDistribution`), the input that most moves the recommendation.
   *
   * Null means "not yet set", which now falls back to `DEFAULT_PLAN_TO_AGE`
   * rather than to the SSA period-table suggestion for this person's age and
   * gender. The suggestion is still offered beside the slider — it is a
   * secondary reference, not the driver.
   */
  lifeExpectancy: number | null;
}

export interface AnalyzerFormState {
  personA: PersonFormFields;
  personB: PersonFormFields;
  /**
   * Null means "not yet chosen", which is what gates the analysis. Replaces the
   * former boolean `hasSpouse`: a widowed household is neither single nor
   * married, and a third boolean would have made every read site guess.
   */
  maritalStatus: 'single' | 'married' | 'widowed' | null;
  /** Only meaningful when `maritalStatus === 'widowed'`. */
  deceased: DeceasedFormFields;
  /** Only meaningful when `maritalStatus === 'widowed'`. */
  alreadyClaimed: AlreadyClaimedFormFields;
  annualCola: number;
  discountRate: number;
  /**
   * Real is the engine's own output, untouched — `combinedTimeline` carries
   * no COLA. Nominal is a display transform (`lib/dollarsMode.ts`) applied
   * on top, never sent to the engine, which is why this field plays no part
   * in `toHousehold`/`analyzeIfComplete` below. Defaults to real: a chart
   * that inflates benefits forward shows a rising line for flat purchasing
   * power, so the flattering view is the one the reader has to ask for.
   */
  dollarsMode: DollarsMode;
  /**
   * The adviser's comparison scenarios and which one the analysis is built
   * on. Lives in form state rather than beside it in `Analyzer` so it travels
   * through the share link and through `analyzeIfComplete` by the same route
   * every other engine input does — unlike `dollarsMode` and `annualCola`,
   * this one genuinely changes what the engine is asked, so a re-analysis
   * must follow a change to it.
   */
  scenarios: ScenarioSet;
}

const BLANK_PERSON: PersonFormFields = {
  name: '',
  birthYear: '',
  birthMonth: '',
  gender: null,
  monthlyBenefit: '',
  // Set, not null. `reseedLifeExpectancy` no longer fills this in from the
  // SSA table on the first identity edit, so leaving it null would leave
  // `isFormComplete` permanently false — the form would never analyse at all.
  lifeExpectancy: DEFAULT_PLAN_TO_AGE,
};

export const BLANK_FORM: AnalyzerFormState = {
  personA: BLANK_PERSON,
  personB: BLANK_PERSON,
  maritalStatus: null,
  deceased: BLANK_DECEASED,
  alreadyClaimed: BLANK_ALREADY_CLAIMED,
  annualCola: CPI_DEFAULT_COLA,
  discountRate: DEFAULT_DISCOUNT_RATE,
  dollarsMode: 'real',
  scenarios: DEFAULT_SCENARIO_SET,
};

export { isBenefitInRange, MAX_BENEFIT, MIN_BENEFIT } from './formBounds';

/** A person is complete when identity is present and the benefit is in range. */
function isPersonComplete(p: PersonFormFields): boolean {
  if (p.birthYear === '' || p.birthMonth === '' || p.gender === null) return false;
  if (p.monthlyBenefit === '') return false;
  return isBenefitInRange(p.monthlyBenefit);
}

/**
 * `asOf` defaults to now, matching `analyzeHousehold`'s established pattern.
 * It exists because completeness is genuinely date-dependent for a widowed
 * household — `widowedErrors` blocks a death date in the future — and an
 * implicit `new Date()` inside a predicate makes it impure in two ways that
 * both bite: a test pinning "incomplete while a field error is outstanding"
 * silently inverts once the fixture's date stops being in the future, and a
 * caller that reads the clock separately for the DISPLAYED errors can
 * disagree with this gate across a month boundary. Callers that show errors
 * should pass the same `asOf` they render from.
 */
export function isFormComplete(form: AnalyzerFormState, asOf: Date = new Date()): boolean {
  if (form.maritalStatus === null || form.personA.lifeExpectancy === null) return false;
  if (!isPersonComplete(form.personA)) return false;
  // Married analyses require real spouse data — never defaulted from person A.
  if (form.maritalStatus === 'married' && !isPersonComplete(form.personB)) return false;

  if (form.maritalStatus === 'widowed') {
    if (!isWidowedComplete(form.deceased)) return false;
    // An impossible combination must not reach the engine — several of these
    // produce a throw rather than a wrong answer.
    const { birthYear, birthMonth } = form.personA;
    if (birthYear === '' || birthMonth === '') return false;
    const errors = widowedErrors(
      form.deceased,
      form.alreadyClaimed,
      { year: birthYear, month: birthMonth },
      asOf,
    );
    if (Object.keys(errors).length > 0) return false;
  }

  // A person with no work record of their own is legitimate — they may draw a
  // spousal benefit on their partner's record. A household where *nobody*
  // earns has nothing to analyze. A widow always has the deceased's record.
  if (form.maritalStatus === 'widowed') return true;
  const benefits =
    form.maritalStatus === 'married'
      ? [form.personA.monthlyBenefit, form.personB.monthlyBenefit]
      : [form.personA.monthlyBenefit];
  return benefits.some((b) => b !== '' && b > 0);
}

/** The SSA-suggested plan-to age for one person, or null if identity is incomplete. */
export function suggestedLifeExpectancyFor(fields: PersonFormFields): number | null {
  const { birthYear, birthMonth, gender } = fields;
  if (birthYear === '' || birthMonth === '' || gender === null) return null;
  return getSuggestedLifeExpectancy(getCurrentAge(birthYear, birthMonth).years, gender);
}

/**
 * Carries a person's edits through untouched.
 *
 * This used to re-seed the plan-to age from the SSA period table whenever the
 * identity inputs changed, so correcting a birth year moved the horizon — and
 * now that the optimizer runs on that horizon, it would move the
 * recommendation too, from a table the adviser never chose. The plan-to age
 * is theirs to set: it starts at `DEFAULT_PLAN_TO_AGE` and changes only when
 * they change it, or when they press the SSA-suggestion button beside the
 * slider.
 *
 * Kept as a named function rather than deleted at the call sites: `Analyzer`
 * routes both people's edits through it, and a future rule about what an
 * identity change should do belongs here rather than in two components.
 */
export function reseedLifeExpectancy(
  _prev: PersonFormFields,
  next: PersonFormFields,
): PersonFormFields {
  return next;
}

function toPerson(fields: PersonFormFields, id: 'a' | 'b'): Person {
  return {
    id,
    name: fields.name.trim() || undefined,
    birthYear: fields.birthYear as number,
    birthMonth: fields.birthMonth as number,
    gender: fields.gender as Gender,
    piaMonthly: fields.monthlyBenefit as number,
    // `DEFAULT_PLAN_TO_AGE`, not the SSA suggestion — see the field's own
    // note. A household reaching the engine with no plan-to age set gets the
    // same horizon as one the adviser left alone, rather than a different one
    // derived from their gender.
    lifeExpectancy: fields.lifeExpectancy ?? DEFAULT_PLAN_TO_AGE,
  };
}

export function toHousehold(form: AnalyzerFormState): Household {
  const personA = toPerson(form.personA, 'a');
  if (form.maritalStatus === 'widowed') {
    return {
      status: 'widowed',
      people: [personA],
      deceased: toDeceased(form.deceased),
      alreadyClaimed: toAlreadyClaimed(form.alreadyClaimed),
    };
  }
  if (form.maritalStatus !== 'married') return { status: 'single', people: [personA] };
  return { status: 'married', people: [personA, toPerson(form.personB, 'b')] };
}

/**
 * The longevity sensitivity for the form as it stands, or null if the form
 * is not complete.
 *
 * Beside `analyzeIfComplete` and gated the same way, so the two cannot
 * disagree about whether the household is ready or about which `asOf` they
 * used — the sensitivity re-runs the same analysis at other plan-to ages,
 * and a different reference date would make its middle row not match the
 * report it sits in.
 */
export async function longevityIfComplete(
  form: AnalyzerFormState,
  asOf?: Date,
): Promise<LongevitySensitivity | null> {
  if (!isFormComplete(form, asOf)) return null;
  return longevitySensitivity(
    toHousehold(form),
    { annualCola: form.annualCola, discountRate: form.discountRate },
    asOf ?? new Date(),
    form.scenarios,
  );
}

export async function analyzeIfComplete(
  form: AnalyzerFormState,
  asOf?: Date,
): Promise<HouseholdAnalysis | null> {
  // The same `asOf` gates completeness and drives the analysis: two clock
  // reads could otherwise disagree across a month boundary.
  if (!isFormComplete(form, asOf)) return null;
  return analyzeHousehold(
    toHousehold(form),
    { annualCola: form.annualCola, discountRate: form.discountRate },
    asOf,
    form.scenarios,
  );
}
