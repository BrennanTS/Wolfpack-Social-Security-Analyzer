import { describe, expect, it } from 'vitest';
import { DATA_VINTAGE, dataVintageLine } from './dataVintage';
import { getCpiLast30Years } from './cpiHistory';

/**
 * The annual alarm.
 *
 * These tests are MEANT to fail in the new year. Each names what to refresh.
 * Refreshing is: check the figure against SSA or BLS, update the data if it
 * moved, then update the constant. Never the constant alone.
 */
const thisYear = new Date().getFullYear();

describe('data vintage', () => {
  it('records a real, past date', () => {
    const verified = new Date(`${DATA_VINTAGE.rulesVerified}T00:00:00`);
    expect(Number.isNaN(verified.getTime())).toBe(false);
    expect(verified.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('has had its rules verified this calendar year', () => {
    // Failing from January 1 is the point. To clear it: check the FRA
    // schedule, the reduction and credit rates, the survivor schedule, the
    // earnings-test treatment and the $255 payment against ssa.gov, fix
    // anything that moved, then set `rulesVerified` to the date you did.
    expect(
      new Date(`${DATA_VINTAGE.rulesVerified}T00:00:00`).getFullYear(),
      'Social Security rules have not been verified this year. See dataVintage.ts.',
    ).toBe(thisYear);
  });

  it('carries price history through last year', () => {
    // BLS publishes the prior year's annual average CPI-U in January. A
    // COLA assumption drawn from a series two years old is quietly out of
    // date, and this is where it stops being quiet.
    expect(
      getCpiLast30Years().endYear,
      'cpiHistory.ts is missing last year. Add the BLS annual average.',
    ).toBeGreaterThanOrEqual(thisYear - 1);
  });

  it('suggests planning ages from a life table no more than five years old', () => {
    // SSA publishes a new period life table most years. Five is the leash,
    // not the goal: replace `public/data/processed` and the year together.
    expect(
      thisYear - DATA_VINTAGE.lifeTableYear,
      'The SSA period life table is more than five years old. See dataVintage.ts.',
    ).toBeLessThanOrEqual(5);
  });

  it('prints all three vintages in one line', () => {
    const line = dataVintageLine();
    expect(line).toContain('2026');
    expect(line).toContain(String(DATA_VINTAGE.lifeTableYear));
    expect(line).toContain(String(getCpiLast30Years().endYear));
    expect(line).not.toContain('—');
  });
});
