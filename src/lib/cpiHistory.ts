/**
 * BLS CPI-U annual percent change (December-to-December, all urban consumers).
 * Source: U.S. Bureau of Labor Statistics — https://www.bls.gov/cpi/
 */
export const BLS_CPI_U_ANNUAL: Readonly<Record<number, number>> = {
  1995: 2.8,
  1996: 3.3,
  1997: 1.7,
  1998: 1.6,
  1999: 2.7,
  2000: 3.4,
  2001: 1.6,
  2002: 2.4,
  2003: 1.9,
  2004: 3.3,
  2005: 3.4,
  2006: 2.5,
  2007: 4.1,
  2008: 0.1,
  2009: 2.7,
  2010: 1.5,
  2011: 3.0,
  2012: 1.7,
  2013: 1.5,
  2014: 0.8,
  2015: 0.7,
  2016: 2.1,
  2017: 2.1,
  2018: 1.9,
  2019: 2.3,
  2020: 1.4,
  2021: 7.0,
  2022: 6.5,
  2023: 3.4,
  2024: 2.9,
};

export const BLS_CPI_URL = 'https://www.bls.gov/cpi/';
export const CPI_HISTORY_YEARS = 30;

export interface CpiYear {
  year: number;
  rate: number;
}

export interface CpiStats {
  years: CpiYear[];
  startYear: number;
  endYear: number;
  arithmeticMean: number;
  geometricMean: number;
  min: number;
  max: number;
}

/** Most recent 30 complete years of BLS CPI-U annual inflation. */
export function getCpiLast30Years(): CpiStats {
  const endYear = Math.max(...Object.keys(BLS_CPI_U_ANNUAL).map(Number));
  const startYear = endYear - CPI_HISTORY_YEARS + 1;

  const years: CpiYear[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const rate = BLS_CPI_U_ANNUAL[y];
    if (rate !== undefined) years.push({ year: y, rate });
  }

  const rates = years.map((y) => y.rate);
  const arithmeticMean =
    Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100;

  const geometricProduct = rates.reduce((acc, r) => acc * (1 + r / 100), 1);
  const geometricMean =
    Math.round((Math.pow(geometricProduct, 1 / rates.length) - 1) * 10000) / 100;

  return {
    years,
    startYear,
    endYear,
    arithmeticMean,
    geometricMean,
    min: Math.min(...rates),
    max: Math.max(...rates),
  };
}

export const CPI_DEFAULT_COLA = getCpiLast30Years().arithmeticMean;

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}
