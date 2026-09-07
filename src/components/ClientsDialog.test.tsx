import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientsDialog } from './ClientsDialog';
import type { ClientRecord } from '../lib/clientRecord';

const saved = (over: Partial<ClientRecord> = {}): ClientRecord => ({
  id: 'client-1',
  label: 'Dan and Sarah',
  names: { a: 'Dan', b: 'Sarah' },
  params: 'ay=1962&am=4&ag=m&ab=2400',
  savedAt: Date.parse('2026-09-01T12:00:00Z'),
  ...over,
});

function store(list: ClientRecord[] = []) {
  return {
    clients: list,
    save: vi.fn((r) => ({ ...r, id: 'new-id', savedAt: 1 })),
    update: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    importClients: vi.fn(),
  };
}

function renderDialog(over: Partial<Parameters<typeof ClientsDialog>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    clients: store(),
    openClientId: null,
    currentView: {
      params: 'an=Dan&ay=1962&am=4&ag=m&ab=2400&th=midnight&ly=preset-adviser',
      suggestedLabel: 'Dan',
      complete: true,
    },
    onOpenClient: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  };
  render(<ClientsDialog {...props} />);
  return props;
}

describe('ClientsDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing at all when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says where the records live, unprompted', () => {
    // An adviser is entitled to know a client list is in their browser and
    // nowhere else before they put a household in it.
    renderDialog();
    expect(screen.getByText(/saved in this browser only/i)).toBeInTheDocument();
    expect(screen.getByText(/theme and layout/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument();
  });

  it('saves what is on screen under a suggested name', async () => {
    const props = renderDialog();
    expect(screen.getByLabelText(/save what is on screen/i)).toHaveValue('Dan');
    await userEvent.click(screen.getByRole('button', { name: /save as new/i }));
    expect(props.clients.save).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Dan',
        params: 'an=Dan&ay=1962&am=4&ag=m&ab=2400&th=midnight&ly=preset-adviser',
        // Read back out of the view rather than passed in beside it.
        names: { a: 'Dan' },
      }),
    );
    expect(props.onSaved).toHaveBeenCalledWith('new-id');
  });

  it('will not save a half-filled form', async () => {
    // The record is the view; saving one that cannot be analyzed stores a
    // blank form under a client's name.
    renderDialog({
      currentView: { params: '', suggestedLabel: 'Saved Sep 7', complete: false },
    });
    expect(screen.getByRole('button', { name: /save as new/i })).toBeDisabled();
    expect(screen.getByText(/fill in the dates and benefit amounts/i)).toBeInTheDocument();
  });

  it('offers to overwrite only the record the view came from', async () => {
    renderDialog();
    expect(screen.queryByRole('button', { name: /update open/i })).not.toBeInTheDocument();
    const props = renderDialog({ clients: store([saved()]), openClientId: 'client-1' });
    await userEvent.click(screen.getByRole('button', { name: /update open/i }));
    expect(props.clients.update).toHaveBeenCalledWith('client-1', expect.anything());
  });

  it('lists what is saved, with who is in it and when', () => {
    renderDialog({ clients: store([saved()]) });
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Dan and Sarah')).toBeInTheDocument();
    expect(within(row).getByText(/Dan and Sarah · saved/)).toBeInTheDocument();
  });

  it('opens a saved client', async () => {
    const props = renderDialog({ clients: store([saved()]) });
    await userEvent.click(screen.getByRole('button', { name: /^open$/i }));
    expect(props.onOpenClient).toHaveBeenCalledWith(expect.objectContaining({ id: 'client-1' }));
  });

  it('asks before deleting, and does nothing when refused', async () => {
    const props = renderDialog({ clients: store([saved()]) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(props.clients.remove).not.toHaveBeenCalled();
  });

  it('says so plainly when there is nothing saved yet', () => {
    renderDialog();
    expect(screen.getByText(/nothing saved yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('closes on Escape and on the backdrop', async () => {
    const props = renderDialog();
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /close clients/i }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('holds the page behind it still', () => {
    renderDialog();
    expect(document.documentElement.style.overflow).toBe('hidden');
  });
});
