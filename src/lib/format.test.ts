import { describe, expect, it } from 'vitest';
import {
  formatAgeDisplay,
  formatCurrency,
  formatCurrencyPrecise,
  fraLabel,
  personLabel,
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

describe('personLabel', () => {
  it('prefers a supplied name', () => {
    expect(personLabel('Dan', 0)).toBe('Dan');
    expect(personLabel('Sarah', 1)).toBe('Sarah');
  });

  it('falls back to You and Spouse by position', () => {
    expect(personLabel(undefined, 0)).toBe('You');
    expect(personLabel(undefined, 1)).toBe('Spouse');
  });

  it('treats blank and whitespace-only names as absent', () => {
    expect(personLabel('', 0)).toBe('You');
    expect(personLabel('   ', 1)).toBe('Spouse');
  });
});
