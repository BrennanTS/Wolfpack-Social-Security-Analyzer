import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeEditorDialog } from './ThemeEditorDialog';
import { DEFAULT_REPORT_THEME_ID, REPORT_THEMES, reportTheme } from '../lib/reportTheme';

const themes = () => ({
  themes: [...REPORT_THEMES],
  theme: reportTheme(DEFAULT_REPORT_THEME_ID),
  selectedId: DEFAULT_REPORT_THEME_ID,
  draft: null,
  setDraft: vi.fn(),
  select: vi.fn(),
  change: vi.fn(),
  isPreset: (id: string) => REPORT_THEMES.some((t) => t.id === id),
  saveAs: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  importTheme: vi.fn(),
});

function renderDialog(overrides: { open?: boolean; onClose?: () => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <ThemeEditorDialog open={overrides.open ?? true} onClose={onClose} themes={themes()} />,
  );
  return { onClose };
}

describe('ThemeEditorDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing at all when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a modal dialog with a name, not an anonymous overlay', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: /report theme/i })).toBeInTheDocument();
  });

  it('holds the editor, so the drawer and the dialog cannot drift', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: /firm/i })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Brand')).toBeInTheDocument();
  });

  it('closes on Escape, its own button, and the backdrop', async () => {
    const { onClose } = renderDialog();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: /close theme editor/i }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('asks for the inputs rather than showing an empty preview', () => {
    renderDialog();
    expect(screen.getByText(/fill in the dates and benefit amounts/i)).toBeInTheDocument();
  });

  it('holds the page behind it still, and gives it back on close', () => {
    const { rerender } = render(
      <ThemeEditorDialog open onClose={vi.fn()} themes={themes()} />,
    );
    expect(document.documentElement.style.overflow).toBe('hidden');
    rerender(<ThemeEditorDialog open={false} onClose={vi.fn()} themes={themes()} />);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('does not listen for Escape while closed', async () => {
    const { onClose } = renderDialog({ open: false });
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
