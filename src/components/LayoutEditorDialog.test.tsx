import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayoutEditorDialog } from './LayoutEditorDialog';
import { CLIENT_LAYOUT, PRESETS } from '../lib/reportLayout';

const layouts = () => ({
  layouts: [...PRESETS],
  layout: CLIENT_LAYOUT,
  selectedId: CLIENT_LAYOUT.id,
  select: vi.fn(),
  draftItems: null,
  setDraftItems: vi.fn(),
  isPreset: (id: string) => PRESETS.some((p) => p.id === id),
  saveAs: vi.fn(),
  update: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  importLayout: vi.fn(),
});

function renderDialog(overrides: { open?: boolean; onClose?: () => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <LayoutEditorDialog
      open={overrides.open ?? true}
      onClose={onClose}
      layouts={layouts()}
      shape="twoClaimants"
    />,
  );
  return { onClose };
}

describe('LayoutEditorDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing at all when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a modal dialog with a name, not an anonymous overlay', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: /report layout/i })).toBeInTheDocument();
  });

  it('holds the same editor the drawer did, so neither can drift', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(CLIENT_LAYOUT.items.length);
    expect(within(dialog).getByRole('button', { name: /\+ Page break/ })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    // The dialog covers the app; a reader who cannot dismiss it with the key
    // every other dialog answers to is stuck.
    const { onClose } = renderDialog();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on its own button and on the backdrop', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /close layout editor/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('asks for the inputs rather than showing an empty preview', () => {
    // The dialog is reachable before a household is complete; the layout is
    // still editable, there is simply nothing to render yet.
    renderDialog();
    expect(screen.getByText(/fill in the dates and benefit amounts/i)).toBeInTheDocument();
  });

  it('does not listen for Escape while closed', () => {
    // A dialog that answers keystrokes it cannot see would close itself the
    // next time anything else on the page used Escape.
    const { onClose } = renderDialog({ open: false });
    return userEvent.keyboard('{Escape}').then(() => {
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
