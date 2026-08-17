import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeceasedFields } from './DeceasedFields';
import { BLANK_ALREADY_CLAIMED, BLANK_DECEASED } from '../lib/widowedForm';

const noop = () => {};

function renderFields(overrides = {}) {
  return render(
    <DeceasedFields
      deceased={BLANK_DECEASED}
      alreadyClaimed={BLANK_ALREADY_CLAIMED}
      errors={{}}
      onDeceasedChange={noop}
      onAlreadyClaimedChange={noop}
      {...overrides}
    />,
  );
}

describe('DeceasedFields', () => {
  it('asks for the deceased identity and death date', () => {
    renderFields();
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date of death/i)).toBeInTheDocument();
  });

  it('shows the PIA route by default and the check route on request', async () => {
    const onDeceasedChange = vi.fn();
    renderFields({ onDeceasedChange });
    expect(screen.getByLabelText(/benefit at full retirement age/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /monthly check/i }));
    expect(onDeceasedChange).toHaveBeenCalledWith(
      expect.objectContaining({ recordKind: 'checkAmount' }),
    );
  });

  it('renders a field error where the field is', () => {
    renderFields({ errors: { death: 'deathInFuture' } });
    expect(screen.getByText(/cannot be in the future/i)).toBeInTheDocument();
  });

  it('renders nothing about an estimate on the PIA route', () => {
    // The estimate caveat belongs to the check-amount route only; showing it
    // on a known PIA would be a true sentence beside a number it does not
    // describe — this project's recurring defect shape.
    renderFields();
    expect(screen.queryByText(/estimate/i)).not.toBeInTheDocument();
  });

  it('says the check-amount route is an estimate', async () => {
    renderFields({ deceased: { ...BLANK_DECEASED, recordKind: 'checkAmount' } });
    expect(screen.getByText(/estimate/i)).toBeInTheDocument();
  });
});
