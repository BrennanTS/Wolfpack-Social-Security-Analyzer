import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportLayoutEditor } from './ReportLayoutEditor';
import {
  ADVISER_LAYOUT,
  CLIENT_LAYOUT,
  PRESETS,
  type LayoutItem,
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
function Harness(props: ReturnType<typeof store> & { shape?: 'oneClaimant' | 'twoClaimants' | 'widowed' }) {
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
