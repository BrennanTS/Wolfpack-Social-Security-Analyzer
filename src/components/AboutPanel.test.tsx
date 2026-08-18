import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ABOUT_CARDS, ABOUT_INTRO } from '../lib/about';
import { formatVersionLabel } from '../lib/version';
import { AboutPanel } from './AboutPanel';

describe('AboutPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<AboutPanel open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Two of the spec's five sections had no assertion at all: the intro
  // paragraph and the version footer could both be deleted outright with a
  // green suite, and the intro's text could be replaced with anything.
  it('opens with the orienting paragraph, in its own words', () => {
    render(<AboutPanel open onClose={() => {}} />);
    expect(screen.getByText(ABOUT_INTRO)).toBeInTheDocument();
    // Sourcing the string from `about.ts` proves it renders but not that it
    // still says the two things that keep this panel honest, so pin those
    // directly: what the tool is for, and what it explicitly is not.
    expect(ABOUT_INTRO).toContain('models Social Security claiming decisions for a household');
    expect(ABOUT_INTRO).toContain('not advice');
    expect(ABOUT_INTRO).toContain('not affiliated with the Social Security Administration');
  });

  it('closes with the version footer', () => {
    render(<AboutPanel open onClose={() => {}} />);
    expect(screen.getByText(formatVersionLabel())).toBeInTheDocument();
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
    // "Carries the four" has to mean four. Listing the titles proves each one
    // is present and proves nothing about a fifth arriving beside them.
    expect(ABOUT_CARDS).toHaveLength(4);
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(4);
  });

  // Titles alone don't pin the load-bearing numbers inside each card body.
  // Once `Analyzer.tsx`'s original "How This Works" block is deleted,
  // `about.ts` becomes the sole source of these percentages with nothing else
  // on screen to catch a corrupted figure by eye. The FRA card gets the most
  // scrutiny of the three: it has no on-screen predecessor from before this
  // change (Task 1's report confirms `Analyzer.tsx` never had an FRA card),
  // so this is the first and only place its own figures have ever been
  // checked against reality — verified against `fraFromBirthYear` and the
  // engine's own schedule (66 for 1943-1954, rising to 67 for 1960+).
  it('states the FRA, early-claiming, and delayed-credit figures exactly', () => {
    render(<AboutPanel open onClose={() => {}} />);
    expect(
      screen.getByText(
        "Set by birth year on SSA's published schedule — 66 for those born 1943-1954, " +
          'rising to 67 for 1960 and later.',
      ),
    ).toBeInTheDocument();
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

  // The fourth body, and the one with the weakest claim to being already
  // reviewed: the other three moved verbatim out of `Analyzer.tsx`, while this
  // one was rewritten for its new home — the sentence pointing the adviser at
  // the slider is new prose that never rendered anywhere before. It makes two
  // checkable claims and both are load-bearing: the table year, and the name
  // of the control it sends the reader to (`AssumptionsPanel.tsx:50`).
  it('states where the life-expectancy figure comes from and where to change it', () => {
    render(<AboutPanel open onClose={() => {}} />);
    expect(
      screen.getByText(
        "SSA's 2021 period life table supplies a suggested planning age for each person. " +
          'Adjust it under Planning assumptions — every lifetime total moves with it.',
      ),
    ).toBeInTheDocument();
  });

  it('states the calculation engine once, with a link', () => {
    // The single attribution this whole change exists to consolidate.
    render(<AboutPanel open onClose={() => {}} />);
    const link = screen.getByRole('link', { name: /ssa\.tools/i });
    expect(link).toHaveAttribute('href', 'https://ssa.tools/');
    // "license", not "licence". `resources.ts` says "MIT license" one click
    // away and `ssaTools.ts` says "MIT License"; the app is American
    // everywhere else it has the choice ("modeled"), so the two spellings
    // sitting side by side were the defect, not the spelling itself.
    expect(screen.getByText(/MIT license/)).toBeInTheDocument();
    expect(screen.queryByText(/licence/i)).not.toBeInTheDocument();
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
