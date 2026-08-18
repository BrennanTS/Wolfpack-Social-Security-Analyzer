import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_TO_AGE, LIFE_EXPECTANCY_BOUNDS } from './formBounds';
import { BLANK_FORM, type AnalyzerFormState } from './formState';
import { buildShareUrl, fromShareParams, toShareParams } from './shareLink';
import {
  addScenario,
  DEFAULT_SCENARIO_SET,
  isDefaultScenarioSet,
  resetScenarios,
  selectedRow,
  selectScenario,
  type ScenarioSet,
} from './scenario';
import { BLANK_ALREADY_CLAIMED, BLANK_DECEASED } from './widowedForm';

const married: AnalyzerFormState = {
  ...BLANK_FORM,
  personA: {
    name: 'Dan', birthYear: 1962, birthMonth: 4, gender: 'male',
    monthlyBenefit: 2400, lifeExpectancy: 85,
  },
  personB: {
    name: 'Sarah', birthYear: 1964, birthMonth: 2, gender: 'female',
    // Was null. A person with no plan-to age set now carries the default
    // rather than nothing, so a round trip returns the default rather than
    // the null this fixture used to assert — the field never travels as
    // absent-and-meaningful any more.
    monthlyBenefit: 2100, lifeExpectancy: DEFAULT_PLAN_TO_AGE,
  },
  maritalStatus: 'married',
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
  maritalStatus: 'single',
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
    expect(restored.maritalStatus).toBe('single');
    expect(restored.personA.birthYear).toBe(1962);
    expect(restored.personB).toEqual(BLANK_FORM.personB);
  });

  it('round-trips a nominal dollars mode, not just the default', () => {
    const nominal: AnalyzerFormState = { ...single, dollarsMode: 'nominal' };
    expect(fromShareParams(toShareParams(nominal)).dollarsMode).toBe('nominal');
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
    // Not null: this is the one field with no blank state — the slider
    // always shows a number and the optimizer takes its horizon from it — so
    // an unusable value gets the same default an untouched form has, which
    // is still a refusal to clamp 'soon' into something plausible.
    expect(parse('le=soon').personA.lifeExpectancy).toBe(DEFAULT_PLAN_TO_AGE);
  });

  it('drops assumptions outside their slider bounds', () => {
    expect(parse('cola=99').annualCola).toBe(BLANK_FORM.annualCola);
    expect(parse('dr=99').discountRate).toBe(BLANK_FORM.discountRate);
    expect(parse('le=200').personA.lifeExpectancy).toBe(DEFAULT_PLAN_TO_AGE);
    // The point of "never clamped": 200 does not become the 100 maximum.
    expect(parse('le=200').personA.lifeExpectancy).not.toBe(LIFE_EXPECTANCY_BOUNDS.max);
  });

  // Unlike the numeric fields above, there is no bounds check to fail here —
  // `dollars` is dropped by recognizing exactly one non-default spelling
  // ('nominal') rather than validating a range, so an unrecognized value
  // must fall back to the default rather than throwing or passing through.
  it('falls back to real for an unrecognized dollars value, rather than erroring', () => {
    expect(parse('dollars=bogus').dollarsMode).toBe('real');
    expect(parse('').dollarsMode).toBe('real');
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

describe('per-person life expectancy params', () => {
  const form: AnalyzerFormState = {
    ...BLANK_FORM,
    personA: {
      name: '', birthYear: 1960, birthMonth: 6, gender: 'male',
      monthlyBenefit: 2500, lifeExpectancy: 85,
    },
    personB: {
      name: '', birthYear: 1962, birthMonth: 3, gender: 'female',
      monthlyBenefit: 1200, lifeExpectancy: 92,
    },
    maritalStatus: 'married',
  };

  it('round-trips two distinct values', () => {
    const back = fromShareParams(toShareParams(form));
    expect(back.personA.lifeExpectancy).toBe(85);
    expect(back.personB.lifeExpectancy).toBe(92);
  });

  it('never writes the legacy le param', () => {
    // `le` is a read-only legacy alias for `ale` (see fromShareParams). A
    // future edit that reintroduced writing it would silently resurrect a
    // parameter this module deliberately retired.
    const params = toShareParams(form);
    expect(params.has('le')).toBe(false);
  });

  it('omits ble for a single claimant', () => {
    const params = toShareParams({ ...form, maritalStatus: 'single' });
    expect(params.get('ale')).toBe('85');
    expect(params.has('ble')).toBe(false);
  });

  it('hydrates a legacy le link onto person A', () => {
    const back = fromShareParams(new URLSearchParams('ay=1960&am=6&ag=m&ab=2500&m=0&le=88'));
    expect(back.personA.lifeExpectancy).toBe(88);
  });

  it('prefers ale over a legacy le when both are present', () => {
    const back = fromShareParams(new URLSearchParams('ay=1960&am=6&ag=m&ab=2500&m=0&le=88&ale=91'));
    expect(back.personA.lifeExpectancy).toBe(91);
  });

  it('drops an out-of-range value without touching the other person', () => {
    const back = fromShareParams(
      new URLSearchParams('ay=1960&am=6&ag=m&ab=2500&by=1962&bm=3&bg=f&bb=1200&m=1&ale=200&ble=92'),
    );
    expect(back.personA.lifeExpectancy).toBe(DEFAULT_PLAN_TO_AGE);
    // The invariant this has always guarded: one person's bad value must not
    // reach the other, and B's own 92 survives untouched.
    expect(back.personB.lifeExpectancy).toBe(92);
  });

  it('drops non-numeric junk', () => {
    const back = fromShareParams(new URLSearchParams('ay=1960&am=6&ag=m&ab=2500&m=0&ale=eighty'));
    expect(back.personA.lifeExpectancy).toBe(DEFAULT_PLAN_TO_AGE);
  });
});

describe('buildShareUrl', () => {
  it('joins origin, path and query', () => {
    const url = buildShareUrl(single, 'https://example.test', '/');
    expect(url.startsWith('https://example.test/?')).toBe(true);
    expect(url).toMatch(/ay=1962/);
  });
});

describe('widowed share links', () => {
  const form: AnalyzerFormState = {
    ...BLANK_FORM,
    maritalStatus: 'widowed',
    personA: {
      name: '', birthYear: 1964, birthMonth: 6, gender: 'female',
      monthlyBenefit: 1200, lifeExpectancy: 92,
    },
    deceased: {
      birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
      recordKind: 'pia', piaMonthly: 3000, hadFiled: true,
      checkAmount: '', filedYear: 2022, filedMonth: 5,
    },
    alreadyClaimed: {
      survivorSinceYear: 2024, survivorSinceMonth: 8, ownSinceYear: '', ownSinceMonth: '',
    },
  };

  it('round-trips a widowed household', () => {
    const back = fromShareParams(toShareParams(form));
    expect(back.maritalStatus).toBe('widowed');
    expect(back.deceased).toEqual(form.deceased);
    expect(back.alreadyClaimed).toEqual(form.alreadyClaimed);
  });

  it('round-trips the check-amount route', () => {
    const check = {
      ...form,
      deceased: {
        ...form.deceased, recordKind: 'checkAmount' as const, piaMonthly: '' as const,
        hadFiled: null, checkAmount: 2400,
      },
    };
    expect(fromShareParams(toShareParams(check)).deceased).toEqual(check.deceased);
  });

  it('leaves an unset already-claimed date absent, not zero', () => {
    const params = toShareParams(form);
    expect(params.get('coy')).toBeNull();
    expect(fromShareParams(params).alreadyClaimed.ownSinceYear).toBe('');
  });

  // Every key this module writes for a widowed household, including `dk`,
  // which (unlike its siblings) is written unconditionally by `writeWidowed`
  // and so is NOT covered by checking `dy` alone — a regression that made
  // `writeWidowed` unconditional slipped past the single-key version of this
  // test with all 35 other tests still green.
  const WIDOWED_KEYS = [
    'dy', 'dm', 'ddy', 'ddm', 'dk', 'dp', 'dc', 'df', 'dfy', 'dfm',
    'csy', 'csm', 'coy', 'com',
  ];

  it('writes no widowed parameters for a married household', () => {
    const married = { ...BLANK_FORM, maritalStatus: 'married' as const };
    const params = toShareParams(married);
    for (const key of WIDOWED_KEYS) expect(params.get(key)).toBeNull();
    expect(params.get('m')).toBe('1');
  });

  it('writes no widowed parameters for a single household', () => {
    const single = { ...BLANK_FORM, maritalStatus: 'single' as const };
    const params = toShareParams(single);
    for (const key of WIDOWED_KEYS) expect(params.get(key)).toBeNull();
    expect(params.get('m')).toBe('0');
  });

  // `dm`/`ddm`/`dfm`/`csm`/`com` must be bounds-checked the same as `am`/`bm`
  // — an out-of-range month must be dropped, not passed through. Left
  // unchecked, `widowedForm.ts`'s `idx()` would silently roll a month of 13
  // into January of the next year: a plausible-looking wrong date rather
  // than a blocked field, which is exactly what "dropped, not clamped" exists
  // to prevent.
  it('drops an out-of-range deceased month rather than passing it through', () => {
    const back = fromShareParams(
      new URLSearchParams('m=w&dy=1960&dm=99&ddy=2024&ddm=0&dk=p&dp=3000&df=1&dfy=2022&dfm=5'),
    );
    expect(back.deceased.birthMonth).toBe('');
    expect(back.deceased.deathMonth).toBe('');
  });

  it('drops an out-of-range already-claimed month rather than passing it through', () => {
    const back = fromShareParams(new URLSearchParams('m=w&csy=2024&csm=13&coy=2030&com=0'));
    expect(back.alreadyClaimed.survivorSinceMonth).toBe('');
    expect(back.alreadyClaimed.ownSinceMonth).toBe('');
  });

  // The READ side of the scoping the WRITE side is already pinned for above.
  // The round-trip tests cannot reach it: they only ever decode params that
  // `toShareParams` wrote, and on a married or single link that params set
  // carries no `d*`/`c*` keys at all — so `readWidowed` would return exactly
  // `BLANK_DECEASED`/`BLANK_ALREADY_CLAIMED` and calling it unconditionally
  // looks identical. Deleting the `maritalStatus === 'widowed' ?` guard in
  // `fromShareParams` left the whole suite green. A hand-written link is the
  // only way to see it: widowed keys present, `m=1`, and they must be ignored.
  it('ignores widowed parameters on a non-widowed link', () => {
    const married = fromShareParams(new URLSearchParams('m=1&dy=1960&dm=3&dk=c&csy=2024'));
    expect(married.deceased).toEqual(BLANK_DECEASED);
    expect(married.alreadyClaimed).toEqual(BLANK_ALREADY_CLAIMED);

    const single = fromShareParams(new URLSearchParams('m=0&dy=1960&dm=3&dk=c&csy=2024'));
    expect(single.deceased).toEqual(BLANK_DECEASED);
    expect(single.alreadyClaimed).toEqual(BLANK_ALREADY_CLAIMED);
  });

  it('still reads those same parameters when the link IS widowed', () => {
    // The guard above must not be satisfiable by ignoring the keys always.
    const widowed = fromShareParams(new URLSearchParams('m=w&dy=1960&dm=3&dk=c&csy=2024'));
    expect(widowed.deceased.birthYear).toBe(1960);
    expect(widowed.deceased.recordKind).toBe('checkAmount');
    expect(widowed.alreadyClaimed.survivorSinceYear).toBe(2024);
  });
});

describe('legacy share links', () => {
  // Links already in circulation carry m=1 / m=0. They must keep working
  // unchanged — that compatibility is why the widowed value was added to this
  // parameter rather than replacing it.
  it('still reads m=1 as married and m=0 as single', () => {
    expect(fromShareParams(new URLSearchParams('m=1')).maritalStatus).toBe('married');
    expect(fromShareParams(new URLSearchParams('m=0')).maritalStatus).toBe('single');
  });

  it('leaves the status unchosen when m is absent or unrecognised', () => {
    expect(fromShareParams(new URLSearchParams('')).maritalStatus).toBeNull();
    expect(fromShareParams(new URLSearchParams('m=x')).maritalStatus).toBeNull();
  });
});

describe('scenario share links', () => {
  const withScenarios = (set: ScenarioSet) => ({ ...BLANK_FORM, scenarios: set });

  it('writes nothing while the optimizer’s own answer is shown', () => {
    // The commonest link by far, and the one that must stay a re-resolved
    // answer rather than a remembered pair of ages.
    expect(toShareParams(withScenarios(DEFAULT_SCENARIO_SET)).get('sc')).toBeNull();
  });

  it('writes nothing when a DERIVED row is shown', () => {
    // "Both claim at FRA" is a different pair for every household, so pinning
    // this household's ages would misrepresent it to a recipient whose inputs
    // differ. The recipient's own FRA row already says the same thing.
    const set = selectScenario(resetScenarios(), 'fra');
    expect(toShareParams(withScenarios(set)).get('sc')).toBeNull();
  });

  /** Add and select — a link carries what is SHOWN, not what merely exists. */
  const addAndShow = (ages: { years: number; months: number }[]) => {
    const set = addScenario(resetScenarios(), ages);
    return selectScenario(set, set.rows[set.rows.length - 1].id);
  };

  it('writes the shown scenario’s ages, person A first', () => {
    const set = addAndShow([
      { years: 65, months: 0 },
      { years: 66, months: 3 },
    ]);
    expect(toShareParams(withScenarios(set)).get('sc')).toBe('65-0.66-3');
  });

  it('writes nothing for a custom row nobody selected', () => {
    // `addScenario` no longer selects, so a link built while the report is
    // still on the optimum must carry the optimum — not whichever row the
    // adviser last typed in to compare against it.
    const set = addScenario(resetScenarios(), [{ years: 65, months: 0 }]);
    expect(toShareParams(withScenarios(set)).get('sc')).toBeNull();
  });

  it('round-trips through a URL into a selected custom row', () => {
    const set = addAndShow([
      { years: 65, months: 0 },
      { years: 66, months: 3 },
    ]);
    const back = fromShareParams(toShareParams(withScenarios(set)));
    expect(selectedRow(back.scenarios).scenario).toEqual({
      kind: 'custom',
      ages: [
        { years: 65, months: 0 },
        { years: 66, months: 3 },
      ],
    });
  });

  it('gives the recipient their own built-in rows alongside it', () => {
    // A link is a view of one analysis. Replacing the recipient's comparison
    // list would be editing their workspace to show them a number.
    const back = fromShareParams(new URLSearchParams('sc=65-0.66-3'));
    expect(back.scenarios.rows.map((r) => r.id)).toEqual([
      'optimal',
      'earliest',
      'fra',
      'latest',
      's1',
    ]);
  });

  it('drops a malformed value rather than guessing at it', () => {
    for (const raw of ['', 'abc', '65', '65-', '-0', '65-0.', '65-12', '20-0', '65.0', '65-0.66-3.67-0']) {
      const back = fromShareParams(new URLSearchParams(`sc=${encodeURIComponent(raw)}`));
      expect(isDefaultScenarioSet(back.scenarios), `sc=${raw}`).toBe(true);
    }
  });

  it('leaves an out-of-reach but well-formed age to the analysis to clamp', () => {
    // Not dropped: `analyzeHousehold` clamps it and the sidebar shows the
    // clamped value, so a stale link behaves exactly like a stale form.
    const back = fromShareParams(new URLSearchParams('sc=62-0'));
    expect(selectedRow(back.scenarios).scenario).toEqual({
      kind: 'custom',
      ages: [{ years: 62, months: 0 }],
    });
  });
});
