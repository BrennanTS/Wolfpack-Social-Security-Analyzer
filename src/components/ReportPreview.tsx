import { useEffect, useRef, useState } from 'react';
import type { HouseholdAnalysis } from '../lib/household';
import type { ClaimingRow } from '../lib/claimingRows';
import type { LongevitySensitivity } from '../lib/longevity';
import type { ReportBlockId, ReportLayout } from '../lib/reportLayout';
import type { ReportTheme } from '../lib/reportTheme';

/** How long to wait after the last edit before rendering. */
const SETTLE_MS = 250;

/**
 * Whether this browser can display a PDF in a frame at all.
 *
 * Chrome, Edge and Safari can; a browser with the PDF viewer disabled by
 * policy cannot, and paints an empty white box instead of failing — which
 * would read as "the report is blank" rather than "this browser will not show
 * it here". Older browsers do not report the flag, and those are given the
 * benefit of the doubt rather than a warning they may not need.
 */
function canShowPdfInline(): boolean {
  if (typeof navigator === 'undefined') return false;
  const flag = (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled;
  return flag === undefined ? true : flag;
}

interface Props {
  analysis: HouseholdAnalysis;
  claimingRowsByPerson: Record<string, ClaimingRow[]>;
  gridTarget?: { on: boolean; percent: number };
  sensitivity?: LongevitySensitivity | null;
  theme: ReportTheme;
  layout: ReportLayout;
  /**
   * Called with the page each block starts on, after every render.
   *
   * The editor labels its rows with these. It cannot work them out for
   * itself: which sheet a block lands on is decided by the layout pass, and
   * one long table above moves everything after it.
   */
  onPages?: (pages: ReadonlyMap<ReportBlockId, number>) => void;
}

/**
 * The real report, rendered as the layout is edited.
 *
 * The same `pdf()` call the export button makes, on the same document, so
 * this cannot show something the exported file will not. That is the whole
 * reason it is a live render rather than a set of drawn thumbnails: a picture
 * of a section is a claim about what the section looks like, and it would
 * start drifting from the truth the first time a block's content changed.
 *
 * Affordable because the report is quick — around 270ms for the client
 * layout and 430ms for the full ten-page one — so a debounce longer than a
 * drag is enough to keep the editor responsive while the preview keeps up.
 */
export function ReportPreview({
  analysis,
  claimingRowsByPerson,
  gridTarget,
  sensitivity,
  theme,
  layout,
  onPages,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [failed, setFailed] = useState(false);
  const [inlineOk] = useState(canShowPdfInline);
  // Every object URL this component has made, so none outlives it.
  const current = useRef<string | null>(null);

  useEffect(() => {
    // Nothing to build if it could not be shown — rendering a PDF every
    // keystroke to paint a white rectangle is worse than saying so.
    if (!inlineOk) return;
    let canceled = false;
    setRendering(true);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { pdf } = await import('@react-pdf/renderer');
          const { setActiveReportTheme } = await import('./pdf/theme');
          // Before the document is built, exactly as `printReport` does it:
          // the stylesheet is rebuilt here, and a section that had already
          // captured `styles` would render in the previous theme.
          setActiveReportTheme(theme);
          const { ReportDocument } = await import('./pdf/ReportDocument');
          // Filled as the document renders, and only then complete: which
          // sheet a block lands on is decided by the layout pass, not by the
          // layout list. A fresh map each time, so a block that has since
          // been removed cannot leave a page behind.
          const landed = new Map<ReportBlockId, number>();
          const blob = await pdf(
            <ReportDocument
              analysis={analysis}
              claimingRowsByPerson={claimingRowsByPerson}
              gridTarget={gridTarget}
              sensitivity={sensitivity}
              layout={layout}
              onBlockPage={(id, page) => landed.set(id, page)}
            />,
          ).toBlob();
          if (canceled) return;
          report.current?.(landed);
          const next = URL.createObjectURL(blob);
          // Revoked only once the new one is in hand, so the frame never
          // points at a URL that has just been freed.
          if (current.current !== null) URL.revokeObjectURL(current.current);
          current.current = next;
          setUrl(next);
          setFailed(false);
        } catch {
          if (!canceled) setFailed(true);
        } finally {
          if (!canceled) setRendering(false);
        }
      })();
    }, SETTLE_MS);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [analysis, claimingRowsByPerson, gridTarget, sensitivity, theme, layout, inlineOk]);

  // Held in a ref so a caller passing an inline function does not re-render
  // the whole report on every keystroke somewhere else in the dialog.
  const report = useRef(onPages);
  report.current = onPages;

  // On unmount only — the effect above frees each URL as it replaces it.
  useEffect(
    () => () => {
      if (current.current !== null) URL.revokeObjectURL(current.current);
    },
    [],
  );

  return (
    <div className="report-preview">
      <div className="report-preview-head">
        <span className="report-preview-title">Preview</span>
        {/* The old render stays on screen while the next one is built, so the
            panel never blinks empty mid-drag. This says it is catching up. */}
        <span className="report-preview-status" aria-live="polite">
          {!inlineOk ? '' : failed ? 'Could not render' : rendering ? 'Updating…' : ''}
        </span>
      </div>
      <div className="report-preview-frame">
        {!inlineOk ? (
          <p className="report-preview-empty">
            This browser will not display a PDF here. The layout still works. Export the
            report to see it.
          </p>
        ) : url === null ? (
          <p className="report-preview-empty">
            {failed ? 'This layout could not be rendered.' : 'Building the report…'}
          </p>
        ) : (
          // No `#page=` here, however tempting. The viewer is a plugin, not a
          // document: given a blob URL carrying a page fragment it renders
          // nothing at all — measured, both as a fresh load and as a change to
          // an already-loaded frame — and a fragment changed underneath it
          // moves nothing. The editor names the page instead of going to it.
          <iframe
            src={`${url}#toolbar=0&navpanes=0&view=FitH`}
            title="Report preview"
            className={rendering ? 'is-stale' : ''}
          />
        )}
      </div>
    </div>
  );
}
