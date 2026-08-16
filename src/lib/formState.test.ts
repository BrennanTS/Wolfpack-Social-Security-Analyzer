import { describe, expect, it } from 'vitest';
import {
  BLANK_FORM,
  isBenefitInRange,
  isFormComplete,
  MAX_BENEFIT,
  MIN_BENEFIT_BY_INDEX,
  toHousehold,
  type AnalyzerFormState,
} from './formState';

const completeA = {
  name: 'Dan',
  birthYear: 1962,
  birthMonth: 4,
  gender: 'male' as const,
  monthlyBenefit: 2400,
};
const completeB = {
  name: '',
  birthYear: 1964,
  birthMonth: 2,
  gender: 'female' as const,
  monthlyBenefit: 2100,
};

const single: AnalyzerFormState = {
  ...BLANK_FORM,
  personA: completeA,
  hasSpouse: false,
  lifeExpectancy: 85,
};

describe('isFormComplete', () => {
  it('accepts a complete single form', () => {
    expect(isFormComplete(single)).toBe(true);
  });

  it('rejects a blank form', () => {
    expect(isFormComplete(BLANK_FORM)).toBe(false);
  });

  it('rejects a zero or missing benefit', () => {
    expect(isFormComplete({ ...single, personA: { ...completeA, monthlyBenefit: 0 } })).toBe(false);
    expect(isFormComplete({ ...single, personA: { ...completeA, monthlyBenefit: '' } })).toBe(false);
  });

  it('rejects married until every spouse field is supplied', () => {
    const married = { ...single, hasSpouse: true, personB: BLANK_FORM.personB };
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
      hasSpouse: true,
      personB: { ...completeB, monthlyBenefit: 0 },
    };
    expect(isFormComplete(married)).toBe(true);
  });

  // The gate used to require only `> 0` while the field marked anything under
  // $500 (or over $5,000) invalid, so a $250 or $9,999 entry showed a red
  // field and still produced a confident analysis.
  it('agrees with the field-level guardrails the UI declares', () => {
    const withBenefitA = (monthlyBenefit: number) =>
      isFormComplete({ ...single, personA: { ...completeA, monthlyBenefit } });

    expect(withBenefitA(MIN_BENEFIT_BY_INDEX[0] - 1)).toBe(false); // $499
    expect(withBenefitA(MIN_BENEFIT_BY_INDEX[0])).toBe(true); // $500, on the floor
    expect(withBenefitA(250)).toBe(false);
    expect(withBenefitA(MAX_BENEFIT)).toBe(true); // $5,000, on the ceiling
    expect(withBenefitA(MAX_BENEFIT + 1)).toBe(false);
    expect(withBenefitA(9999)).toBe(false); // reachable past maxLength=4
  });

  it('applies the ceiling but not the $500 floor to a spouse', () => {
    const withBenefitB = (monthlyBenefit: number) =>
      isFormComplete({ ...single, hasSpouse: true, personB: { ...completeB, monthlyBenefit } });

    expect(withBenefitB(0)).toBe(true);
    expect(withBenefitB(250)).toBe(true);
    expect(withBenefitB(-1)).toBe(false);
    expect(withBenefitB(MAX_BENEFIT + 1)).toBe(false);
  });
});

describe('isBenefitInRange', () => {
  it('is the single predicate behind both the aria-invalid ring and the gate', () => {
    expect(isBenefitInRange(500, 0)).toBe(true);
    expect(isBenefitInRange(499, 0)).toBe(false);
    expect(isBenefitInRange(0, 1)).toBe(true);
    expect(isBenefitInRange(5001, 1)).toBe(false);
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
    const h = toHousehold({ ...single, hasSpouse: true, personB: completeB });
    expect(h.status).toBe('married');
    expect(h.people.map((p) => p.id)).toEqual(['a', 'b']);
    expect(h.people[1].gender).toBe('female');
    expect(h.people[1].piaMonthly).toBe(2100);
  });

  it('never invents spouse data from the primary person', () => {
    const h = toHousehold({ ...single, hasSpouse: true, personB: completeB });
    expect(h.people[1].birthYear).toBe(1964);
    expect(h.people[1].birthYear).not.toBe(h.people[0].birthYear);
  });
});
