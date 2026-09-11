import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkOnSsaToolsUrl,
  scenarioCounts,
  VALIDATION_GENERATED_FROM,
  VALIDATION_SCENARIOS,
} from './validationSummary';

const fixtures = JSON.parse(
  readFileSync(path.join(process.cwd(), 'validation/fixtures/scenarios.json'), 'utf8'),
) as {
  scenarios: {
    id: string;
    mode: string;
    inputs: {
      status: string;
      people: { birthYear: number; birthMonth: number; birthDay?: number; piaMonthly: number }[];
    };
    expected: {
      fraByPerson: { label: string }[];
      monthlyByClaimAgeByPerson: Record<string, number>[];
    };
  }[];
};

const full = fixtures.scenarios.filter((s) => s.mode === 'full');

/**
 * The summary is generated, and a generated file that nobody checks is a file
 * that drifts. This project has already shipped a panel stating something the
 * app could not verify; the whole point of generating this one is that it
 * cannot say anything the fixtures do not.
 *
 * Regenerate with: node validation/scripts/gen-validation-summary.mjs
 */
describe('the validation summary the app displays', () => {
  it('covers exactly the full-mode fixtures, in order', () => {
    expect(VALIDATION_SCENARIOS.map((s) => s.id)).toEqual(full.map((s) => s.id));
  });

  it('carries figures that match the fixtures it was generated from', () => {
    const byId = new Map(full.map((s) => [s.id, s]));
    for (const shown of VALIDATION_SCENARIOS) {
      const source = byId.get(shown.id)!;
      expect(shown.status, shown.id).toBe(source.inputs.status);
      expect(shown.fra, shown.id).toEqual(source.expected.fraByPerson.map((f) => f.label));
      for (const [age, value] of Object.entries(shown.monthly)) {
        expect(value, `${shown.id} at ${age}`).toBe(
          source.expected.monthlyByClaimAgeByPerson[0][age],
        );
      }
      expect(shown.people, shown.id).toEqual(
        source.inputs.people.map((p) => ({
          birthYear: p.birthYear,
          birthMonth: p.birthMonth,
          ...(p.birthDay === undefined ? {} : { birthDay: p.birthDay }),
          piaMonthly: p.piaMonthly,
        })),
      );
    }
  });

  it('was generated from this version of the app', () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(VALIDATION_GENERATED_FROM).toBe(pkg.version);
  });

  it('sends the birth day the fixture actually has', () => {
    // The one case this matters completely: a 1 January birthday sits in the
    // previous FRA cohort, so a link that flattened the day would open a
    // different claimant than the panel is describing.
    const janFirst = VALIDATION_SCENARIOS.find((s) => s.id.includes('jan1'));
    expect(janFirst, 'a day-1 scenario should be in the summary').toBeDefined();
    expect(checkOnSsaToolsUrl(janFirst!)).toContain('dob1=1960-01-01');
  });

  it('builds a two-person link for a couple', () => {
    const couple = VALIDATION_SCENARIOS.find((s) => s.status === 'married')!;
    const url = checkOnSsaToolsUrl(couple);
    expect(url).toContain('pia1=');
    expect(url).toContain('pia2=');
    expect(url.startsWith('https://ssa.tools/calculator#')).toBe(true);
  });

  it('counts what it shows', () => {
    const counts = scenarioCounts();
    expect(counts.total).toBe(VALIDATION_SCENARIOS.length);
    expect(counts.single + counts.married + counts.widowed).toBe(counts.total);
    expect(counts.total).toBeGreaterThan(20);
  });
});
