import { describe, expect, it } from 'vitest';
import * as beta from './betaCopy';

/**
 * The whole point of the beta's client half is that it can be read without a
 * glossary. That erodes one word at a time, so it is asserted mechanically
 * over everything the module exports rather than sentence by sentence.
 */
const BARRED = [
  'present value',
  'discount',
  'optimizer',
  'optimal',
  'mortality',
  'net present',
  'nominal',
  'PIA',
  'FRA',
  'RIB-LIM',
  'undiscounted',
];

/** Every string this module can produce, functions called with samples. */
function allCopy(): string[] {
  const out: string[] = [];
  for (const value of Object.values(beta)) {
    if (typeof value === 'string') out.push(value);
    if (Array.isArray(value)) {
      for (const item of value as beta.Term[]) out.push(item.term, item.body);
    }
  }
  out.push(
    beta.versusWorstNote(1000, '$1,000', 'Both claim as early as you can') ?? '',
    beta.survivorGainNote('$19,728', 'Both claim as early as you can', 12),
    beta.survivorGainNote('$686', 'Both claim at your full ages', 0),
    beta.longevityVerdict('Both wait until 70'),
    beta.longevityVerdict(null),
    beta.longevityDroppedNote(['Both wait until 70']) ?? '',
    beta.planToNote(['Dan', 'Sarah'], [79, 95]),
  );
  return out.filter((s) => s.length > 0);
}

describe('beta copy', () => {
  it('uses no term the reader would have to look up', () => {
    // The terms page is the one place these words may appear, and there they
    // appear defined and in brackets — which is why it is checked for the
    // bare jargon rather than for the words in passing.
    const clientCopy = allCopy().filter((s) => !beta.KEY_TERMS.some((t) => t.body === s));
    for (const line of clientCopy) {
      for (const word of BARRED) {
        expect(line.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });

  it('introduces each barred term on the terms page, in plain words first', () => {
    const terms = beta.KEY_TERMS.map((t) => `${t.term} ${t.body}`).join(' ');
    // The three a client will meet elsewhere — on an SSA statement, or from
    // another adviser — have to be recognisable when they do.
    for (const word of ['FRA', 'PIA', 'COLA']) {
      expect(terms).toContain(word);
    }
    // And each is introduced by what it IS before it is named.
    for (const t of beta.KEY_TERMS) {
      expect(t.term).not.toMatch(/\b(FRA|PIA|COLA)\b/);
    }
  });

  it('says nothing about a gain that is not there', () => {
    expect(beta.versusWorstNote(0, '$0', 'x')).toBeNull();
    expect(beta.versusWorstNote(-5, '-$5', 'x')).toBeNull();
  });

  it('drops the duration clause when the survivor barely outlives', () => {
    // The two can die within months of each other on the ages in the report,
    // and "for about 0 years" turns the strongest argument on the page into
    // an argument for nothing.
    expect(beta.survivorGainNote('$686', 'Both claim at your full ages', 0)).not.toMatch(
      /about 0 years/,
    );
    expect(beta.survivorGainNote('$686', 'Both claim at your full ages', 12)).toContain(
      'about 12 years',
    );
  });

  it('does not claim a winner when there is none', () => {
    expect(beta.longevityVerdict(null)).toMatch(/No single plan wins/);
    expect(beta.longevityVerdict('Both wait until 70')).toContain('Both wait until 70');
  });

  it('stays silent about dropped strategies when none were dropped', () => {
    expect(beta.longevityDroppedNote([])).toBeNull();
  });

  it('names each person and their own plan-to age', () => {
    const note = beta.planToNote(['Dan', 'Sarah'], [79, 95]);
    expect(note).toContain('Dan to 79');
    expect(note).toContain('Sarah to 95');
  });
});
