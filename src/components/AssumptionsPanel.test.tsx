import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssumptionsPanel } from './AssumptionsPanel';
import { COLA_BOUNDS } from '../lib/formBounds';
import { DEFAULT_SOLVENCY, TRUSTEES_ASSUMPTION } from '../lib/solvency';
import { fromShareParams, toShareParams } from '../lib/shareLink';
import { BLANK_FORM } from '../lib/formState';

function renderPanel(overrides: Partial<Parameters<typeof AssumptionsPanel>[0]> = {}) {
  const onAnnualColaChange = vi.fn();
  const view = render(
    <AssumptionsPanel
      annualCola={2.5}
      onAnnualColaChange={onAnnualColaChange}
      discountRate={0.025}
      onDiscountRateChange={vi.fn()}
      dollarsMode="real"
      onDollarsModeChange={vi.fn()}
      solvency={DEFAULT_SOLVENCY}
      onSolvencyChange={vi.fn()}
      expanded
      onToggle={vi.fn()}
      {...overrides}
    />,
  );
  return { onAnnualColaChange, unmount: view.unmount };
}

/**
 * A stateful harness, because the field is controlled: with a fixed
 * `annualCola` prop React snaps the DOM value back after every keystroke, so
 * "12" would never reach the handler as 12. `Analyzer` holds this in state, so
 * the harness does too — otherwise the test cannot reach the case it exists
 * for. `latest()` reports what actually landed in state.
 */
function renderStateful(initial: number) {
  const seen: number[] = [];
  function Harness() {
    const [cola, setCola] = useState(initial);
    return (
      <AssumptionsPanel
        annualCola={cola}
        onAnnualColaChange={(v) => {
          seen.push(v);
          setCola(v);
        }}
        discountRate={0.025}
        onDiscountRateChange={vi.fn()}
      dollarsMode="real"
      onDollarsModeChange={vi.fn()}
        solvency={DEFAULT_SOLVENCY}
        onSolvencyChange={vi.fn()}
        expanded
        onToggle={vi.fn()}
      />
    );
  }
  render(<Harness />);
  return { seen, latest: () => seen[seen.length - 1] };
}

const colaInput = () => screen.getByLabelText('Annual COLA percentage') as HTMLInputElement;

describe('AssumptionsPanel COLA number input', () => {
  // The bounds are read from COLA_BOUNDS rather than hard-coded, so a change
  // to the shared bound moves the slider, this field and the share-link parser
  // together. The field previously advertised max=15 while the parser accepted
  // only 8.
  it('advertises the shared COLA bounds, not its own', () => {
    renderPanel();
    expect(colaInput().min).toBe(String(COLA_BOUNDS.min));
    expect(colaInput().max).toBe(String(COLA_BOUNDS.max));
    expect(colaInput().step).toBe(String(COLA_BOUNDS.step));
  });

  it('reports an in-range typed value unchanged', async () => {
    const { onAnnualColaChange } = renderPanel({ annualCola: 0 });
    await userEvent.type(colaInput(), '4');
    expect(onAnnualColaChange).toHaveBeenLastCalledWith(4);
  });

  // The bug: a typed 12 entered state, `isFormComplete` never inspected COLA,
  // so Copy link stayed enabled and `toShareParams` wrote `cola=12`.
  it('clamps a typed value above the ceiling instead of letting it into state', async () => {
    const { seen, latest } = renderStateful(0);
    await userEvent.clear(colaInput());
    await userEvent.type(colaInput(), '12');
    expect(latest()).toBe(COLA_BOUNDS.max);
    for (const v of seen) {
      expect(v).toBeLessThanOrEqual(COLA_BOUNDS.max);
      expect(v).toBeGreaterThanOrEqual(COLA_BOUNDS.min);
    }
    // And the field the adviser is looking at shows the clamped value, so the
    // substitution is visible rather than silent.
    expect(colaInput().value).toBe(String(COLA_BOUNDS.max));
  });

  it('clamps a far-out-of-range value too', async () => {
    const { latest } = renderStateful(0);
    await userEvent.clear(colaInput());
    await userEvent.type(colaInput(), '999');
    expect(latest()).toBe(COLA_BOUNDS.max);
  });

  it('never emits NaN when the field is cleared', async () => {
    const { seen } = renderStateful(3);
    await userEvent.clear(colaInput());
    for (const v of seen) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});

// The reason the clamp matters, stated end to end: whatever COLA the field can
// now produce must survive a round trip through a link unchanged. Before the
// clamp, a sender on 12% shared a link the recipient's parser rejected,
// replacing it with the CPI default — two people reading different cumulative
// and break-even charts, with nothing on screen saying so.
describe('COLA survives a share-link round trip', () => {
  it('round-trips every value the clamped field can now emit', () => {
    for (const cola of [COLA_BOUNDS.min, 0.1, 2.5, 4, 7.9, COLA_BOUNDS.max]) {
      const sent = { ...BLANK_FORM, annualCola: cola };
      const received = fromShareParams(new URLSearchParams(toShareParams(sent).toString()));
      expect(received.annualCola).toBe(cola);
    }
  });

  it('confirms the value the field used to allow would NOT have round-tripped', () => {
    const sent = { ...BLANK_FORM, annualCola: 12 };
    const received = fromShareParams(new URLSearchParams(toShareParams(sent).toString()));
    expect(received.annualCola).not.toBe(12);
    expect(received.annualCola).toBe(BLANK_FORM.annualCola);
  });
});

describe('AssumptionsPanel benefit-reduction scenario', () => {
  it('is off in the panel until it is switched on, and hides its figures until then', () => {
    renderPanel();
    expect(screen.getByLabelText('Price a benefit reduction')).not.toBeChecked();
    // The year and percent are meaningless while the scenario is off, and a
    // pair of live-looking number fields reads as a setting that is in force.
    expect(screen.queryByLabelText('Reduced from')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Percent payable')).not.toBeInTheDocument();
  });

  it('shows the year and the percent once it is on', () => {
    renderPanel({ solvency: TRUSTEES_ASSUMPTION });
    expect(screen.getByLabelText('Price a benefit reduction')).toBeChecked();
    expect(screen.getByLabelText('Reduced from')).toHaveValue(2032);
    expect(screen.getByLabelText('Percent payable')).toHaveValue(78);
  });

  it('switches on without losing the figures already typed', async () => {
    const onSolvencyChange = vi.fn();
    renderPanel({
      solvency: { enabled: false, fromYear: 2040, payablePercent: 90 },
      onSolvencyChange,
    });
    await userEvent.click(screen.getByLabelText('Price a benefit reduction'));
    expect(onSolvencyChange).toHaveBeenCalledWith({
      enabled: true,
      fromYear: 2040,
      payablePercent: 90,
    });
  });

  it('flags the scenario where the panel is shut, not only inside it', () => {
    // The scenario adds a page to the exported report. An adviser must never
    // learn that it was on from the PDF they have already sent.
    renderPanel({ solvency: TRUSTEES_ASSUMPTION, expanded: false });
    expect(screen.getByTestId('solvency-flag')).toBeInTheDocument();
    renderPanel({ expanded: false });
    expect(screen.queryAllByTestId('solvency-flag')).toHaveLength(1);
  });
});

describe('AssumptionsPanel CPI history', () => {
  it('no longer renders the thirty-year CPI history', () => {
    // Moved to the About panel. The COLA slider and its hint stay here; only
    // the reference table left.
    renderPanel();
    expect(screen.queryByText(/BLS CPI-U/)).not.toBeInTheDocument();
    expect(screen.queryByText('30-yr average')).not.toBeInTheDocument();
  });

  // A positive control: the two absence checks above would also pass if this
  // panel rendered an empty div. Pin that the COLA slider and its hint —
  // exactly what the comment above says stays — actually survived.
  it('still renders the COLA slider and its hint', () => {
    renderPanel();
    expect(colaInput()).toBeInTheDocument();
    expect(
      screen.getByText(
        'Benefit math uses SSA historical COLA tables. This rate applies to ' +
          'illustrative cumulative charts only.',
      ),
    ).toBeInTheDocument();
  });
});

/**
 * One control for how every figure in the report is stated.
 *
 * It replaces a "Comparison view" checkbox, which drove the same two settings
 * but could only name one of the two bases — leaving present value, the
 * default, as the unlabelled off state.
 */
/**
 * ONE control for how figures are stated.
 *
 * It was two — this switch and a separate Dollars toggle — and moving the
 * dollars alone produced a pair neither name described, so the switch showed
 * nothing selected. The two were always describing one decision.
 */
describe('AssumptionsPanel report basis', () => {
  const basisButton = (id: 'present' | 'future') => screen.getByTestId(`report-basis-${id}`);

  it('always has exactly one option selected', () => {
    for (const mode of ['real', 'nominal'] as const) {
      const view = renderPanel({ dollarsMode: mode });
      const pressed = (['present', 'future'] as const).filter(
        (id) => basisButton(id).getAttribute('aria-pressed') === 'true',
      );
      expect(pressed, `dollarsMode=${mode}`).toHaveLength(1);
      view.unmount();
    }
  });

  it('reads present value from the default settings', () => {
    renderPanel();
    expect(basisButton('present')).toHaveAttribute('aria-pressed', 'true');
    expect(basisButton('future')).toHaveAttribute('aria-pressed', 'false');
  });

  it('never touches the discount rate', async () => {
    // The whole point of the split. The rate is a planning assumption that
    // ranks the strategies; choosing how a figure is WORDED must not change
    // which filing ages the report recommends.
    const onDollarsModeChange = vi.fn();
    const onDiscountRateChange = vi.fn();
    renderPanel({ onDollarsModeChange, onDiscountRateChange });
    await userEvent.click(basisButton('future'));
    expect(onDollarsModeChange).toHaveBeenCalledWith('nominal');
    expect(onDiscountRateChange).not.toHaveBeenCalled();
  });

  it('comes back to present value without restoring anything', async () => {
    const onDollarsModeChange = vi.fn();
    const onDiscountRateChange = vi.fn();
    renderPanel({ dollarsMode: 'nominal', onDollarsModeChange, onDiscountRateChange });
    expect(basisButton('future')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(basisButton('present'));
    expect(onDollarsModeChange).toHaveBeenCalledWith('real');
    expect(onDiscountRateChange).not.toHaveBeenCalled();
  });

  it('holds a rate the adviser chose, whichever basis is showing', () => {
    // 4% stays 4% in both. It is an assumption about this household, not a
    // consequence of which way the figures are being read.
    for (const mode of ['real', 'nominal'] as const) {
      const view = renderPanel({ dollarsMode: mode, discountRate: 0.04 });
      expect(screen.getByLabelText(/Discount rate/)).toHaveValue('4');
      view.unmount();
    }
  });

  it('says the recommendation does not move with it', () => {
    renderPanel();
    expect(
      screen.getByText(/the recommended filing ages are the same either way/),
    ).toBeInTheDocument();
  });

  it('no longer offers a second control for the same state', () => {
    // The Dollars toggle is gone: it set half of this and could leave the
    // switch above it showing neither option.
    renderPanel();
    expect(screen.queryByTestId('dollars-real')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dollars-nominal')).not.toBeInTheDocument();
  });
});

describe('AssumptionsPanel scope', () => {
  it('no longer holds the per-person life expectancy sliders', () => {
    // They moved next to each person's name, date of birth and benefit —
    // the fields an adviser is typing when they know the answer. What is
    // left here applies to the whole report.
    renderPanel();
    expect(screen.queryAllByRole('slider').filter((el) => el.id.startsWith('life-'))).toHaveLength(
      0,
    );
  });
});
