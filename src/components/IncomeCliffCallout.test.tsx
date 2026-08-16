import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IncomeCliffCallout } from './IncomeCliffCallout';
import type { HouseholdAnalysis } from '../lib/household';
import type { SurvivorGap } from '../lib/benefitPeriods';

/**
 * Only the fields `incomeCliff` and `survivorGapNote` read. Running the
 * optimizer here would duplicate the pipeline coverage `incomeCliff.test.ts`
 * already owns — this file is about the component's rendering decisions
 * (render/don't render, which note appears), not the arithmetic.
 */
function analysisWith(
  overrides: Partial<HouseholdAnalysis> & {
    finalIndexByPersonId?: Record<string, number>;
    combinedTimeline?: HouseholdAnalysis['combinedTimeline'];
  } = {},
): HouseholdAnalysis {
  return {
    status: 'married',
    people: [{ person: { id: 'a', name: 'Dan' } }, { person: { id: 'b', name: 'Sarah' } }],
    finalIndexByPersonId: { a: 2047 * 12 + 3, b: 2052 * 12 + 1 },
    combinedTimeline: [
      { year: 2046, bySeries: {}, byPersonId: {}, total: 60000 },
      { year: 2047, bySeries: {}, byPersonId: {}, total: 55000 },
      { year: 2048, bySeries: {}, byPersonId: {}, total: 38000 },
    ],
    survivorGap: null,
    ...overrides,
  } as unknown as HouseholdAnalysis;
}

describe('IncomeCliffCallout', () => {
  it('renders the sentence and the drop figures for a household with a modeled first death', () => {
    const { getByTestId } = render(<IncomeCliffCallout analysis={analysisWith()} />);
    const sentence = getByTestId('income-cliff-sentence').textContent!;
    expect(sentence).toContain('2047');
    expect(sentence).toContain('$60,000');
    expect(sentence).toContain('$38,000');
    expect(sentence).toContain('Sarah');
    expect(sentence).toMatch(/falls 36\.7%/);
  });

  it('renders nothing for a single claimant', () => {
    const { container } = render(
      <IncomeCliffCallout
        analysis={analysisWith({
          people: [{ person: { id: 'a', name: 'Dan' } }] as HouseholdAnalysis['people'],
          finalIndexByPersonId: { a: 2047 * 12 + 3 },
        })}
      />,
    );
    expect(container.querySelector('[data-testid="income-cliff-callout"]')).toBeNull();
  });

  it('renders nothing when the first death falls outside the timeline', () => {
    const { container } = render(
      <IncomeCliffCallout
        analysis={analysisWith({
          combinedTimeline: [{ year: 2047, bySeries: {}, byPersonId: {}, total: 55000 }],
        })}
      />,
    );
    expect(container.querySelector('[data-testid="income-cliff-callout"]')).toBeNull();
  });

  // The sentence must stay true when the survivor's step-up fully offsets
  // the loss — reachable, and specifically the shape the brief calls out as
  // one "falls" cannot be written unconditionally for.
  it('says income does not fall when dropPercent is zero, rather than asserting a fall', () => {
    const { getByTestId } = render(
      <IncomeCliffCallout
        analysis={analysisWith({
          combinedTimeline: [
            { year: 2046, bySeries: {}, byPersonId: {}, total: 50000 },
            { year: 2047, bySeries: {}, byPersonId: {}, total: 48000 },
            { year: 2048, bySeries: {}, byPersonId: {}, total: 52000 },
          ],
        })}
      />,
    );
    const sentence = getByTestId('income-cliff-sentence').textContent!;
    expect(sentence).toContain('does not fall');
    expect(sentence).not.toMatch(/falls \d/);
    expect(sentence).toContain('$50,000');
    expect(sentence).toContain('$52,000');
  });

  it('reuses survivorGapNote rather than a second hand-written sentence, when the gap is set', () => {
    const gap: SurvivorGap = {
      survivorLabel: 'Sarah',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    };
    const { getByTestId } = render(
      <IncomeCliffCallout analysis={analysisWith({ survivorGap: gap })} />,
    );
    const note = getByTestId('income-cliff-gap-note').textContent!;
    // Exactly the string `survivorGapNote` produces for this gap — not a
    // paraphrase written locally in the component.
    expect(note).toContain('no step-up is shown for Sarah');
    expect(note).toContain('$1,780.00/mo');
    expect(note).toContain('$1,760.00/mo');
    expect(note).toContain('lower than SSA would pay');
  });

  it('renders no gap note when the analysis has none', () => {
    const { queryByTestId } = render(<IncomeCliffCallout analysis={analysisWith()} />);
    expect(queryByTestId('income-cliff-gap-note')).toBeNull();
  });
});
