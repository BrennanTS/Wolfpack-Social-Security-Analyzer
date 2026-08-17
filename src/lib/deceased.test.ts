import { describe, expect, it } from 'vitest';
import { benefitOnDate } from '$lib/benefit-calculator';
import { MonthDuration } from '$lib/month-time';
import { deceasedContext, deceasedPia, type Deceased } from './deceased';
import { monthIndexOf } from './benefitPeriods';

const base = { birthYear: 1950, birthMonth: 6, deathYear: 2020, deathMonth: 3 };

describe('deceasedPia', () => {
  it('returns a known PIA unchanged and unestimated', () => {
    const d: Deceased = {
      ...base,
      record: { kind: 'pia', piaMonthly: 2400, filed: { year: 2016, month: 7 } },
    };
    expect(deceasedPia(d)).toEqual({ piaMonthly: 2400, estimated: false });
  });

  it('recovers a PIA from a check amount to within a dollar', () => {
    // Build the check amount the engine itself would pay a $2,400 PIA filing
    // at 66y1m, then require the recovery to get back to $2,400. Round-trip
    // through the engine rather than against a hand-computed factor: the app
    // must not encode a benefit rule, and neither must its test.
    const known: Deceased = {
      ...base,
      record: { kind: 'pia', piaMonthly: 2400, filed: { year: 2016, month: 7 } },
    };
    const { recipient, filingDate } = deceasedContext(known);
    const check = benefitOnDate(
      recipient,
      filingDate,
      filingDate.addDuration(MonthDuration.OneYear()),
    ).value();

    const fromCheck: Deceased = {
      ...base,
      record: { kind: 'checkAmount', monthlyAmount: check, filed: { year: 2016, month: 7 } },
    };
    const recovered = deceasedPia(fromCheck);
    expect(Math.abs(recovered.piaMonthly - 2400)).toBeLessThanOrEqual(1);
    expect(recovered.estimated).toBe(true);
  });

  it('accepts a legitimate large check amount without throwing', () => {
    // A high but real PIA, near the top of what SSA ever pays — the guard
    // must not reject this just because it rejects the truly out-of-bracket
    // case below.
    const known: Deceased = {
      ...base,
      record: { kind: 'pia', piaMonthly: 4000, filed: { year: 2016, month: 7 } },
    };
    const { recipient, filingDate } = deceasedContext(known);
    const check = benefitOnDate(
      recipient,
      filingDate,
      filingDate.addDuration(MonthDuration.OneYear()),
    ).value();

    const fromCheck: Deceased = {
      ...base,
      record: { kind: 'checkAmount', monthlyAmount: check, filed: { year: 2016, month: 7 } },
    };
    expect(() => deceasedPia(fromCheck)).not.toThrow();
  });

  it('throws when the check amount exceeds what the search bracket can reach', () => {
    // A data-entry typo (an extra digit) should fail loudly, not silently
    // return the bracket's top PIA dressed up as a normal estimate.
    const d: Deceased = {
      ...base,
      record: { kind: 'checkAmount', monthlyAmount: 500_000, filed: { year: 2016, month: 7 } },
    };
    expect(() => deceasedPia(d)).toThrow();
  });

  it('throws on a negative check amount', () => {
    const d: Deceased = {
      ...base,
      record: { kind: 'checkAmount', monthlyAmount: -100, filed: { year: 2016, month: 7 } },
    };
    expect(() => deceasedPia(d)).toThrow();
  });

  it('throws on a non-finite check amount', () => {
    const d: Deceased = {
      ...base,
      record: { kind: 'checkAmount', monthlyAmount: NaN, filed: { year: 2016, month: 7 } },
    };
    expect(() => deceasedPia(d)).toThrow();
  });

  it('does not throw on a check amount of exactly 0', () => {
    // A $0 check is legitimate: the deceased had filed but the benefit was
    // fully offset. The bisection already returns 0 for this target.
    const d: Deceased = {
      ...base,
      record: { kind: 'checkAmount', monthlyAmount: 0, filed: { year: 2016, month: 7 } },
    };
    expect(deceasedPia(d)).toEqual({ piaMonthly: 0, estimated: true });
  });
});

describe('deceasedContext', () => {
  it('uses the recorded filing date when the deceased had filed', () => {
    const d: Deceased = {
      ...base,
      record: { kind: 'pia', piaMonthly: 2400, filed: { year: 2016, month: 7 } },
    };
    const { filingDate, deathDate } = deceasedContext(d);
    expect(monthIndexOf(filingDate)).toBe(2016 * 12 + 6);
    expect(monthIndexOf(deathDate)).toBe(2020 * 12 + 2);
  });

  it('sets the filing date EQUAL to the death date when they never filed', () => {
    // This is how the engine is told "never filed": survivorBenefit branches
    // on `deceasedFilingDate >= deceasedDeathDate`. Any later date works too,
    // but equality is the documented, minimal selector.
    const d: Deceased = { ...base, record: { kind: 'pia', piaMonthly: 2400, filed: null } };
    const { filingDate, deathDate } = deceasedContext(d);
    expect(monthIndexOf(filingDate)).toBe(monthIndexOf(deathDate));
  });
});
