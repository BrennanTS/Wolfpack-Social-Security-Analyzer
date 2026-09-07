/**
 * The household on screen, remembered across a refresh.
 *
 * The query string is stripped from the address bar on arrival, so until this
 * existed a reload emptied the form — deliberate, but it cost an adviser their
 * work for a mistyped keystroke or a browser that decided to reload itself
 * mid-meeting.
 *
 * What this changes about the app's posture, plainly: a household now reaches
 * this browser's storage without anyone clicking Save. It is the same data a
 * saved client holds — first names, dates of birth, benefit figures — under
 * the same terms, and `ClientsDialog` offers the way to clear it. Nothing is
 * uploaded, and the address bar still shows nothing.
 */

const STORAGE_KEY = 'ssa-current-view';

export interface CurrentView {
  /** The query string `toViewParams` wrote. */
  params: string;
  /** The saved client this came from, so "Update open" still knows which. */
  openClientId: string | null;
}

/** Long enough for any view this app produces; short enough to be a sanity check. */
const MAX_PARAMS = 2000;

export function readCurrentView(): CurrentView | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const source = parsed as Record<string, unknown>;
    if (typeof source.params !== 'string') return null;
    const params = source.params.trim().replace(/^\?/, '').slice(0, MAX_PARAMS);
    if (params === '') return null;
    return {
      params,
      openClientId: typeof source.openClientId === 'string' ? source.openClientId : null,
    };
  } catch {
    return null;
  }
}

export function writeCurrentView(view: CurrentView): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    /* storage unavailable, or full */
  }
}

export function clearCurrentView(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}
