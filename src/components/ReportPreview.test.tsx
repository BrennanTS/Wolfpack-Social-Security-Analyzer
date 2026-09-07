import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportPreview } from './ReportPreview';
import { CLIENT_LAYOUT } from '../lib/reportLayout';
import type { HouseholdAnalysis } from '../lib/household';

/**
 * These cover the paths that do NOT reach react-pdf.
 *
 * Rendering a real PDF is exercised end to end in a browser instead — jsdom
 * has no PDF viewer and no canvas, so a test here that "renders the preview"
 * would prove only that a promise resolved.
 */
function setPdfViewer(enabled: boolean | undefined) {
  Object.defineProperty(navigator, 'pdfViewerEnabled', {
    value: enabled,
    configurable: true,
  });
}

const props = {
  analysis: {} as HouseholdAnalysis,
  claimingRowsByPerson: {},
  themeId: 'wolfpack',
  layout: CLIENT_LAYOUT,
};

afterEach(() => {
  setPdfViewer(true);
  vi.restoreAllMocks();
});

describe('ReportPreview', () => {
  it('says so when the browser will not show a PDF inline', () => {
    // Otherwise the panel is an empty white rectangle, which reads as "the
    // report is blank" rather than "this browser will not show it here".
    setPdfViewer(false);
    render(<ReportPreview {...props} />);
    expect(screen.getByText(/will not display a pdf here/i)).toBeInTheDocument();
    expect(screen.queryByTitle('Report preview')).not.toBeInTheDocument();
  });

  it('points at the export as the way to see it anyway', () => {
    setPdfViewer(false);
    render(<ReportPreview {...props} />);
    expect(screen.getByText(/export the report/i)).toBeInTheDocument();
  });

  it('does not try to render when it could not be shown', () => {
    // A PDF built on every edit to paint a white box costs half a second of
    // work per keystroke and shows nothing for it.
    setPdfViewer(false);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    render(<ReportPreview {...props} />);
    expect(timeout).not.toHaveBeenCalled();
  });

  it('gives browsers that do not report the flag the benefit of the doubt', () => {
    // `pdfViewerEnabled` is recent; an older browser that omits it can very
    // likely still show one, and a warning it does not need is worse.
    setPdfViewer(undefined);
    render(<ReportPreview {...props} />);
    expect(screen.queryByText(/will not display a pdf here/i)).not.toBeInTheDocument();
  });

  it('shows it is working before the first render lands', () => {
    render(<ReportPreview {...props} />);
    expect(screen.getByText(/building the report/i)).toBeInTheDocument();
  });
});
