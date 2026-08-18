/**
 * What each surface actually renders, as a list of strings.
 *
 * Modelled per surface rather than "every copy function", because the two
 * questions differ. A sentinel is a defect wherever it appears; a *duplicate*
 * is only a defect when both copies land in front of the same reader. Two
 * traps make a naive list wrong:
 *
 *  - `spousalMethodologyCopy` EMBEDS `spousalSummary` and `survivorGapNote`.
 *    Comparing the composite against its own parts reports a duplicate that
 *    no reader ever sees twice.
 *  - Screen-only and print-only strings share wording on purpose. A reader
 *    sees one or the other, never both.
 *
 * Kept beside the components rather than inside them so the sweep can build a
 * surface without a DOM.
 *
 * Nothing cross-checks this model against real rendered output — there is no
 * DOM in the sweep and no renderer here, so a string a component renders but
 * this file never pushes is invisible to every invariant below. The backstop
 * is `src/lib/engineBrand.test.ts`, which reads the component sources
 * directly. It covers only the engine's brand name, but for that one question
 * it needs no model at all, which is exactly the gap: this file models what
 * `methodologyCopy` and `household.ts` COMPUTE, and no JSX literal anywhere.
 */
import {
  COMBINED_INCOME_SUBTITLE,
  INCOME_CLIFF_HEADING,
  combinedIncomeCaption,
  coupleModelingNote,
  incomeCliffSentence,
  nominalFirstDeathNote,
  spousalMethodologyCopy,
  spousalSummary,
  survivorClaimNote,
  survivorGapNote,
  survivorIncomeCaption,
} from '../../src/components/methodologyCopy';
import { incomeCliff } from '../../src/lib/incomeCliff';
import { toNominalAmount, type DollarsMode } from '../../src/lib/dollarsMode';
import type { HouseholdAnalysis } from '../../src/lib/household';
import { SWEEP_ASSUMPTIONS } from './harness';
import { SWEEP_AS_OF } from './households';

/** One rendered string, tagged with the component that renders it. */
export interface Line {
  /** `Component.function`, so a finding names a file to open. */
  source: string;
  text: string;
}

const push = (lines: Line[], source: string, text: string | null | undefined) => {
  if (text !== null && text !== undefined) lines.push({ source, text });
};

/**
 * The Household tab as one reader sees it, plus the "How This Works" panel
 * below it — `Analyzer.tsx` renders both as siblings on one scrolling page,
 * so they share a reader.
 */
export function screenSurface(analysis: HouseholdAnalysis, mode: DollarsMode): Line[] {
  const lines: Line[] = [];

  push(
    lines,
    'StrategyComparisonTable.survivorIncomeCaption',
    survivorIncomeCaption(analysis.comparisons, analysis.survivorGap, mode),
  );

  const cliff = incomeCliff(analysis);
  if (cliff) {
    push(lines, 'IncomeCliffCallout.heading', INCOME_CLIFF_HEADING);
    push(lines, 'IncomeCliffCallout.incomeCliffSentence', incomeCliffSentence(cliff, mode));
  }

  push(
    lines,
    'SurvivorClaimNote.survivorClaimNote',
    survivorClaimNote(analysis.survivorClaim, mode),
  );

  push(lines, 'CombinedIncomeChart.subtitle', COMBINED_INCOME_SUBTITLE);
  push(
    lines,
    'CombinedIncomeChart.combinedIncomeCaption',
    combinedIncomeCaption(analysis.survivorGap, mode),
  );
  push(lines, 'CombinedIncomeChart.survivorGapNote', survivorGapNote(analysis.survivorGap));

  push(lines, 'Analyzer.spousalMethodologyCopy', spousalMethodologyCopy(analysis));

  push(lines, 'HouseholdPanel.recommendation', analysis.recommendation);
  push(lines, 'HouseholdPanel.recommendationDetail', analysis.recommendationDetail);

  return lines;
}

/**
 * The PDF. For a MARRIED report the methodology appendix is placed on the
 * household page itself (`ReportDocument`'s `appendix` prop, and the
 * `MethodologyAppendix` docstring says so explicitly), so both belong to one
 * surface here.
 */
export function pdfSurface(analysis: HouseholdAnalysis): Line[] {
  const lines: Line[] = [];
  const spousal = analysis.spousalTopUp;
  const married = analysis.status === 'married';

  if (married) {
    push(lines, 'pdf/HouseholdSection.recommendation', analysis.recommendation);
    push(lines, 'pdf/HouseholdSection.recommendationDetail', analysis.recommendationDetail);

    if (spousal) {
      push(
        lines,
        'pdf/HouseholdSection.spousalSummary',
        spousalSummary(spousal, spousal.lowerEarnerLabel === null ? null : 'the lower earner'),
      );
    }
    push(
      lines,
      'pdf/HouseholdSection.survivorIncomeCaption',
      survivorIncomeCaption(analysis.comparisons, analysis.survivorGap, 'real'),
    );
    push(lines, 'pdf/HouseholdSection.subtitle', COMBINED_INCOME_SUBTITLE);
    push(
      lines,
      'pdf/HouseholdSection.combinedIncomeCaption',
      combinedIncomeCaption(analysis.survivorGap, 'real'),
    );
    push(lines, 'pdf/HouseholdSection.survivorGapNote', survivorGapNote(analysis.survivorGap));

    const cliff = incomeCliff(analysis);
    if (cliff) {
      push(lines, 'pdf/HouseholdSection.heading', INCOME_CLIFF_HEADING);
      push(lines, 'pdf/HouseholdSection.incomeCliffSentence', incomeCliffSentence(cliff, 'real'));
      const nominalAfter = toNominalAmount(
        cliff.after,
        SWEEP_ASSUMPTIONS.annualCola,
        SWEEP_AS_OF.getFullYear(),
        cliff.deathYear + 1,
      );
      push(
        lines,
        'pdf/HouseholdSection.nominalFirstDeathNote',
        nominalFirstDeathNote(cliff, nominalAfter, SWEEP_ASSUMPTIONS.annualCola),
      );
    }

    push(
      lines,
      'pdf/HouseholdSection.survivorClaimNote',
      survivorClaimNote(analysis.survivorClaim, 'real'),
    );
  }

  // MethodologyAppendix — on the household page for a married report, on the
  // first person page for a single claimant.
  if (spousal) {
    push(
      lines,
      'pdf/MethodologyAppendix.spousalSummary',
      spousalSummary(spousal, spousal.lowerEarnerLabel === null ? null : 'the lower earner'),
    );
  }
  push(lines, 'pdf/MethodologyAppendix.coupleModelingNote', coupleModelingNote(analysis.survivorGap));

  return lines;
}

export const SURFACES = [
  { name: 'screen', build: screenSurface },
  { name: 'pdf', build: (a: HouseholdAnalysis) => pdfSurface(a) },
] as const;
