import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssumptionsPanel } from './AssumptionsPanel';
import { COLA_BOUNDS } from '../lib/formBounds';
import { fromShareParams, toShareParams } from '../lib/shareLink';
import { BLANK_FORM } from '../lib/formState';

function renderPanel(overrides: Partial<Parameters<typeof AssumptionsPanel>[0]> = {}) {
  const onAnnualColaChange = vi.fn();
  render(
    <AssumptionsPanel
      lifeExpectancy={85}
      onLifeExpectancyChange={vi.fn()}
      annualCola={2.5}
      onAnnualColaChange={onAnnualColaChange}
      discountRate={0.025}
      onDiscountRateChange={vi.fn()}
      ssaSuggestedLifeExpectancy={82}
      gender="male"
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
        lifeExpectancy={85}
        onLifeExpectancyChange={vi.fn()}
        annualCola={cola}
        onAnnualColaChange={(v) => {
          seen.push(v);
          setCola(v);
        }}
        discountRate={0.025}
        onDiscountRateChange={vi.fn()}
        ssaSuggestedLifeExpectancy={82}
        gender="male"
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
