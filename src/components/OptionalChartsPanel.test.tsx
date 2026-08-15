import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OptionalChartsPanel, type ChartKey } from './OptionalChartsPanel';
import type { AnalysisResult, UserInputs } from '../lib/socialSecurity';

/**
 * Regression guard for the deleted `spousalSurvivor` chart (it rendered the
 * worker's own benefit relabeled as "survivor benefit" — a claim Phase 1
 * deletes rather than carries forward; see task-17-report.md). This is a
 * runtime guard, not a type-level one: `*.test.tsx` files are excluded from
 * `tsconfig.app.json` (see its `exclude`), so `npm run build`'s `tsc -b`
 * never typechecks this file, and `vitest run` does not typecheck by
 * default either — a `Record<ChartKey, boolean>` mismatch here would not
 * fail either command. The two tests below fail for real, at runtime,
 * regardless of that: the panel always renders every chart section's
 * title/description (`ToggleChartSection` shows `title`/`description`
 * regardless of `visible` — see ToggleChartSection.tsx), so asserting no
 * "survivor" text and an exact section count catches a reintroduced
 * survivor chart even if it were renamed.
 */
const claimingOptions = [62, 67, 70].map((age) => ({
  age,
  monthlyBenefit: age === 62 ? 1680 : age === 67 ? 2400 : 2976,
  percentOfPia: age === 62 ? 70 : age === 67 ? 100 : 124,
  lifetimeBenefits: 100_000,
  yearsOfPayments: 0,
  isEligible: true,
  monthsFromFra: 0,
}));

// OptionalChartsPanel only reads claimingOptions/optimalAge off `result` and
// lifeExpectancy/annualCola off `inputs` — the rest of the legacy
// AnalysisResult/UserInputs shape is unused here, so it's cast rather than
// fully constructed (same pattern as PersonPanel.test.tsx).
const result = { claimingOptions, optimalAge: 70 } as unknown as AnalysisResult;
const inputs = { lifeExpectancy: 85, annualCola: 2.5, hasSpouse: true } as unknown as UserInputs;

const visibility: Record<ChartKey, boolean> = {
  monthlyBar: false,
  lifetimeBar: false,
  colaProjection: false,
  lifetimeHeatmap: false,
  opportunityCost: false,
  monthlyRamp: false,
};

describe('OptionalChartsPanel', () => {
  it('never offers a survivor chart, even for a married household', () => {
    render(
      <OptionalChartsPanel result={result} inputs={inputs} visibility={visibility} onToggle={() => {}} />,
    );
    expect(screen.queryByText(/survivor/i)).toBeNull();
  });

  it('renders exactly the six non-survivor optional chart sections', () => {
    render(
      <OptionalChartsPanel result={result} inputs={inputs} visibility={visibility} onToggle={() => {}} />,
    );
    // The intro "Optional Visualizations" h3 plus one h3 per ToggleChartSection.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7);
  });
});
