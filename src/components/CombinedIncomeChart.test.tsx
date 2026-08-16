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

  // The timeline drops a person's band to zero at their life expectancy with no
  // survivor step-up, so the post-death drop is deeper than reality. Until Phase 2
  // models that, the chart must say so — this is the guard against the caveat
  // being quietly dropped in a future layout change.
  it('discloses that survivor benefits are not modeled, for a couple', () => {
    render(<CombinedIncomeChart timeline={timeline} people={people} />);
    const caveat = screen.getByTestId('combined-income-caveat');
    expect(caveat.textContent).toMatch(/survivor benefits are not\s+modeled/i);
    expect(caveat.textContent).toMatch(/greater of the two benefits/i);
  });

  it('omits the survivor caveat for a single claimant, who has no survivor', () => {
    render(<CombinedIncomeChart timeline={timeline} people={[people[0]]} />);
    expect(screen.queryByTestId('combined-income-caveat')).toBeNull();
  });
});
