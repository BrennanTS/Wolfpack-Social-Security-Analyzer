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
  render(
    <AssumptionsPanel
      lifeExpectancies={[
        { label: 'John', value: 85, onChange: vi.fn(), ssaSuggested: 82, gender: 'male' },
      ]}
      annualCola={2.5}
      onAnnualColaChange={onAnnualColaChange}
      discountRate={0.025}
      onDiscountRateChange={vi.fn()}
      solvency={DEFAULT_SOLVENCY}
      onSolvencyChange={vi.fn()}
      expanded
      onToggle={vi.fn()}
      {...overrides}
    />,
  );
  return { onAnnualColaChange };
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
        lifeExpectancies={[
          { label: 'John', value: 85, onChange: vi.fn(), ssaSuggested: 82, gender: 'male' },
        ]}
        annualCola={cola}
        onAnnualColaChange={(v) => {
          seen.push(v);
          setCola(v);
        }}
        discountRate={0.025}
        onDiscountRateChange={vi.fn()}
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

describe('AssumptionsPanel per-person life expectancy', () => {
  it('renders exactly one life-expectancy control for a single claimant', () => {
    render(
      <AssumptionsPanel
        lifeExpectancies={[
          { label: 'John', value: 85, onChange: vi.fn(), ssaSuggested: 83, gender: 'male' },
        ]}
        annualCola={2.5}
        onAnnualColaChange={vi.fn()}
        discountRate={0.025}
        onDiscountRateChange={vi.fn()}
        solvency={DEFAULT_SOLVENCY}
        onSolvencyChange={vi.fn()}
        expanded
        onToggle={vi.fn()}
      />,
    );
    // The panel also renders discount-rate and COLA sliders, so count
    // life-expectancy controls specifically (id starting `life-`) rather
    // than all sliders on the page — a single claimant must see B's control
    // absent, not just "some slider count".
    const lifeSliders = screen
      .getAllByRole('slider')
      .filter((el) => el.id.startsWith('life-'));
    expect(lifeSliders).toHaveLength(1);
  });

  it('renders one life-expectancy control per person', () => {
    render(
      <AssumptionsPanel
        lifeExpectancies={[
          { label: 'John', value: 85, onChange: vi.fn(), ssaSuggested: 83, gender: 'male' },
          { label: 'Jane', value: 92, onChange: vi.fn(), ssaSuggested: 86, gender: 'female' },
        ]}
        annualCola={2.5}
        onAnnualColaChange={vi.fn()}
        discountRate={0.025}
        onDiscountRateChange={vi.fn()}
        solvency={DEFAULT_SOLVENCY}
        onSolvencyChange={vi.fn()}
        expanded
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/John/)).toHaveValue('85');
    expect(screen.getByLabelText(/Jane/)).toHaveValue('92');
    // Each hint reads its own person's gender and SSA-suggested age, not person
    // A's. A bare /86/ match could hit unrelated text on the panel and
    // getByText throws if more than one node matches, so this pins the claim
    // to the one field-hint span whose own text mentions both "86" and
    // "female" — i.e. Jane's hint, not John's (83, male).
    const janeHint = screen.getByText(
      (_, element) =>
        element?.tagName === 'SPAN' &&
        element.className === 'field-hint' &&
        /86/.test(element.textContent ?? '') &&
        /female/i.test(element.textContent ?? ''),
    );
    expect(janeHint).toBeInTheDocument();
  });

  it('calls the right person handler', async () => {
    const onChangeB = vi.fn();
    render(
      <AssumptionsPanel
        lifeExpectancies={[
          { label: 'John', value: 85, onChange: vi.fn(), ssaSuggested: 83, gender: 'male' },
          { label: 'Jane', value: 92, onChange: onChangeB, ssaSuggested: 86, gender: 'female' },
        ]}
        annualCola={2.5}
        onAnnualColaChange={vi.fn()}
        discountRate={0.025}
        onDiscountRateChange={vi.fn()}
        solvency={DEFAULT_SOLVENCY}
        onSolvencyChange={vi.fn()}
        expanded
        onToggle={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Use SSA age \(86\)/ }));
    expect(onChangeB).toHaveBeenCalledWith(86);
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
