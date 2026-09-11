import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearCurrentView } from '../lib/currentView';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * The last thing between a thrown render and a blank page.
 *
 * Everything asynchronous in this app already fails politely: a rejected
 * analysis is caught in `Analyzer` and rendered as "Analysis unavailable".
 * A throw during RENDER had no such path — React unmounts the whole tree, and
 * the adviser is left looking at white. That is not hypothetical. Typing a
 * birth year of 1875 threw inside a live FRA hint (`fraFromBirthYear` builds
 * a `Birthdate`, which throws below 1900) and took the app down mid-entry,
 * with no message and nothing on screen to report.
 *
 * A class component because `componentDidCatch` has no hook equivalent; this
 * is the one thing React still requires a class for.
 *
 * What it offers matters more than that it exists:
 *
 *  - The error text, so an adviser can say what happened rather than "it
 *    went white".
 *  - The address bar, said out loud. This app keeps the whole household in
 *    the query string, so the work is usually still there to copy before
 *    doing anything else.
 *  - A way out that clears the REMEMBERED view. Without it, state persisted
 *    to `localStorage` that causes a crash would re-crash on every reload —
 *    a permanently bricked app, fixable only by knowing to clear site data.
 *    That is the failure mode a boundary must not leave open.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack is the only part that says WHERE, and it is absent
    // from the error itself. Logged rather than shown: it is for whoever is
    // asked to fix this, not for the adviser reading the panel.
    console.error('Render failed', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>
            This screen stopped working. Nothing has been sent anywhere, and no saved client
            has been changed.
          </p>
          <p>
            <strong>Before you reload</strong>, copy the address from your browser&rsquo;s
            address bar. It holds the household you were working on, so you can paste it back
            and carry on.
          </p>
          <p className="crash-detail">{error.message || String(error)}</p>
          <div className="crash-actions">
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              type="button"
              className="crash-reset"
              onClick={() => {
                // Only the remembered view, not saved clients, themes or
                // layouts: the point is to escape a crash without throwing
                // away work the adviser deliberately kept.
                clearCurrentView();
                window.location.href = window.location.pathname;
              }}
            >
              Start fresh
            </button>
          </div>
          <p className="crash-note">
            &ldquo;Start fresh&rdquo; forgets the household on screen. Saved clients, themes
            and report layouts are kept.
          </p>
        </div>
      </div>
    );
  }
}
