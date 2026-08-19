import { describe, expect, it } from 'vitest';
import {
  formatAgeDisplay,
  formatCurrency,
  compactUnitFor,
  formatCompactCurrency,
  formatCurrencyPerYear,
  formatThousandsTick,
  formatCurrencyPrecise,
  fraLabel,
  personLabel,
  yearsMonthsLabel,
} from './format';

describe('currency formatting', () => {
  it('rounds to whole dollars', () => {
    expect(formatCurrency(2816.4)).toBe('$2,816');
    expect(formatCurrency(1750)).toBe('$1,750');
  });

  it('keeps cents when precise', () => {
    expect(formatCurrencyPrecise(1750.5)).toBe('$1,750.50');
  });
});

// `CombinedIncomeChart`'s tooltip is the motivating case: its label is a
// single month, but every value is an ANNUAL rate, so the unit has to be
// explicit or the figure reads as that month's own payment.
describe('formatCurrencyPerYear', () => {
  it('appends /yr to the whole-dollar figure', () => {
    expect(formatCurrencyPerYear(45600)).toBe('$45,600/yr');
  });

  it('rounds the same way formatCurrency does', () => {
    expect(formatCurrencyPerYear(2816.4)).toBe('$2,816/yr');
  });
});

describe('fraLabel', () => {
  it('omits months when the FRA is a whole year', () => {
    expect(fraLabel({ years: 67, months: 0 })).toBe('67');
  });

  it('spells out partial years', () => {
    expect(fraLabel({ years: 66, months: 10 })).toBe('66 years, 10 months');
  });
});

describe('formatAgeDisplay', () => {
  it('reads naturally at an exact birthday', () => {
    expect(formatAgeDisplay({ years: 66, months: 0 })).toBe('66 years old');
    expect(formatAgeDisplay({ years: 66, months: 3 })).toBe('66 years, 3 months');
  });
});

describe('yearsMonthsLabel', () => {
  // 62y1m is the earliest a retirement benefit can begin — entitlement needs
  // a full month at 62 — so this is not an exotic input, it is the single
  // most commonly recommended filing age in the app.
  it('says "1 month", never "1 months"', () => {
    expect(yearsMonthsLabel(62, 1)).toBe('62 years, 1 month');
  });

  it('says "1 year" for a single year', () => {
    expect(yearsMonthsLabel(1, 4)).toBe('1 year, 4 months');
  });

  it('pluralizes everything else', () => {
    expect(yearsMonthsLabel(66, 10)).toBe('66 years, 10 months');
    expect(yearsMonthsLabel(70, 0)).toBe('70 years, 0 months');
  });
});

describe('personLabel', () => {
  it('prefers a supplied name', () => {
    expect(personLabel('Dan', 0)).toBe('Dan');
    expect(personLabel('Sarah', 1)).toBe('Sarah');
  });

  it('falls back to Client and Spouse by position', () => {
    expect(personLabel(undefined, 0)).toBe('Client');
    expect(personLabel(undefined, 1)).toBe('Spouse');
  });

  it('treats blank and whitespace-only names as absent', () => {
    expect(personLabel('', 0)).toBe('Client');
    expect(personLabel('   ', 1)).toBe('Spouse');
  });
});

describe('formatThousandsTick', () => {
  it('drops the unit at the baseline', () => {
    // "$0k" is a unit on a quantity that has none, and the baseline is the
    // one tick on every axis a reader checks first.
    expect(formatThousandsTick(0)).toBe('$0');
  });

  it('rounds to the nearest thousand', () => {
    expect(formatThousandsTick(731_400)).toBe('$731k');
    expect(formatThousandsTick(731_600)).toBe('$732k');
  });

  it('says $0 for anything that rounds to zero, not "$0k"', () => {
    // A tick at $400 rounds to zero thousands. It must take the baseline
    // wording too, or the axis prints "$0k" for a nonzero value.
    expect(formatThousandsTick(400)).toBe('$0');
  });
});

describe('compactUnitFor and formatCompactCurrency', () => {
  it('picks one unit for a whole set from its largest figure', () => {
    expect(compactUnitFor(1_007_324)).toBe('millions');
    expect(compactUnitFor(787_434)).toBe('thousands');
    expect(compactUnitFor(950)).toBe('ones');
  });

  it('keeps every figure in the set’s unit, even below it', () => {
    // The point of choosing once: a board spanning 853k to 1.01m must not
    // print "$853k" beside "$1.01m", where the step from $999k to $1.00m
    // reads as a change of magnitude but is a tenth of a percent.
    expect(formatCompactCurrency(852_937, 'millions')).toBe('$0.85m');
    expect(formatCompactCurrency(1_007_324, 'millions')).toBe('$1.01m');
  });

  it('holds three significant figures in the millions', () => {
    // "$1.0m" would collapse most of a household's board onto one number.
    expect(formatCompactCurrency(1_290_000, 'millions')).toBe('$1.29m');
    expect(formatCompactCurrency(12_340_000, 'millions')).toBe('$12.3m');
    expect(formatCompactCurrency(123_400_000, 'millions')).toBe('$123m');
  });

  it('rounds to whole thousands, with a separator', () => {
    expect(formatCompactCurrency(787_434, 'thousands')).toBe('$787k');
    expect(formatCompactCurrency(1_007_324, 'thousands')).toBe('$1,007k');
  });

  it('falls back to exact dollars below a thousand', () => {
    expect(formatCompactCurrency(950, 'ones')).toBe('$950');
  });
});
