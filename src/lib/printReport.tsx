import type { ClaimingRow } from './claimingRows';
import { reportTheme } from './reportTheme';
import type { HouseholdAnalysis } from './household';
import type { LongevitySensitivity } from './longevity';

function reportFilename(suffix = ''): string {
  const date = new Date().toISOString().slice(0, 10);
  return `Social-Security-Analysis-${date}${suffix}.pdf`;
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
 * Generate and download a PDF without using the browser print dialog.
 *
 * `claimingRowsByPerson` is the SAME array the screen renders, built once in
 * `Analyzer` — not rebuilt here. An adviser who hides a claiming age for a
 * meeting and then exports must not find it back in the report, and two
 * builders would eventually disagree about which rows a table has.
 *
 * `gridTarget` travels for the same reason: the printed claiming grid must
 * outline the near-best region the adviser had dialed in, not a default.
 */
export async function downloadPdfReport(
  analysis: HouseholdAnalysis,
  claimingRowsByPerson: Record<string, ClaimingRow[]> = {},
  gridTarget?: { on: boolean; percent: number },
  themeId?: string,
): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer');
  const { setActiveReportTheme } = await import('../components/pdf/theme');
  // Before the document is imported OR built: the stylesheet is rebuilt here,
  // and a section that had already captured `styles` would print the old one.
  setActiveReportTheme(reportTheme(themeId));
  const { ReportDocument } = await import('../components/pdf/ReportDocument');

  const blob = await pdf(
    <ReportDocument
      analysis={analysis}
      claimingRowsByPerson={claimingRowsByPerson}
      gridTarget={gridTarget}
    />,
  ).toBlob();

  save(blob, reportFilename());
}

/**
 * The beta report. Same analysis and the same engine as
 * `downloadPdfReport` — a different document composed from it.
 *
 * `sensitivity` is computed by the caller and passed in rather than derived
 * here: it needs the household and the assumptions, which a
 * `HouseholdAnalysis` does not carry, and it is asynchronous, which a render
 * is not. Passing null simply omits the longevity page rather than failing
 * the export.
 */
export async function downloadBetaPdfReport(
  analysis: HouseholdAnalysis,
  claimingRowsByPerson: Record<string, ClaimingRow[]> = {},
  gridTarget?: { on: boolean; percent: number },
  sensitivity?: LongevitySensitivity | null,
  themeId?: string,
): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer');
  const { setActiveReportTheme } = await import('../components/pdf/theme');
  setActiveReportTheme(reportTheme(themeId));
  const { BetaReportDocument } = await import('../components/pdf/BetaReportDocument');

  const blob = await pdf(
    <BetaReportDocument
      analysis={analysis}
      claimingRowsByPerson={claimingRowsByPerson}
      gridTarget={gridTarget}
      sensitivity={sensitivity}
    />,
  ).toBlob();

  save(blob, reportFilename('-beta'));
}
