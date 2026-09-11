import { render, screen, within } from '@testing-library/react';
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

  it('keeps the household list behind a toggle', () => {
    // Thirty-two rows is a reference, not an opening argument.
    render(<ValidationPanel open onClose={vi.fn()} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows every pinned household when asked', async () => {
    render(<ValidationPanel open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Show all/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(VALIDATION_SCENARIOS.length);
  });

  it('links each household to ssa.tools with that household s own figures', async () => {
    // The link and the automated cross-check are built by one function, so
    // what the reader opens is the page the suite diffed — not a lookalike.
    render(<ValidationPanel open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Show all/ }));
    const rows = screen.getAllByRole('listitem');
    for (const row of rows) {
      const link = within(row).getByRole('link', { name: /Check on ssa\.tools/ });
      expect(link).toHaveAttribute('href', expect.stringContaining('ssa.tools/calculator#pia1='));
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('sends a 1 January birthday as the 1st, not a flattened day', async () => {
    // The one case where a wrong day opens a DIFFERENT claimant: SSA reads a
    // 1 January birthday into the previous FRA cohort.
    render(<ValidationPanel open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Show all/ }));
    const row = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('1/1/1960'));
    expect(row, 'a day-1 household should be listed').toBeDefined();
    expect(within(row!).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('dob1=1960-01-01'),
    );
    // And that household's FRA is the previous cohort's, which is the whole
    // reason it is pinned.
    expect(row!.textContent).toContain('66 years, 10 months');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<ValidationPanel open onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
