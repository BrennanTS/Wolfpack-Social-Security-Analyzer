import { useCallback, useId, useRef, useState } from 'react';
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

/** What a space says about itself, including when it will do nothing. */
const SPACE_BLURB: Record<'edge' | 'person' | 'prints', string> = {
  prints: 'Extra room before what follows — add another for a wider gap',
  edge: 'Nothing to separate here — the page margin already does it',
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
}: ReturnType<typeof useReportLayouts> & {
  /** The household on screen, so the editor can say what it will skip. */
  shape?: HouseholdDisplayShape;
  /**
   * Two columns instead of one — the report on the left, what is not in it on
   * the right. Only a layout change: the drawer and the dialog run the same
   * editor, so neither can grow behavior the other lacks.
   */
  wide?: boolean;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
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

  const addBreak = useCallback(() => {
    commit([...items, { kind: 'break' }]);
  }, [items, commit]);

  const addSpace = useCallback(() => {
    commit([...items, { kind: 'space' }]);
  }, [items, commit]);

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
    <div className={wide ? 'layout-editor layout-editor-wide' : 'layout-editor'}>
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

      <ol className="layout-list">
        {items.map((item, index) => {
          const meta = item.kind === 'block' ? blockMeta(item.id) : undefined;
          const key = item.kind === 'block' ? item.id : `${item.kind}-${index}`;
          const skipped =
            item.kind === 'block' && shape !== undefined && !blockAppliesTo(item.id, shape);
          // A space can be dragged somewhere it cannot print. Saying which
          // is the difference between a layout that adapts and one an
          // adviser thinks is broken.
          const ignored = item.kind === 'space' ? spaceIgnored(items, index, shape) : null;
          return (
            <li
              key={key}
              className={[
                'layout-row',
                item.kind === 'break' ? 'layout-row-break' : '',
                item.kind === 'space' ? 'layout-row-space' : '',
                skipped || ignored !== null ? 'layout-row-skipped' : '',
                overIndex === index ? 'layout-row-over' : '',
                dragIndex === index ? 'layout-row-dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(index);
              }}
              onDragLeave={() => setOverIndex((i) => (i === index ? null : i))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
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
                  <span className="layout-row-name">{meta?.label ?? item.id}</span>
                  <span className="layout-row-blurb">
                    {/* A block outside its household shape is dropped at
                        render, silently. Saying so here is the difference
                        between a layout that adapts and one that looks
                        broken when a single client's report comes out short. */}
                    {skipped
                      ? `Not printed for ${SHAPE_NAME[shape!]} — kept for other households`
                      : meta
                        ? `${meta.blurb} · ${FILL_LABEL[meta.fill]}`
                        : ''}
                  </span>
                </span>
              )}
              {/* Drag is the primary gesture; these are how it is done without
                  a mouse, and they are the only way on a touch screen. */}
              <span className="layout-row-actions">
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
      </ol>

      <div className="layout-add">
        {wide && <h3 className="layout-add-heading">Not in this report</h3>}
        <button type="button" className="layout-add-break" onClick={addBreak}>
          + Page break
        </button>
        <button type="button" className="layout-add-break" onClick={addSpace}>
          + Space
        </button>
        {omitted.length > 0 && !wide && <span className="layout-add-label">Not included</span>}
        {omitted.map((b) => (
          <button key={b.id} type="button" className="layout-add-block" onClick={() => addBlock(b.id)}>
            + {b.label}
          </button>
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
