import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HouseholdsDialog } from './HouseholdsDialog';
import { claimAges, VALIDATION_SCENARIOS } from '../lib/validationSummary';

/** The table's own rows, without the header row above them. */
function bodyRows() {
  const [, ...rows] = screen.getAllByRole('row');
  return rows;
}

describe('HouseholdsDialog', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<HouseholdsDialog open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('gives every pinned household a row', () => {
    render(<HouseholdsDialog open onClose={vi.fn()} />);
    expect(bodyRows()).toHaveLength(VALIDATION_SCENARIOS.length);
  });

  it('takes its claiming-age columns from the fixtures rather than naming them', () => {
    // The summary is generated. A column list written here would keep printing
    // "At 67" after the fixtures stopped pinning it, which is the class of
    // defect `validationSummary` exists to prevent.
    render(<HouseholdsDialog open onClose={vi.fn()} />);
    const ages = claimAges();
    expect(ages.length).toBeGreaterThan(0);
    for (const age of ages) {
      expect(screen.getByRole('columnheader', { name: `At ${age}` })).toBeInTheDocument();
    }
    // And no more than those: a column list written into the component would
    // survive the fixtures dropping an age, and this is what notices.
    const figureColumns = screen
      .getAllByRole('columnheader')
      .filter((th) => /^At \d+$/.test(th.textContent ?? ''));
    expect(figureColumns).toHaveLength(ages.length);
  });

  it('shows a figure for every household in every age column', () => {
    // A blank column reads as a household that was not checked at that age.
    render(<HouseholdsDialog open onClose={vi.fn()} />);
    for (const row of bodyRows()) {
      const cells = within(row).getAllByRole('cell');
      // Benefit, full retirement age, one per claiming age, and the link.
      expect(cells).toHaveLength(claimAges().length + 3);
      for (const cell of cells) expect(cell.textContent).not.toBe('');
    }
  });

  it('names both earners in a couple, so two households cannot print alike', () => {
    // `married-1960-spouse-no-record` and `married-1960-partial-topup` pin the
    // same first earner and the same three monthly figures. Showing only the
    // first person left two rows identical in every visible column.
    render(<HouseholdsDialog open onClose={vi.fn()} />);
    const printed = bodyRows().map((row) => row.textContent);
    expect(new Set(printed).size).toBe(printed.length);
  });

  it('links each household to ssa.tools with that household s own figures', () => {
    // The link and the automated cross-check are built by one function, so
    // what the reader opens is the page the suite diffed, not a lookalike.
    render(<HouseholdsDialog open onClose={vi.fn()} />);
    for (const row of bodyRows()) {
      const link = within(row).getByRole('link', { name: /Check on ssa\.tools/ });
      expect(link).toHaveAttribute('href', expect.stringContaining('ssa.tools/calculator#pia1='));
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('sends a 1 January birthday as the 1st, not a flattened day', () => {
    // The one case where a wrong day opens a DIFFERENT claimant: SSA reads a
    // 1 January birthday into the previous FRA cohort.
    render(<HouseholdsDialog open onClose={vi.fn()} />);
    const row = bodyRows().find((tr) => tr.textContent?.includes('1/1/1960'));
    expect(row, 'a day-1 household should be listed').toBeDefined();
    expect(within(row!).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('dob1=1960-01-01'),
    );
    // And that household's FRA is the previous cohort's, which is the whole
    // reason it is pinned.
    expect(row!.textContent).toContain('66 years, 10 months');
  });

  it('closes on Escape and on the backdrop', async () => {
    const onClose = vi.fn();
    render(<HouseholdsDialog open onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /close the household list/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
