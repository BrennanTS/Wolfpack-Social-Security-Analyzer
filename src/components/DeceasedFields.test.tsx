import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  // Scoped to the death field's own container, not `screen` — a broad
  // `screen.getByText` matches anywhere in the document, so an
  // implementation that dumped every error string in one banner at the top
  // of the fieldset would satisfy an unscoped version of this test too. The
  // point of "where the field is" is the *placement*, so the query must
  // fail unless the text is inside that field's own subtree.
  it('renders a field error where the field is', () => {
    renderFields({ errors: { death: 'deathInFuture' } });
    const deathField = screen.getByTestId('dec-death-field');
    expect(
      within(deathField).getByText('Date of death cannot be in the future.'),
    ).toBeInTheDocument();
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

  // The brief pins these five error strings, the estimate hint, and the
  // leave-blank hint verbatim. 872/872 stayed green with the estimate hint
  // truncated to "This is an estimate." and two error strings swapped for
  // "Too early."/"Nope." — a loose `/regex/i` match is satisfied by a
  // paraphrase. These assert the exact strings, each scoped to the field
  // that error belongs beside, so both the wording and the placement are
  // pinned together.
  describe('pinned copy, verbatim', () => {
    it('death-before-birth', () => {
      renderFields({ errors: { death: 'deathBeforeBirth' } });
      const field = screen.getByTestId('dec-death-field');
      expect(
        within(field).getByText('Date of death cannot be before date of birth.'),
      ).toBeInTheDocument();
    });

    it('death-in-future', () => {
      renderFields({ errors: { death: 'deathInFuture' } });
      const field = screen.getByTestId('dec-death-field');
      expect(
        within(field).getByText('Date of death cannot be in the future.'),
      ).toBeInTheDocument();
    });

    it('claim-before-death, on the survivor-since field', () => {
      renderFields({ errors: { survivorSince: 'claimBeforeDeath' } });
      const field = screen.getByTestId('ac-survivor-since-field');
      expect(
        within(field).getByText(
          'A survivor benefit cannot start before the month after the death.',
        ),
      ).toBeInTheDocument();
    });

    it('claim-before-birth, on the own-since field', () => {
      renderFields({ errors: { ownSince: 'claimBeforeBirth' } });
      const field = screen.getByTestId('ac-own-since-field');
      expect(
        within(field).getByText('That date is before this person was born.'),
      ).toBeInTheDocument();
    });

    it('check-amount-unreachable', () => {
      renderFields({
        deceased: { ...BLANK_DECEASED, recordKind: 'checkAmount' },
        errors: { checkAmount: 'checkAmountUnreachable' },
      });
      const field = screen.getByTestId('dec-check-amount-field');
      expect(
        within(field).getByText(
          'No Social Security benefit reaches that amount — check for an extra digit.',
        ),
      ).toBeInTheDocument();
    });

    it('the check-amount route estimate hint', () => {
      renderFields({ deceased: { ...BLANK_DECEASED, recordKind: 'checkAmount' } });
      expect(
        screen.getByText(
          'This is an estimate — a current check includes every cost-of-living increase ' +
            'since they filed, which the benefit formula does not.',
        ),
      ).toBeInTheDocument();
    });

    it('the already-claimed leave-blank hint', () => {
      renderFields();
      expect(
        screen.getByText('Leave blank if they have not started that benefit yet.'),
      ).toBeInTheDocument();
    });
  });

  // The already-claimed dates are the SURVIVOR's own claims, not the
  // deceased's — they must live in their own fieldset, separate from
  // "Deceased Spouse", with labels that say so.
  describe('the already-claimed dates are framed as the survivor\'s, not the deceased\'s', () => {
    it('lives in its own fieldset, not "Deceased Spouse"', () => {
      renderFields();
      const survivorField = screen.getByTestId('ac-survivor-since-field');
      const ownField = screen.getByTestId('ac-own-since-field');
      const deceasedFieldset = screen.getByRole('group', { name: 'Deceased spouse' });
      expect(deceasedFieldset).not.toContainElement(survivorField);
      expect(deceasedFieldset).not.toContainElement(ownField);
    });

    it('labels each date with the survivor\'s possessive', () => {
      renderFields();
      expect(screen.getByLabelText('Your survivor benefit started')).toBeInTheDocument();
      expect(screen.getByLabelText('Your own benefit started')).toBeInTheDocument();
    });
  });
});
