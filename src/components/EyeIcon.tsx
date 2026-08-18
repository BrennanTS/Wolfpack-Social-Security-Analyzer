/**
 * Eye / eye-off, inline rather than from an icon font — this app ships no
 * icon set, and the header buttons already draw their own SVG the same way.
 *
 * Drawn rather than typed as `◉`/`⦸`, which is what these were first: the
 * filled circle reads as a selected radio button, and the rows beside it
 * genuinely do carry a "which one drives the report" choice, so the two were
 * competing for the same meaning.
 *
 * One component for both editable tables — the household comparison table and
 * each person's benefit-by-claiming-age table — so the control that means
 * "hide this row on both surfaces" looks the same wherever it appears.
 */
export function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8S3.9 3.9 8 3.9 14.5 8 14.5 8 12.1 12.1 8 12.1 1.5 8 1.5 8z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.1" />
      {!open && (
        <path d="M2.6 13.4 13.4 2.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      )}
    </svg>
  );
}
