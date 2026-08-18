import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_TO_AGE } from './formBounds';
import type { Household } from './household';
import type { Person } from './personAnalysis';
import {
  BLANK_FORM,
  isBenefitInRange,
  isFormComplete,
  MAX_BENEFIT,
  MIN_BENEFIT,
  reseedLifeExpectancy,
  suggestedLifeExpectancyFor,
  toHousehold,
  type AnalyzerFormState,
  type PersonFormFields,
} from './formState';
import { BLANK_DECEASED } from './widowedForm';

const completeA = {
  name: 'Dan',
  birthYear: 1962,
  birthMonth: 4,
  gender: 'male' as const,
  monthlyBenefit: 2400,
  lifeExpectancy: 85,
};
const completeB = {
  name: '',
  birthYear: 1964,
  birthMonth: 2,
  gender: 'female' as const,
  monthlyBenefit: 2100,
  lifeExpectancy: null,
};

const single: AnalyzerFormState = {
  ...BLANK_FORM,
  personA: completeA,
  maritalStatus: 'single',
};

/**
 * Narrows a `Household` to the married arm, failing loudly if it is not one.
 *
 * `Household.people` is `[Person]` for single and widowed and `[Person, Person]`
 * for married, so `h.people[1]` is `Person | undefined` on the union — and
 * `expect(h.status).toBe('married')` does not narrow it for the type checker.
 * A non-null assertion would have silenced that without checking anything;
 * this asserts the thing the following lines depend on.
 */
function asMarried(h: Household): [Person, Person] {
  if (h.status !== 'married') throw new Error(`expected a married household, got ${h.status}`);
  return h.people;
}

describe('isFormComplete', () => {
  it('accepts a complete single form', () => {
    expect(isFormComplete(single)).toBe(true);
  });

  it('rejects a blank form', () => {
    expect(isFormComplete(BLANK_FORM)).toBe(false);
  });

  // Person A's own benefit legitimately starts at $0 too now that the old
  // $500 floor is gone — see 'agrees with the field-level guardrails' below.
  // Only a missing value (never typed) blocks completion.
  it('rejects a missing benefit', () => {
    expect(isFormComplete({ ...single, personA: { ...completeA, monthlyBenefit: '' } })).toBe(false);
  });

  it('rejects married until every spouse field is supplied', () => {
    const married = { ...single, maritalStatus: 'married' as const, personB: BLANK_FORM.personB };
    expect(isFormComplete(married)).toBe(false);

    expect(
      isFormComplete({ ...married, personB: { ...completeB, gender: null } }),
    ).toBe(false);
    expect(
      isFormComplete({ ...married, personB: { ...completeB, birthYear: '' } }),
    ).toBe(false);

    expect(isFormComplete({ ...married, personB: completeB })).toBe(true);
  });

  it('accepts a spouse with a zero benefit, which means no work record', () => {
    const married = {
      ...single,
      maritalStatus: 'married' as const,
      personB: { ...completeB, monthlyBenefit: 0 },
    };
    expect(isFormComplete(married)).toBe(true);
  });

  // The gate used to require only `> 0` while the field marked anything under
  // the old $500 floor (or over $5,000) invalid, so a $250 entry showed a red
  // field and still produced a confident analysis. Both people now share one
  // range (MIN_BENEFIT-MAX_BENEFIT), so the same values are asserted for A.
  //
  // This is a field-range test, not an earner test: it holds personB as a
  // real earner throughout, so varying A's benefit down to $0 (a no-work-
  // record spouse) never trips the separate "at least one earner" rule
  // exercised below. A $0 A in a *single* household is covered there instead
  // (nothing to analyze with no spouse to draw a benefit from).
  it('agrees with the field-level guardrails the UI declares', () => {
    const marriedEarningSpouse = { ...single, maritalStatus: 'married' as const, personB: completeB };
    const withBenefitA = (monthlyBenefit: number) =>
      isFormComplete({ ...marriedEarningSpouse, personA: { ...completeA, monthlyBenefit } });

    expect(withBenefitA(MIN_BENEFIT - 1)).toBe(false); // -$1
    expect(withBenefitA(MIN_BENEFIT)).toBe(true); // $0, a no-work-record A; B still earns
    expect(withBenefitA(250)).toBe(true); // the old $500 floor used to reject this
    expect(withBenefitA(MAX_BENEFIT)).toBe(true); // $5,000, on the ceiling
    expect(withBenefitA(MAX_BENEFIT + 1)).toBe(false);
    expect(withBenefitA(9999)).toBe(false); // reachable past maxLength=4
  });

  it('applies the same range to a spouse', () => {
    const withBenefitB = (monthlyBenefit: number) =>
      isFormComplete({
        ...single, maritalStatus: 'married' as const, personB: { ...completeB, monthlyBenefit },
      });

    expect(withBenefitB(0)).toBe(true);
    expect(withBenefitB(250)).toBe(true);
    expect(withBenefitB(-1)).toBe(false);
    expect(withBenefitB(MAX_BENEFIT + 1)).toBe(false);
  });
});

describe('isBenefitInRange', () => {
  it('is the single predicate behind both the aria-invalid ring and the gate', () => {
    expect(isBenefitInRange(500)).toBe(true);
    expect(isBenefitInRange(-1)).toBe(false);
    expect(isBenefitInRange(0)).toBe(true);
    expect(isBenefitInRange(5001)).toBe(false);
  });
});

describe('at least one person must have a positive benefit', () => {
  const earner = {
    name: '', birthYear: 1962, birthMonth: 4,
    gender: 'male' as const, monthlyBenefit: 2400, lifeExpectancy: 85,
  };
  const noRecord = {
    name: '', birthYear: 1964, birthMonth: 2,
    gender: 'female' as const, monthlyBenefit: 0, lifeExpectancy: 85,
  };
  const base = BLANK_FORM;

  it('accepts a married household where person A has no work record', () => {
    expect(
      isFormComplete({ ...base, maritalStatus: 'married' as const, personA: noRecord, personB: earner }),
    ).toBe(true);
  });

  it('accepts a married household where person B has no work record', () => {
    expect(
      isFormComplete({ ...base, maritalStatus: 'married' as const, personA: earner, personB: noRecord }),
    ).toBe(true);
  });

  it('rejects a household where neither person earns', () => {
    expect(
      isFormComplete({
        ...base, maritalStatus: 'married' as const,
        personA: noRecord, personB: { ...noRecord, birthYear: 1966 },
      }),
    ).toBe(false);
  });

  it('rejects a single claimant with no benefit — nothing to analyze', () => {
    expect(isFormComplete({ ...base, maritalStatus: 'single' as const, personA: noRecord })).toBe(false);
  });

  it('accepts a genuine low-earner PIA the old $500 floor rejected', () => {
    expect(
      isFormComplete({
        ...base, maritalStatus: 'single' as const,
        personA: { ...earner, monthlyBenefit: 250 },
      }),
    ).toBe(true);
  });
});

describe('toHousehold', () => {
  it('builds a single household with one person keyed a', () => {
    const h = toHousehold(single);
    expect(h.status).toBe('single');
    expect(h.people).toHaveLength(1);
    expect(h.people[0].id).toBe('a');
    expect(h.people[0].name).toBe('Dan');
  });

  it('builds a married household preserving order and ids', () => {
    const people = asMarried(toHousehold({ ...single, maritalStatus: 'married' as const, personB: completeB }));
    expect(people.map((p) => p.id)).toEqual(['a', 'b']);
    expect(people[1].gender).toBe('female');
    expect(people[1].piaMonthly).toBe(2100);
  });

  it('never invents spouse data from the primary person', () => {
    const people = asMarried(toHousehold({ ...single, maritalStatus: 'married' as const, personB: completeB }));
    expect(people[1].birthYear).toBe(1964);
    expect(people[1].birthYear).not.toBe(people[0].birthYear);
  });
});

describe('per-person life expectancy', () => {
  // Both born 1960, so both are the same age — gender is the only variable.
  // Absolute values are deliberately not asserted: getCurrentAge reads the
  // wall clock, so an exact expectation would rot. See the plan's note.
  const male: PersonFormFields = {
    name: '', birthYear: 1960, birthMonth: 6, gender: 'male',
    monthlyBenefit: 2500, lifeExpectancy: null,
  };
  const female: PersonFormFields = {
    name: '', birthYear: 1960, birthMonth: 6, gender: 'female',
    monthlyBenefit: 1200, lifeExpectancy: null,
  };

  it('falls back to the fixed default, never to the other person\u2019s value', () => {
    const household = toHousehold({
      ...BLANK_FORM,
      personA: { ...male, lifeExpectancy: 85 },
      personB: female,
      maritalStatus: 'married' as const,
    });
    // The fallback used to be B's own SSA period-table suggestion. It is now
    // `DEFAULT_PLAN_TO_AGE`, because the optimizer takes its horizon from
    // this number and a table-derived figure should not drive a
    // recommendation the adviser never chose.
    //
    // The invariant this has always guarded is unchanged and is the reason
    // the test survives the rewrite: A's explicit 85 must not leak into B.
    expect(asMarried(household)[1].lifeExpectancy).toBe(DEFAULT_PLAN_TO_AGE);
    expect(asMarried(household)[1].lifeExpectancy).not.toBe(85);
  });

  it('uses an explicit value for person B rather than the fallback', () => {
    const household = toHousehold({
      ...BLANK_FORM,
      personA: { ...male, lifeExpectancy: 85 },
      personB: { ...female, lifeExpectancy: 92 },
      maritalStatus: 'married' as const,
    });
    expect(asMarried(household)[1].lifeExpectancy).toBe(92);
    expect(asMarried(household)[0].lifeExpectancy).toBe(85);
  });

  it('requires person A life expectancy but not person B', () => {
    const base = {
      ...BLANK_FORM,
      personA: { ...male, lifeExpectancy: 85 },
      personB: female,
      maritalStatus: 'married' as const,
    };
    expect(isFormComplete(base)).toBe(true);
    expect(isFormComplete({ ...base, personA: { ...male, lifeExpectancy: null } })).toBe(false);
  });

  it('returns null from the suggestion helper when identity is incomplete', () => {
    expect(suggestedLifeExpectancyFor({ ...male, gender: null })).toBeNull();
    expect(suggestedLifeExpectancyFor({ ...male, birthYear: '' })).toBeNull();
  });
});

describe('reseedLifeExpectancy', () => {
  // Both born 1960 — see the note above on why absolute ages are not asserted.
  const person: PersonFormFields = {
    name: 'Sarah', birthYear: 1960, birthMonth: 6, gender: 'female',
    monthlyBenefit: 2100, lifeExpectancy: 95,
  };

  it('survives an unrelated field edit — the bug this guards against', () => {
    // An adviser drags the slider to 95, then fixes an unrelated field (here,
    // a benefit correction). Before this fix, the re-seed ran on every
    // change and silently snapped 95 back to the SSA suggestion.
    const next = { ...person, monthlyBenefit: 2150 };
    expect(reseedLifeExpectancy(person, next)).toEqual(next);
  });

  it('survives a name correction too', () => {
    const next = { ...person, name: 'Sarah Smith' };
    expect(reseedLifeExpectancy(person, next)).toEqual(next);
  });

  it('leaves an identity edit alone rather than re-seeding the horizon', () => {
    // This used to re-seed the plan-to age from the SSA period table whenever
    // birth year, birth month or gender changed. Now that the optimizer runs
    // on that horizon, re-seeding would move the RECOMMENDATION from a table
    // the adviser never chose — silently, on an unrelated correction.
    expect(reseedLifeExpectancy(person, { ...person, birthYear: 1955 }).lifeExpectancy).toBe(95);
    expect(reseedLifeExpectancy(person, { ...person, birthMonth: 1 }).lifeExpectancy).toBe(95);
    expect(reseedLifeExpectancy(person, { ...person, gender: 'male' }).lifeExpectancy).toBe(95);
  });

  it('still leaves the SSA suggestion available, as a figure to choose', () => {
    // `suggestedLifeExpectancyFor` is not dead — the assumptions panel prints
    // it beside the slider with a button to adopt it. What changed is that
    // nothing applies it on the adviser's behalf.
    expect(suggestedLifeExpectancyFor(person)).not.toBeNull();
    expect(suggestedLifeExpectancyFor({ ...person, gender: 'male' })).not.toBe(
      suggestedLifeExpectancyFor(person),
    );
  });
});

describe('reseedLifeExpectancy', () => {
  // Both born 1960 — see the note above on why absolute ages are not asserted.
  const person: PersonFormFields = {
    name: 'Sarah', birthYear: 1960, birthMonth: 6, gender: 'female',
    monthlyBenefit: 2100, lifeExpectancy: 95,
  };

  it('survives an unrelated field edit — the bug this guards against', () => {
    // An adviser drags the slider to 95, then fixes an unrelated field (here,
    // a benefit correction). Before this fix, the re-seed ran on every
    // change and silently snapped 95 back to the SSA suggestion.
    const next = { ...person, monthlyBenefit: 2150 };
    expect(reseedLifeExpectancy(person, next)).toEqual(next);
  });

  it('survives a name correction too', () => {
    const next = { ...person, name: 'Sarah Smith' };
    expect(reseedLifeExpectancy(person, next)).toEqual(next);
  });

  it('leaves the value untouched when identity changes but is now incomplete', () => {
    const next = { ...person, birthYear: '' as const, lifeExpectancy: 95 };
    expect(reseedLifeExpectancy(person, next)).toEqual(next);
  });
});

describe('widowed form state', () => {
  const survivor = {
    name: '', birthYear: 1964, birthMonth: 6, gender: 'female' as const,
    monthlyBenefit: 1200, lifeExpectancy: 92,
  };
  const deceased = {
    birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
    recordKind: 'pia' as const, piaMonthly: 3000, hadFiled: false,
    checkAmount: '' as const, filedYear: '' as const, filedMonth: '' as const,
  };
  const form: AnalyzerFormState = {
    ...BLANK_FORM,
    maritalStatus: 'widowed' as const,
    personA: survivor,
    deceased,
  };

  it('builds a widowed household', () => {
    const household = toHousehold(form);
    expect(household.status).toBe('widowed');
    if (household.status !== 'widowed') throw new Error('expected widowed');
    expect(household.people).toHaveLength(1);
    expect(household.deceased.record).toEqual({ kind: 'pia', piaMonthly: 3000, filed: null });
    expect(household.alreadyClaimed).toEqual({ survivorSince: null, ownSince: null });
  });

  it('is incomplete until the deceased record is filled in', () => {
    expect(isFormComplete({ ...form, deceased: BLANK_DECEASED })).toBe(false);
    expect(isFormComplete(form)).toBe(true);
  });

  // AGING-OUT FIXTURE, now pinned. `isFormComplete` reads the clock (a death
  // date in the future blocks the form), so a fixture that is "in the future"
  // only relative to today stops testing anything the moment today catches up:
  // `deathYear: 2027, deathMonth: 3` was still blocked in Jan 2027 and
  // ACCEPTED from Mar 2027, silently inverting this assertion. The explicit
  // `asOf` is what makes the date in the fixture mean something.
  const asOf = new Date(2026, 0, 15);

  it('is incomplete while a field error is outstanding', () => {
    const impossible = { ...form, deceased: { ...deceased, deathYear: 2027, deathMonth: 3 } };
    expect(isFormComplete(impossible, asOf)).toBe(false);
    // The same household with the death back in the past is complete, so this
    // is the death date failing and not some unrelated missing field.
    expect(isFormComplete(form, asOf)).toBe(true);
  });

  it('judges the death date against the asOf it is given, not against today', () => {
    // A death in Mar 2027 is in the future as of Jan 2027 and in the past as
    // of Jun 2027. Nothing but `asOf` differs between these two calls.
    const march2027 = { ...form, deceased: { ...deceased, deathYear: 2027, deathMonth: 3 } };
    expect(isFormComplete(march2027, new Date(2027, 0, 15))).toBe(false);
    expect(isFormComplete(march2027, new Date(2027, 5, 15))).toBe(true);
  });

  // The population this feature exists for: a widow drawing only the survivor
  // benefit, with no work record of her own. `isFormComplete`'s "at least one
  // person must have a positive benefit" rule would reject her — the household
  // has a record, it is the deceased's. Deleting the widowed early-return
  // leaves the rest of the suite green.
  it('accepts a widow with no work record of her own', () => {
    const noRecord = { ...survivor, monthlyBenefit: 0 };
    expect(isFormComplete({ ...form, personA: noRecord }, asOf)).toBe(true);
    // Scoped to widowed: the same $0 claimant with no deceased record behind
    // her has nothing to analyze.
    expect(isFormComplete({ ...BLANK_FORM, maritalStatus: 'single' as const, personA: noRecord }, asOf))
      .toBe(false);
  });

  it('still builds single and married households', () => {
    // The three-way change must not disturb the two existing statuses.
    expect(toHousehold({ ...BLANK_FORM, maritalStatus: 'single' as const, personA: survivor }).status)
      .toBe('single');
    const married = toHousehold({
      ...BLANK_FORM, maritalStatus: 'married' as const, personA: survivor, personB: survivor,
    });
    expect(married.status).toBe('married');
    expect(married.people).toHaveLength(2);
  });
});
