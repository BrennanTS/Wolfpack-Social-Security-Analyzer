import { useEffect, useRef, useState } from 'react';
import { usePageScrollLock } from '../hooks/usePageScrollLock';
import { ReportLayoutEditor } from './ReportLayoutEditor';
import { ReportPreview } from './ReportPreview';
import type { HouseholdAnalysis, HouseholdDisplayShape } from '../lib/household';
import type { ClaimingRow } from '../lib/claimingRows';
import type { LongevitySensitivity } from '../lib/longevity';
import type { SolvencySensitivity } from '../lib/solvency';
import type { useReportLayouts } from '../hooks/useReportLayouts';
import type { ReportBlockId } from '../lib/reportLayout';
import type { ReportTheme } from '../lib/reportTheme';

/**
 * The layout editor, with room to work.
 *
 * In the menu the editor shared a 420px drawer with the theme picker, which
 * left fifteen blocks stacked in a column and the palette of what to add
 * pushed below the fold. A dialog gives it the width to put the report on one
 * side and everything not in it on the other — which is how the two lists are
 * actually used, one dragging into the other.
 *
 * Rendered above everything rather than inside the drawer: it is a task an
 * adviser finishes and leaves, not a setting they flick.
 */
export function LayoutEditorDialog({
  open,
  onClose,
  layouts,
  shape,
  preview,
}: {
  open: boolean;
  onClose: () => void;
  layouts: ReturnType<typeof useReportLayouts>;
  shape?: HouseholdDisplayShape;
  /**
   * Everything the report is built from. Absent until the inputs are
   * complete, in which case the layout is still editable — there is simply
   * nothing to preview yet.
   */
  preview?: {
    analysis: HouseholdAnalysis;
    claimingRowsByPerson: Record<string, ClaimingRow[]>;
    gridTarget?: { on: boolean; percent: number };
    sensitivity?: LongevitySensitivity | null;
  solvency?: SolvencySensitivity | null;
    theme: ReportTheme;
  };
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Which page each block starts on, measured by the preview as it renders
  // and handed to the editor for its row labels. Held here because it
  // travels between the two halves of the dialog.
  const [pages, setPages] = useState<ReadonlyMap<ReportBlockId, number>>(new Map());

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    // Focus moves into the dialog, so the next Tab lands inside it rather
    // than back on the page behind.
    if (open) panel.current?.focus();
  }, [open]);

  usePageScrollLock(open);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="drawer-backdrop drawer-backdrop-dialog"
        onClick={onClose}
        aria-label="Close layout editor"
      />
      <div
        className="layout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="layout-dialog-title"
        ref={panel}
        tabIndex={-1}
      >
        <header className="layout-dialog-header">
          <div>
            <h2 id="layout-dialog-title">Report layout</h2>
            <p>
              What the exported PDF contains, in what order, and where its pages break. Drag a
              block to move it, or in from the right to add it. Each block says which page it
              starts on.
            </p>
          </div>
          <button type="button" className="btn-panel-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="layout-dialog-body">
          <ReportLayoutEditor {...layouts} shape={shape} wide blockPages={pages} />
          {preview ? (
            <ReportPreview {...preview} layout={layouts.layout} onPages={setPages} />
          ) : (
            <div className="report-preview">
              <div className="report-preview-head">
                <span className="report-preview-title">Preview</span>
              </div>
              <div className="report-preview-frame">
                <p className="report-preview-empty">
                  Fill in the dates and benefit amounts to see the report.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
