import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AboutPanel } from './AboutPanel';

describe('AboutPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<AboutPanel open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('carries the four method cards', () => {
    // Spousal benefits is deliberately not here: it stays on the main
    // surface as `spousalMethodologyCopy(analysis)`, this household's own
    // figures, not static reference material.
    render(<AboutPanel open onClose={() => {}} />);
    for (const title of [
      'Full Retirement Age (FRA)',
      'Early claiming (before FRA)',
      'Delayed credits (after FRA)',
      'Life expectancy by gender',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  // Titles alone don't pin the load-bearing numbers inside each card body.
  // Once `Analyzer.tsx`'s original "How This Works" block is deleted,
  // `about.ts` becomes the sole source of these percentages with nothing else
  // on screen to catch a corrupted figure by eye.
  it('states the early-claiming and delayed-credit figures exactly', () => {
    render(<AboutPanel open onClose={() => {}} />);
    expect(
      screen.getByText(
        'Benefits are reduced 5/9 of 1% per month for the first 36 months early, then ' +
          '5/12 of 1% per month thereafter.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Benefits increase 2/3 of 1% per month (8% per year) until age 70.'),
    ).toBeInTheDocument();
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

  // The heading and the "30-yr average" stat both survive deleting the whole
  // table underneath them — this pins the table itself, not just its
  // surrounding chrome.
  it('renders the full CPI table, not just its heading', () => {
    render(<AboutPanel open onClose={() => {}} />);
    const table = screen.getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual(['Year', 'CPI-U', 'Year', 'CPI-U']);

    // 30 years of history laid out two years per row.
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(16); // 1 header row + 15 data rows
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
