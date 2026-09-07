import type { ClaimingRow } from './claimingRows';
import { reportTheme, type ReportTheme } from './reportTheme';
import type { ReportLayout } from './reportLayout';
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
 * The report as it printed before layouts, kept while advisers move across.
 *
 * `claimingRowsByPerson` is the SAME array the screen renders, built once in
 * `Analyzer` — not rebuilt here. An adviser who hides a claiming age for a
 * meeting and then exports must not find it back in the report, and two
 * builders would eventually disagree about which rows a table has.
 *
 * `gridTarget` travels for the same reason: the printed claiming grid must
 * outline the near-best region the adviser had dialed in, not a default.
 */
export async function downloadLegacyPdfReport(
  analysis: HouseholdAnalysis,
  claimingRowsByPerson: Record<string, ClaimingRow[]> = {},
  gridTarget?: { on: boolean; percent: number },
  theme?: ReportTheme,
): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer');
  const { setActiveReportTheme } = await import('../components/pdf/theme');
  // Before the document is imported OR built: the stylesheet is rebuilt here,
  // and a section that had already captured `styles` would print the old one.
  // A whole theme rather than an id: the editor previews and exports drafts
  // that are not in the registry at all, and `reportTheme` could only ever
  // hand back a preset.
  setActiveReportTheme(theme ?? reportTheme(undefined));
  const { LegacyReportDocument } = await import('../components/pdf/LegacyReportDocument');

  const blob = await pdf(
    <LegacyReportDocument
      analysis={analysis}
      claimingRowsByPerson={claimingRowsByPerson}
      gridTarget={gridTarget}
    />,
  ).toBlob();

  save(blob, reportFilename('-legacy'));
}

/**
 * The report, composed from the adviser's layout.
 *
 * Same analysis and the same engine as `downloadLegacyPdfReport`, arranged by
 * whichever layout is selected rather than by a fixed order in the code.
 *
 * `sensitivity` is computed by the caller and passed in rather than derived
 * here: it needs the household and the assumptions, which a
 * `HouseholdAnalysis` does not carry, and it is asynchronous, which a render
 * is not. Passing null simply omits the longevity page rather than failing
 * the export.
 */
export async function downloadPdfReport(
  analysis: HouseholdAnalysis,
  claimingRowsByPerson: Record<string, ClaimingRow[]> = {},
  gridTarget?: { on: boolean; percent: number },
  sensitivity?: LongevitySensitivity | null,
  theme?: ReportTheme,
  layout?: ReportLayout,
): Promise<void> {
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
      layout={layout}
    />,
  ).toBlob();

  save(blob, reportFilename());
}
