import { describe, expect, it } from 'vitest';
import { BLS_CPI_U_ANNUAL, CPI_DEFAULT_COLA, formatPercent, getCpiLast30Years } from './cpiHistory';

describe('getCpiLast30Years', () => {
  const stats = getCpiLast30Years();

  it('ends at the most recent year present in the table', () => {
    expect(stats.endYear).toBe(Math.max(...Object.keys(BLS_CPI_U_ANNUAL).map(Number)));
  });

  it('reports min and max drawn from the included years', () => {
    const rates = stats.years.map((y) => y.rate);
    expect(stats.min).toBe(Math.min(...rates));
    expect(stats.max).toBe(Math.max(...rates));
  });

  it('places the geometric mean at or below the arithmetic mean', () => {
    expect(stats.geometricMean).toBeLessThanOrEqual(stats.arithmeticMean);
  });

  it('exports the arithmetic mean as the default COLA', () => {
    expect(CPI_DEFAULT_COLA).toBe(stats.arithmeticMean);
  });
});

describe('formatPercent', () => {
  it('formats with the requested precision', () => {
    expect(formatPercent(2.5)).toBe('2.5%');
    expect(formatPercent(2.5, 2)).toBe('2.50%');
  });
});
