import type { ClaimingRow } from './claimingRows';
import { reportTheme, type ReportTheme } from './reportTheme';
import type { ReportLayout } from './reportLayout';
import type { HouseholdAnalysis } from './household';
import type { LongevitySensitivity } from './longevity';
import type { SolvencySensitivity } from './solvency';

function reportFilename(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `Social-Security-Analysis-${date}.pdf`;
}

/** Hand a rendered blob to the browser as a download. */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The report, composed from the adviser's layout.
 *
 * Arranged by whichever layout is selected rather than by a fixed order in
 * the code.
 *
 * `sensitivity` and `solvency` are computed by the caller and passed in
 * rather than derived here. The first needs the household and the
 * assumptions, which a `HouseholdAnalysis` does not carry, and it is
 * asynchronous, which a render is not; the second needs an assumption that
 * belongs to the adviser rather than to the analysis. Passing null for either
 * simply omits that page rather than failing the export.
 *
 * One object rather than seven positional arguments: two of them are
 * optional booleans-in-disguise and three are optional objects, which is
 * exactly the shape that produces a silent argument-order bug.
 */
export interface ReportInputs {
  analysis: HouseholdAnalysis;
  /**
   * Each person's benefit-by-claiming-age rows, the SAME arrays the screen
   * renders. An adviser who hid a row for a meeting must not find it back in
   * the report.
   */
  claimingRowsByPerson?: Record<string, ClaimingRow[]>;
  gridTarget?: { on: boolean; percent: number };
  sensitivity?: LongevitySensitivity | null;
  solvency?: SolvencySensitivity | null;
  theme?: ReportTheme;
  layout?: ReportLayout;
}

export async function downloadPdfReport({
  analysis,
  claimingRowsByPerson = {},
  gridTarget,
  sensitivity,
  solvency,
  theme,
  layout,
}: ReportInputs): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer');
  const { setActiveReportTheme } = await import('../components/pdf/theme');
  // A whole theme rather than an id: the editor previews and exports drafts
  // that are not in the registry at all, and `reportTheme` could only ever
  // hand back a preset.
  setActiveReportTheme(theme ?? reportTheme(undefined));
  const { ReportDocument } = await import('../components/pdf/ReportDocument');

  const blob = await pdf(
    <ReportDocument
      analysis={analysis}
      claimingRowsByPerson={claimingRowsByPerson}
      gridTarget={gridTarget}
      sensitivity={sensitivity}
      solvency={solvency}
      layout={layout}
    />,
  ).toBlob();

  save(blob, reportFilename());
}
