import type { HouseholdAnalysis } from './household';

function reportFilename(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `Social-Security-Analysis-${date}.pdf`;
}

/** Generate and download a PDF without using the browser print dialog. */
export async function downloadPdfReport(analysis: HouseholdAnalysis): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer');
  const { ReportDocument } = await import('../components/pdf/ReportDocument');

  const blob = await pdf(<ReportDocument analysis={analysis} />).toBlob();

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
