import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IncomeCliffCallout } from './IncomeCliffCallout';
import { INCOME_CLIFF_HEADING } from './methodologyCopy';
import type { HouseholdAnalysis } from '../lib/household';
import type { SurvivorGap } from '../lib/benefitPeriods';

/**
 * Only the fields `incomeCliff` reads. Running the optimizer here would
 * duplicate the pipeline coverage `incomeCliff.test.ts` already owns — this
 * file is about the component's rendering decisions (render/don't render,
 * which wording appears), not the arithmetic.
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
  it('renders the shared heading and the sentence with the drop figures', () => {
    const { getByText, getByTestId } = render(<IncomeCliffCallout analysis={analysisWith()} />);
    expect(getByText(INCOME_CLIFF_HEADING)).toBeInTheDocument();
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

  // Code-review finding: "once {survivor} is the only one still collecting"
  // is false the moment `after` is $0 — a real, reachable shape (see
  // `methodologyCopy.test.ts`'s `incomeCliffSentence` coverage, and
  // `incomeCliff.test.ts` for the arithmetic that produces it). The closing
  // clause must be a composition claim ("the household's only remaining
  // member"), never a payment claim, so it stays true beside a $0 figure.
  it('never claims the survivor is "collecting" anything, even when after is $0', () => {
    const { getByTestId } = render(
      <IncomeCliffCallout
        analysis={analysisWith({
          combinedTimeline: [
            { year: 2046, bySeries: {}, byPersonId: {}, total: 24192 },
            { year: 2047, bySeries: {}, byPersonId: {}, total: 12096 },
            { year: 2048, bySeries: {}, byPersonId: {}, total: 0 },
          ],
        })}
      />,
    );
    const sentence = getByTestId('income-cliff-sentence').textContent!;
    expect(sentence).toContain('$0');
    expect(sentence).not.toMatch(/collecting/i);
    expect(sentence).toContain("Sarah is the household's only remaining member");
  });

  // Code-review finding: `CombinedIncomeChart` already prints
  // `survivorGapNote` directly above this callout in `HouseholdPanel`, so
  // this component must NOT render a second copy of the same paragraph — an
  // earlier version did, and the note appeared twice on one screen. This
  // component owns none of that text; `HouseholdPanel.test.tsx` covers the
  // "exactly once, across the whole panel" invariant that matters at the
  // composition level.
  it('renders no survivor-gap paragraph of its own, even when the gap is set', () => {
    const gap: SurvivorGap = {
      survivorLabel: 'Sarah',
      deceasedMonthly: 1780,
      survivorOwnMonthly: 1760,
      survivorUnder60: false,
    };
    const { queryByTestId, getByTestId } = render(
      <IncomeCliffCallout analysis={analysisWith({ survivorGap: gap })} />,
    );
    // The callout still renders its own sentence...
    expect(getByTestId('income-cliff-sentence')).toBeInTheDocument();
    // ...but not a second rendering of the note `CombinedIncomeChart` already
    // prints above it.
    expect(queryByTestId('income-cliff-gap-note')).toBeNull();
  });

  // The boxed callout had no unit statement in it at all before this —
  // `dollarsMode` names which dollars `analysis` (already transformed by
  // `HouseholdPanel`, if nominal) is in.
  describe('dollarsMode', () => {
    it('defaults to naming today’s dollars when omitted', () => {
      const { getByTestId } = render(<IncomeCliffCallout analysis={analysisWith()} />);
      expect(getByTestId('income-cliff-sentence')).toHaveTextContent(
        /today.s dollars, before any cost-of-living/i,
      );
    });

    it('names nominal dollars when passed nominal', () => {
      const { getByTestId } = render(
        <IncomeCliffCallout analysis={analysisWith()} dollarsMode="nominal" />,
      );
      expect(getByTestId('income-cliff-sentence')).toHaveTextContent(/nominal/i);
    });
  });
});
