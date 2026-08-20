/**
 * What each surface actually renders, as a list of strings.
 *
 * Modeled per surface rather than "every copy function", because the two
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
  survivorFloorNote,
  survivorGapNote,
  survivorIncomeCaption,
} from '../../src/components/methodologyCopy';
import {
  piaEstimateNote,
  WIDOWED_MODELING_NOTE,
  WIDOWED_SURVIVOR_CARD,
  widowedIncomeCaption,
  widowedLifetimeCaption,
} from '../../src/components/widowedCopy';
import { widowedBenefitsOverlap } from '../../src/lib/widowedStages';
import { householdValueCaption, soloVsHouseholdNote } from '../../src/components/methodologyCopy';
import { formatPercent } from '../../src/lib/cpiHistory';
import { personLabel } from '../../src/lib/format';
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
 * A widow(er)'s single page. `WidowedPanel` — no tabs, no spousal block, and
 * none of the married household's captions: those speak of two people, a
 * spousal segment and a first death, none of which this household has.
 */
function widowedScreenSurface(analysis: HouseholdAnalysis, mode: DollarsMode): Line[] {
  const lines: Line[] = [];
  const person = analysis.people[0];

  push(lines, 'WidowedPanel.recommendation', analysis.recommendation);
  push(lines, 'WidowedPanel.recommendationDetail', analysis.recommendationDetail);
  push(
    lines,
    'WidowedPanel.widowedLifetimeCaption',
    widowedLifetimeCaption(person.person.lifeExpectancy),
  );
  push(
    lines,
    'CombinedIncomeChart.widowedIncomeCaption',
    widowedIncomeCaption(mode, widowedBenefitsOverlap(analysis.periods)),
  );
  if (analysis.deceased !== null) {
    push(
      lines,
      'WidowedPanel.piaEstimateNote',
      piaEstimateNote(analysis.deceased, analysis.piaEstimated === true),
    );
  }

  return lines;
}

/** The widow(er)'s printed page, plus the appendix `ReportDocument` puts on it. */
function widowedPdfSurface(analysis: HouseholdAnalysis): Line[] {
  const lines: Line[] = [];
  const person = analysis.people[0];

  push(lines, 'pdf/WidowedSection.recommendation', analysis.recommendation);
  push(lines, 'pdf/WidowedSection.recommendationDetail', analysis.recommendationDetail);
  push(
    lines,
    'pdf/WidowedSection.widowedLifetimeCaption',
    widowedLifetimeCaption(person.person.lifeExpectancy),
  );
  // Print has no dollars toggle; it is always real.
  push(
    lines,
    'pdf/WidowedSection.widowedIncomeCaption',
    widowedIncomeCaption('real', widowedBenefitsOverlap(analysis.periods)),
  );
  if (analysis.deceased !== null) {
    push(
      lines,
      'pdf/WidowedSection.piaEstimateNote',
      piaEstimateNote(analysis.deceased, analysis.piaEstimated === true),
    );
  }
  // The appendix attaches to this same physical page, so its two widowed
  // slots share a reader with everything above. Both are modeled precisely
  // because they held the identical constant at first, and the sweep found it.
  push(lines, 'pdf/MethodologyAppendix.disclosure', WIDOWED_MODELING_NOTE);
  push(lines, 'pdf/MethodologyAppendix.survivorBenefitCard', WIDOWED_SURVIVOR_CARD);

  return lines;
}

/**
 * The Household tab as one reader sees it, plus the "How This Works" panel
 * below it — `Analyzer.tsx` renders both as siblings on one scrolling page,
 * so they share a reader.
 *
 * Dispatches on status rather than assuming married/single, so every sweep
 * that calls this covers a widowed household by feeding it one — the
 * alternative was each sweep remembering to branch, which is the failure mode
 * `householdDisplayShape` exists to prevent in the app itself.
 */
export function screenSurface(analysis: HouseholdAnalysis, mode: DollarsMode): Line[] {
  if (analysis.status === 'widowed') return widowedScreenSurface(analysis, mode);
  const lines: Line[] = [];

  push(
    lines,
    'StrategyComparisonTable.householdValueCaption',
    householdValueCaption(formatPercent(analysis.assumptions.discountRate * 100, 2)),
  );
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
  push(
    lines,
    'CombinedIncomeChart.survivorFloorNote',
    survivorFloorNote(analysis.survivorFloor),
  );

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
  if (analysis.status === 'widowed') return widowedPdfSurface(analysis);
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
    push(
      lines,
      'pdf/HouseholdSection.householdValueCaption',
      householdValueCaption(formatPercent(analysis.assumptions.discountRate * 100, 2)),
    );
    push(lines, 'pdf/HouseholdSection.subtitle', COMBINED_INCOME_SUBTITLE);
    push(
      lines,
      'pdf/HouseholdSection.combinedIncomeCaption',
      combinedIncomeCaption(analysis.survivorGap, 'real'),
    );
    push(lines, 'pdf/HouseholdSection.survivorGapNote', survivorGapNote(analysis.survivorGap));
    push(
      lines,
      'pdf/HouseholdSection.survivorFloorNote',
      survivorFloorNote(analysis.survivorFloor),
    );

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

/**
 * ONE person's tab, and ONE person's printed page — a single reader's view of
 * a single person.
 *
 * Separate from the household surfaces above, not folded into them, because
 * the duplicate check's question is "does one reader see this sentence
 * twice?" On screen `HouseholdView` mounts only the active tab, so two people
 * never share a reader; in print they are two pages. Modeling both people's
 * notes as one surface reported a duplicate for every household whose two
 * spouses file at the same age — the explanatory half of the sentence is
 * identical then, and correctly so, because it is explaining the same age to
 * two different readers.
 *
 * That false positive is exactly what this model is for: it fired on the
 * first full run, and the model was wrong rather than the copy.
 */
export function personScreenSurface(analysis: HouseholdAnalysis, index: number): Line[] {
  const lines: Line[] = [];
  const p = analysis.people[index];
  if (p === undefined) return lines;

  const householdBest = p.householdBestFilingAge ?? p.filingAge;
  const soloDiffers =
    p.soloFilingAge != null && p.soloFilingAge.label !== householdBest.label;
  const shownDiffers = p.filingAge.label !== householdBest.label;
  if (soloDiffers || shownDiffers) {
    push(
      lines,
      'PersonPanel.soloVsHouseholdNote',
      soloVsHouseholdNote(
        personLabel(p.person.name, index),
        householdBest.label,
        soloDiffers ? p.soloFilingAge!.label : null,
        shownDiffers ? p.filingAge.label : null,
      ),
    );
  }
  return lines;
}

export function personPdfSurface(analysis: HouseholdAnalysis, index: number): Line[] {
  return personScreenSurface(analysis, index).map((line) => ({
    ...line,
    source: line.source.replace('PersonPanel.', 'pdf/PersonSection.'),
  }));
}

export const SURFACES = [
  { name: 'screen', build: screenSurface },
  { name: 'pdf', build: (a: HouseholdAnalysis) => pdfSurface(a) },
] as const;
