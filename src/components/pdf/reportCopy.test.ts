import { describe, expect, it } from 'vitest';
import * as copy from './reportCopy';

/**
 * The whole point of the report's client half is that it can be read without a
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
  for (const value of Object.values(copy)) {
    if (typeof value === 'string') out.push(value);
    if (Array.isArray(value)) {
      for (const item of value as copy.Term[]) out.push(item.term, item.body);
    }
  }
  out.push(
    copy.versusWorstNote(1000, '$1,000', 'Both claim as early as you can') ?? '',
    copy.survivorGainNote('$19,728', 'Both claim as early as you can', 12),
    copy.survivorGainNote('$686', 'Both claim at your full ages', 0),
    copy.longevityVerdict('Both wait until 70'),
    copy.longevityVerdict(null),
    copy.longevityVerdict(null, true),
    copy.longevityDroppedNote(['Both wait until 70']) ?? '',
    copy.planToNote(['Dan', 'Sarah'], [79, 95]),
    copy.coverSubtitle(true),
    copy.coverSubtitle(false),
    ...copy.introQuestions(true),
    ...copy.introQuestions(false),
  );
  return out.filter((s) => s.length > 0);
}

describe('report copy', () => {
  it('uses no term the reader would have to look up', () => {
    // The terms page is the one place these words may appear, and there they
    // appear defined and in brackets — which is why it is checked for the
    // bare jargon rather than for the words in passing.
    const clientCopy = allCopy().filter((s) => !copy.KEY_TERMS.some((t) => t.body === s));
    for (const line of clientCopy) {
      for (const word of BARRED) {
        expect(line.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });

  it('introduces each barred term on the terms page, in plain words first', () => {
    const terms = copy.KEY_TERMS.map((t) => `${t.term} ${t.body}`).join(' ');
    // The three a client will meet elsewhere — on an SSA statement, or from
    // another adviser — have to be recognizable when they do.
    for (const word of ['FRA', 'PIA', 'COLA']) {
      expect(terms).toContain(word);
    }
    // And each is introduced by what it IS before it is named.
    for (const t of copy.KEY_TERMS) {
      expect(t.term).not.toMatch(/\b(FRA|PIA|COLA)\b/);
    }
  });

  it('says nothing about a gain that is not there', () => {
    expect(copy.versusWorstNote(0, '$0', 'x')).toBeNull();
    expect(copy.versusWorstNote(-5, '-$5', 'x')).toBeNull();
  });

  it('drops the duration clause when the survivor barely outlives', () => {
    // The two can die within months of each other on the ages in the report,
    // and "for about 0 years" turns the strongest argument on the page into
    // an argument for nothing.
    expect(copy.survivorGainNote('$686', 'Both claim at your full ages', 0)).not.toMatch(
      /about 0 years/,
    );
    expect(copy.survivorGainNote('$686', 'Both claim at your full ages', 12)).toContain(
      'about 12 years',
    );
  });

  it('does not claim a winner when there is none', () => {
    expect(copy.longevityVerdict(null)).toMatch(/No single plan wins/);
    expect(copy.longevityVerdict('Both wait until 70')).toContain('Both wait until 70');
  });

  it('says the leaders are level rather than naming one by a hair', () => {
    const tied = copy.longevityVerdict(null, true);
    expect(tied).toMatch(/within half a percent/);
    expect(tied).not.toMatch(/No single plan wins/);
    // And it tells the reader what to decide on instead.
    expect(tied).toMatch(/when you actually want to stop working/);
  });

  it('stays silent about dropped strategies when none were dropped', () => {
    expect(copy.longevityDroppedNote([])).toBeNull();
  });

  it('names each person and their own plan-to age', () => {
    const note = copy.planToNote(['Dan', 'Sarah'], [79, 95]);
    expect(note).toContain('Dan to 79');
    expect(note).toContain('Sarah to 95');
  });
});

describe('the introduction and the limits page', () => {
  it('states the whole trade-off in the lead sentence', () => {
    // The clearest sentence in six competing reports, and the one thing a
    // client should be able to repeat afterwards.
    expect(copy.INTRO_LEAD).toMatch(/more payments/);
    expect(copy.INTRO_LEAD).toMatch(/fewer payments/);
  });

  it('asks the survivor question only of a couple', () => {
    expect(copy.introQuestions(true).join(' ')).toMatch(/left/);
    expect(copy.introQuestions(false).join(' ')).not.toMatch(/left/);
  });

  it('names taxes and work as limits, since both are asked about', () => {
    const terms = copy.LIMITS.map((l) => l.term);
    expect(terms).toContain('Taxes');
    expect(terms.some((t) => /work/i.test(t))).toBe(true);
  });

  it('gives the client a phone number and the survivor rule', () => {
    expect(copy.ACTION_APPLY_NOTE).toContain('1-800-772-1213');
    expect(copy.ACTION_APPLY_NOTE).toMatch(/survivor benefit cannot be applied for online/i);
  });
});
