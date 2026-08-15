/**
 * The optional-chart toggle set shared between `OptionalChartsPanel` and its
 * caller (`PersonPanel`, one instance per person).
 *
 * Kept out of `OptionalChartsPanel.tsx` deliberately: a component file that
 * exports a non-component constant alongside its component trips oxlint's
 * `react/only-export-components` (React Fast Refresh) rule, since the
 * `Record<ChartKey, boolean>` object literal isn't treated as a
 * refresh-safe "constant export" the way a primitive would be.
 */

export type ChartKey =
  | 'monthlyBar'
  | 'lifetimeBar'
  | 'colaProjection'
  | 'lifetimeHeatmap'
  | 'opportunityCost'
  | 'monthlyRamp';

/** All charts start hidden. */
export const DEFAULT_CHART_VISIBILITY: Record<ChartKey, boolean> = {
  monthlyBar: false,
  lifetimeBar: false,
  colaProjection: false,
  lifetimeHeatmap: false,
  opportunityCost: false,
  monthlyRamp: false,
};
