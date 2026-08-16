import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CombinedIncomeChart } from './CombinedIncomeChart';
import type { CombinedTimelinePoint } from '../lib/household';
import type { Person } from '../lib/personAnalysis';

const people = [
  { id: 'a', name: 'Dan' },
  { id: 'b', name: 'Sarah' },
] as Person[];

const timeline: CombinedTimelinePoint[] = [
  { year: 2030, byPersonId: { a: 24000, b: 0 }, total: 24000 },
  { year: 2031, byPersonId: { a: 24000, b: 18000 }, total: 42000 },
];

/**
 * `ResponsiveContainer` measures its parent via a resize observer, and
 * jsdom reports zero size for that parent — Recharts intentionally renders
 * nothing (no <svg>, no axes, no series) rather than divide by zero. So
 * these tests don't assert on chart internals; they assert on what the
 * component itself controls regardless of the measured size: it renders
 * without throwing, and the legend row (driven by `personLabel`, not by
 * Recharts) shows the right names. See task-18-report.md for the fuller
 * explanation of this gap.
 */
describe('CombinedIncomeChart', () => {
  it('renders without throwing for a two-person household', () => {
    expect(() =>
      render(<CombinedIncomeChart timeline={timeline} people={people} />),
    ).not.toThrow();
  });

  it('renders without throwing for a single-person household', () => {
    expect(() =>
      render(<CombinedIncomeChart timeline={timeline} people={[people[0]]} />),
    ).not.toThrow();
  });

  it('labels the legend with personLabel names, not raw ids', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    expect(screen.getByText('Dan')).toBeDefined();
    expect(screen.getByText('Sarah')).toBeDefined();
  });

  it('falls back to You/Spouse when a person has no name', () => {
    const unnamed = [{ id: 'a' }, { id: 'b' }] as Person[];
    render(<CombinedIncomeChart timeline={timeline} people={unnamed} />);
    expect(screen.getByText('You')).toBeDefined();
    expect(screen.getByText('Spouse')).toBeDefined();
  });

  // `buildCombinedTimeline` now sums the engine's benefit-period bands, so a
  // person's band is their personal benefit PLUS any spousal and survivor
  // benefit, credited only for the months actually paid. The caption used to
  // say the exact opposite of all three — that bands were own-benefit-only,
  // that a no-record spouse showed as $0, and that survivor benefits were
  // unmodeled. These guard the corrected caption against drifting back.
  it('says the bands include spousal and survivor benefits, for a couple', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/spousal or survivor benefit/i);
    // The claims the rebase falsified must not come back.
    expect(caveat.textContent).not.toMatch(/excludes any spousal/i);
    expect(caveat.textContent).not.toMatch(/survivor benefits are not\s+modeled/i);
    expect(caveat.textContent).not.toMatch(/shows here as \$0/i);
  });

  it('says partial years are credited only the months actually paid', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/only the months\s+actually paid/i);
  });

  it('states that the amounts carry no cost-of-living adjustment', () => {
    // `HouseholdPanel` passes the timeline straight to the chart, so the COLA
    // slider never reaches these figures. Saying so is the honest caption.
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/before any cost-of-living adjustment/i);
  });

  it('omits the caveat for a single claimant, who has no second band', () => {
    render(<CombinedIncomeChart timeline={timeline} people={[people[0]]} />);
    expect(screen.queryByTestId('combined-income-caveat')).toBeNull();
  });

  // The caption above says each band includes "any spousal or survivor
  // benefit". For the one survivor direction the engine does not model that is
  // false, and the survivor's figures are too low — so that household gets a
  // second, conditional sentence saying so.
  it('discloses the unmodeled survivor direction when there is one', () => {
    render(
      <CombinedIncomeChart
        timeline={timeline}
        people={people}
        survivorGap={{ survivorLabel: 'Sarah', survivorOwnMonthly: 1760, deceasedMonthly: 1780 }}
      />,
    );
    const note = screen.getByTestId('survivor-gap-note');
    expect(note.textContent).toMatch(/no step-up is shown for Sarah/i);
    expect(note.textContent).toMatch(/lower than SSA would pay/i);
  });

  it('shows no survivor-gap note when the engine models the direction', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} survivorGap={null} />);
    expect(screen.queryByTestId('survivor-gap-note')).toBeNull();
  });

  it('shows no survivor-gap note when the prop is omitted entirely', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    expect(screen.queryByTestId('survivor-gap-note')).toBeNull();
  });
});
