import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_TO_AGE, LIFE_EXPECTANCY_BOUNDS } from './formBounds';
import { BLANK_FORM, type AnalyzerFormState } from './formState';
import {
  buildShareUrl,
  fromShareParams,
  readViewExtras,
  toShareParams,
  toViewParams,
  BLANK_VIEW_EXTRAS,
} from './shareLink';
import { DEFAULT_TARGET_RANGE } from './gridTarget';
import { DEFAULT_SOLVENCY, TRUSTEES_ASSUMPTION } from './solvency';
import {
  addScenario,
  DEFAULT_SCENARIO_SET,
  isDefaultScenarioSet,
  resetScenarios,
  selectedRow,
  selectScenario,
  toggleScenarioHidden,
  type ScenarioSet,
} from './scenario';
import { BLANK_ALREADY_CLAIMED, BLANK_DECEASED } from './widowedForm';

const married: AnalyzerFormState = {
  ...BLANK_FORM,
  personA: {
    name: 'John', birthYear: 1962, birthMonth: 4, gender: 'male',
    monthlyBenefit: 2400, lifeExpectancy: 85,
  },
  personB: {
    name: 'Jane', birthYear: 1964, birthMonth: 2, gender: 'female',
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
    name: 'John', birthYear: 1962, birthMonth: 4, gender: 'male',
    monthlyBenefit: 2400, lifeExpectancy: 85,
  },
  maritalStatus: 'single',
};

describe('round trip', () => {
  it('restores everything, names included', () => {
    // Names travel since 2026-09-07 — see the module comment for what
    // changed and what did not.
    expect(fromShareParams(toShareParams(married))).toEqual(married);
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

describe('first names', () => {
  it('travel, so a link opens on the household it was sent about', () => {
    const query = toShareParams(married).toString();
    expect(query).toContain('an=John');
    expect(query).toContain('bn=Jane');
  });

  it('are omitted when there are none, rather than sent empty', () => {
    const query = toShareParams({
      ...married,
      personA: { ...married.personA, name: '   ' },
      personB: { ...married.personB, name: '' },
    }).toString();
    expect(query).not.toContain('an=');
    expect(query).not.toContain('bn=');
  });

  it('survive the characters a name actually has', () => {
    const back = fromShareParams(
      toShareParams({ ...married, personA: { ...married.personA, name: "Ana María O'Neill" } }),
    );
    expect(back.personA.name).toBe("Ana María O'Neill");
  });

  it('are capped rather than rejected, being display text', () => {
    const back = fromShareParams(new URLSearchParams(`an=${'x'.repeat(200)}`));
    expect(back.personA.name).toHaveLength(40);
  });

  it('omits person B entirely when single', () => {
    const query = toShareParams(single).toString();
    expect(query).not.toMatch(/[?&]?b[ymgbn]=/);
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

  it('leaves the status unchosen when m is absent or unrecognized', () => {
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

  it('carries a custom row nobody selected, and keeps the optimum selected', () => {
    // The row travels now — a saved view that lost the comparison an adviser
    // built is the data loss this encoding exists to prevent — but selection
    // is explicit, so a link built while the report is still on the optimum
    // opens on the optimum rather than on whatever was typed in beside it.
    const set = addScenario(resetScenarios(), [{ years: 65, months: 0 }]);
    const params = toShareParams(withScenarios(set));
    expect(params.get('sc')).toBe('65-0');
    expect(params.get('scs')).toBe('optimal');
    const back = fromShareParams(params);
    expect(back.scenarios.selectedId).toBe('optimal');
    expect(back.scenarios.rows).toHaveLength(5);
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


describe('the rest of the view', () => {
  const complete = (): AnalyzerFormState => ({
    ...BLANK_FORM,
    personA: { ...BLANK_FORM.personA, birthYear: 1962, birthMonth: 4, gender: 'male', monthlyBenefit: 2400, lifeExpectancy: 85 },
    maritalStatus: 'single',
  });

  it('carries the rows an adviser hid and the ages they added', () => {
    // Both are printed in the report, so a link or a saved client that lost
    // them reopens something the adviser did not set up.
    const params = toViewParams(complete(), {
      claimingPrefs: { a: { hidden: ['63', '64'], added: [{ years: 69, months: 1 }] } },
      gridTarget: DEFAULT_TARGET_RANGE,
    });
    expect(params.get('pah')).toBe('63,64');
    expect(params.get('paa')).toBe('69-1');
    const back = readViewExtras(params);
    expect(back.claimingPrefs.a).toEqual({ hidden: ['63', '64'], added: [{ years: 69, months: 1 }] });
  });

  it('leaves a spouse’s preferences out of a single claimant’s link', () => {
    // Switching married → single leaves person B's edits in state; writing
    // them would restore a table for someone the household no longer has.
    const params = toViewParams(complete(), {
      claimingPrefs: { b: { hidden: ['67'], added: [] } },
      gridTarget: DEFAULT_TARGET_RANGE,
    });
    expect(params.get('pbh')).toBeNull();
  });

  it('says nothing about preferences that were never touched', () => {
    const params = toViewParams(complete(), BLANK_VIEW_EXTRAS);
    expect(params.get('pah')).toBeNull();
    expect(params.get('paa')).toBeNull();
    expect(readViewExtras(params).claimingPrefs).toEqual({});
  });

  it('drops a row id that is not one, keeping the rest', () => {
    const params = new URLSearchParams('pah=63,%3Cscript%3E,64');
    expect(readViewExtras(params).claimingPrefs.a?.hidden).toEqual(['63', '64']);
  });

  it('carries the near-best region, including when it is switched off', () => {
    // Absent has to mean "a link written before this existed", and the
    // default is on — so off is written explicitly.
    const off = toViewParams(complete(), { claimingPrefs: {}, gridTarget: { on: false, percent: 1 } });
    expect(off.get('gt')).toBe('off');
    expect(readViewExtras(off).gridTarget.on).toBe(false);

    const wide = toViewParams(complete(), { claimingPrefs: {}, gridTarget: { on: true, percent: 4 } });
    expect(wide.get('gt')).toBe('4');
    expect(readViewExtras(wide).gridTarget).toEqual({ on: true, percent: 4 });
  });

  it('falls back to the default region for a nonsense tolerance', () => {
    for (const raw of ['-1', '0', '900', 'wide', '']) {
      expect(readViewExtras(new URLSearchParams(`gt=${raw}`)).gridTarget).toEqual(
        DEFAULT_TARGET_RANGE,
      );
    }
  });

  it('omits the tolerance when it is the default one', () => {
    const params = toViewParams(complete(), BLANK_VIEW_EXTRAS);
    expect(params.get('gt')).toBeNull();
  });

  it('carries the reduction scenario only while it is switched on', () => {
    // The parameter's presence IS the on switch. An adviser who never touched
    // the scenario shares a link that cannot turn it on for the recipient,
    // and one who did shares the figures they were looking at.
    const off = toViewParams(complete(), { ...BLANK_VIEW_EXTRAS, solvency: DEFAULT_SOLVENCY });
    expect(off.get('sv')).toBeNull();
    expect(readViewExtras(off).solvency).toBeUndefined();

    const trustees = toViewParams(complete(), {
      ...BLANK_VIEW_EXTRAS,
      solvency: TRUSTEES_ASSUMPTION,
    });
    expect(trustees.get('sv')).toBe('2032-78');

    const chosen = toViewParams(complete(), {
      ...BLANK_VIEW_EXTRAS,
      solvency: { enabled: true, fromYear: 2040, payablePercent: 90 },
    });
    expect(chosen.get('sv')).toBe('2040-90');
    expect(readViewExtras(chosen).solvency).toEqual({
      enabled: true,
      fromYear: 2040,
      payablePercent: 90,
    });
  });

  it('drops a reduction that is not one, rather than pricing a number nobody chose', () => {
    for (const raw of ['2040', '2040-0', '2040-101', '1990-90', 'x-y', '2040-90-1']) {
      expect(readViewExtras(new URLSearchParams(`sv=${raw}`)).solvency).toBeUndefined();
    }
  });

  it('carries the theme and layout the report is built with', () => {
    // A saved client reopens looking the way it was presented, rather than in
    // whatever was last used for someone else.
    const params = toViewParams(complete(), {
      ...BLANK_VIEW_EXTRAS,
      themeId: 'midnight',
      layoutId: 'preset-adviser',
    });
    expect(params.get('th')).toBe('midnight');
    expect(params.get('ly')).toBe('preset-adviser');
    const back = readViewExtras(params);
    expect(back.themeId).toBe('midnight');
    expect(back.layoutId).toBe('preset-adviser');
  });

  it('says nothing about a theme or layout that was not named', () => {
    const params = toViewParams(complete(), BLANK_VIEW_EXTRAS);
    expect(params.get('th')).toBeNull();
    expect(readViewExtras(params).themeId).toBeUndefined();
  });

  it('refuses an id that is not one this app could have minted', () => {
    // The value picks a theme by id; anything shaped unlike an id is a
    // hand-edited link rather than a theme this browser has.
    for (const raw of ['<script>', 'a b', 'x'.repeat(200), '']) {
      expect(readViewExtras(new URLSearchParams(`th=${encodeURIComponent(raw)}`)).themeId).toBeUndefined();
    }
  });
});

describe('the whole scenario list', () => {
  const withRows = (set: ScenarioSet): AnalyzerFormState => ({ ...BLANK_FORM, scenarios: set });

  it('carries every custom row, not only the selected one', () => {
    let set = addScenario(resetScenarios(), [{ years: 65, months: 0 }]);
    set = addScenario(set, [{ years: 68, months: 6 }]);
    const params = toShareParams(withRows(set));
    expect(params.get('sc')).toBe('65-0_68-6');
    const back = fromShareParams(params);
    expect(back.scenarios.rows.filter((r) => r.scenario.kind === 'custom')).toHaveLength(2);
  });

  it('carries a renamed row’s label, and not a minted one', () => {
    let set = addScenario(resetScenarios(), [{ years: 65, months: 0 }]);
    const id = set.rows[set.rows.length - 1].id;
    expect(toShareParams(withRows(set)).get('sc')).toBe('65-0');
    set = { ...set, rows: set.rows.map((r) => (r.id === id ? { ...r, label: 'Retire early' } : r)) };
    const params = toShareParams(withRows(set));
    expect(params.get('sc')).toBe('65-0~Retire early');
    const back = fromShareParams(params);
    expect(back.scenarios.rows.map((r) => r.label)).toContain('Retire early');
  });

  it('carries a derived row as the selection, which used to be lost', () => {
    // Selecting "Delay to 70" and sharing handed the reader Best.
    const set = selectScenario(resetScenarios(), 'latest');
    const params = toShareParams(withRows(set));
    expect(params.get('scs')).toBe('latest');
    expect(fromShareParams(params).scenarios.selectedId).toBe('latest');
  });

  it('carries which rows are hidden', () => {
    const set = toggleScenarioHidden(resetScenarios(), 'fra');
    const params = toShareParams(withRows(set));
    expect(params.get('sch')).toBe('fra');
    const back = fromShareParams(params);
    expect(back.scenarios.rows.find((r) => r.id === 'fra')?.hidden).toBe(true);
  });

  it('will not hide the row everything else is measured against', () => {
    // `toggleScenarioHidden` refuses Optimal; a hand-written link goes
    // through that rule rather than around it.
    const back = fromShareParams(new URLSearchParams('sch=optimal'));
    expect(back.scenarios.rows.find((r) => r.id === 'optimal')?.hidden).not.toBe(true);
  });

  it('ignores a selection token that names nothing', () => {
    const back = fromShareParams(new URLSearchParams('scs=c9'));
    expect(back.scenarios.selectedId).toBe('optimal');
  });

  it('still reads a link written before rows could travel together', () => {
    // One custom row, no `scs` — the shape every link in circulation has.
    const back = fromShareParams(new URLSearchParams('sc=65-0.67-6'));
    const selected = selectedRow(back.scenarios);
    expect(selected.scenario).toEqual({
      kind: 'custom',
      ages: [{ years: 65, months: 0 }, { years: 67, months: 6 }],
    });
  });

  it('drops the whole list when one row is malformed', () => {
    // A partially restored comparison is a set of rows the adviser did not
    // build, which is worse than the defaults.
    const back = fromShareParams(new URLSearchParams('sc=65-0_nonsense'));
    expect(back.scenarios).toEqual(DEFAULT_SCENARIO_SET);
  });

  it('round-trips a list an adviser actually built', () => {
    let set = addScenario(resetScenarios(), [{ years: 65, months: 0 }]);
    set = addScenario(set, [{ years: 70, months: 0 }]);
    set = toggleScenarioHidden(set, 'earliest');
    set = selectScenario(set, set.rows[set.rows.length - 1].id);
    const back = fromShareParams(toShareParams(withRows(set)));
    expect(back.scenarios.rows.map((r) => r.scenario.kind)).toEqual(
      set.rows.map((r) => r.scenario.kind),
    );
    expect(back.scenarios.rows.find((r) => r.id === 'earliest')?.hidden).toBe(true);
    expect(selectedRow(back.scenarios).scenario).toEqual({
      kind: 'custom',
      ages: [{ years: 70, months: 0 }],
    });
  });
});
