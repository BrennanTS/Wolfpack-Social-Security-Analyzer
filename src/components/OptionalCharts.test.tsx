import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClaimingOption } from '../lib/benefitMath';
import {
  ColaProjectionChart,
  LifetimeBarChart,
  LifetimeHeatmapChart,
  MonthlyBenefitBarChart,
  MonthlyRampChart,
  OpportunityCostChart,
} from './OptionalCharts';
import { BenefitChart } from './BenefitChart';

/**
 * The on-screen charts, tested for what jsdom can actually see.
 *
 * Recharts draws inside a `ResponsiveContainer`, which measures its parent —
 * and in jsdom every element is 0x0, so the plotted marks never render. That
 * is a real limit, stated rather than worked around with a mocked width that
 * would assert against a fiction.
 *
 * What IS asserted is what a reader sees besides the plot, and what actually
 * breaks: the heading and legend (plain DOM, and the legend carries the same
 * claim-age colours the plot does), and that none of the seven throws on the
 * data the engine can genuinely hand them. A chart that throws takes the
 * whole tab down — these render inside `PersonPanel`, above the error
 * boundary, so a divide-by-zero here is a white page, not a blank chart.
 *
 * The drawn geometry is covered where it can be: `pdf/charts.test.tsx` walks
 * the printed versions, which are hand-drawn SVG and therefore inspectable.
 */

function option(age: number, monthly: number, lifetime: number): ClaimingOption {
  return {
    age,
    monthlyBenefit: monthly,
    percentOfPia: Math.round((monthly / 2400) * 1000) / 10,
    lifetimeBenefits: lifetime,
    yearsOfPayments: Math.max(0, 85 - age),
    isEligible: true,
    monthsFromFra: (age - 67) * 12,
  };
}

const OPTIONS = [62, 63, 64, 65, 66, 67, 68, 69, 70].map((a) =>
  option(a, 1680 + (a - 62) * 160, 463_000 + (a - 62) * 9_000),
);
/** Every value identical — the denominator of every min/max scale. */
const FLAT = [62, 63, 64, 65, 66, 67, 68, 69, 70].map((a) => option(a, 2000, 500_000));
const ONE = [option(62, 1680, 463_000)];
/** A $0 benefit: legal input, and the one that makes every ratio 0/0. */
const ZERO = [62, 67, 70].map((a) => option(a, 0, 0));

const CHARTS: [string, (o: ClaimingOption[]) => React.ReactElement][] = [
  ['MonthlyBenefitBarChart', (o) => <MonthlyBenefitBarChart options={o} shownAge={70} />],
  ['LifetimeBarChart', (o) => <LifetimeBarChart options={o} shownAge={70} />],
  [
    'LifetimeHeatmapChart',
    (o) => <LifetimeHeatmapChart options={o} lifeExpectancy={85} shownAge={70} annualCola={2.5} />,
  ],
  ['OpportunityCostChart', (o) => <OpportunityCostChart options={o} shownAge={70} />],
  ['MonthlyRampChart', (o) => <MonthlyRampChart options={o} shownAge={70} />],
  [
    'BenefitChart',
    (o) => <BenefitChart options={o} lifeExpectancy={85} shownAge={70} annualCola={2.5} />,
  ],
];

describe('every on-screen chart', () => {
  it.each(CHARTS)('renders %s for ordinary data', (_name, make) => {
    expect(() => render(make(OPTIONS))).not.toThrow();
  });

  it.each(CHARTS)('renders %s when every value is identical', (_name, make) => {
    // A flat set makes max === min, and a scale that divides by the range
    // produces NaN or throws. Reachable: two claiming ages can tie.
    expect(() => render(make(FLAT))).not.toThrow();
  });

  it.each(CHARTS)('renders %s for a single claiming age', (_name, make) => {
    // A claimant already past 69 has one option left.
    expect(() => render(make(ONE))).not.toThrow();
  });

  it.each(CHARTS)('renders %s for a $0 benefit', (_name, make) => {
    // The spouse with no earnings record. Every ratio becomes 0/0.
    expect(() => render(make(ZERO))).not.toThrow();
  });

  it.each(CHARTS)('renders %s for no options at all', (_name, make) => {
    // `Math.max(...[])` is -Infinity, which is how an empty set becomes a
    // NaN coordinate rather than an empty chart.
    expect(() => render(make([]))).not.toThrow();
  });
});

describe('the COLA projection, which takes figures rather than options', () => {
  it('renders, and survives a zero benefit and a zero COLA', () => {
    for (const props of [
      { claimAge: 70, monthlyBenefit: 2976, lifeExpectancy: 85, annualCola: 2.5 },
      { claimAge: 62, monthlyBenefit: 0, lifeExpectancy: 85, annualCola: 0 },
      // Plan-to age equal to the claim age: a projection with no years in it.
      { claimAge: 70, monthlyBenefit: 2976, lifeExpectancy: 70, annualCola: 2.5 },
    ]) {
      expect(() => render(<ColaProjectionChart {...props} />)).not.toThrow();
    }
  });
});

describe('what a reader sees beside the plot', () => {
  it('names the chart and what it shows', () => {
    render(<BenefitChart options={OPTIONS} lifeExpectancy={85} shownAge={70} annualCola={2.5} />);
    expect(screen.getByRole('heading', { name: /Cumulative Lifetime Benefits/i })).toBeInTheDocument();
    expect(screen.getByText(/comparing key claiming strategies/i)).toBeInTheDocument();
  });

  it('gives the legend a swatch per compared age', () => {
    // The legend is plain DOM and renders even though the plot does not, so
    // it is the one part of the on-screen chart a test can hold to account.
    const { container } = render(
      <BenefitChart options={OPTIONS} lifeExpectancy={85} shownAge={70} annualCola={2.5} />,
    );
    const swatches = container.querySelectorAll('.chart-legend-swatch');
    expect(swatches.length).toBeGreaterThan(0);
    for (const swatch of swatches) {
      // An unset colour renders as transparent, which reads as a missing
      // series rather than as a broken one.
      expect((swatch as HTMLElement).style.background).not.toBe('');
    }
  });

  it('hides the decorative legend from assistive technology', () => {
    // It repeats what the chart's own heading and description already say.
    const { container } = render(
      <BenefitChart options={OPTIONS} lifeExpectancy={85} shownAge={70} annualCola={2.5} />,
    );
    expect(container.querySelector('.chart-legend-row')).toHaveAttribute('aria-hidden', 'true');
  });
});
