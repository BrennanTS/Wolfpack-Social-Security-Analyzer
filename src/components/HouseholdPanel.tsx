import { useMemo } from 'react';
import { buildMonthlyIncomeSeries, type HouseholdAnalysis, type HouseholdStrategy } from '../lib/household';
import { computeBreakEvens } from '../lib/benefitMath';
import { toNominal, toNominalAmount, toNominalMonthly, type DollarsMode } from '../lib/dollarsMode';
import { personLabel } from '../lib/format';
import { firstDeath } from '../lib/incomeCliff';
import { scenarioEyebrow, type ScenarioSet } from '../lib/scenario';
import { StrategyComparisonTable } from './StrategyComparisonTable';
import { CombinedIncomeChart } from './CombinedIncomeChart';
import { IncomeCliffCallout } from './IncomeCliffCallout';
import { SurvivorClaimNote } from './SurvivorClaimNote';
import { BreakEvenSection } from './BreakEvenSection';

interface HouseholdPanelProps {
  analysis: HouseholdAnalysis;
  annualCola: number;
  dollarsMode: DollarsMode;
  onDollarsModeChange: (mode: DollarsMode) => void;
  /**
   * The scenario list behind the comparison table. Optional so the tests
   * written before scenarios existed render a plain, non-editable table.
   */
  scenarios?: ScenarioSet;
  onScenariosChange?: (scenarios: ScenarioSet) => void;
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
 * `dollarsMode` is applied exactly once here, before any of the four
 * dependent displays see the data: the chart's `monthlySeries`, the strategy
 * table's `comparisons` (its survivor-income column), the cliff callout (via
 * `displayAnalysis`, which carries the same transformed `combinedTimeline`)
 * all read the SAME already-transformed values rather than each calling
 * `toNominal`/`toNominalMonthly` themselves — a chart in nominal beside a
 * callout still in real is the exact defect class this toggle exists to
 * avoid, and independent transforms agreeing by construction is weaker than
 * one transform read everywhere. The chart's own series is a SEPARATE
 * transform call (`toNominalMonthly`, not `toNominal` — see
 * `buildMonthlyIncomeSeries`/`dollarsMode.ts` for why one function can't
 * serve both shapes) over a SEPARATE input (`analysis.periods`, not
 * `analysis.combinedTimeline`), but both calls read the same `dollarsMode`,
 * `annualCola` and `asOfYear` right here, so the toggle still moves every
 * surface together by construction.
 *
 * Uses the live `annualCola` prop, not `analysis.assumptions.annualCola` —
 * the same choice `breakEvens` above makes and for the same reason: the
 * engine analysis that produced `analysis` doesn't re-run when the COLA
 * slider moves, so the baked-in assumption can be stale while the slider
 * (and its on-screen label) has already moved on. `analysis.asOf` is used
 * for the anchor year regardless, since "today" for this analysis doesn't
 * change with the slider.
 *
 * Each derived value is memoized on `[analysis, annualCola, dollarsMode,
 * asOfYear]` — `analysis.combinedTimeline`/`analysis.periods` are otherwise
 * stable array identities, and rebuilding fresh ones on every unrelated
 * re-render would hand `Area`/table children new object identities for data
 * that hadn't actually changed.
 */
export function HouseholdPanel({
  analysis,
  annualCola,
  dollarsMode,
  onDollarsModeChange,
  scenarios,
  onScenariosChange,
}: HouseholdPanelProps) {
  const people = analysis.people.map((p) => p.person);
  const [personA] = analysis.people;
  const breakEvens = computeBreakEvens(personA.claimingOptions, annualCola);

  const asOfYear = analysis.asOf.getFullYear();
  // Memoized so a re-render that doesn't change `analysis`, `annualCola` or
  // `dollarsMode` (e.g. the "vs. best" delta's own state, or a parent
  // re-render) reuses the same array identities `analysis.combinedTimeline`
  // itself would have had — otherwise every render below `HouseholdPanel`
  // saw a brand-new `timeline`/`comparisons` array even in real mode, where
  // nothing had actually changed.
  const displayTimeline = useMemo(
    () =>
      dollarsMode === 'nominal'
        ? toNominal(analysis.combinedTimeline, annualCola, asOfYear)
        : analysis.combinedTimeline,
    [analysis, annualCola, dollarsMode, asOfYear],
  );
  const displayComparisons = useMemo(
    () =>
      dollarsMode === 'nominal'
        ? nominalComparisons(
            analysis.comparisons,
            analysis.people,
            analysis.finalIndexByPersonId,
            annualCola,
            asOfYear,
          )
        : analysis.comparisons,
    [analysis, annualCola, dollarsMode, asOfYear],
  );
  // The same dollars transform over the unfiltered set, so a hidden row shows
  // its real survivor income in the editor rather than a figure in the other
  // mode from every row beside it.
  const displayAllComparisons = useMemo(
    () =>
      dollarsMode === 'nominal'
        ? nominalComparisons(
            analysis.allComparisons,
            analysis.people,
            analysis.finalIndexByPersonId,
            annualCola,
            asOfYear,
          )
        : analysis.allComparisons,
    [analysis, annualCola, dollarsMode, asOfYear],
  );
  const displayAnalysis: HouseholdAnalysis = useMemo(
    () =>
      dollarsMode === 'nominal'
        ? { ...analysis, combinedTimeline: displayTimeline, comparisons: displayComparisons }
        : analysis,
    [analysis, dollarsMode, displayTimeline, displayComparisons],
  );
  // The chart's own series — monthly, not the annual `displayTimeline`
  // above. Built from `analysis.periods` (the raw engine bands) via
  // `buildMonthlyIncomeSeries`, then through the SAME dollars-mode decision
  // as every other derived value here, via `toNominalMonthly` rather than
  // `toNominal` (which has no field for `monthIndex` and would silently drop
  // it — see `dollarsMode.ts`).
  const displayMonthlySeries = useMemo(() => {
    const monthly = buildMonthlyIncomeSeries(
      analysis.periods,
      analysis.people.map((p) => p.person),
    );
    return dollarsMode === 'nominal' ? toNominalMonthly(monthly, annualCola, asOfYear) : monthly;
  }, [analysis, annualCola, dollarsMode, asOfYear]);

  return (
    <div className="results">
      <div className="recommendation-card">
        <span className="rec-label">Household — {scenarioEyebrow(analysis.scenarioIsBest)}</span>
        <h2 data-testid="recommendation-title">{analysis.recommendation}</h2>
        <p>{analysis.recommendationDetail}</p>
      </div>

      <StrategyComparisonTable
        comparisons={displayComparisons}
        allComparisons={displayAllComparisons}
        people={people}
        survivorGap={analysis.survivorGap}
        dollarsMode={dollarsMode}
        scenarios={scenarios}
        onScenariosChange={onScenariosChange}
        filingAgeOptions={analysis.filingAgeOptions}
      />

      <CombinedIncomeChart
        monthlySeries={displayMonthlySeries}
        people={people}
        survivorGap={analysis.survivorGap}
        finalIndexByPersonId={analysis.finalIndexByPersonId}
        dollarsMode={dollarsMode}
        onDollarsModeChange={onDollarsModeChange}
      />

      <IncomeCliffCallout analysis={displayAnalysis} dollarsMode={dollarsMode} />

      {/* Not `displayAnalysis`: `survivorClaim`'s figures come straight from
          the engine's bands (real dollars, no COLA applied), exactly like
          `analysis.periods` itself, and are untouched by the dollars-mode
          transform that only rewrites `combinedTimeline`/`comparisons` above
          — so this reads the same field either way. Using `analysis` here
          says so directly rather than implying a mode-dependence that isn't
          there. `dollarsMode` IS still passed through, separately — not to
          transform the figure, but so the note can decide whether stating
          its (unchanging) dollars basis would repeat what the callout above
          already said (real mode) or is the one time that disclosure is
          needed (nominal mode). */}
      <SurvivorClaimNote analysis={analysis} dollarsMode={dollarsMode} />

      <BreakEvenSection
        breakEvens={breakEvens}
        lifeExpectancy={personA.person.lifeExpectancy}
        attributedTo={personLabel(personA.person.name, 0)}
      />
    </div>
  );
}
