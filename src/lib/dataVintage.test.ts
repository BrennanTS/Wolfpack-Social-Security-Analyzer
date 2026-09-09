import { describe, expect, it } from 'vitest';
import {
  DATA_VINTAGE,
  dataVintageLine,
  staleSsaTables,
  staleSsaTablesReport,
} from './dataVintage';
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

  it('carries vendored SSA tables current to SSA\'s own publications', () => {
    // The fourth annual alarm, and the only one that reads its subject rather
    // than trusting an attested date. To clear it: add the year SSA published
    // to src/vendor/ssa-tools/constants.ts (each message names the table and
    // the ssa.gov page), then re-run. See staleSsaTables in dataVintage.ts for
    // the publication schedule these deadlines encode.
    //
    // A failure here moves no number the app currently displays — this app
    // enters a PIA directly and PIA-only recipients never consult these
    // tables — so it is a trap for the first earnings-record feature, not a
    // live client-facing defect. Fix it anyway; that is the point of catching
    // it while it is cheap.
    const now = new Date();
    expect(staleSsaTables(now), staleSsaTablesReport(now)).toEqual([]);
  });

  // The three tests above can only observe that an alarm is NOT ringing, which
  // is exactly the failure mode of the self-referential check this file
  // replaced (`endYear === max(keys)` is true at any staleness). These two
  // prove staleSsaTables actually rings, by asking it about dates at which the
  // committed tables are definitely behind.
  describe('the vendored-table alarm actually fires', () => {
    it('objects on January 1 once the calendar passes the tables', () => {
      // Far enough out that no plausible update makes this vacuous.
      const stale = staleSsaTables(new Date('2099-01-01T00:00:00'));
      const tables = stale.map((s) => s.table);
      expect(tables).toContain('MAX_YEAR');
      expect(tables).toContain('MAXIMUM_EARNINGS');
      expect(tables).toContain('COLA');
      expect(tables).toContain('WAGE_INDICES');
    });

    it('objects from November, when SSA has published the next year', () => {
      // Every complaint must name where to fix it, or the alarm is just noise.
      const stale = staleSsaTables(new Date('2099-11-15T00:00:00'));
      expect(stale.length).toBeGreaterThan(0);
      for (const s of stale) {
        expect(s.fix, `${s.table} complaint must say where to fix it`).toMatch(
          /constants\.ts|ssa\.gov/,
        );
        expect(s.needs).toBeGreaterThan(s.says);
      }
      expect(staleSsaTablesReport(new Date('2099-11-15T00:00:00'))).toContain('needs >=');
    });

    it('says so plainly when nothing is stale', () => {
      // The report doubles as the failure message, so its quiet form matters.
      const quiet = staleSsaTablesReport(new Date());
      if (staleSsaTables(new Date()).length === 0) {
        expect(quiet).toBe('All vendored SSA tables are current.');
      }
    });
  });

  it('prints all three vintages in one line', () => {
    const line = dataVintageLine();
    expect(line).toContain('2026');
    expect(line).toContain(String(DATA_VINTAGE.lifeTableYear));
    expect(line).toContain(String(getCpiLast30Years().endYear));
    expect(line).not.toContain('—');
  });
});
