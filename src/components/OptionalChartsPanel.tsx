import type { ClaimingOption } from '../lib/benefitMath';
import type { ChartKey } from '../lib/chartVisibility';
import {
  ColaProjectionChart,
  LifetimeBarChart,
  LifetimeHeatmapChart,
  MonthlyBenefitBarChart,
  MonthlyRampChart,
  OpportunityCostChart,
} from './OptionalCharts';
import { ToggleChartSection } from './ToggleChartSection';

export type { ChartKey };

interface OptionalChartsPanelProps {
  claimingOptions: ClaimingOption[];
  optimalAge: number;
  lifeExpectancy: number;
  annualCola: number;
  visibility: Record<ChartKey, boolean>;
  onToggle: (key: ChartKey) => void;
}

/**
 * Per-person optional chart gallery — takes plain `PersonAnalysis`-derived
 * values (`claimingOptions`, `optimalAge`, `lifeExpectancy`, `annualCola`)
 * rather than a household-level shape, so it has no dependency on
 * `household.ts`. Rendered once per person, inside `PersonPanel`.
 */
export function OptionalChartsPanel({
  claimingOptions,
  optimalAge,
  lifeExpectancy,
  annualCola,
  visibility,
  onToggle,
}: OptionalChartsPanelProps) {
  const optimal = claimingOptions.find((o) => o.age === optimalAge)!;

  return (
    <div className="optional-charts">
      <div className="optional-charts-intro">
        <h3>Optional Visualizations</h3>
        <p>Click the eye icon to show or hide additional charts. The PDF report includes the heatmap and summary charts.</p>
      </div>

      <div className="optional-charts-list">
      <ToggleChartSection
        title="Lifetime Benefit Heatmap"
        description="Cumulative benefits by claiming age (rows) and living age (columns). Darker colors = more total received."
        visible={visibility.lifetimeHeatmap}
        onToggle={() => onToggle('lifetimeHeatmap')}
        className="chart-span-full"
      >
        <LifetimeHeatmapChart
          options={claimingOptions}
          lifeExpectancy={lifeExpectancy}
          optimalAge={optimalAge}
          annualCola={annualCola}
        />
      </ToggleChartSection>

      <ToggleChartSection
        title="Opportunity Cost vs. Optimal"
        description={`How much lifetime income you leave on the table by claiming before or after age ${optimalAge}.`}
        visible={visibility.opportunityCost}
        onToggle={() => onToggle('opportunityCost')}
      >
        <OpportunityCostChart options={claimingOptions} optimalAge={optimalAge} />
      </ToggleChartSection>

      <ToggleChartSection
        title="Monthly Benefit Ramp (62–70)"
        description="How your monthly check grows for each year you delay — includes % of PIA and boost vs. claiming at 62."
        visible={visibility.monthlyRamp}
        onToggle={() => onToggle('monthlyRamp')}
      >
        <MonthlyRampChart options={claimingOptions} optimalAge={optimalAge} />
      </ToggleChartSection>

      <ToggleChartSection
        title="Monthly Benefit by Claiming Age"
        description="Side-by-side comparison of your monthly check at each age from 62 to 70."
        visible={visibility.monthlyBar}
        onToggle={() => onToggle('monthlyBar')}
      >
        <MonthlyBenefitBarChart options={claimingOptions} optimalAge={optimalAge} />
      </ToggleChartSection>

      <ToggleChartSection
        title="Lifetime Total by Claiming Age"
        // Same `claimingOptions.lifetimeBenefits` figures the PDF's benefit
        // table describes: `lifetimeNpvToAge` sums the engine's own periods,
        // which carry no projected COLA. Screen and print used to agree here
        // and both be wrong; correcting only print would leave them
        // disagreeing about identical numbers.
        description={`Total benefits received through age ${lifeExpectancy}, in today’s dollars before any future cost-of-living adjustment, undiscounted.`}
        visible={visibility.lifetimeBar}
        onToggle={() => onToggle('lifetimeBar')}
      >
        <LifetimeBarChart options={claimingOptions} optimalAge={optimalAge} />
      </ToggleChartSection>

      <ToggleChartSection
        title="COLA Growth Projection"
        description={`How your monthly benefit grows from age ${optimalAge} to ${lifeExpectancy} at ${annualCola}% annual COLA.`}
        visible={visibility.colaProjection}
        onToggle={() => onToggle('colaProjection')}
      >
        <ColaProjectionChart
          claimAge={optimalAge}
          monthlyBenefit={optimal.monthlyBenefit}
          lifeExpectancy={lifeExpectancy}
          annualCola={annualCola}
        />
      </ToggleChartSection>
      </div>
    </div>
  );
}
