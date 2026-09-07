import { useCallback, useEffect, useState } from 'react';
import {
  newClientId,
  parseClient,
  type ClientRecord,
} from '../lib/clientRecord';

const STORAGE_KEY = 'ssa-clients';

/**
 * The households this browser has saved.
 *
 * The shape `useReportLayouts` and `useReportThemes` established, minus the
 * presets: there is no such thing as a preset client. Newest first, because
 * the list is read to find the person sitting in front of you, and that is
 * usually someone recent.
 */
export function useSavedClients() {
  const [clients, setClients] = useState<ClientRecord[]>(read);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
    } catch {
      /* storage unavailable, or full */
    }
  }, [clients]);

  /** Save the view as a new record, newest first. */
  const save = useCallback((record: Omit<ClientRecord, 'id' | 'savedAt'>) => {
    const next: ClientRecord = { ...record, id: newClientId(), savedAt: Date.now() };
    setClients((list) => [next, ...list]);
    return next;
  }, []);

  /** Overwrite one in place, keeping its id and its place in the list. */
  const update = useCallback((id: string, record: Omit<ClientRecord, 'id' | 'savedAt'>) => {
    setClients((list) =>
      list.map((c) => (c.id === id ? { ...record, id, savedAt: Date.now() } : c)),
    );
  }, []);

  const rename = useCallback((id: string, label: string) => {
    setClients((list) =>
      list.map((c) => (c.id === id ? { ...c, label: label.trim().slice(0, 60) || c.label } : c)),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setClients((list) => list.filter((c) => c.id !== id));
  }, []);

  /**
   * Add imported records under fresh ids.
   *
   * Fresh rather than merged by id: two advisers who both saved a household
   * this morning have two different records with two different ids, and an
   * import that silently overwrote one with the other would lose work with
   * nothing on screen to say so.
   */
  const importClients = useCallback((incoming: readonly ClientRecord[]) => {
    const added = incoming.map((c) => ({ ...c, id: newClientId() }));
    setClients((list) => [...added, ...list]);
    return added;
  }, []);

  return { clients, save, update, rename, remove, importClients };
}

function read(): ClientRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Through `parseClient`, not trusted: one bad entry must not cost the
    // rest of an adviser's list.
    return parsed.flatMap((entry) => {
      const client = parseClient(entry);
      return client === null ? [] : [client];
    });
  } catch {
    return [];
  }
}
