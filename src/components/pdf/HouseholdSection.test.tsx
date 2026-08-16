import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import type { SurvivorGap } from '../../lib/benefitPeriods';
import type { HouseholdAnalysis } from '../../lib/household';
import { HouseholdSection } from './HouseholdSection';

/**
 * The PDF's half of the survivor-gap disclosure and the combined-income
 * caption.
 *
 * `ReportDocument.test.tsx` renders the real document, but PDFKit deflates
 * every content stream, so no assertion on the printed *words* is possible
 * from the blob. This walks the element tree `HouseholdSection` returns
 * instead — the strings it puts into the document, which is exactly what the
 * C1 and I2 findings are about. Without it the print surface has copy
 * coverage only by assumption, which is how the unguarded absence marker
 * reached print once already.
 */
function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectText);
  const element = node as ReactElement<{ children?: unknown }>;
  if (typeof element === 'object' && 'props' in element) {
    return collectText(element.props?.children);
  }
  return [];
}

/**
 * Only the fields `HouseholdSection` reads. Running the optimizer here would
 * duplicate the pipeline coverage in `methodologyCopy.test.ts`, which is where
 * these exact gap figures are pinned against real `analyzeHousehold` output.
 */
function analysisWith(survivorGap: SurvivorGap | null): HouseholdAnalysis {
  return {
    status: 'married',
    people: [
      { person: { id: 'a', name: 'Avery' } },
      { person: { id: 'b', name: 'Blake' } },
    ],
    comparisons: [],
    combinedTimeline: [{ year: 2030, byPersonId: { a: 12000, b: 0 }, total: 12000 }],
    periods: [],
    survivorGap,
    recommendation: 'r',
    recommendationDetail: 'd',
  } as unknown as HouseholdAnalysis;
}

const printed = (survivorGap: SurvivorGap | null) =>
  collectText(HouseholdSection({ analysis: analysisWith(survivorGap), footerText: 'f' })).join(' ');

describe('HouseholdSection — the printed combined-income caption', () => {
  it('claims spousal and survivor benefits are included when they are', () => {
    const text = printed(null);
    expect(text).toContain('their own benefit plus any spousal or survivor benefit');
    expect(text).toContain("today's dollars, before any cost-of-living adjustment");
    expect(text).not.toContain('No survivor benefit is included');
  });

  it('drops the survivor claim for a gap household, as the screen caption does', () => {
    // Both captions were verbatim duplicates rendered unconditionally, and
    // both contradicted the note printed directly beneath them.
    const text = printed({
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    });
    expect(text).not.toContain('or survivor benefit');
    expect(text).toContain('No survivor benefit is included for this household');
  });
});

describe('HouseholdSection — the printed survivor-gap note', () => {
  it('prints contemporaneous figures when the survivor has already filed', () => {
    const text = printed({
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    });
    expect(text).toContain('no step-up is shown for Blake');
    expect(text).toContain('$1,780.00/mo');
    expect(text).toContain('$1,760.00/mo');
  });

  it('prints no survivor figure when the survivor has not filed at the death', () => {
    const text = printed({
      survivorLabel: 'Blake',
      deceasedMonthly: 1780,
      survivorOwnMonthly: null,
      survivorUnder60: false,
    });
    expect(text).toContain('has not filed on their own record by then');
    // The one dollar figure on the page's note is the deceased's. A figure the
    // survivor is not receiving must not reach print — this is C1's failure.
    const note = text.slice(text.indexOf('Survivor benefits are modeled'));
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual(['$1,780.00']);
  });

  it('prints the under-60 branch without asserting an immediate shortfall', () => {
    const text = printed({
      survivorLabel: 'Blake',
      deceasedMonthly: 2016,
      survivorOwnMonthly: null,
      survivorUnder60: true,
    });
    expect(text).toContain('is under 60 then');
    expect(text).toContain('from age 60 onward');
    expect(text).not.toContain('lower than SSA would pay');
    const note = text.slice(text.indexOf('Survivor benefits are modeled'));
    expect(note.match(/\$[\d,]+\.\d\d/g)).toEqual(['$2,016.00']);
  });

  it('prints nothing at all when there is no gap', () => {
    expect(printed(null)).not.toContain('no step-up is shown');
  });
});
