import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

function renderDialog(over: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const props = {
    open: true,
    title: 'Start a new client?',
    body: 'Priya has not been saved. Starting a new one clears the form.',
    onCancel: vi.fn(),
    choices: [
      { label: 'Save, then start new', onChoose: vi.fn(), primary: true },
      { label: 'Discard and start new', onChoose: vi.fn() },
    ],
    ...over,
  };
  render(<ConfirmDialog {...props} />);
  return props;
}

describe('ConfirmDialog', () => {
  it('renders nothing at all when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('is an alert dialog, not a plain one', () => {
    // It interrupts to ask something. The distinction is what tells a screen
    // reader to announce the question rather than wait to be explored.
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Start a new client?');
    expect(dialog).toHaveAccessibleDescription(/has not been saved/);
  });

  it('opens focused on the safe choice, not the destructive one', () => {
    // A stray Return should not be what clears an adviser's afternoon.
    renderDialog();
    expect(screen.getByRole('button', { name: /save, then start new/i })).toHaveFocus();
  });

  it('runs the choice that was picked, and only that one', async () => {
    const props = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /discard and start new/i }));
    expect(props.choices[1].onChoose).toHaveBeenCalled();
    expect(props.choices[0].onChoose).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('treats Escape and the backdrop as the answer that changes nothing', async () => {
    const props = renderDialog();
    await userEvent.keyboard('{Escape}');
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /dismiss without changing/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(2);
    for (const choice of props.choices) expect(choice.onChoose).not.toHaveBeenCalled();
  });

  it('does not listen for Escape while closed', async () => {
    const props = renderDialog({ open: false });
    await userEvent.keyboard('{Escape}');
    expect(props.onCancel).not.toHaveBeenCalled();
  });
});
