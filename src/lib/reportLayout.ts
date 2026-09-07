/**
 * What the report contains, in what order, and where its pages break.
 *
 * The beta report was a fixed sequence of sections, each of which rendered
 * its own physical page. That is why it printed at about 5% ink: a section
 * holding a third of a page still consumed a whole sheet, and four of the
 * client-facing pages ended less than 40% of the way down.
 *
 * A layout replaces that sequence. Blocks flow onto whatever page they land
 * on, and a page break is something the adviser places rather than something
 * the section list implies — so removing a block closes the gap it left
 * instead of leaving a hole.
 */
import type { HouseholdDisplayShape } from './household';

/** Every block the report can print. */
export type ReportBlockId =
  | 'answer'
  | 'changes'
  | 'survivor'
  | 'longevity'
  | 'action'
  | 'household'
  | 'grid'
  | 'people'
  | 'terms'
  | 'methodology';

/**
 * A block, or a forced page break.
 *
 * Breaks are items in the same list rather than a property of the block that
 * follows, because that is how they are edited: dragged to a position, not
 * attached to a neighbour. It also lets two breaks sit together without
 * meaning something different from one.
 */
export type LayoutItem = { kind: 'block'; id: ReportBlockId } | { kind: 'break' };

export interface ReportLayout {
  /** Stable id, used as the storage key. */
  id: string;
  name: string;
  items: LayoutItem[];
}

export interface BlockMeta {
  id: ReportBlockId;
  /** Shown in the editor — the client's words, not the code's. */
  label: string;
  /** One line under the label. */
  blurb: string;
  /**
   * Which household shapes this block can render for. A block outside its
   * shape is skipped at render rather than rejected from the layout: an
   * adviser's saved layout must survive being opened on a widowed household
   * and then a married one.
   */
  shapes: readonly HouseholdDisplayShape[];
  /** Roughly how much of a page it fills, for the editor's size hint. */
  fill: 'small' | 'medium' | 'full';
}

const ALL: readonly HouseholdDisplayShape[] = ['oneClaimant', 'twoClaimants', 'widowed'];
const LIVING: readonly HouseholdDisplayShape[] = ['oneClaimant', 'twoClaimants'];
const COUPLE: readonly HouseholdDisplayShape[] = ['twoClaimants'];

/**
 * Block metadata, in the order the editor lists them.
 *
 * The labels are the ones printed on the page, so an adviser arranging the
 * report is choosing between the same words the client will read.
 */
export const BLOCKS: readonly BlockMeta[] = [
  {
    id: 'answer',
    label: 'Your Social Security decision',
    blurb: 'Filing dates, the monthly figures, and the lifetime total',
    shapes: LIVING,
    fill: 'small',
  },
  {
    id: 'changes',
    label: 'What changes, and when',
    blurb: 'Every month the household income moves, and why',
    shapes: LIVING,
    fill: 'small',
  },
  {
    id: 'survivor',
    label: 'If one of you is left alone',
    blurb: 'Survivor income under each plan, as bars',
    shapes: COUPLE,
    fill: 'small',
  },
  {
    id: 'longevity',
    label: 'What if we are wrong about how long you live',
    blurb: 'The same comparison priced at three lifespans',
    shapes: LIVING,
    fill: 'small',
  },
  {
    id: 'action',
    label: 'Your action plan',
    blurb: 'When to apply, and what to bring',
    shapes: LIVING,
    fill: 'small',
  },
  {
    id: 'household',
    label: 'Household comparison',
    blurb: 'The strategy table and the combined income chart',
    shapes: COUPLE,
    fill: 'full',
  },
  {
    id: 'grid',
    label: 'Claiming age grid',
    blurb: 'Every combination of claiming ages, ranked',
    shapes: COUPLE,
    fill: 'medium',
  },
  {
    id: 'people',
    label: 'Client and spouse detail',
    blurb: 'A page each: benefit by claiming age, break-even',
    shapes: LIVING,
    fill: 'full',
  },
  {
    id: 'terms',
    label: 'Key terms and assumptions',
    blurb: 'The words on the page, defined',
    shapes: ALL,
    fill: 'medium',
  },
  {
    id: 'methodology',
    label: 'Methodology',
    blurb: 'How every figure was produced',
    shapes: ALL,
    fill: 'medium',
  },
];

const BY_ID = new Map(BLOCKS.map((b) => [b.id, b]));

export function blockMeta(id: ReportBlockId): BlockMeta | undefined {
  return BY_ID.get(id);
}

/** Whether a block has anything to say about this kind of household. */
export function blockAppliesTo(id: ReportBlockId, shape: HouseholdDisplayShape): boolean {
  return BY_ID.get(id)?.shapes.includes(shape) ?? false;
}

const block = (id: ReportBlockId): LayoutItem => ({ kind: 'block', id });
const BREAK: LayoutItem = { kind: 'break' };

/**
 * What a client is handed.
 *
 * The four blocks that answer the questions they walked in with, and nothing
 * that answers a question they did not ask. No page breaks at all — the
 * blocks are small enough that forcing one would put the white space back.
 */
export const CLIENT_LAYOUT: ReportLayout = {
  id: 'preset-client',
  name: 'Client',
  items: [block('answer'), block('changes'), block('survivor'), block('action'), block('terms')],
};

/**
 * The full working document.
 *
 * Breaks before the three blocks that are a page in their own right, so they
 * start clean rather than beginning two thirds down a sheet.
 */
export const ADVISER_LAYOUT: ReportLayout = {
  id: 'preset-adviser',
  name: 'Adviser',
  items: [
    block('answer'),
    block('changes'),
    block('survivor'),
    block('longevity'),
    block('action'),
    BREAK,
    block('household'),
    block('grid'),
    BREAK,
    block('people'),
    BREAK,
    block('terms'),
    block('methodology'),
  ],
};

export const PRESETS: readonly ReportLayout[] = [CLIENT_LAYOUT, ADVISER_LAYOUT];

export const DEFAULT_LAYOUT_ID = CLIENT_LAYOUT.id;

/** Blocks in a layout, in order, ignoring breaks. */
export function layoutBlockIds(layout: ReportLayout): ReportBlockId[] {
  return layout.items.flatMap((i) => (i.kind === 'block' ? [i.id] : []));
}

/** Blocks NOT in a layout — the editor's "not included" column. */
export function omittedBlocks(layout: ReportLayout): BlockMeta[] {
  const present = new Set(layoutBlockIds(layout));
  return BLOCKS.filter((b) => !present.has(b.id));
}

/**
 * Split a layout into the runs that become physical page groups.
 *
 * A run is the blocks between two breaks. Each becomes one `<Page>`, inside
 * which react-pdf paginates on its own — so a run that overflows spills onto
 * a second sheet rather than being clipped, and a run that underfills does
 * not leave a blank remainder.
 *
 * Blocks that do not apply to this household are dropped BEFORE the split,
 * so a break left stranded between two skipped blocks cannot produce an
 * empty page. That was the failure mode of the old fixed sequence rendered
 * for a widowed household.
 */
export function layoutRuns(
  layout: ReportLayout,
  shape: HouseholdDisplayShape,
): ReportBlockId[][] {
  const runs: ReportBlockId[][] = [];
  let current: ReportBlockId[] = [];
  for (const item of layout.items) {
    if (item.kind === 'break') {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    if (blockAppliesTo(item.id, shape)) current.push(item.id);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/* ------------------------------------------------------------------ *
 * Import, export, and repair
 * ------------------------------------------------------------------ */

/** The shape written to a shared `.json` file. */
interface LayoutFile {
  kind: 'wolfpack-report-layout';
  version: 1;
  layout: ReportLayout;
}

export const LAYOUT_FILE_KIND = 'wolfpack-report-layout';

export function serializeLayout(layout: ReportLayout): string {
  const file: LayoutFile = { kind: 'wolfpack-report-layout', version: 1, layout };
  return JSON.stringify(file, null, 2);
}

/**
 * Repair anything that claims to be a layout.
 *
 * Layouts arrive from a teammate's file and from this browser's own storage,
 * which means they can be any shape at all: written by an older version,
 * hand-edited, or simply not a layout. Every field is therefore checked
 * rather than trusted, and a block id this version does not know is dropped
 * instead of rejecting the whole file — a colleague on a newer build should
 * not hand you a layout you cannot open.
 *
 * Returns null only when there is nothing recoverable.
 */
export function parseLayout(raw: unknown): ReportLayout | null {
  const source = unwrap(raw);
  if (source === null) return null;

  const items: LayoutItem[] = [];
  const seen = new Set<ReportBlockId>();
  for (const item of source.items) {
    if (item === null || typeof item !== 'object') continue;
    const kind = (item as { kind?: unknown }).kind;
    if (kind === 'break') {
      // Two breaks in a row would print a blank page; a leading break would
      // put one at the front of the report.
      if (items.length > 0 && items[items.length - 1].kind !== 'break') items.push({ kind: 'break' });
      continue;
    }
    if (kind !== 'block') continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string' || !BY_ID.has(id as ReportBlockId)) continue;
    // A block twice would render its content twice under one heading.
    if (seen.has(id as ReportBlockId)) continue;
    seen.add(id as ReportBlockId);
    items.push({ kind: 'block', id: id as ReportBlockId });
  }
  while (items.length > 0 && items[items.length - 1].kind === 'break') items.pop();
  if (items.length === 0) return null;

  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : 'Imported layout';
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : `layout-${Date.now()}`;
  return { id, name: name.slice(0, 60), items };
}

/** Accept either a wrapped file or a bare layout object. */
function unwrap(raw: unknown): { id?: unknown; name?: unknown; items: unknown[] } | null {
  if (raw === null || typeof raw !== 'object') return null;
  const outer = raw as Record<string, unknown>;
  const inner =
    outer.kind === LAYOUT_FILE_KIND && outer.layout !== null && typeof outer.layout === 'object'
      ? (outer.layout as Record<string, unknown>)
      : outer;
  if (!Array.isArray(inner.items)) return null;
  return { id: inner.id, name: inner.name, items: inner.items };
}

/** Parse a `.json` file's text. Returns null rather than throwing. */
export function parseLayoutFile(text: string): ReportLayout | null {
  try {
    return parseLayout(JSON.parse(text));
  } catch {
    return null;
  }
}
