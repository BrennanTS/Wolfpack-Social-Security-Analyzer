/**
 * Shared plumbing for the invariant sweeps: the life-table fetch stub, the
 * analysis runner, and the canonicalizer that makes two analyses of the same
 * household comparable regardless of entry order.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from '../../src/lib/household';
import { householdAt, widowedHouseholdAt, SWEEP_AS_OF, type SweepHousehold } from './households';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

/** `analyzeHousehold` fetches SSA life tables; in node there is no server. */
export function stubLifeTableFetch(): (url: string) => Promise<Response> {
  return async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  };
}

export const SWEEP_ASSUMPTIONS = { annualCola: 2.5, discountRate: 0.025 };

export function analyze(household: Household): Promise<HouseholdAnalysis> {
  return analyzeHousehold(household, SWEEP_ASSUMPTIONS, SWEEP_AS_OF);
}

/**
 * Both corpora as one list — married and single from `householdAt`, widowed
 * from its own generator.
 *
 * Lives here rather than in each sweep because the widowed surfaces went
 * un-modelled for an entire phase while `npm run sweep` reported success, and
 * a per-sweep opt-in is how that happens again. A sweep that wants only the
 * main corpus passes `widowedCount: 0` and says why.
 */
export function sweepCorpus(count: number, widowedCount: number): SweepHousehold[] {
  const all: SweepHousehold[] = [];
  for (let i = 0; i < count; i++) all.push(householdAt(i));
  for (let i = 0; i < widowedCount; i++) all.push(widowedHouseholdAt(i));
  return all;
}

/**
 * A failure the sweep can report. `label` reproduces the household; `detail`
 * has to be enough to act on without re-running anything.
 */
export interface Finding {
  index: number;
  label: string;
  detail: string;
}

/**
 * Formats a findings list for the report: the count, then the first `sample`
 * of them. A sweep that prints ten thousand lines gets skimmed, not read.
 */
export function summarize(name: string, findings: Finding[], sample = 5): string {
  if (findings.length === 0) return `PASS ${name}: 0 failures`;
  const lines = findings.slice(0, sample).map((f) => `    ${f.label}\n      ${f.detail}`);
  const more = findings.length > sample ? `\n    ...and ${findings.length - sample} more` : '';
  return `FAIL ${name}: ${findings.length} failures\n${lines.join('\n')}${more}`;
}

/* ------------------------------------------------------------------ *
 * Canonicalization
 *
 * `id` is a SLOT ('a' or 'b'); `name` is the human. Swapping entry order
 * moves a human between slots, so every id-keyed structure has to be
 * re-keyed by human before two analyses can be compared. Anything left
 * keyed by slot would report a difference on every married household and
 * drown the real findings.
 * ------------------------------------------------------------------ */

type Json = ReturnType<typeof JSON.parse>;

/**
 * Deeply sorts object keys. Re-keying a record by human rebuilds it in
 * whatever order the slots happened to be in, so without this every married
 * household reports a difference that is nothing but key insertion order —
 * which is exactly what the first run of this sweep reported.
 */
function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys(value[k])]),
  );
}

function slotToName(analysis: HouseholdAnalysis): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of analysis.people) map[p.person.id] = p.person.name ?? p.person.id;
  return map;
}

/** Rewrites `${personId}:${type}` and bare-personId keys of a record. */
function rekey(record: Record<string, number>, names: Record<string, string>) {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    const [id, ...rest] = key.split(':');
    out[[names[id] ?? id, ...rest].join(':')] = value;
  }
  return out;
}

/**
 * Reduces an analysis to a form that depends on the household but not on the
 * order its people were entered in. Two analyses of the same household must
 * be deep-equal after this; any difference that survives is a real finding.
 *
 * Deliberately covers the WHOLE object rather than a chosen field list. The
 * order-independence defect survived two fixes because the tests asserted
 * `lowerEarnerLabel` and nothing else — the timeline, periods, cliff and
 * filing ages were never compared, and that is exactly where it was hiding.
 */
export function canonicalize(analysis: HouseholdAnalysis): Json {
  const names = slotToName(analysis);
  const nameOf = (id: string) => names[id] ?? id;

  // People, and the per-strategy filing ages positionally aligned with them,
  // sorted together by human.
  const order = analysis.people
    .map((p, i) => ({ i, name: nameOf(p.person.id) }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const strategy = (s: HouseholdAnalysis['optimal']) => ({
    ...s,
    filingAges: order.map(({ i }) => s.filingAges[i]),
  });

  return sortKeys(
    JSON.parse(
      JSON.stringify({
        status: analysis.status,
        people: order.map(({ i }) => {
          const p = analysis.people[i];
          return { ...p, person: { ...p.person, id: nameOf(p.person.id) } };
        }),
        optimal: strategy(analysis.optimal),
        comparisons: analysis.comparisons.map(strategy),
        combinedTimeline: analysis.combinedTimeline.map((point) => ({
          ...point,
          bySeries: rekey(point.bySeries, names),
          byPersonId: rekey(point.byPersonId, names),
        })),
        periods: analysis.periods
          .map((b) => ({ ...b, personId: nameOf(b.personId) }))
          .sort(
            (x, y) =>
              x.personId.localeCompare(y.personId) ||
              x.type.localeCompare(y.type) ||
              x.startIndex - y.startIndex,
          ),
        spousalTopUp: analysis.spousalTopUp,
        survivorGap: analysis.survivorGap,
        survivorClaim: analysis.survivorClaim,
        // Widowed-only, and both order-independent facts about the household.
        // `lifetimeTotal` and `survivorClaimDate` already ride along inside
        // `strategy`'s spread; these two had no carrier at all.
        piaEstimated: analysis.piaEstimated,
        deceased: analysis.deceased,
        finalIndexByPersonId: rekey(analysis.finalIndexByPersonId, names),
      }),
    ),
  );
}

/** First differing path between two canonicalized analyses, for the report. */
export function firstDifference(a: Json, b: Json, at = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${at || '(root)'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const diff = firstDifference(a[key], b[key], at ? `${at}.${key}` : key);
    if (diff) return diff;
  }
  return `${at || '(root)'}: differs`;
}
