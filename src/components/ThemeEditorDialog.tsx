import { useEffect, useRef } from 'react';
import { usePageScrollLock } from '../hooks/usePageScrollLock';
import { ReportThemeEditor } from './ReportThemeEditor';
import { ReportPreview } from './ReportPreview';
import type { HouseholdAnalysis } from '../lib/household';
import type { ClaimingRow } from '../lib/claimingRows';
import type { LongevitySensitivity } from '../lib/longevity';
import type { SolvencySensitivity } from '../lib/solvency';
import type { ReportLayout } from '../lib/reportLayout';
import type { useReportThemes } from '../hooks/useReportThemes';

/**
 * The theme editor, beside the report it changes.
 *
 * The same shape as the layout dialog on purpose: an adviser who has arranged
 * one report should not have to learn a second set of habits to color it. The
 * preview is the point — a hex in a text box tells you nothing about what a
 * client will be holding, and the two decisions people actually get wrong,
 * brand color on white and the heat ramp, are only visible on the page.
 */
export function ThemeEditorDialog({
  open,
  onClose,
  themes,
  preview,
}: {
  open: boolean;
  onClose: () => void;
  themes: ReturnType<typeof useReportThemes>;
  /** Everything the report is built from, absent until the inputs are complete. */
  preview?: {
    analysis: HouseholdAnalysis;
    claimingRowsByPerson: Record<string, ClaimingRow[]>;
    gridTarget?: { on: boolean; percent: number };
    sensitivity?: LongevitySensitivity | null;
  solvency?: SolvencySensitivity | null;
    layout: ReportLayout;
  };
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
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
        aria-label="Close theme editor"
      />
      <div
        className="layout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-dialog-title"
        ref={panel}
        tabIndex={-1}
      >
        <header className="layout-dialog-header">
          <div>
            <h2 id="theme-dialog-title">Report theme</h2>
            <p>
              The colors and the name the exported PDF is printed with. Changes show in the
              preview as you make them.
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
          <ReportThemeEditor {...themes} />
          {preview ? (
            <ReportPreview {...preview} theme={themes.theme} />
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
