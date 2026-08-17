import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AboutPanel } from './AboutPanel';

describe('AboutPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<AboutPanel open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('carries the five method cards', () => {
    render(<AboutPanel open onClose={() => {}} />);
    for (const title of [
      'Full Retirement Age (FRA)',
      'Early claiming (before FRA)',
      'Delayed credits (after FRA)',
      'Life expectancy by gender',
      'Spousal benefits',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('states the calculation engine once, with a link', () => {
    // The single attribution this whole change exists to consolidate.
    render(<AboutPanel open onClose={() => {}} />);
    const link = screen.getByRole('link', { name: /ssa\.tools/i });
    expect(link).toHaveAttribute('href', 'https://ssa.tools/');
    expect(screen.getByText(/MIT/)).toBeInTheDocument();
  });

  it('carries the thirty-year CPI history', () => {
    render(<AboutPanel open onClose={() => {}} />);
    expect(screen.getByText(/BLS CPI-U/)).toBeInTheDocument();
    expect(screen.getByText('30-yr average')).toBeInTheDocument();
  });

  it('closes on the close button and on Escape', async () => {
    const onClose = vi.fn();
    render(<AboutPanel open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();

    onClose.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
