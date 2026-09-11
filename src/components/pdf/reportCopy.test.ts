import { describe, expect, it } from 'vitest';
import * as copy from './reportCopy';
import { unprintableInPdf } from '../../lib/pdfSafeText';

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
    copy.solvencyIntro(
      { fromYear: 2032, payablePercent: 78, report: '2026 OASDI Trustees Report' },
      { fromYear: 2032, payablePercent: 78 },
    ),
    copy.solvencyIntro(
      { fromYear: 2032, payablePercent: 78, report: '2026 OASDI Trustees Report' },
      { fromYear: 2040, payablePercent: 90 },
    ),
    copy.solvencyVerdict(true, 'Both wait until 70', 'Both wait until 70'),
    copy.solvencyVerdict(false, 'Both wait until 70', 'Both claim at your full ages'),
    copy.versusWorstNote(1000, '$1,000', 'Both claim as early as you can') ?? '',
    copy.survivorGainNote('$19,728', 'Both claim as early as you can', 12),
    copy.survivorGainNote('$686', 'Both claim at your full ages', 0),
    copy.longevityVerdict('Both wait until 70'),
    copy.longevityVerdict(null),
    copy.longevityVerdict(null, true),
    copy.longevityDroppedNote(['Both wait until 70']) ?? '',
    copy.planToNote(['John', 'Jane'], [79, 95]),
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
    expect(tied).toMatch(/when you want to stop working/);
  });

  it('stays silent about dropped strategies when none were dropped', () => {
    expect(copy.longevityDroppedNote([])).toBeNull();
  });

  it('names each person and their own plan-to age', () => {
    const note = copy.planToNote(['John', 'Jane'], [79, 95]);
    expect(note).toContain('John to 79');
    expect(note).toContain('Jane to 95');
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
    expect(copy.ACTION_APPLY_NOTE).toMatch(/survivor benefits cannot be applied for online/i);
  });
});

/**
 * The report gives an answer. It must not present that answer as the whole
 * decision, and the cover is where that goes wrong first: a promise in 40pt
 * on page one is not undone by a disclosure in 7pt on page twelve.
 */
describe('how definite the report allows itself to be', () => {
  it('does not tell the reader on the cover when to claim', () => {
    for (const hasSpouse of [false, true]) {
      const subtitle = copy.coverSubtitle(hasSpouse);
      expect(subtitle.toLowerCase()).not.toContain('should');
      // And it points forward to there being more to it.
      expect(subtitle.toLowerCase()).toContain('weigh');
    }
  });

  it('calls the first page a summary rather than the answer', () => {
    // "The first page is the answer" was the most definitive sentence in the
    // report and the least defensible: it is the answer to the question this
    // report asks, which is not the question of when to claim.
    expect(copy.INTRO_HOW_TO_READ).not.toMatch(/first page is the answer/i);
    expect(copy.INTRO_HOW_TO_READ.toLowerCase()).toContain('leaves out');
  });

  it('names what the decision needs that this report does not have', () => {
    // Every other limit is a caveat about the model. This one is about the
    // decision, which is why it leads the page.
    const first = copy.LIMITS[0];
    expect(first.term.toLowerCase()).toContain('decision');
    const body = first.body.toLowerCase();
    for (const factor of ['health', 'working', 'tax', 'medicare']) {
      expect(body).toContain(factor);
    }
    // And it says what the report is FOR, rather than only what it lacks.
    expect(body).toContain('one input');
  });
});

/**
 * Every character the report prints has to exist in the font that prints it.
 *
 * react-pdf's standard-14 fonts stop just past Latin-1, and a character
 * outside that does not fail loudly — it prints as some other glyph, or as
 * nothing. `Age 62 → Age 67` printed as "Age 62 ' Age67" for months: the
 * arrow became a stray apostrophe and ate the space after it. Nothing caught
 * it, because every assertion ran against the React element tree, where the
 * arrow is simply the arrow.
 *
 * `unprintableInPdf` was written after that defect and then never called by
 * anything — dead code guarding nothing, at 0% coverage, while the class it
 * exists to prevent stayed open. This is the call site.
 */
describe('everything this module prints, printed', () => {
  it('uses no character the report\'s fonts cannot render', () => {
    for (const line of allCopy()) {
      const bad = unprintableInPdf(line);
      expect(
        bad,
        `Unprintable ${JSON.stringify(bad)} in: ${JSON.stringify(line.slice(0, 120))}. ` +
          "react-pdf's standard-14 fonts stop past Latin-1, so this prints as " +
          'some other glyph or as nothing at all. Use a Latin-1 equivalent, or ' +
          'add the character to ALLOWED_ABOVE_LATIN1 in pdfSafeText.ts after ' +
          'checking how it actually prints.',
      ).toEqual([]);
    }
  });

  it('catches the arrow that started this', () => {
    // A guard nobody has seen reject anything is a guard nobody can trust.
    expect(unprintableInPdf('Age 62 \u2192 Age 67')).toEqual(['\u2192']);
    // And the typography this copy genuinely uses stays allowed.
    expect(unprintableInPdf('you\u2019re \u201cbest\u201d \u2014 age 70\u2026')).toEqual([]);
  });
});

