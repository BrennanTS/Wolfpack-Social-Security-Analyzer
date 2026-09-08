import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportLayoutEditor } from './ReportLayoutEditor';
import {
  ADVISER_LAYOUT,
  CLIENT_LAYOUT,
  PRESETS,
  type LayoutItem,
  type ReportBlockId,
  type ReportLayout,
} from '../lib/reportLayout';

/** A store whose calls can be inspected, so these tests are about the editor. */
function store(overrides: Partial<ReturnType<typeof base>> = {}) {
  return { ...base(), ...overrides };
}

/**
 * Renders the editor against a store that really holds the draft.
 *
 * The draft lives in the store, not the component — that is what makes the
 * export show what the editor shows — so a stub with a frozen `draftItems`
 * would never re-render and every assertion about the visible list would be
 * about nothing.
 */
function Harness(
  props: ReturnType<typeof store> & {
    shape?: 'oneClaimant' | 'twoClaimants' | 'widowed';
    blockPages?: ReadonlyMap<ReportBlockId, number>;
  },
) {
  const [draftItems, setDraftItems] = useState<LayoutItem[] | null>(props.draftItems ?? null);
  const layout = draftItems === null ? props.layout : { ...props.layout, items: draftItems };
  return <ReportLayoutEditor {...props} layout={layout} draftItems={draftItems} setDraftItems={setDraftItems} />;
}

const renderEditor = (
  s: ReturnType<typeof store> = store(),
  shape?: 'oneClaimant' | 'twoClaimants' | 'widowed',
) => render(<Harness {...s} shape={shape} />);

function base() {
  return {
    layouts: [...PRESETS] as ReportLayout[],
    layout: CLIENT_LAYOUT,
    selectedId: CLIENT_LAYOUT.id,
    select: vi.fn(),
    isPreset: (id: string) => PRESETS.some((p) => p.id === id),
    saveAs: vi.fn(),
    update: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    importLayout: vi.fn(),
    draftItems: null,
    setDraftItems: vi.fn(),
  };
}

const rowNames = () =>
  screen.getAllByRole('listitem').map((li) => li.textContent?.trim().slice(0, 40) ?? '');

/**
 * A pointer drag, the way the editor implements one.
 *
 * jsdom's pointer events carry no coordinates and no button, so they are put
 * back on by hand — the editor reads `clientY`, `button` and nothing else.
 */
function pointer(type: 'pointerDown' | 'pointerMove' | 'pointerUp', clientY: number, target?: HTMLElement) {
  const event = createEvent[type](target ?? document.body);
  Object.defineProperty(event, 'clientX', { value: 0 });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'button', { value: 0 });
  if (target !== undefined) Object.defineProperty(event, 'target', { value: target });
  return event;
}

const press = (el: HTMLElement, y: number) => fireEvent(el, pointer('pointerDown', y));
const move = (el: HTMLElement, y: number) => fireEvent(el, pointer('pointerMove', y));
const release = (el: HTMLElement, y: number) => fireEvent(el, pointer('pointerUp', y));

/** Press, drag to `y`, let go. */
function dragFrom(el: HTMLElement, y: number) {
  press(el, 0);
  move(el, y);
  release(el, y);
}

/** jsdom lays nothing out, so the rows are given somewhere to be. */
function layOutRows() {
  screen.getAllByRole('listitem').forEach((row, i) => {
    row.getBoundingClientRect = () => ({ top: i * 50, height: 40 }) as DOMRect;
  });
}

const twoRowStore = () => {
  const mine: ReportLayout = {
    id: 'mine',
    name: 'Mine',
    items: [
      { kind: 'block', id: 'answer' },
      { kind: 'block', id: 'terms' },
    ],
  };
  return store({ layout: mine, selectedId: 'mine', layouts: [...PRESETS, mine] });
};

describe('ReportLayoutEditor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the selected layout in order', () => {
    renderEditor();
    expect(screen.getAllByRole('listitem')).toHaveLength(CLIENT_LAYOUT.items.length);
    // The client preset opens on its cover.
    expect(rowNames()[0]).toContain('Cover');
  });

  it('offers every block the layout leaves out, and none it already has', () => {
    renderEditor();
    // The client preset omits the grid; it must be one click from being in.
    expect(screen.getByRole('button', { name: /\+ Claiming age grid/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+ Your action plan/ })).not.toBeInTheDocument();
  });

  it('says so when nothing is left to add', () => {
    renderEditor(store({ layout: ADVISER_LAYOUT, selectedId: ADVISER_LAYOUT.id }));
    expect(screen.getByText(/every section is in this report/i)).toBeInTheDocument();
  });

  it('moves a block with the arrows, not only by dragging', () => {
    // Drag is the gesture the feature was asked for; these are how it is done
    // from a keyboard, and the only way on a touch screen. A drag-only editor
    // is a locked door.
    const s = store();
    renderEditor(s);
    const [first] = rowNames();
    expect(first).toContain('Cover');
    return userEvent
      .click(screen.getByRole('button', { name: /move Cover down/i }))
      .then(() => {
        // A preset is not written through; it becomes a draft shown in place.
        expect(s.update).not.toHaveBeenCalled();
        expect(rowNames()[1]).toContain('Cover');
      });
  });

  it('cannot move the first block up or the last one down', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: /move Cover up/i })).toBeDisabled();
  });

  it('removes a block, and offers it back', async () => {
    renderEditor();
    await userEvent.click(screen.getByRole('button', { name: /remove Your action plan/i }));
    expect(rowNames().join(' ')).not.toContain('Your action plan');
    expect(screen.getByRole('button', { name: /\+ Your action plan/ })).toBeInTheDocument();
  });

  it('adds a page break', async () => {
    renderEditor();
    // The client preset already carries one, after its cover.
    const before = screen.getAllByText('Page break').length;
    await userEvent.click(screen.getByRole('button', { name: /\+ Page break/ }));
    expect(screen.getAllByText('Page break')).toHaveLength(before + 1);
  });

  it('adds a space, and says what it will do there', async () => {
    // A space is the answer to two blocks that read as one; the row has to
    // say so, or it looks like a break that failed to break.
    renderEditor();
    await userEvent.click(screen.getByRole('button', { name: /\+ Space/ }));
    expect(screen.getByText('Space')).toBeInTheDocument();
    expect(screen.getByText(/nothing to separate here/i)).toBeInTheDocument();
  });

  it('says when a space sits somewhere it cannot print', async () => {
    // Between two per-person sections there is nowhere for it to go: they
    // print together, once per claimant.
    const mine: ReportLayout = {
      id: 'mine',
      name: 'Mine',
      items: [
        { kind: 'block', id: 'personDetails' },
        { kind: 'space' },
        { kind: 'block', id: 'personRamp' },
      ],
    };
    renderEditor(store({ layout: mine, selectedId: 'mine', layouts: [...PRESETS, mine] }), 'twoClaimants');
    expect(screen.getByText(/not printed between two per-person sections/i)).toBeInTheDocument();
  });

  it('keeps a space that has a block on either side', async () => {
    const mine: ReportLayout = {
      id: 'mine',
      name: 'Mine',
      items: [
        { kind: 'block', id: 'answer' },
        { kind: 'space' },
        { kind: 'block', id: 'terms' },
      ],
    };
    renderEditor(store({ layout: mine, selectedId: 'mine', layouts: [...PRESETS, mine] }), 'twoClaimants');
    expect(screen.getByText(/extra room before what follows/i)).toBeInTheDocument();
  });

  it('moves and removes a space by keyboard, like every other row', async () => {
    const mine: ReportLayout = {
      id: 'mine',
      name: 'Mine',
      items: [
        { kind: 'block', id: 'answer' },
        { kind: 'space' },
        { kind: 'block', id: 'terms' },
      ],
    };
    const s = store({ layout: mine, selectedId: 'mine', layouts: [...PRESETS, mine] });
    renderEditor(s, 'twoClaimants');
    await userEvent.click(screen.getByRole('button', { name: /move space up/i }));
    expect(s.update).toHaveBeenCalledWith('mine', [
      { kind: 'space' },
      { kind: 'block', id: 'answer' },
      { kind: 'block', id: 'terms' },
    ]);
    await userEvent.click(screen.getByRole('button', { name: /remove space/i }));
    expect(s.update).toHaveBeenLastCalledWith('mine', [
      { kind: 'block', id: 'answer' },
      { kind: 'block', id: 'terms' },
    ]);
  });

  it('hides a block without moving it', async () => {
    // Removing and re-adding costs the position: the block returns to the end
    // of the list and has to be walked back up. Hiding answers "how does it
    // read without this section", which is the question actually being asked.
    const mine: ReportLayout = {
      id: 'mine',
      name: 'Mine',
      items: [
        { kind: 'block', id: 'answer' },
        { kind: 'block', id: 'changes' },
        { kind: 'block', id: 'terms' },
      ],
    };
    const s = store({ layout: mine, selectedId: 'mine', layouts: [...PRESETS, mine] });
    renderEditor(s, 'twoClaimants');
    await userEvent.click(screen.getByRole('button', { name: /^hide what changes, and when$/i }));
    expect(s.update).toHaveBeenCalledWith('mine', [
      { kind: 'block', id: 'answer' },
      { kind: 'block', id: 'changes', hidden: true },
      { kind: 'block', id: 'terms' },
    ]);
  });

  it('offers to show a block that is hidden, and says it is', async () => {
    const mine: ReportLayout = {
      id: 'mine',
      name: 'Mine',
      items: [{ kind: 'block', id: 'answer', hidden: true }],
    };
    const s = store({ layout: mine, selectedId: 'mine', layouts: [...PRESETS, mine] });
    renderEditor(s, 'twoClaimants');
    expect(screen.getByText(/hidden\. kept here, left out of the report/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^show your social security decision$/i }));
    expect(s.update).toHaveBeenCalledWith('mine', [{ kind: 'block', id: 'answer' }]);
  });

  it('adds a block from the palette where it is dragged, not at the end', async () => {
    // Adding at the bottom and pressing ↓ eleven times is what the drag is
    // for; a palette that only appends leaves the reordering to be done twice.
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    layOutRows();
    // 45 is past the middle of the first row and before the middle of the
    // second, so it lands between them — including in the gap, which the
    // rows themselves do not cover.
    dragFrom(screen.getByRole('button', { name: /\+ Your action plan/ }), 45);
    expect(s.update).toHaveBeenCalledWith('mine', [
      { kind: 'block', id: 'answer' },
      { kind: 'block', id: 'action' },
      { kind: 'block', id: 'terms' },
    ]);
  });

  it('drags a page break to a position, rather than only appending one', async () => {
    // The two items whose whole purpose is being at a particular position
    // were the two that could only be added at the end. Reported by Dan:
    // "the Page break and Space sections were not drag and dropping".
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    layOutRows();
    dragFrom(screen.getByRole('button', { name: /\+ Page break/ }), 45);
    expect(s.update).toHaveBeenCalledWith('mine', [
      { kind: 'block', id: 'answer' },
      { kind: 'break' },
      { kind: 'block', id: 'terms' },
    ]);
  });

  it('drags a space to a position too', () => {
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    layOutRows();
    dragFrom(screen.getByRole('button', { name: /\+ Space/ }), 45);
    expect(s.update).toHaveBeenCalledWith('mine', [
      { kind: 'block', id: 'answer' },
      { kind: 'space' },
      { kind: 'block', id: 'terms' },
    ]);
  });

  it('still appends a page break on a press that never moved', async () => {
    // Clicking is what a keyboard and a touch screen have, and it must keep
    // meaning "put it at the end" rather than becoming a dead gesture.
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    await userEvent.click(screen.getByRole('button', { name: /\+ Page break/ }));
    expect(s.update).toHaveBeenCalledWith('mine', [
      { kind: 'block', id: 'answer' },
      { kind: 'block', id: 'terms' },
      { kind: 'break' },
    ]);
  });

  it('drops past the last row, and says so while the drag is on', () => {
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    layOutRows();
    expect(screen.queryByText(/put it last/i)).not.toBeInTheDocument();
    const chip = screen.getByRole('button', { name: /\+ Your action plan/ });
    press(chip, 0);
    move(chip, 400);
    expect(screen.getByText(/put it last/i)).toBeInTheDocument();
    release(chip, 400);
    expect(s.update).toHaveBeenCalledWith('mine', [
      { kind: 'block', id: 'answer' },
      { kind: 'block', id: 'terms' },
      { kind: 'block', id: 'action' },
    ]);
  });

  it('shows what is in hand, so a drag that started looks like one', () => {
    // The browser draws nothing for a pointer drag. Without this an adviser
    // sees no difference between a drag in progress and a dead gesture.
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    layOutRows();
    const chip = screen.getByRole('button', { name: /\+ Your action plan/ });
    press(chip, 0);
    move(chip, 45);
    expect(document.querySelector('.layout-ghost')?.textContent).toBe('Your action plan');
    release(chip, 45);
    expect(document.querySelector('.layout-ghost')).toBeNull();
  });

  it('treats a press that never moves as a click, and adds at the end', () => {
    // Which is what a keyboard and a touch screen have.
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    layOutRows();
    const chip = screen.getByRole('button', { name: /\+ Your action plan/ });
    press(chip, 10);
    release(chip, 11);
    expect(s.update).toHaveBeenCalledWith('mine', [
      { kind: 'block', id: 'answer' },
      { kind: 'block', id: 'terms' },
      { kind: 'block', id: 'action' },
    ]);
  });

  it('calls a drag off on Escape, changing nothing', async () => {
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    layOutRows();
    const chip = screen.getByRole('button', { name: /\+ Your action plan/ });
    press(chip, 0);
    move(chip, 45);
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('.layout-ghost')).toBeNull();
    release(chip, 45);
    expect(s.update).not.toHaveBeenCalled();
  });

  it('still moves a row that is dragged over another', () => {
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    layOutRows();
    // The second row, taken above the middle of the first.
    dragFrom(screen.getAllByRole('listitem')[1], 5);
    expect(s.update).toHaveBeenCalledWith('mine', [
      { kind: 'block', id: 'terms' },
      { kind: 'block', id: 'answer' },
    ]);
  });

  it('does not start a drag from the buttons inside a row', () => {
    // The eye and the arrows are pressed, not dragged, and a press that
    // turned into a drag would make them unusable.
    const s = twoRowStore();
    renderEditor(s, 'twoClaimants');
    layOutRows();
    const row = screen.getAllByRole('listitem')[0];
    const eye = screen.getByRole('button', { name: /^hide your social security decision$/i });
    fireEvent(row, pointer('pointerDown', 0, eye));
    fireEvent(row, pointer('pointerMove', 60));
    expect(document.querySelector('.layout-ghost')).toBeNull();
  });

  it('says which page each block starts on', async () => {
    // Measured by the preview as it renders, because it cannot be worked out
    // from the list: one long table above moves everything after it.
    render(
      <Harness
        {...store()}
        shape="twoClaimants"
        blockPages={new Map([['cover', 1], ['answer', 2]])}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(/Cover\s*Page 1/);
    expect(screen.getByText('Page 2')).toBeInTheDocument();
  });

  it('leaves the page unnamed before the first render lands', () => {
    // The dialog is reachable before the inputs are complete, and a made-up
    // page number is worse than none.
    renderEditor();
    expect(screen.queryByText(/^Page \d/)).not.toBeInTheDocument();
  });

  it('will not write an edit back into a preset', async () => {
    // Presets are code. Editing one in place would fork what "Client" means
    // for this browser only, silently.
    const s = store();
    renderEditor(s);
    await userEvent.click(screen.getByRole('button', { name: /\+ Page break/ }));
    expect(s.update).not.toHaveBeenCalled();
    expect(screen.getByText(/presets can’t be changed/i)).toBeInTheDocument();
  });

  it('saves an edited preset under a new name', async () => {
    const s = store();
    renderEditor(s);
    await userEvent.click(screen.getByRole('button', { name: /\+ Page break/ }));
    await userEvent.clear(screen.getByLabelText(/layout name/i));
    await userEvent.type(screen.getByLabelText(/layout name/i), 'Estate review');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(s.saveAs).toHaveBeenCalledWith('Estate review', expect.any(Array));
  });

  it('writes edits straight through for a layout of your own', async () => {
    const mine: ReportLayout = { id: 'mine', name: 'Mine', items: CLIENT_LAYOUT.items };
    const s = store({ layout: mine, selectedId: 'mine', layouts: [...PRESETS, mine] });
    renderEditor(s);
    await userEvent.click(screen.getByRole('button', { name: /\+ Page break/ }));
    expect(s.update).toHaveBeenCalledWith('mine', expect.any(Array));
    expect(screen.queryByText(/presets can’t be changed/i)).not.toBeInTheDocument();
  });

  it('duplicates any layout, so a second variant need not restart from a preset', async () => {
    // Editing your own layout writes through in place, so without this the
    // only way to a second custom layout is back to a preset and start again.
    const s = store();
    vi.spyOn(window, 'prompt').mockReturnValue('Married — long');
    renderEditor(s);
    await userEvent.click(screen.getByRole('button', { name: /^duplicate$/i }));
    expect(s.saveAs).toHaveBeenCalledWith('Married — long', expect.any(Array));
  });

  it('does not duplicate when the name prompt is dismissed', async () => {
    const s = store();
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    renderEditor(s);
    await userEvent.click(screen.getByRole('button', { name: /^duplicate$/i }));
    expect(s.saveAs).not.toHaveBeenCalled();
  });

  it('says which blocks this household will not receive', () => {
    // Blocks outside their household shape are dropped at render, silently.
    // Unflagged, a single client's short report looks like a bug.
    renderEditor(store(), 'oneClaimant');
    expect(screen.getByText(/not printed for a single client/i)).toBeInTheDocument();
  });

  it('flags nothing when every block applies', () => {
    renderEditor(store(), 'twoClaimants');
    expect(screen.queryByText(/not printed for/i)).not.toBeInTheDocument();
  });

  it('says nothing about households when there is no analysis yet', () => {
    renderEditor();
    expect(screen.queryByText(/not printed for/i)).not.toBeInTheDocument();
  });

  it('offers rename and delete only for a layout you own', () => {
    const { unmount } = renderEditor();
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
    unmount();
    const mine: ReportLayout = { id: 'mine', name: 'Mine', items: CLIENT_LAYOUT.items };
    renderEditor(store({ layout: mine, selectedId: 'mine' }));
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });
});
