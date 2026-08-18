/**
 * The generator's own invariant: every household it emits must be one the app
 * would actually accept.
 *
 * Without this, a widowed generator that quietly produced illegal households —
 * a survivor claim before 60, a deceased who filed at 59 — would make every
 * downstream invariant vacuous over them: `analyze` throws, the sweep reports
 * a crash rather than a finding, or worse, the household is silently valid to
 * the engine and invalid to the form, and the sweep checks copy nobody can
 * reach.
 *
 * `widowedErrors` is the same function the intake form gates on, so this
 * asserts exactly what an adviser could have typed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { widowedErrors } from '../../src/lib/widowedForm';
import { widowedHouseholdAt, SWEEP_AS_OF } from './households';
import { analyze, stubLifeTableFetch, summarize, type Finding } from './harness';

const COUNT = Number(process.env.SWEEP_COUNT ?? 500);

beforeAll(() => vi.stubGlobal('fetch', stubLifeTableFetch()));
afterAll(() => vi.unstubAllGlobals());

describe('the widowed generator', () => {
  it(`emits only households the intake form would accept (${COUNT})`, () => {
    const findings: Finding[] = [];

    for (let index = 0; index < COUNT; index++) {
      const { household, label } = widowedHouseholdAt(index);
      if (household.status !== 'widowed') {
        findings.push({ index, label, detail: `status ${household.status}, expected widowed` });
        continue;
      }
      const { deceased, alreadyClaimed, people } = household;
      const filed = deceased.record.filed;

      const errors = widowedErrors(
        {
          birthYear: deceased.birthYear,
          birthMonth: deceased.birthMonth,
          deathYear: deceased.deathYear,
          deathMonth: deceased.deathMonth,
          recordKind: deceased.record.kind === 'pia' ? 'pia' : 'checkAmount',
          piaMonthly: deceased.record.kind === 'pia' ? deceased.record.piaMonthly : '',
          hadFiled: deceased.record.kind === 'pia' ? filed !== null : null,
          checkAmount: deceased.record.kind === 'checkAmount' ? deceased.record.monthlyAmount : '',
          filedYear: filed?.year ?? '',
          filedMonth: filed?.month ?? '',
        },
        {
          survivorSinceYear: alreadyClaimed.survivorSince?.year ?? '',
          survivorSinceMonth: alreadyClaimed.survivorSince?.month ?? '',
          ownSinceYear: alreadyClaimed.ownSince?.year ?? '',
          ownSinceMonth: alreadyClaimed.ownSince?.month ?? '',
        },
        { year: people[0].birthYear, month: people[0].birthMonth },
        SWEEP_AS_OF,
      );

      if (Object.keys(errors).length > 0) {
        findings.push({ index, label, detail: `field errors: ${JSON.stringify(errors)}` });
      }
    }

    console.log(summarize('widowed households are legal', findings));
    expect(findings).toEqual([]);
  });

  it(`analyses every one of them without throwing (${COUNT})`, async () => {
    // The other half of the same guarantee. `widowedErrors` returning `{}` is
    // the form's promise that the engine will accept the household; three
    // inputs that broke that promise shipped, and each surfaced as the
    // generic "Analysis failed" banner rather than a field error.
    const findings: Finding[] = [];

    for (let index = 0; index < COUNT; index++) {
      const { household, label } = widowedHouseholdAt(index);
      try {
        await analyze(household);
      } catch (error) {
        findings.push({ index, label, detail: `threw: ${String(error).slice(0, 160)}` });
      }
    }

    console.log(summarize('widowed households analyse', findings));
    expect(findings).toEqual([]);
  });

  it(`reaches both record kinds and both already-claimed axes (${COUNT})`, () => {
    // A generator that never produced a check amount, or never an
    // already-claimed date, would leave whole branches of the widowed
    // surfaces uncovered while every invariant above still passed.
    const reached = new Set<string>();
    for (let index = 0; index < COUNT; index++) {
      const { household } = widowedHouseholdAt(index);
      if (household.status !== 'widowed') continue;
      const { deceased, alreadyClaimed } = household;
      reached.add(`record:${deceased.record.kind}`);
      reached.add(`filed:${deceased.record.filed === null ? 'never' : 'dated'}`);
      reached.add(`survivorSince:${alreadyClaimed.survivorSince === null ? 'none' : 'set'}`);
      reached.add(`ownSince:${alreadyClaimed.ownSince === null ? 'none' : 'set'}`);
    }

    console.log(`Widowed generator reaches:\n  ${[...reached].sort().join('\n  ')}`);
    expect([...reached].sort()).toEqual([
      'filed:dated',
      'filed:never',
      'ownSince:none',
      'ownSince:set',
      'record:checkAmount',
      'record:pia',
      'survivorSince:none',
      'survivorSince:set',
    ]);
  });
});
