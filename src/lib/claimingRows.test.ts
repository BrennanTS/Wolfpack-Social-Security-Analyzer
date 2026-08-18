import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addClaimingRow,
  BLANK_CLAIMING_PREFS,
  buildClaimingRows,
  claimingRowId,
  claimingRowLabel,
  isDefaultClaimingPrefs,
  prefsFor,
  removeClaimingRow,
  resetClaimingPrefs,
  toggleClaimingRowHidden,
  visibleClaimingRows,
  withPrefsFor,
  type ClaimingTablePrefs,
} from './claimingRows';
import { analyzePerson, type Person } from './personAnalysis';
import { formatFilingAge } from './ssaTools';
import { MonthDuration } from '$lib/month-time';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const c = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(c) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

const asOf = new Date(2026, 0, 15);
const dan: Person = {
  id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
  gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
};

const analysis = analyzePerson(
  dan,
  formatFilingAge(MonthDuration.initFromYearsMonths({ years: 70, months: 0 })),
  2.5,
  asOf,
);

const prefs = (over: Partial<ClaimingTablePrefs> = {}): ClaimingTablePrefs => ({
  ...BLANK_CLAIMING_PREFS,
  ...over,
});

describe('claimingRowId / claimingRowLabel', () => {
  it('drops the months on a whole year and keeps them otherwise', () => {
    expect(claimingRowId({ years: 67, months: 0 })).toBe('67');
    expect(claimingRowId({ years: 69, months: 1 })).toBe('69-1');
    expect(claimingRowLabel({ years: 67, months: 0 })).toBe('67');
    expect(claimingRowLabel({ years: 69, months: 1 })).toBe('69 years, 1 month');
  });
});

describe('buildClaimingRows', () => {
  it('shows the decision still available, not the ages already gone by', () => {
    // Dan is 63 as of `asOf`.
    const rows = buildClaimingRows(analysis, prefs(), asOf);
    expect(rows.map((r) => r.years)).toEqual([63, 64, 65, 66, 67, 68, 69, 70]);
  });

  it('adds an age the adviser asked for, in age order', () => {
    const rows = buildClaimingRows(analysis, prefs({ added: [{ years: 69, months: 1 }] }), asOf);
    expect(rows.map((r) => r.id)).toEqual([
      '63', '64', '65', '66', '67', '68', '69', '69-1', '70',
    ]);
  });

  it('prices an added age against the SAME baseline as the rows beside it', () => {
    const rows = buildClaimingRows(analysis, prefs({ added: [{ years: 69, months: 1 }] }), asOf);
    const at69 = rows.find((r) => r.id === '69')!;
    const at69m1 = rows.find((r) => r.id === '69-1')!;
    const at70 = rows.find((r) => r.id === '70')!;
    // Monotone in every column between the two whole years that bracket it —
    // which is only true if it used the same recipient, plan-to age, discount
    // rate and reference date.
    expect(at69m1.monthlyBenefit).toBeGreaterThan(at69.monthlyBenefit);
    expect(at69m1.monthlyBenefit).toBeLessThan(at70.monthlyBenefit);
    expect(at69m1.percentOfPia).toBeGreaterThan(at69.percentOfPia);
    expect(at69m1.percentOfPia).toBeLessThan(at70.percentOfPia);
    expect(at69m1.lifetimeBenefits).toBeGreaterThan(0);
  });

  it('marks an added row as removable and a built-in row as not', () => {
    const rows = buildClaimingRows(analysis, prefs({ added: [{ years: 69, months: 1 }] }), asOf);
    expect(rows.find((r) => r.id === '69-1')?.added).toBe(true);
    expect(rows.find((r) => r.id === '69')?.added).toBe(false);
  });

  it('drops an added age that duplicates a whole-year row', () => {
    const rows = buildClaimingRows(analysis, prefs({ added: [{ years: 67, months: 0 }] }), asOf);
    expect(rows.filter((r) => r.id === '67')).toHaveLength(1);
    expect(rows.find((r) => r.id === '67')?.added).toBe(false);
  });

  it('flags hidden rows rather than dropping them, so the editor can show them', () => {
    const rows = buildClaimingRows(analysis, prefs({ hidden: ['65'] }), asOf);
    expect(rows.find((r) => r.id === '65')?.hidden).toBe(true);
    expect(visibleClaimingRows(rows).map((r) => r.id)).not.toContain('65');
    // The figures are still there, so un-hiding is not a blind click.
    expect(rows.find((r) => r.id === '65')?.monthlyBenefit).toBeGreaterThan(0);
  });

  it('marks eligibility by whole months, not whole years', () => {
    const rows = buildClaimingRows(analysis, prefs({ added: [{ years: 63, months: 11 }] }), asOf);
    // Dan is 63 years 9 months at `asOf`: 63y0m is behind him, 63y11m is not.
    expect(rows.find((r) => r.id === '63')?.isEligible).toBe(true);
    expect(rows.find((r) => r.id === '63-11')?.isEligible).toBe(false);
  });

  it('never touches `claimingOptions`, which every chart still reads', () => {
    const before = JSON.stringify(analysis.claimingOptions);
    buildClaimingRows(analysis, prefs({ hidden: ['65'], added: [{ years: 69, months: 1 }] }), asOf);
    expect(JSON.stringify(analysis.claimingOptions)).toBe(before);
  });
});

describe('the preference helpers', () => {
  it('hides and shows a row', () => {
    let p = toggleClaimingRowHidden(prefs(), '65');
    expect(p.hidden).toEqual(['65']);
    p = toggleClaimingRowHidden(p, '65');
    expect(p.hidden).toEqual([]);
  });

  it('adds an age', () => {
    const p = addClaimingRow(prefs(), { years: 69, months: 1 }, ['69', '70']);
    expect(p.added).toEqual([{ years: 69, months: 1 }]);
  });

  it('reveals rather than duplicates when the age is already on the table', () => {
    const p = addClaimingRow(prefs({ hidden: ['67'] }), { years: 67, months: 0 }, ['67']);
    expect(p.added).toEqual([]);
    expect(p.hidden).toEqual([]);
  });

  it('reveals an added age that is currently hidden', () => {
    const p = addClaimingRow(
      prefs({ hidden: ['69-1'], added: [{ years: 69, months: 1 }] }),
      { years: 69, months: 1 },
      ['69-1'],
    );
    expect(p.hidden).toEqual([]);
    expect(p.added).toHaveLength(1);
  });

  it('removes an added age and forgets it was hidden', () => {
    const p = removeClaimingRow(
      prefs({ hidden: ['69-1'], added: [{ years: 69, months: 1 }] }),
      '69-1',
    );
    expect(p).toEqual({ hidden: [], added: [] });
  });

  it('resets, and reports when there is nothing to reset', () => {
    expect(isDefaultClaimingPrefs(resetClaimingPrefs())).toBe(true);
    expect(isDefaultClaimingPrefs(prefs({ hidden: ['65'] }))).toBe(false);
    expect(isDefaultClaimingPrefs(prefs({ added: [{ years: 69, months: 1 }] }))).toBe(false);
  });
});

describe('per-person storage', () => {
  it('keeps one person’s table out of the other’s', () => {
    let byPerson = withPrefsFor({}, 'a', prefs({ hidden: ['65'] }));
    byPerson = withPrefsFor(byPerson, 'b', prefs({ hidden: ['70'] }));
    expect(prefsFor(byPerson, 'a').hidden).toEqual(['65']);
    expect(prefsFor(byPerson, 'b').hidden).toEqual(['70']);
  });

  it('reads an untouched person as the blank default', () => {
    expect(prefsFor({}, 'a')).toEqual({ hidden: [], added: [] });
  });
});

describe('the recipient the added row is priced with', () => {
  it('is built the same way `analyzePerson` builds its own', () => {
    // An independent check rather than one that compares this module against
    // itself: someone born in 1958 has an FRA of 66 years 8 months, and a
    // benefit taken exactly at FRA is 100% of PIA by definition. A recipient
    // built with a different birth day, month or gender would not land on it.
    const born1958: Person = { ...dan, birthYear: 1958, birthMonth: 3 };
    const own = analyzePerson(
      born1958,
      formatFilingAge(MonthDuration.initFromYearsMonths({ years: 70, months: 0 })),
      2.5,
      asOf,
    );
    expect(own.fra).toEqual({ years: 66, months: 8 });
    const rows = buildClaimingRows(own, prefs({ added: [{ years: 66, months: 8 }] }), asOf);
    expect(rows.find((r) => r.id === '66-8')?.percentOfPia).toBe(100);
  });

  it('keeps an added age the person has already passed, since they typed it', () => {
    // Whole-year rows behind the person are dropped; an added one is not.
    // Silently discarding it would leave the Add control looking broken.
    const rows = buildClaimingRows(analysis, prefs({ added: [{ years: 62, months: 6 }] }), asOf);
    expect(rows.map((r) => r.id)).toContain('62-6');
    expect(rows.map((r) => r.id)).not.toContain('62');
    expect(rows.find((r) => r.id === '62-6')?.isEligible).toBe(true);
  });
});
