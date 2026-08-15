import type { HouseholdAnalysis } from '../lib/household';
import { StrategyComparisonTable } from './StrategyComparisonTable';
import { CombinedIncomeChart } from './CombinedIncomeChart';
import { BreakEvenSection } from './BreakEvenSection';

interface HouseholdPanelProps {
  analysis: HouseholdAnalysis;
}

/**
 * The Household tab's contents: leads on the recommendation, then the
 * strategy comparison table — the feature this refactor exists for, since it
 * shows the client what the optimizer rejected and by how much rather than
 * just what it picked — followed by the combined income timeline and the
 * household break-even, which reuses person A's break-even pairs (the
 * household's single, engine-computed set; see `household.ts`).
 */
export function HouseholdPanel({ analysis }: HouseholdPanelProps) {
  const people = analysis.people.map((p) => p.person);
  const [personA] = analysis.people;

  return (
    <div className="results">
      <div className="recommendation-card">
        <span className="rec-label">Household — Recommended Strategy (ssa.tools)</span>
        <h2 data-testid="recommendation-title">{analysis.recommendation}</h2>
        <p>{analysis.recommendationDetail}</p>
      </div>

      <StrategyComparisonTable comparisons={analysis.comparisons} people={people} />

      <CombinedIncomeChart timeline={analysis.combinedTimeline} people={people} />

      <BreakEvenSection
        breakEvens={personA.breakEvens}
        lifeExpectancy={personA.person.lifeExpectancy}
      />
    </div>
  );
}
