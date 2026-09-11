import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValidationPanel } from './ValidationPanel';
import { VALIDATION_SCENARIOS } from '../lib/validationSummary';

describe('ValidationPanel', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<ValidationPanel open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leads with a count a non-technical reader can repeat', () => {
    render(<ValidationPanel open onClose={vi.fn()} />);
    expect(screen.getByText(/How this is checked/)).toBeInTheDocument();
    expect(screen.getByText(`${VALIDATION_SCENARIOS.length} worked households`)).toBeInTheDocument();
  });

  it('scopes the claim to the worked examples, not the reader s own figures', () => {
    // A validation claim inside a client-facing app is a marketing claim.
    // It has to say what it does NOT cover, in the same breath.
    render(<ValidationPanel open onClose={vi.fn()} />);
    expect(screen.getByText(/not your own figures/i)).toBeInTheDocument();
    expect(screen.getByText(/set by the Social Security Administration when you apply/i))
      .toBeInTheDocument();
    // And it must not imply endorsement by an agency that has not endorsed it.
    expect(screen.getByText(/affiliated with or endorsed by SSA/i)).toBeInTheDocument();
  });

  it('keeps the household table behind a button', () => {
    // Thirty-two rows is a reference, not an opening argument.
    render(<ValidationPanel open onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the table over itself rather than in place of itself', async () => {
    // The paragraph that introduces the households is worth still being there
    // when the table closes, so the panel does not step aside for it the way
    // it does for another drawer.
    render(<ValidationPanel open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Show all/ }));
    expect(screen.getByRole('dialog', { name: /worked households/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /How this is checked/ })).toBeInTheDocument();
  });

  it('closes the table on Escape without also closing the panel behind it', async () => {
    // Both listen for Escape. One press should close what the reader is
    // looking at, not take them two steps back.
    const onClose = vi.fn();
    render(<ValidationPanel open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /Show all/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<ValidationPanel open onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
