import { isInBounds, LIFE_EXPECTANCY_BOUNDS } from './formBounds';

/**
 * Remembers the plan-to ages an adviser last SET, so a fresh form starts
 * where they left off rather than back at 95 every session.
 *
 * Three rules, each of which the alternative gets wrong:
 *
 * **A shared link always wins.** Storage is consulted only when the URL
 * carries no parameters at all. Two people opening one link must see one
 * analysis — and since the plan-to age now drives the recommendation
 * (`planToAgeDistribution`), a remembered value silently overriding a link
 * would show the sender and the recipient different filing ages for the same
 * household. That is the failure this app has worked hardest to avoid.
 *
 * **Only what was SET is stored, never what was merely shown.** Writing
 * happens in the slider's own change handler, not in an effect over the
 * value. An effect would record a colleague's 85 the moment their link was
 * opened, quietly adopting an assumption the reader never chose.
 *
 * **Anything read back is untrusted.** `localStorage` is user-writable and
 * survives across app versions, so a stored value is validated against the
 * same bounds the slider enforces and otherwise ignored — the same
 * dropped-not-clamped rule `shareLink.ts` applies to query parameters.
 */
const KEY = 'wolfpack.planToAge.v1';

/** Per person SLOT, matching `Person.id`. Either may be absent. */
export interface StoredPlanToAges {
  a?: number;
  b?: number;
}

/**
 * `localStorage` access can THROW rather than return null — Safari's private
 * mode and some enterprise policies do exactly that, and an uncaught throw
 * here would happen during `Analyzer`'s state initializer, taking the whole
 * app down before first paint. Every entry point below is wrapped for that
 * reason, not as ambient defensiveness.
 */
function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    // `?? null` matters: a DOM without storage support (jsdom's default, and
    // some embedded webviews) has a `window` whose `localStorage` is
    // `undefined` rather than absent, and the callers below test for null.
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

const valid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && isInBounds(value, LIFE_EXPECTANCY_BOUNDS);

/** What was last set, or `{}` — never a partial value that failed validation. */
export function readPlanToAges(): StoredPlanToAges {
  const store = storage();
  if (store === null) return {};
  try {
    const raw = store.getItem(KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return {};
    const out: StoredPlanToAges = {};
    const record = parsed as Record<string, unknown>;
    if (valid(record.a)) out.a = record.a;
    if (valid(record.b)) out.b = record.b;
    return out;
  } catch {
    // Malformed JSON from an older version, or a hand-edited value.
    return {};
  }
}

/** Records one slot's value, leaving the other alone. */
export function writePlanToAge(slot: 'a' | 'b', age: number): void {
  const store = storage();
  if (store === null || !valid(age)) return;
  try {
    store.setItem(KEY, JSON.stringify({ ...readPlanToAges(), [slot]: age }));
  } catch {
    // Quota exceeded, or storage disabled mid-session. A preference that
    // fails to persist is not worth interrupting an analysis over.
  }
}
