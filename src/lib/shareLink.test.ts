import { describe, expect, it } from 'vitest';
import { BLANK_FORM, type AnalyzerFormState } from './formState';
import { buildShareUrl, fromShareParams, toShareParams } from './shareLink';

const married: AnalyzerFormState = {
  ...BLANK_FORM,
  personA: {
    name: 'Dan', birthYear: 1962, birthMonth: 4, gender: 'male',
    monthlyBenefit: 2400, lifeExpectancy: 85,
  },
  personB: {
    name: 'Sarah', birthYear: 1964, birthMonth: 2, gender: 'female',
    monthlyBenefit: 2100, lifeExpectancy: null,
  },
  hasSpouse: true,
  annualCola: 2.5,
  // A FRACTION (0.025 = 2.5%), unlike annualCola above — see the module
  // comment. A value of `2.5` here would mean 250%, fail the dr bounds check
  // on decode, and get dropped to BLANK_FORM.discountRate instead of
  // round-tripping.
  discountRate: 0.025,
};

const single: AnalyzerFormState = {
  ...BLANK_FORM,
  personA: {
    name: 'Dan', birthYear: 1962, birthMonth: 4, gender: 'male',
    monthlyBenefit: 2400, lifeExpectancy: 85,
  },
  hasSpouse: false,
};

describe('round trip', () => {
  it('restores everything except the names', () => {
    const restored = fromShareParams(toShareParams(married));
    expect(restored).toEqual({
      ...married,
      personA: { ...married.personA, name: '' },
      personB: { ...married.personB, name: '' },
    });
  });

  it('restores a single household without person B', () => {
    const restored = fromShareParams(toShareParams(single));
    expect(restored.hasSpouse).toBe(false);
    expect(restored.personA.birthYear).toBe(1962);
    expect(restored.personB).toEqual(BLANK_FORM.personB);
  });
});

describe('names are never encoded', () => {
  it('omits both name fields from the query string', () => {
    const query = toShareParams(married).toString();
    expect(query).not.toMatch(/Dan/i);
    expect(query).not.toMatch(/Sarah/i);
  });

  it('omits person B entirely when single', () => {
    const query = toShareParams(single).toString();
    expect(query).not.toMatch(/[?&]?b[ymgb]=/);
  });
});

describe('invalid parameters are dropped, never clamped', () => {
  const parse = (q: string) => fromShareParams(new URLSearchParams(q));

  it('drops a benefit above the ceiling rather than clamping to it', () => {
    expect(parse('ab=99999').personA.monthlyBenefit).toBe('');
  });

  it('drops a negative benefit', () => {
    expect(parse('ab=-5').personA.monthlyBenefit).toBe('');
  });

  it('drops an impossible month', () => {
    expect(parse('am=13').personA.birthMonth).toBe('');
    expect(parse('am=0').personA.birthMonth).toBe('');
  });

  it('drops an unknown gender', () => {
    expect(parse('ag=x').personA.gender).toBeNull();
  });

  it('drops a birth year outside the offered range', () => {
    expect(parse('ay=1800').personA.birthYear).toBe('');
    expect(parse('ay=2200').personA.birthYear).toBe('');
  });

  it('drops non-numeric junk', () => {
    expect(parse('ab=abc').personA.monthlyBenefit).toBe('');
    expect(parse('le=soon').personA.lifeExpectancy).toBeNull();
  });

  it('drops assumptions outside their slider bounds', () => {
    expect(parse('cola=99').annualCola).toBe(BLANK_FORM.annualCola);
    expect(parse('dr=99').discountRate).toBe(BLANK_FORM.discountRate);
    expect(parse('le=200').personA.lifeExpectancy).toBeNull();
  });

  // `dr` travels as a percent and is stored as a fraction. Without the
  // conversion this reads back as a 250% discount rate, and nothing else in
  // the app would notice.
  it('converts the discount rate from percent back to a fraction', () => {
    expect(parse('dr=2.5').discountRate).toBeCloseTo(0.025, 6);
  });

  it('round-trips the discount rate through both conversions', () => {
    const params = toShareParams({ ...single, discountRate: 0.031 });
    expect(params.get('dr')).toBe('3.1');
    expect(fromShareParams(params).discountRate).toBeCloseTo(0.031, 6);
  });

  // The units guard (`isDiscountRateInBounds`) is what enforces these, and it
  // runs on the converted FRACTION rather than the incoming percent — so the
  // value that is checked is the value that reaches state. Whatever survives
  // decoding must therefore be a plausible fraction, never a percent-shaped
  // number that would mean a 250%+ discount rate.
  it('only ever yields a discount rate that is plausible as a fraction', () => {
    for (const raw of ['dr=0', 'dr=2.5', 'dr=6', 'dr=6.1', 'dr=99', 'dr=-1', 'dr=abc', '']) {
      const { discountRate } = parse(raw);
      expect(discountRate).toBeGreaterThanOrEqual(0);
      expect(discountRate).toBeLessThanOrEqual(0.06);
    }
  });

  it('accepts both endpoints of the discount range', () => {
    expect(parse('dr=0').discountRate).toBe(0);
    expect(parse('dr=6').discountRate).toBeCloseTo(0.06, 6);
  });

  it('drops a discount rate just past the ceiling', () => {
    expect(parse('dr=6.1').discountRate).toBe(BLANK_FORM.discountRate);
  });

  it('keeps the valid fields when a sibling field is invalid', () => {
    const form = parse('ay=1962&am=99&ab=2400');
    expect(form.personA.birthYear).toBe(1962);
    expect(form.personA.birthMonth).toBe('');
    expect(form.personA.monthlyBenefit).toBe(2400);
  });

  it('returns a blank form for an empty query string', () => {
    expect(parse('')).toEqual(BLANK_FORM);
  });

  it('accepts a zero benefit, which is a valid no-work-record entry', () => {
    expect(parse('ab=0').personA.monthlyBenefit).toBe(0);
  });
});

describe('buildShareUrl', () => {
  it('joins origin, path and query', () => {
    const url = buildShareUrl(single, 'https://example.test', '/');
    expect(url.startsWith('https://example.test/?')).toBe(true);
    expect(url).toMatch(/ay=1962/);
  });
});
