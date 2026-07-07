import type { AnalysisResult, UserInputs } from '../lib/socialSecurity';
import { formatCurrency } from '../lib/socialSecurity';
import {
  ColaProjectionChart,
  LifetimeBarChart,
  LifetimeHeatmapChart,
  MonthlyBenefitBarChart,
  MonthlyRampChart,
  OpportunityCostChart,
  SpousalSurvivorChart,
} from './OptionalCharts';
import { ToggleChartSection } from './ToggleChartSection';

export type ChartKey =
  | 'monthlyBar'
  | 'lifetimeBar'
  | 'colaProjection'
  | 'spousalSurvivor'
  | 'lifetimeHeatmap'
  | 'opportunityCost'
  | 'monthlyRamp';

interface OptionalChartsPanelProps {
  result: AnalysisResult;
  inputs: UserInputs;
  visibility: Record<ChartKey, boolean>;
  onToggle: (key: ChartKey) => void;
}

export function OptionalChartsPanel({
  result,
  inputs,
  visibility,
  onToggle,
}: OptionalChartsPanelProps) {
  const { claimingOptions, optimalAge, spousal } = result;
  const optimal = claimingOptions.find((o) => o.age === optimalAge)!;
  const { lifeExpectancy, annualCola, hasSpouse } = inputs;

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
        description={`Projected lifetime benefits through age ${lifeExpectancy} with ${annualCola}% COLA.`}
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

      <ToggleChartSection
        title="Spousal & Survivor Benefits"
        description={
          hasSpouse
            ? `Survivor benefit equals your monthly amount. Spousal benefit at FRA is ${formatCurrency(spousal?.spousalBenefitAtFra ?? 0)} (50% of your PIA).`
            : 'Enable "Married" in your profile to view spousal and survivor projections.'
        }
        visible={visibility.spousalSurvivor}
        onToggle={() => onToggle('spousalSurvivor')}
        disabled={!hasSpouse}
      >
        {hasSpouse && spousal && (
          <SpousalSurvivorChart
            options={claimingOptions}
            spousalAtFra={spousal.spousalBenefitAtFra}
            optimalAge={optimalAge}
          />
        )}
      </ToggleChartSection>
      </div>
    </div>
  );
}
