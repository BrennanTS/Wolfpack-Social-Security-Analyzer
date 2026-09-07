import { useEffect, useRef, useState } from 'react';
import {
  namesFromParams,
  parseClientsFile,
  serializeClients,
  type ClientRecord,
} from '../lib/clientRecord';
import type { useSavedClients } from '../hooks/useSavedClients';

/** What the app is showing right now, ready to be saved. */
interface CurrentView {
  /** The query string `toViewParams` wrote — names included. */
  params: string;
  suggestedLabel: string;
  /** Whether there is enough on screen to be worth saving. */
  complete: boolean;
}

/**
 * The households this browser has saved.
 *
 * Local by design, and worth being plain about: the record is the same query
 * string a share link carries, plus the first names, which links leave out.
 * Nothing is uploaded. That is what makes this safe to use in a meeting and
 * also what makes Export the only backup — a browser that is cleared takes
 * the list with it.
 */
export function ClientsDialog({
  open,
  onClose,
  clients,
  openClientId,
  currentView,
  onOpenClient,
  onSaved,
  onNewClient,
  canStartNew,
}: {
  open: boolean;
  onClose: () => void;
  clients: ReturnType<typeof useSavedClients>;
  /** The record the view came from, if any — what Save overwrites. */
  openClientId: string | null;
  currentView: CurrentView;
  onOpenClient: (client: ClientRecord) => void;
  onSaved: (id: string) => void;
  /** Empties the form for the next household — see the note beside the button. */
  onNewClient: () => void;
  /** Whether there is anything on screen to clear. */
  canStartNew: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [label, setLabel] = useState(currentView.suggestedLabel);

  useEffect(() => {
    if (open) setLabel(currentView.suggestedLabel);
  }, [open, currentView.suggestedLabel]);

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

  useEffect(() => {
    // The page behind is held still while the dialog is up.
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousPadding = root.style.paddingRight;
    const scrollbar = window.innerWidth - root.clientWidth;
    root.style.overflow = 'hidden';
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    return () => {
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPadding;
    };
  }, [open]);

  if (!open) return null;

  const record = () => ({
    label: label.trim() || currentView.suggestedLabel,
    // Read back out of the parameters rather than passed in beside them, so
    // the list and the view it opens cannot disagree about who this is.
    names: namesFromParams(currentView.params),
    params: currentView.params,
  });

  const onExport = () => {
    const blob = new Blob([serializeClients(clients.clients)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `clients-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseClientsFile(await file.text());
    if (parsed === null) {
      setNote("That file isn't a saved client list.");
      return;
    }
    clients.importClients(parsed);
    setNote(`Imported ${parsed.length} ${parsed.length === 1 ? 'client' : 'clients'}.`);
  };

  return (
    <>
      <button
        type="button"
        className="drawer-backdrop drawer-backdrop-dialog"
        onClick={onClose}
        aria-label="Close clients"
      />
      <div
        className="layout-dialog clients-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clients-dialog-title"
        ref={panel}
        tabIndex={-1}
      >
        <header className="layout-dialog-header">
          <div>
            <h2 id="clients-dialog-title">Clients</h2>
            <p>
              Saved in this browser only: first names, dates of birth, benefit figures, the
              assumptions you set, and the theme and layout the report is built with. Nothing is
              uploaded. Export is the only backup.
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

        <div className="clients-body">
          <section className="clients-save">
            <label className="theme-field-label" htmlFor="client-save-name">
              Save what is on screen
            </label>
            <div className="clients-save-row">
              <input
                id="client-save-name"
                type="text"
                value={label}
                maxLength={60}
                onChange={(e) => setLabel(e.target.value)}
                disabled={!currentView.complete}
              />
              <button
                type="button"
                disabled={!currentView.complete}
                onClick={() => {
                  const saved = clients.save(record());
                  onSaved(saved.id);
                  setNote(`Saved “${saved.label}”.`);
                }}
              >
                Save as new
              </button>
              {openClientId !== null && (
                <button
                  type="button"
                  disabled={!currentView.complete}
                  onClick={() => {
                    clients.update(openClientId, record());
                    setNote('Updated.');
                  }}
                >
                  Update open
                </button>
              )}
            </div>
            {!currentView.complete && (
              <p className="clients-empty">
                Fill in the dates and benefit amounts before saving.
              </p>
            )}
            {/* The household on screen is held in this browser too, so a
                reload does not cost an adviser their work. That makes this the
                way to start the next one — the refresh used to be. */}
            <p className="clients-empty">
              The household on screen stays put across a refresh.{' '}
              <button
                type="button"
                className="clients-inline-action"
                onClick={onNewClient}
                disabled={!canStartNew}
              >
                Start a new one
              </button>
            </p>
          </section>

          {clients.clients.length === 0 ? (
            <p className="clients-empty">Nothing saved yet.</p>
          ) : (
            <ul className="clients-list">
              {clients.clients.map((client) => (
                <li
                  key={client.id}
                  className={`clients-row${client.id === openClientId ? ' is-open' : ''}`}
                >
                  <span className="clients-row-text">
                    <span className="clients-row-name">{client.label}</span>
                    <span className="clients-row-meta">{describe(client)}</span>
                  </span>
                  <span className="clients-row-actions">
                    <button type="button" onClick={() => onOpenClient(client)}>
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = window.prompt('Rename client', client.label);
                        if (next !== null) clients.rename(client.id, next);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete “${client.label}”?`)) clients.remove(client.id);
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="layout-actions">
            <button type="button" onClick={onExport} disabled={clients.clients.length === 0}>
              Export…
            </button>
            <button type="button" onClick={() => fileInput.current?.click()}>
              Import…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void onImportFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          {note && <p className="layout-note">{note}</p>}
        </div>
      </div>
    </>
  );
}

/** One line under the name: who is in it, and when it was saved. */
function describe(client: ClientRecord): string {
  const names = [client.names.a, client.names.b].filter(
    (n): n is string => n !== undefined && n !== '',
  );
  const who = names.length > 0 ? names.join(' and ') : 'No names';
  const when = new Date(client.savedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${who} · saved ${when}`;
}
