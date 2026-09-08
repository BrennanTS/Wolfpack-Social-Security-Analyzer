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

/** Every key, in the order the panel lists them. */
export const CHART_KEYS: readonly ChartKey[] = [
  'lifetimeHeatmap',
  'opportunityCost',
  'monthlyRamp',
  'monthlyBar',
  'lifetimeBar',
  'colaProjection',
];

export type ChartVisibility = Record<ChartKey, boolean>;

/** Which optional charts each person is showing, keyed by person id. */
export type ChartsByPerson = Record<string, ChartVisibility>;

export function chartsFor(charts: ChartsByPerson, personId: string): ChartVisibility {
  return charts[personId] ?? DEFAULT_CHART_VISIBILITY;
}

export function withChartsFor(
  charts: ChartsByPerson,
  personId: string,
  next: ChartVisibility,
): ChartsByPerson {
  return { ...charts, [personId]: next };
}

export function toggleChart(visibility: ChartVisibility, key: ChartKey): ChartVisibility {
  return { ...visibility, [key]: !visibility[key] };
}

/**
 * The charts that are on, as a comma list.
 *
 * Written in `CHART_KEYS` order rather than click order, because this string
 * is compared: the whole view is serialized to decide what to remember and
 * what a saved client holds, and two identical screens reached by different
 * clicks have to produce the same text.
 *
 * Empty when nothing is on, which is the default, so an ordinary link carries
 * no chart parameter at all.
 */
export function encodeCharts(visibility: ChartVisibility): string {
  return CHART_KEYS.filter((key) => visibility[key]).join(',');
}

/**
 * A chart list from a URL, or null when it names nothing this app has.
 *
 * Unknown names are dropped rather than rejecting the whole list: these are
 * chart ids, and one retired between the writing of a link and its opening
 * should cost that chart, not the other five.
 */
export function decodeCharts(raw: string | null): ChartVisibility | null {
  if (raw === null) return null;
  const wanted = new Set(raw.split(',').map((part) => part.trim()));
  const on = CHART_KEYS.filter((key) => wanted.has(key));
  if (on.length === 0) return null;
  return { ...DEFAULT_CHART_VISIBILITY, ...Object.fromEntries(on.map((key) => [key, true])) };
}
