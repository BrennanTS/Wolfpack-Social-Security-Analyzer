import { useEffect, useState } from 'react';
import { buildShareUrl } from '../lib/shareLink';
import type { AnalyzerFormState } from '../lib/formState';

interface CopyLinkButtonProps {
  form: AnalyzerFormState;
  disabled: boolean;
}

/**
 * Builds a shareable URL on demand (never tracked in the address bar as the
 * form is edited) and copies it to the clipboard.
 *
 * `navigator.clipboard.writeText` can reject — insecure context, denied
 * permission — and a silent failure here is worse than no button at all: an
 * adviser who thinks they copied a link may paste stale clipboard contents
 * into an email instead. On failure, the URL is shown in a read-only,
 * pre-selected input so it can still be copied by hand.
 *
 * That panel is captured at click time, so it must not outlive the state it
 * encodes. It is cleared whenever the form changes and can be dismissed by
 * hand — otherwise a URL carrying the client's date of birth and benefit sits
 * in the header for the rest of the session, and goes stale the moment the
 * adviser edits anything, showing a scenario that no longer exists.
 */
export function CopyLinkButton({ form, disabled }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  // `form` is a `useMemo` over the individual fields in `Analyzer`, so its
  // identity changes exactly when the scenario does — never on an unrelated
  // re-render.
  useEffect(() => {
    setFallbackUrl(null);
    setCopied(false);
  }, [form]);

  async function handleCopy() {
    const url = buildShareUrl(form, window.location.origin, window.location.pathname);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFallbackUrl(null);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Insecure context or denied permission — show it rather than fail silently.
      setCopied(false);
      setFallbackUrl(url);
    }
  }

  return (
    <div className="copy-link">
      <button type="button" className="btn-ghost" onClick={handleCopy} disabled={disabled}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M6.5 9.5a2 2 0 002.83 0l2-2a2 2 0 00-2.83-2.83l-.8.8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M9.5 6.5a2 2 0 00-2.83 0l-2 2a2 2 0 002.83 2.83l.8-.8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <span className="visually-hidden" role="status">
        {copied ? 'Link copied to clipboard' : ''}
      </span>
      {fallbackUrl && (
        <div className="share-link-fallback">
          <div className="share-link-fallback-head">
            <label htmlFor="share-link-fallback-input" className="field-hint">
              Clipboard unavailable — copy this link manually:
            </label>
            <button
              type="button"
              className="share-link-fallback-dismiss"
              data-testid="share-link-fallback-dismiss"
              onClick={() => setFallbackUrl(null)}
              aria-label="Dismiss link"
            >
              ×
            </button>
          </div>
          <input
            id="share-link-fallback-input"
            data-testid="share-link-fallback"
            type="text"
            readOnly
            value={fallbackUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}
