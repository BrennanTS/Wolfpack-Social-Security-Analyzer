import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  BLOCKS,
  blockMeta,
  omittedBlocks,
  parseLayoutFile,
  serializeLayout,
  spaceIgnored,
  type LayoutItem,
  type ReportBlockId,
  type ReportLayout,
} from '../lib/reportLayout';
import type { HouseholdDisplayShape } from '../lib/household';
import { blockAppliesTo } from '../lib/reportLayout';
import type { useReportLayouts } from '../hooks/useReportLayouts';

/** What this household is called, for the "won't print" hint. */
const SHAPE_NAME: Record<HouseholdDisplayShape, string> = {
  oneClaimant: 'a single client',
  twoClaimants: 'a married couple',
  widowed: 'a widow(er)',
};

/** How much of a page a block takes, in the editor's words. */
const FILL_LABEL: Record<'small' | 'medium' | 'full', string> = {
  small: 'about a third of a page',
  medium: 'about half a page',
  full: 'a page or more',
};

/**
 * An eye, open or struck through.
 *
 * Drawn rather than an emoji: the row is 28px of dense text and an emoji
 * renders at a different weight in every browser. `aria-hidden` because the
 * button around it carries the words.
 */
function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <circle cx="8" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.1" />
      {hidden && <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.2" />}
    </svg>
  );
}

/** What a space says about itself, including when it will do nothing. */
const SPACE_BLURB: Record<'edge' | 'person' | 'prints', string> = {
  prints: 'Extra room before what follows. Add another for a wider gap',
  edge: 'Nothing to separate here. The page margin already does it',
  person: 'Not printed between two per-person sections',
};

/**
 * Arrange what the report contains.
 *
 * Blocks are dragged rather than moved with buttons because ordering is the
 * whole task and a list of arrows makes you count. Keyboard users get the
 * arrows anyway — a drag-only editor is a locked door — so both exist and
 * do the same thing.
 *
 * A preset cannot be edited in place. Dragging inside one moves to a working
 * copy that has to be named before it sticks, so an adviser cannot quietly
 * change what "Client" means for everyone else who picks it.
 */
/**
 * What is being dragged: a row already in the report, or a block from the
 * palette that is not in it yet.
 *
 * One piece of state for both because they land the same way — a block
 * dragged in from the palette goes where it was dropped, exactly as a row
 * dragged up the list does.
 */
type Dragging =
  | { kind: 'row'; index: number; label: string }
  | { kind: 'add'; id: ReportBlockId; label: string }
  /**
   * A page break or a space, which are not blocks and have no id.
   *
   * These were click-to-append only, which put them at the bottom of the
   * report to be walked up — for the two items whose whole purpose is being
   * at a particular position. They now drag like everything else beside
   * them.
   */
  | { kind: 'mark'; item: LayoutItem; label: string };

/** How far the pointer must travel before a press becomes a drag, in px. */
const DRAG_THRESHOLD = 4;

export function ReportLayoutEditor({
  layouts,
  layout,
  selectedId,
  select,
  isPreset,
  saveAs,
  update,
  rename,
  remove,
  importLayout,
  draftItems,
  setDraftItems,
  shape,
  wide = false,
  blockPages,
}: ReturnType<typeof useReportLayouts> & {
  /** The household on screen, so the editor can say what it will skip. */
  shape?: HouseholdDisplayShape;
  /**
   * Which page each block starts on, measured by the preview.
   *
   * Shown rather than jumped to. The frame is a PDF plugin: handed a blob URL
   * with a `#page=` fragment it renders nothing at all, and a fragment
   * changed underneath it moves nothing — both measured in a browser. Naming
   * the page is what remains, and it is most of the answer.
   */
  blockPages?: ReadonlyMap<ReportBlockId, number>;
  /**
   * Two columns instead of one — the report on the left, what is not in it on
   * the right. Only a layout change: the drawer and the dialog run the same
   * editor, so neither can grow behavior the other lacks.
   */
  wide?: boolean;
}) {
  const [drag, setDrag] = useState<Dragging | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  /** Where the floating label sits while something is being dragged. */
  const [ghostAt, setGhostAt] = useState<{ x: number; y: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameFieldId = useId();

  // `layout` already has the draft applied — the store owns it, so the export
  // and this list can never show different reports.
  const items = layout.items;
  const dirty = draftItems !== null;
  const editingPreset = isPreset(selectedId);

  const commit = useCallback(
    (next: LayoutItem[]) => {
      // A preset's items are code, so editing one starts a draft the adviser
      // then names. A layout of their own is theirs to change, and saves as
      // they go — there is nothing to protect it from.
      if (editingPreset) setDraftItems(next);
      else update(selectedId, next);
    },
    [editingPreset, selectedId, update, setDraftItems],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to || to < 0 || to >= items.length) return;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      commit(next);
    },
    [items, commit],
  );

  const removeAt = useCallback((index: number) => {
    commit(items.filter((_, i) => i !== index));
  }, [items, commit]);

  const addBlock = useCallback((id: ReportBlockId) => {
    commit([...items, { kind: 'block', id }]);
  }, [items, commit]);

  /** Anything from the palette, dropped at a position rather than appended. */
  const insertAt = useCallback(
    (item: LayoutItem, at: number) => {
      const next = [...items];
      next.splice(Math.max(0, Math.min(at, next.length)), 0, item);
      commit(next);
    },
    [items, commit],
  );

  /** Kept in the layout, left out of the report. */
  const toggleHidden = useCallback(
    (index: number) => {
      commit(
        items.map((item, i) =>
          i !== index || item.kind !== 'block'
            ? item
            : item.hidden === true
              ? { kind: 'block', id: item.id }
              : { kind: 'block', id: item.id, hidden: true },
        ),
      );
    },
    [items, commit],
  );

  /**
   * Where a drop at this height would land.
   *
   * Rows answer for themselves; this is for the gaps between them and the
   * space above and below, which are part of the list an adviser aims at and
   * were rejecting every drop.
   */
  const indexAt = useCallback(
    (clientY: number): number => {
      const rows = list.current?.querySelectorAll<HTMLElement>('.layout-row') ?? [];
      let i = 0;
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        if (clientY < box.top + box.height / 2) return i;
        i += 1;
      }
      return i;
    },
    [],
  );

  /** Whatever was being dragged, landing before position `at`. */
  const dropAt = useCallback(
    (item: Dragging, at: number) => {
      if (item.kind === 'add') {
        insertAt({ kind: 'block', id: item.id }, at);
        return;
      }
      if (item.kind === 'mark') {
        insertAt(item.item, at);
        return;
      }
      // `at` is an insertion point, so removing the row first shifts every
      // position after it down by one.
      const to = at > item.index ? at - 1 : at;
      move(item.index, to);
    },
    [insertAt, move],
  );

  /**
   * Dragging, on pointer events rather than the browser's own drag and drop.
   *
   * HTML5 drag looks like the obvious fit and is a trap: Safari and Firefox
   * refuse to start a drag from a form control at all, an embedded browser
   * view may deliver `dragstart` and then no `dragover`, and a drop that
   * lands a few pixels off a row is silently refused — all of which look
   * identical to an adviser, who sees nothing pick up and nothing land.
   * Pointer events are the same three gestures in every browser, on a mouse
   * and on a touch screen, and they can be driven in a test.
   */
  const press = useRef<{ x: number; y: number; item: Dragging } | null>(null);

  /**
   * Follow the pointer even when it leaves the element it started on — which
   * it always does here, since the whole point is to end up somewhere else.
   *
   * Wrapped because a pointer id the browser does not recognize throws, and
   * an exception here would take the drag with it.
   */
  const capture = (e: ReactPointerEvent, on: boolean) => {
    try {
      if (on) e.currentTarget.setPointerCapture?.(e.pointerId);
      else e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // Nothing to do: the drag works without capture, it just stops early
      // if the pointer leaves the window.
    }
  };

  const startPress = (e: ReactPointerEvent, item: Dragging) => {
    // Left button only, and never from the buttons living inside a row.
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button') !== null) return;
    press.current = { x: e.clientX, y: e.clientY, item };
    capture(e, true);
  };

  const movePress = (e: ReactPointerEvent) => {
    const held = press.current;
    if (held === null) return;
    const far =
      Math.abs(e.clientX - held.x) > DRAG_THRESHOLD || Math.abs(e.clientY - held.y) > DRAG_THRESHOLD;
    // A press that has not moved is still a click — that is what adds a block
    // from the palette without dragging it anywhere.
    if (!far && drag === null) return;
    if (drag === null) setDrag(held.item);
    setGhostAt({ x: e.clientX, y: e.clientY });
    setOverIndex(indexAt(e.clientY));
    autoScroll(e.clientY);
  };

  const endPress = (e: ReactPointerEvent) => {
    const held = press.current;
    press.current = null;
    capture(e, false);
    if (drag !== null) dropAt(drag, overIndex ?? items.length);
    // A press that never became a drag is still a click, which appends.
    else if (held?.item.kind === 'add') addBlock(held.item.id);
    else if (held?.item.kind === 'mark') commit([...items, held.item.item]);
    setDrag(null);
    setOverIndex(null);
    setGhostAt(null);
  };

  const cancelPress = () => {
    press.current = null;
    setDrag(null);
    setOverIndex(null);
    setGhostAt(null);
  };

  useEffect(() => {
    if (drag === null) return;
    const onKey = (event: KeyboardEvent) => {
      // A drag that cannot be called off has to be finished somewhere, and
      // "somewhere" is wherever the pointer happens to be.
      if (event.key === 'Escape') cancelPress();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drag]);

  /**
   * Scrolls the list when the pointer nears its edge.
   *
   * The list is taller than the panel it sits in, so without this a drag can
   * only reach the rows that happen to be on screen when it starts.
   */
  const autoScroll = (clientY: number) => {
    // The list is what scrolls in the dialog and the editor is what scrolls
    // in the drawer, so this asks which of them actually can.
    const el = [list.current, root.current].find(
      (candidate) => candidate !== null && candidate.scrollHeight > candidate.clientHeight,
    );
    if (el === undefined || el === null) return;
    const box = el.getBoundingClientRect();
    const edge = 48;
    if (clientY < box.top + edge) el.scrollTop -= 14;
    else if (clientY > box.bottom - edge) el.scrollTop += 14;
  };

  const addBreak = useCallback(() => {
    commit([...items, { kind: 'break' }]);
  }, [items, commit]);

  const addSpace = useCallback(() => {
    commit([...items, { kind: 'space' }]);
  }, [items, commit]);

  /**
   * The two items that are not blocks, as one list so the chips that add them
   * cannot drift apart. `item()` is a factory rather than a constant: each
   * drop needs its own object, and a shared one would put the same identity
   * in the layout twice.
   */
  const MARKS: { label: string; item: () => LayoutItem; add: () => void }[] = [
    { label: 'Page break', item: () => ({ kind: 'break' }), add: addBreak },
    { label: 'Space', item: () => ({ kind: 'space' }), add: addSpace },
  ];

  const onExport = useCallback(() => {
    const current: ReportLayout = { ...layout, items };
    const blob = new Blob([serializeLayout(current)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${current.name.replace(/[^\w -]/g, '').trim() || 'report-layout'}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [layout, items]);

  const onImportFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const parsed = parseLayoutFile(await file.text());
      if (parsed === null) {
        setNote("That file isn't a report layout.");
        return;
      }
      importLayout(parsed);
      setDraftItems(null);
      setNote(`Imported “${parsed.name}”.`);
    },
    [importLayout, setDraftItems],
  );

  const omitted = omittedBlocks({ ...layout, items });

  return (
    <div
      ref={root}
      className={[
        'layout-editor',
        wide ? 'layout-editor-wide' : '',
        drag !== null ? 'is-dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="layout-picker">
        <label className="layout-picker-label" htmlFor={nameFieldId}>
          Layout
        </label>
        <select
          id={nameFieldId}
          value={selectedId}
          onChange={(e) => {
            setNote(null);
            select(e.target.value);
          }}
        >
          {layouts.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {isPreset(l.id) ? ' (preset)' : ''}
            </option>
          ))}
        </select>
      </div>

      {dirty && (
        <p className="layout-dirty">
          {editingPreset
            ? 'Presets can’t be changed. Save this as your own layout to keep it.'
            : 'Unsaved changes.'}
          <SaveAs
            defaultName={editingPreset ? `${layout.name} (mine)` : layout.name}
            onSave={(name) => {
              saveAs(name, items);
              setDraftItems(null);
              setNote(`Saved “${name}”.`);
            }}
          />
        </p>
      )}

      <ol className="layout-list" ref={list}>
        {items.map((item, index) => {
          const meta = item.kind === 'block' ? blockMeta(item.id) : undefined;
          const key = item.kind === 'block' ? item.id : `${item.kind}-${index}`;
          const skipped =
            item.kind === 'block' && shape !== undefined && !blockAppliesTo(item.id, shape);
          // A space can be dragged somewhere it cannot print. Saying which
          // is the difference between a layout that adapts and one an
          // adviser thinks is broken.
          const ignored = item.kind === 'space' ? spaceIgnored(items, index, shape) : null;
          const isHidden = item.kind === 'block' && item.hidden === true;
          // Where it starts in the report as it stands. Absent until the
          // first render lands, and for anything that prints nothing.
          const page = item.kind === 'block' ? blockPages?.get(item.id) : undefined;
          return (
            <li
              key={key}
              className={[
                'layout-row',
                item.kind === 'break' ? 'layout-row-break' : '',
                item.kind === 'space' ? 'layout-row-space' : '',
                isHidden ? 'layout-row-hidden' : '',
                skipped || ignored !== null ? 'layout-row-skipped' : '',
                overIndex === index ? 'layout-row-over' : '',
                drag?.kind === 'row' && drag.index === index ? 'layout-row-dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerDown={(e) => startPress(e, { kind: 'row', index, label: describe(item) })}
              onPointerMove={movePress}
              onPointerUp={endPress}
              onPointerCancel={cancelPress}
            >
              <span className="layout-grip" aria-hidden="true">
                ⠿
              </span>
              {item.kind === 'break' ? (
                <span className="layout-break-label">Page break</span>
              ) : item.kind === 'space' ? (
                <span className="layout-row-text">
                  <span className="layout-break-label">Space</span>
                  <span className="layout-row-blurb">{SPACE_BLURB[ignored ?? 'prints']}</span>
                </span>
              ) : (
                <span className="layout-row-text">
                  <span className="layout-row-name">
                    {meta?.label ?? item.id}
                    {page !== undefined && <span className="layout-row-page">Page {page}</span>}
                  </span>
                  <span className="layout-row-blurb">
                    {/* A block outside its household shape is dropped at
                        render, silently. Saying so here is the difference
                        between a layout that adapts and one that looks
                        broken when a single client's report comes out short. */}
                    {isHidden
                      ? 'Hidden. Kept here, left out of the report'
                      : skipped
                        ? `Not printed for ${SHAPE_NAME[shape!]}. Kept for other households`
                        : meta
                          ? `${meta.blurb} · ${FILL_LABEL[meta.fill]}`
                          : ''}
                  </span>
                </span>
              )}
              {/* Drag is the primary gesture; these are how it is done without
                  a mouse, and they are the only way on a touch screen. */}
              <span className="layout-row-actions">
                {item.kind === 'block' && (
                  <button
                    type="button"
                    className="layout-row-eye"
                    onClick={() => toggleHidden(index)}
                    aria-label={`${isHidden ? 'Show' : 'Hide'} ${describe(item)}`}
                  >
                    <EyeIcon hidden={isHidden} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move ${describe(item)} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  disabled={index === items.length - 1}
                  aria-label={`Move ${describe(item)} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  aria-label={`Remove ${describe(item)}`}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
        {/* Somewhere to let go past the last row. Without it the end of the
            report is the one position a dragged block cannot reach, and
            "add, then press ↓ eleven times" is what the drag was for. */}
        {drag !== null && (
          <li
            className={`layout-drop-end${overIndex === items.length ? ' layout-row-over' : ''}`}
          >
            Drop here to put it last
          </li>
        )}
      </ol>

      <div className="layout-add">
        {wide && <h3 className="layout-add-heading">Not in this report</h3>}
        {/* Spans carrying the button role, for the reason the block chips
            below give: a press on a real button is the browser's to
            interpret, and the gesture here is a press that may become a
            drag. Enter and Space still append, which is what a keyboard
            has. */}
        {MARKS.map((mark) => (
          <span
            key={mark.label}
            role="button"
            tabIndex={0}
            className="layout-add-break"
            onPointerDown={(e) =>
              startPress(e, { kind: 'mark', item: mark.item(), label: mark.label })
            }
            onPointerMove={movePress}
            onPointerUp={endPress}
            onPointerCancel={cancelPress}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                mark.add();
              }
            }}
          >
            + {mark.label}
          </span>
        ))}
        {omitted.length > 0 && !wide && <span className="layout-add-label">Not included</span>}
        {/* Draggable as well as clickable. Clicking appends, which is right
            for a keyboard and the only thing a touch screen can do; dragging
            puts it where the adviser already knows it belongs, instead of at
            the bottom to be walked up.

            A `span` carrying the button role rather than a `<button>`: a
            press on a real button is the browser's to interpret, and the
            gesture here is a press that may become a drag. Enter and Space
            still add it, which is what a keyboard has. */}
        {omitted.map((b) => (
          <span
            key={b.id}
            role="button"
            tabIndex={0}
            className="layout-add-block"
            onPointerDown={(e) => startPress(e, { kind: 'add', id: b.id, label: b.label })}
            onPointerMove={movePress}
            onPointerUp={endPress}
            onPointerCancel={cancelPress}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                addBlock(b.id);
              }
            }}
          >
            + {b.label}
          </span>
        ))}
        {omitted.length === 0 && BLOCKS.length > 0 && (
          <span className="layout-add-label">Every section is in this report.</span>
        )}
      </div>

      <div className="layout-actions">
        <button
          type="button"
          onClick={() => {
            const name = window.prompt('Name for the copy', `${layout.name} copy`);
            if (name === null) return;
            saveAs(name, items);
            setDraftItems(null);
            setNote(`Saved “${name}”.`);
          }}
        >
          Duplicate
        </button>
        <button type="button" onClick={onExport}>
          Export…
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Import…
        </button>
        {!editingPreset && (
          <>
            <button
              type="button"
              onClick={() => {
                const name = window.prompt('Rename layout', layout.name);
                if (name !== null) rename(selectedId, name);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Delete “${layout.name}”?`)) {
                  remove(selectedId);
                  setDraftItems(null);
                }
              }}
            >
              Delete
            </button>
          </>
        )}
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

      {/* What is in hand. The browser draws this for its own drag and not for
          this one, and a drag with nothing following the pointer reads as a
          drag that never started. */}
      {drag !== null && ghostAt !== null && (
        <div
          className="layout-ghost"
          style={{ left: ghostAt.x, top: ghostAt.y }}
          aria-hidden="true"
        >
          {drag.label}
        </div>
      )}
    </div>
  );
}

function describe(item: LayoutItem): string {
  if (item.kind === 'break') return 'page break';
  if (item.kind === 'space') return 'space';
  return blockMeta(item.id)?.label ?? item.id;
}

/** Name-and-save, inline rather than a prompt so the name can be seen first. */
function SaveAs({ defaultName, onSave }: { defaultName: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(defaultName);
  return (
    <span className="layout-saveas">
      <input
        type="text"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        aria-label="Layout name"
      />
      <button type="button" onClick={() => onSave(name)} disabled={!name.trim()}>
        Save
      </button>
    </span>
  );
}
