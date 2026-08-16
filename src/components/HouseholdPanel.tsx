import type { HouseholdAnalysis, HouseholdStrategy } from '../lib/household';
import { computeBreakEvens } from '../lib/benefitMath';
import { toNominal, toNominalAmount, type DollarsMode } from '../lib/dollarsMode';
import { personLabel } from '../lib/format';
import { firstDeath } from '../lib/incomeCliff';
import { StrategyComparisonTable } from './StrategyComparisonTable';
import { CombinedIncomeChart } from './CombinedIncomeChart';
import { IncomeCliffCallout } from './IncomeCliffCallout';
import { BreakEvenSection } from './BreakEvenSection';

interface HouseholdPanelProps {
  analysis: HouseholdAnalysis;
  annualCola: number;
  dollarsMode: DollarsMode;
  onDollarsModeChange: (mode: DollarsMode) => void;
}

/**
 * The survivor-income column's nominal figures, one scalar transform per
 * row rather than a second timeline. Every row is priced at the same
 * calendar year — `withSurvivorIncome` in `household.ts` fixes it at
 * `firstDeath`'s `deathYear + 1`, independent of that row's own filing
 * strategy — so the year is computed once here via the same `firstDeath`
 * helper `incomeCliff` itself calls, rather than re-derived per row.
 *
 * Real mode, or a household with no first death to speak of (single
 * claimant, or the death falling outside the modeled timeline), returns
 * `comparisons` untouched.
 */
function nominalComparisons(
  comparisons: HouseholdStrategy[],
  people: HouseholdAnalysis['people'],
  finalIndexByPersonId: HouseholdAnalysis['finalIndexByPersonId'],
  annualCola: number,
  asOfYear: number,
): HouseholdStrategy[] {
  if (people.length !== 2) return comparisons;
  const death = firstDeath([people[0].person.id, people[1].person.id], finalIndexByPersonId);
  if (death === null) return comparisons;
  const year = death.deathYear + 1;
  return comparisons.map((c) =>
    c.survivorIncome == null
      ? c
      : { ...c, survivorIncome: toNominalAmount(c.survivorIncome, annualCola, asOfYear, year) },
  );
}

/**
 * The Household tab's contents: leads on the recommendation, then the
 * strategy comparison table — the feature this refactor exists for, since it
 * shows the client what the optimizer rejected and by how much rather than
 * just what it picked — followed by the combined income timeline and the
 * household break-even, based on person A's claiming options (the
 * household's single, representative break-even set; see `household.ts`).
 *
 * The break-even ages are recomputed locally from `annualCola` (via
 * `computeBreakEvens`, the same pure function `analysis.people[0].breakEvens`
 * itself was built with — see `analyzePerson` in `personAnalysis.ts`) rather
 * than read directly off `analysis.people[0].breakEvens`. That field is
 * baked in at the moment of the last full ssa.tools analysis; the
 * COLA-slider-only re-render that changes `annualCola` deliberately does
 * NOT re-trigger that (expensive, mortality-weighted) analysis — see
 * Analyzer.tsx's effect — so reading the baked-in field here would make the
 * COLA slider silently stop updating the break-even ages on screen.
 * Recomputing locally is cheap (pure array math over ≤9 claiming-age rows)
 * and keeps this section live.
 *
 * `dollarsMode` is applied exactly once here, before any of the three
 * dependent displays see the data: the chart's `timeline`, the strategy
 * table's `comparisons` (its survivor-income column), and the cliff callout
 * (via `displayAnalysis`, which carries the same transformed timeline) all
 * read the SAME already-transformed values rather than each calling
 * `toNominal` themselves — a chart in nominal beside a callout still in real
 * is the exact defect class this toggle exists to avoid, and three
 * independent transforms agreeing by construction is weaker than one
 * transform read three times.
 *
 * Uses the live `annualCola` prop, not `analysis.assumptions.annualCola` —
 * the same choice `breakEvens` above makes and for the same reason: the
 * engine analysis that produced `analysis` doesn't re-run when the COLA
 * slider moves, so the baked-in assumption can be stale while the slider
 * (and its on-screen label) has already moved on. `analysis.asOf` is used
 * for the anchor year regardless, since "today" for this analysis doesn't
 * change with the slider.
 */
export function HouseholdPanel({
  analysis,
  annualCola,
  dollarsMode,
  onDollarsModeChange,
}: HouseholdPanelProps) {
  const people = analysis.people.map((p) => p.person);
  const [personA] = analysis.people;
  const breakEvens = computeBreakEvens(personA.claimingOptions, annualCola);

  const asOfYear = analysis.asOf.getFullYear();
  const displayTimeline =
    dollarsMode === 'nominal'
      ? toNominal(analysis.combinedTimeline, annualCola, asOfYear)
      : analysis.combinedTimeline;
  const displayComparisons =
    dollarsMode === 'nominal'
      ? nominalComparisons(
          analysis.comparisons,
          analysis.people,
          analysis.finalIndexByPersonId,
          annualCola,
          asOfYear,
        )
      : analysis.comparisons;
  const displayAnalysis: HouseholdAnalysis =
    dollarsMode === 'nominal'
      ? { ...analysis, combinedTimeline: displayTimeline, comparisons: displayComparisons }
      : analysis;

  return (
    <div className="results">
      <div className="recommendation-card">
        <span className="rec-label">Household — Recommended Strategy (ssa.tools)</span>
        <h2 data-testid="recommendation-title">{analysis.recommendation}</h2>
        <p>{analysis.recommendationDetail}</p>
      </div>

      <StrategyComparisonTable
        comparisons={displayComparisons}
        people={people}
        survivorGap={analysis.survivorGap}
      />

      <CombinedIncomeChart
        timeline={displayTimeline}
        people={people}
        survivorGap={analysis.survivorGap}
        finalIndexByPersonId={analysis.finalIndexByPersonId}
        dollarsMode={dollarsMode}
        onDollarsModeChange={onDollarsModeChange}
      />

      <IncomeCliffCallout analysis={displayAnalysis} />

      <BreakEvenSection
        breakEvens={breakEvens}
        lifeExpectancy={personA.person.lifeExpectancy}
        attributedTo={personLabel(personA.person.name, 0)}
      />
    </div>
  );
}
