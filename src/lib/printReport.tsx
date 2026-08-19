import type { ClaimingRow } from './claimingRows';
import type { HouseholdAnalysis } from './household';

function reportFilename(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `Social-Security-Analysis-${date}.pdf`;
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
 * outline the near-best region the adviser had dialled in, not a default.
 */
export async function downloadPdfReport(
  analysis: HouseholdAnalysis,
  claimingRowsByPerson: Record<string, ClaimingRow[]> = {},
  gridTarget?: { on: boolean; percent: number },
): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer');
  const { ReportDocument } = await import('../components/pdf/ReportDocument');

  const blob = await pdf(
    <ReportDocument
      analysis={analysis}
      claimingRowsByPerson={claimingRowsByPerson}
      gridTarget={gridTarget}
    />,
  ).toBlob();

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = reportFilename();
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
