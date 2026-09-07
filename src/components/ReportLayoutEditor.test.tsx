import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportLayoutEditor } from './ReportLayoutEditor';
import { ADVISER_LAYOUT, CLIENT_LAYOUT, PRESETS, type ReportLayout } from '../lib/reportLayout';

/** A store whose calls can be inspected, so these tests are about the editor. */
function store(overrides: Partial<ReturnType<typeof base>> = {}) {
  return { ...base(), ...overrides };
}

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
  };
}

const rowNames = () =>
  screen.getAllByRole('listitem').map((li) => li.textContent?.trim().slice(0, 40) ?? '');

describe('ReportLayoutEditor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the selected layout in order', () => {
    render(<ReportLayoutEditor {...store()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(CLIENT_LAYOUT.items.length);
    expect(rowNames()[0]).toContain('Your Social Security decision');
  });

  it('offers every block the layout leaves out, and none it already has', () => {
    render(<ReportLayoutEditor {...store()} />);
    // The client preset omits the grid; it must be one click from being in.
    expect(screen.getByRole('button', { name: /\+ Claiming age grid/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+ Your action plan/ })).not.toBeInTheDocument();
  });

  it('says so when nothing is left to add', () => {
    render(<ReportLayoutEditor {...store({ layout: ADVISER_LAYOUT, selectedId: ADVISER_LAYOUT.id })} />);
    expect(screen.getByText(/every section is in this report/i)).toBeInTheDocument();
  });

  it('moves a block with the arrows, not only by dragging', () => {
    // Drag is the gesture the feature was asked for; these are how it is done
    // from a keyboard, and the only way on a touch screen. A drag-only editor
    // is a locked door.
    const s = store();
    render(<ReportLayoutEditor {...s} />);
    const [first] = rowNames();
    expect(first).toContain('Your Social Security decision');
    return userEvent
      .click(screen.getByRole('button', { name: /move Your Social Security decision down/i }))
      .then(() => {
        // A preset is not written through; it becomes a draft shown in place.
        expect(s.update).not.toHaveBeenCalled();
        expect(rowNames()[1]).toContain('Your Social Security decision');
      });
  });

  it('cannot move the first block up or the last one down', () => {
    render(<ReportLayoutEditor {...store()} />);
    expect(screen.getByRole('button', { name: /move Your Social Security decision up/i })).toBeDisabled();
  });

  it('removes a block, and offers it back', async () => {
    render(<ReportLayoutEditor {...store()} />);
    await userEvent.click(screen.getByRole('button', { name: /remove Your action plan/i }));
    expect(rowNames().join(' ')).not.toContain('Your action plan');
    expect(screen.getByRole('button', { name: /\+ Your action plan/ })).toBeInTheDocument();
  });

  it('adds a page break', async () => {
    render(<ReportLayoutEditor {...store()} />);
    await userEvent.click(screen.getByRole('button', { name: /\+ Page break/ }));
    expect(screen.getByText('Page break')).toBeInTheDocument();
  });

  it('will not write an edit back into a preset', async () => {
    // Presets are code. Editing one in place would fork what "Client" means
    // for this browser only, silently.
    const s = store();
    render(<ReportLayoutEditor {...s} />);
    await userEvent.click(screen.getByRole('button', { name: /\+ Page break/ }));
    expect(s.update).not.toHaveBeenCalled();
    expect(screen.getByText(/presets can’t be changed/i)).toBeInTheDocument();
  });

  it('saves an edited preset under a new name', async () => {
    const s = store();
    render(<ReportLayoutEditor {...s} />);
    await userEvent.click(screen.getByRole('button', { name: /\+ Page break/ }));
    await userEvent.clear(screen.getByLabelText(/layout name/i));
    await userEvent.type(screen.getByLabelText(/layout name/i), 'Estate review');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(s.saveAs).toHaveBeenCalledWith('Estate review', expect.any(Array));
  });

  it('writes edits straight through for a layout of your own', async () => {
    const mine: ReportLayout = { id: 'mine', name: 'Mine', items: CLIENT_LAYOUT.items };
    const s = store({ layout: mine, selectedId: 'mine', layouts: [...PRESETS, mine] });
    render(<ReportLayoutEditor {...s} />);
    await userEvent.click(screen.getByRole('button', { name: /\+ Page break/ }));
    expect(s.update).toHaveBeenCalledWith('mine', expect.any(Array));
    expect(screen.queryByText(/presets can’t be changed/i)).not.toBeInTheDocument();
  });

  it('offers rename and delete only for a layout you own', () => {
    const { unmount } = render(<ReportLayoutEditor {...store()} />);
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
    unmount();
    const mine: ReportLayout = { id: 'mine', name: 'Mine', items: CLIENT_LAYOUT.items };
    render(<ReportLayoutEditor {...store({ layout: mine, selectedId: 'mine' })} />);
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });
});
