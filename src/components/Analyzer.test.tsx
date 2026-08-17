import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Analyzer } from './Analyzer';

function renderAnalyzer() {
  return render(<Analyzer onLogout={vi.fn()} darkMode={false} onToggleDarkMode={vi.fn()} />);
}

function maritalGroup() {
  return screen.getByRole('group', { name: 'Marital status' });
}

// `Analyzer`'s lazy `useState` initializer reads `window.location.search`
// once, at mount — before any strip effect runs — so seeding it via
// `pushState` ahead of `render()` is how a shared-link scenario is driven at
// the component level, same as `?...` in the e2e suite's `page.goto` calls.
afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('Analyzer', () => {
  describe('marital status', () => {
    it('pins the marital-status hint verbatim', () => {
      renderAnalyzer();
      expect(
        screen.getByText(
          'Married uses the ssa.tools couple optimizer. Widowed models the survivor ' +
            'benefit and your own, claimed on separate dates.',
        ),
      ).toBeInTheDocument();
    });

    // Mutating `maritalStatus === 'widowed'` to `maritalStatus !== 'married'`
    // at the `DeceasedFields` call site left 872/872 vitest and 39/39 e2e
    // green, because no test asserted the deceased fields were ABSENT for
    // single or married — only that they appeared for widowed. `!== 'married'`
    // is true for single too (and for the initial `null` state), so this
    // guards the other two branches explicitly.
    it('does not render the deceased fields for a single claimant', async () => {
      renderAnalyzer();
      await userEvent.click(within(maritalGroup()).getByRole('button', { name: 'Single' }));
      expect(document.querySelector('#dec-birth')).toBeNull();
    });

    it('does not render the deceased fields for a married household', async () => {
      renderAnalyzer();
      await userEvent.click(within(maritalGroup()).getByRole('button', { name: 'Married' }));
      expect(document.querySelector('#dec-birth')).toBeNull();
    });

    it('renders the deceased fields for a widowed household', async () => {
      renderAnalyzer();
      await userEvent.click(within(maritalGroup()).getByRole('button', { name: 'Widowed' }));
      expect(document.querySelector('#dec-birth')).not.toBeNull();
    });
  });

  // A complete widowed household reaches `analyzeHousehold` (wired in an
  // earlier phase) and gets a real `HouseholdAnalysis` back — Task 5 is what
  // makes that reachable from the UI for the first time. `HouseholdView`
  // still calls `householdDisplayShape`, which still throws for `'widowed'`
  // on purpose (Phase 3B-ii-b builds the real display). Before this fix that
  // throw was uncaught: with no error boundary anywhere in the app, the
  // entire React tree unmounted — header, settings drawer, every typed value,
  // gone, with no way back short of a reload (the share params are already
  // stripped from the URL). These tests drive that same "complete widowed
  // household" state via a seeded URL (Task 4's share-link params) and assert
  // the degraded-but-honest placeholder renders instead.
  describe('a complete widowed household', () => {
    const WIDOWED_URL =
      '/?ay=1964&am=4&ag=f&ab=1200&le=90&m=w&dy=1960&dm=3&ddy=2024&ddm=1&dk=p&dp=2000&df=0';

    it('shows a plain placeholder instead of crashing or showing a wrong result', async () => {
      window.history.pushState({}, '', WIDOWED_URL);
      renderAnalyzer();

      expect(
        await screen.findByTestId('widowed-analysis-unavailable', {}, { timeout: 10000 }),
      ).toBeInTheDocument();

      // Never a partial figure and never the single-claimant view: neither
      // table exists anywhere on the page.
      expect(screen.queryByTestId('benefit-table')).not.toBeInTheDocument();
      expect(screen.queryByTestId('strategy-table')).not.toBeInTheDocument();

      // The rest of the app survives — this is a branch inside the output
      // panel, not an uncaught render error unmounting the tree.
      expect(screen.getByRole('heading', { name: 'Social Security Analyzer' })).toBeInTheDocument();
      expect(screen.getByLabelText(/date of death/i)).toBeInTheDocument();
    });

    it('disables Export PDF and Copy Link rather than offering a dead end', async () => {
      window.history.pushState({}, '', WIDOWED_URL);
      renderAnalyzer();

      await screen.findByTestId('widowed-analysis-unavailable', {}, { timeout: 10000 });

      expect(screen.getByRole('button', { name: /export pdf/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /copy link/i })).toBeDisabled();
    });

    // The gate is `analysis.status === 'widowed'`, NOT `maritalStatus`, and
    // that difference had no test: swapping both sites to `maritalStatus` left
    // 887/887 green, because every other widowed test drives the two to
    // 'widowed' together at mount and they never disagree.
    //
    // They disagree here. Clicking Single flips `maritalStatus`
    // SYNCHRONOUSLY, while `analysis` still holds the widowed result until the
    // effect re-runs and `analyzeIfComplete` resolves. Under the weaker gate
    // that one render is enough: the widowed branch is skipped, `HouseholdView`
    // renders the widowed analysis, `householdDisplayShape` throws, and with no
    // error boundary anywhere in the app the whole tree unmounts — the exact
    // blank page this branch shipped to fix, reached from a different door.
    it('survives switching to Single while the widowed analysis is still held', async () => {
      window.history.pushState({}, '', WIDOWED_URL);
      renderAnalyzer();

      await screen.findByTestId('widowed-analysis-unavailable', {}, { timeout: 10000 });

      await userEvent.click(within(maritalGroup()).getByRole('button', { name: 'Single' }));

      // The tree is still mounted: the header survived that render.
      expect(screen.getByRole('heading', { name: 'Social Security Analyzer' })).toBeInTheDocument();
      // And the marital control still works, which it cannot if React
      // unmounted the tree under it.
      expect(within(maritalGroup()).getByRole('button', { name: 'Single' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  describe('the About panel', () => {
    it('opens from the header and is closed by default', async () => {
      renderAnalyzer();
      expect(screen.queryByText(/How This Works/i)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /^about$/i }));
      expect(screen.getByText(/How This Works/i)).toBeInTheDocument();
    });

    it('no longer renders How This Works on the main surface', () => {
      // It moved to About. If this starts passing with the panel CLOSED, the
      // block was left behind rather than moved.
      renderAnalyzer();
      expect(screen.queryByText('Full Retirement Age (FRA)')).not.toBeInTheDocument();
    });
  });
});
