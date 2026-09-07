/**
 * A saved client — everything the app was showing, kept in this browser.
 *
 * The record is a query string. Not a parallel data model of its own: the
 * share link already encodes the whole view and is validated on the way back
 * in, so a second encoding would be a second thing to keep in step and a
 * second thing to get wrong. What a saved client adds is a label to find it
 * by — the first names come from the parameters, which carry them now.
 *
 * What that means for what is stored: first names, months and years of birth,
 * benefit figures and the assumptions the adviser set. No surnames, no
 * addresses, no Social Security numbers — the app never asks for any of them.
 * Everything stays in this browser; nothing is uploaded, and the export is a
 * file the adviser saves themselves.
 */

export interface ClientRecord {
  id: string;
  /** What the adviser calls this household in the list. */
  label: string;
  /** First names, kept out of the query string on purpose. */
  names: { a?: string; b?: string };
  /** The view, as `toViewParams` wrote it. */
  params: string;
  /** Milliseconds since the epoch, for "saved 3 days ago" and for ordering. */
  savedAt: number;
}

export const CLIENTS_FILE_KIND = 'wolfpack-clients';

interface ClientsFile {
  kind: typeof CLIENTS_FILE_KIND;
  version: 1;
  clients: ClientRecord[];
}

export function serializeClients(clients: readonly ClientRecord[]): string {
  const file: ClientsFile = { kind: CLIENTS_FILE_KIND, version: 1, clients: [...clients] };
  return JSON.stringify(file, null, 2);
}

const MAX_LABEL = 60;
const MAX_NAME = 40;
/**
 * A query string long enough for any view this app can produce, and short
 * enough that a hand-edited file cannot fill the browser's storage.
 */
const MAX_PARAMS = 2000;

function text(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().slice(0, max);
  return value.length > 0 ? value : undefined;
}

/**
 * Repair anything that claims to be a saved client.
 *
 * Records arrive from this browser's storage and from a colleague's export,
 * so nothing is trusted. The parameters are kept as text and re-validated by
 * `fromShareParams` when the record is opened — this only has to establish
 * that there is a name and something that could be a query string.
 */
export function parseClient(raw: unknown): ClientRecord | null {
  if (raw === null || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const params = text(source.params, MAX_PARAMS);
  if (params === undefined) return null;
  // A record with nothing to call it is unusable in a list, but a saved view
  // is worth keeping — so it gets a name rather than being dropped.
  const label = text(source.label, MAX_LABEL) ?? 'Untitled client';
  // From the parameters where they are there, so a hand-edited record cannot
  // list one household and open another. The stored field is the fallback,
  // for records written before names traveled in the query string.
  const fromParams = namesFromParams(params);
  const rawNames =
    source.names !== null && typeof source.names === 'object'
      ? (source.names as Record<string, unknown>)
      : {};
  const names: ClientRecord['names'] =
    Object.keys(fromParams).length > 0
      ? fromParams
      : {
          ...(text(rawNames.a, MAX_NAME) === undefined ? {} : { a: text(rawNames.a, MAX_NAME)! }),
          ...(text(rawNames.b, MAX_NAME) === undefined ? {} : { b: text(rawNames.b, MAX_NAME)! }),
        };
  const savedAt = typeof source.savedAt === 'number' && Number.isFinite(source.savedAt)
    ? source.savedAt
    : Date.now();
  return {
    id: text(source.id, 60) ?? newClientId(),
    label,
    names,
    params: params.replace(/^\?/, ''),
    savedAt,
  };
}

/** Parse a `.json` file's text: a list of clients, or a single one. */
export function parseClientsFile(text: string): ClientRecord[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const list =
      parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as ClientsFile).clients)
        ? (parsed as ClientsFile).clients
        : Array.isArray(parsed)
          ? parsed
          : [parsed];
    const clients = (list as unknown[]).flatMap((entry) => {
      const client = parseClient(entry);
      return client === null ? [] : [client];
    });
    return clients.length > 0 ? clients : null;
  } catch {
    return null;
  }
}

/**
 * The first names a saved view carries.
 *
 * The parameters are the record, so they are where a name lives; the `names`
 * field beside them is a copy kept for the list, which would otherwise have
 * to parse a query string per row. Parsing wins on the way in, so the two
 * cannot drift.
 */
export function namesFromParams(params: string): ClientRecord['names'] {
  const search = new URLSearchParams(params.replace(/^\?/, ''));
  const names: ClientRecord['names'] = {};
  const a = text(search.get('an'), MAX_NAME);
  const b = text(search.get('bn'), MAX_NAME);
  if (a !== undefined) names.a = a;
  if (b !== undefined) names.b = b;
  return names;
}

export function newClientId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * What to call a household that has not been named.
 *
 * The first names if there are any, because that is what an adviser would
 * have written on the folder; the date otherwise.
 */
export function suggestedClientLabel(names: ClientRecord['names'], on = new Date()): string {
  const both = [names.a, names.b].filter((n): n is string => n !== undefined && n.trim() !== '');
  if (both.length > 0) return both.join(' and ').slice(0, MAX_LABEL);
  return `Saved ${on.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
