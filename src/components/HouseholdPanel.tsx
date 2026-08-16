import type { HouseholdAnalysis } from '../lib/household';
import { computeBreakEvens } from '../lib/benefitMath';
import { personLabel } from '../lib/format';
import { StrategyComparisonTable } from './StrategyComparisonTable';
import { CombinedIncomeChart } from './CombinedIncomeChart';
import { BreakEvenSection } from './BreakEvenSection';

interface HouseholdPanelProps {
  analysis: HouseholdAnalysis;
  annualCola: number;
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
 */
export function HouseholdPanel({ analysis, annualCola }: HouseholdPanelProps) {
  const people = analysis.people.map((p) => p.person);
  const [personA] = analysis.people;
  const breakEvens = computeBreakEvens(personA.claimingOptions, annualCola);

  return (
    <div className="results">
      <div className="recommendation-card">
        <span className="rec-label">Household — Recommended Strategy (ssa.tools)</span>
        <h2 data-testid="recommendation-title">{analysis.recommendation}</h2>
        <p>{analysis.recommendationDetail}</p>
      </div>

      <StrategyComparisonTable comparisons={analysis.comparisons} people={people} />

      <CombinedIncomeChart
        timeline={analysis.combinedTimeline}
        people={people}
        survivorGap={analysis.survivorGap}
        finalIndexByPersonId={analysis.finalIndexByPersonId}
      />

      <BreakEvenSection
        breakEvens={breakEvens}
        lifeExpectancy={personA.person.lifeExpectancy}
        attributedTo={personLabel(personA.person.name, 0)}
      />
    </div>
  );
}
