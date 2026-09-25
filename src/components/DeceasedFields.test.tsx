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

    it('puts claim-before-death on the survivor field ONLY, never on her own', () => {
      // `widowedErrors` now scopes this error to the survivor axis, so it can
      // no longer reach the own-benefit field: her own retirement benefit is
      // independent of the death date. The sentence names the survivor
      // benefit, so appearing beside "Your own benefit started" would be a
      // true sentence about the wrong number — this project's recurring
      // defect shape.
      renderFields({ errors: { survivorSince: 'claimBeforeDeath' } });
      const ownField = screen.getByTestId('ac-own-since-field');
      expect(
        within(ownField).queryByText(
          'A survivor benefit cannot start before the month after the death.',
        ),
      ).not.toBeInTheDocument();
    });

    it('claim-before-birth, on the own-since field', () => {
      renderFields({ errors: { ownSince: 'claimBeforeBirth' } });
      const field = screen.getByTestId('ac-own-since-field');
      // Second person: this date is the WIDOW's own claim, and the form's
      // other fieldset is about someone else, so "this person" left the
      // reader to guess which of the two was meant.
      expect(within(field).getByText('That date is before you were born.')).toBeInTheDocument();
    });

    it('check-amount-unreachable', () => {
      renderFields({
        deceased: { ...BLANK_DECEASED, recordKind: 'checkAmount' },
        errors: { checkAmount: 'checkAmountUnreachable' },
      });
      const field = screen.getByTestId('dec-check-amount-field');
      expect(
        within(field).getByText(
          'No Social Security benefit reaches that amount. Check for an extra digit.',
        ),
      ).toBeInTheDocument();
    });

    it('the check-amount route estimate hint', () => {
      renderFields({ deceased: { ...BLANK_DECEASED, recordKind: 'checkAmount' } });
      expect(
        screen.getByText(
          'This is an estimate. It includes the cost-of-living increases paid up to that check.',
        ),
      ).toBeInTheDocument();
    });

    it('the already-claimed leave-blank hint', () => {
      // "they" was the deceased — a leftover from when these two dates sat
      // inside the Deceased Spouse fieldset. The benefit is hers.
      renderFields();
      expect(
        screen.getByText('Leave blank if you have not started that benefit yet.'),
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

/**
 * Every question on this form is about the deceased spouse, so all of them
 * follow the gender control once it is answered.
 *
 * The control sits above them deliberately: an adviser sets it while entering
 * the dates, and the questions below are already in the right words by the
 * time they are read.
 */
describe('the deceased’s own pronoun through the form', () => {
  it('asks in they/them until the field is answered', () => {
    // It is required, so this state is transient — but the form is rendered
    // in it every time a widowed household is started, and "Had  filed
    // before  died?" would be the alternative.
    renderFields({ deceased: { ...BLANK_DECEASED, gender: null } });
    expect(screen.getByText('How do you know their benefit?')).toBeInTheDocument();
    expect(screen.getByText('Had they filed before they died?')).toBeInTheDocument();
    for (const g of ['female', 'male']) {
      expect(screen.getByTestId(`dec-gender-${g}`)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('follows the answer everywhere at once', () => {
    renderFields({ deceased: { ...BLANK_DECEASED, gender: 'male' } });
    expect(screen.getByText('How do you know his benefit?')).toBeInTheDocument();
    expect(screen.getByText('Had he filed before he died?')).toBeInTheDocument();
    expect(screen.queryByText('Had they filed before they died?')).not.toBeInTheDocument();
  });

  it('carries into the check-amount route’s label and hint', () => {
    renderFields({
      deceased: { ...BLANK_DECEASED, gender: 'female', recordKind: 'checkAmount' },
    });
    // Twice on purpose: the route button and the field label beneath it.
    // "Last": the recovered figure carries every increase the check did, so
    // the year it is in depends on WHICH check. See `piaEstimateNote`.
    expect(screen.getAllByText('Last monthly check she received')).toHaveLength(2);
    // The hint used to date the increases from the filing ("since she
    // filed"); SSA applies them from the year a person turns 62.
    expect(
      screen.getByText(
        'This is an estimate. It includes the cost-of-living increases paid up to that check.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/since she filed/)).not.toBeInTheDocument();
  });

  it('capitalizes the pronoun where the label is title case', () => {
    // "Date He Filed", beside "Date of Birth" and "Date of Death". The bare
    // pronoun would read as a typo in that row.
    renderFields({ deceased: { ...BLANK_DECEASED, gender: 'male', hadFiled: true } });
    expect(screen.getByText('Date He Filed')).toBeInTheDocument();
    renderFields({ deceased: { ...BLANK_DECEASED, gender: null, hadFiled: true } });
    expect(screen.getByText('Date They Filed')).toBeInTheDocument();
  });

  it('can be changed after it is set', () => {
    const onDeceasedChange = vi.fn();
    renderFields({ deceased: { ...BLANK_DECEASED, gender: 'male' }, onDeceasedChange });
    screen.getByTestId('dec-gender-female').click();
    expect(onDeceasedChange).toHaveBeenCalledWith(expect.objectContaining({ gender: 'female' }));
  });
});
