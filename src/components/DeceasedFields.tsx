import { useEffect, useState } from 'react';
import type {
  AlreadyClaimedFormFields,
  DeceasedFormFields,
  WidowedFieldError,
} from '../lib/widowedForm';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Unlike `PersonFields`' `BIRTH_YEARS` (which floors at "at least 18 today",
// since the app's two claimants are alive now), a deceased spouse has no such
// floor and may have been born, or died, in any year up to the present. 110
// years covers every realistic case without a lower bound to get wrong.
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 110 }, (_, i) => CURRENT_YEAR - i);

const MONTH_OPTIONS = (
  <>
    <option value="">Month</option>
    {MONTHS.map((m, i) => (
      <option key={m} value={i + 1}>
        {m}
      </option>
    ))}
  </>
);

const YEAR_OPTIONS = (
  <>
    <option value="">Year</option>
    {YEARS.map((y) => (
      <option key={y} value={y}>
        {y}
      </option>
    ))}
  </>
);

/**
 * Field-level UI text with no print counterpart — these strings never appear
 * in a PDF, so they do not belong in `methodologyCopy.ts`, which is reserved
 * for sentences shared between screen and print.
 */
const ERROR_TEXT: Record<WidowedFieldError, string> = {
  deathBeforeBirth: 'Date of death cannot be before date of birth.',
  deathInFuture: 'Date of death cannot be in the future.',
  claimBeforeDeath: 'A survivor benefit cannot start before the month after the death.',
  // Second person throughout: both already-claimed dates are the WIDOW's own,
  // and this form's other fieldset is about someone else. "this person" left
  // the reader to guess which of the two the sentence meant.
  claimBeforeBirth: 'That date is before you were born.',
  checkAmountUnreachable:
    'No Social Security benefit reaches that amount — check for an extra digit.',
};

type WidowedErrors = Partial<
  Record<'death' | 'survivorSince' | 'ownSince' | 'checkAmount', WidowedFieldError>
>;

interface DeceasedFieldsProps {
  deceased: DeceasedFormFields;
  alreadyClaimed: AlreadyClaimedFormFields;
  errors: WidowedErrors;
  onDeceasedChange: (next: DeceasedFormFields) => void;
  onAlreadyClaimedChange: (next: AlreadyClaimedFormFields) => void;
}

export function DeceasedFields({
  deceased,
  alreadyClaimed,
  errors,
  onDeceasedChange,
  onAlreadyClaimedChange,
}: DeceasedFieldsProps) {
  const setDeceased = (patch: Partial<DeceasedFormFields>) =>
    onDeceasedChange({ ...deceased, ...patch });
  const setAlreadyClaimed = (patch: Partial<AlreadyClaimedFormFields>) =>
    onAlreadyClaimedChange({ ...alreadyClaimed, ...patch });

  // Buffered locally for the same reason `PersonFields`' benefit field is: a
  // controlled input whose value never advances between keystrokes forces
  // React to snap the DOM value back to the stale prop after every keystroke.
  const [piaText, setPiaText] = useState(
    deceased.piaMonthly === '' ? '' : String(deceased.piaMonthly),
  );
  useEffect(() => {
    setPiaText(deceased.piaMonthly === '' ? '' : String(deceased.piaMonthly));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deceased.piaMonthly]);

  const [checkText, setCheckText] = useState(
    deceased.checkAmount === '' ? '' : String(deceased.checkAmount),
  );
  useEffect(() => {
    setCheckText(deceased.checkAmount === '' ? '' : String(deceased.checkAmount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deceased.checkAmount]);

  return (
    <>
      <fieldset className="person-fields" aria-label="Deceased spouse">
        <legend>Deceased Spouse</legend>

        <div className="field">
          <label htmlFor="dec-birth">Date of Birth</label>
          <div className="birth-row">
            <select
              id="dec-birth-month"
              value={deceased.birthMonth}
              onChange={(e) => {
                const month = e.target.value === '' ? '' : Number(e.target.value);
                setDeceased({ birthMonth: month });
              }}
              aria-label="Deceased spouse birth month"
            >
              {MONTH_OPTIONS}
            </select>
            <select
              id="dec-birth"
              value={deceased.birthYear}
              onChange={(e) => {
                const year = e.target.value === '' ? '' : Number(e.target.value);
                setDeceased({ birthYear: year });
              }}
              aria-label="Deceased spouse birth year"
            >
              {YEAR_OPTIONS}
            </select>
          </div>
        </div>

        <div className="field" data-testid="dec-death-field">
          <label htmlFor="dec-death">Date of Death</label>
          <div className="birth-row">
            <select
              id="dec-death-month"
              value={deceased.deathMonth}
              onChange={(e) => {
                const month = e.target.value === '' ? '' : Number(e.target.value);
                setDeceased({ deathMonth: month });
              }}
              aria-label="Deceased spouse death month"
            >
              {MONTH_OPTIONS}
            </select>
            <select
              id="dec-death"
              value={deceased.deathYear}
              onChange={(e) => {
                const year = e.target.value === '' ? '' : Number(e.target.value);
                setDeceased({ deathYear: year });
              }}
              aria-label="Deceased spouse death year"
            >
              {YEAR_OPTIONS}
            </select>
          </div>
          {errors.death && <span className="field-error">{ERROR_TEXT[errors.death]}</span>}
        </div>

        <div className="field">
          <span className="field-label">How do you know their benefit?</span>
          <div
            className="segmented-control"
            role="group"
            aria-label="Deceased spouse benefit source"
          >
            <button
              type="button"
              className={`segment-btn ${
                deceased.recordKind === 'pia' ? 'segment-btn-active' : ''
              }`}
              onClick={() => setDeceased({ recordKind: 'pia' })}
              aria-pressed={deceased.recordKind === 'pia'}
            >
              Benefit at full retirement age
            </button>
            <button
              type="button"
              className={`segment-btn ${
                deceased.recordKind === 'checkAmount' ? 'segment-btn-active' : ''
              }`}
              onClick={() => setDeceased({ recordKind: 'checkAmount' })}
              aria-pressed={deceased.recordKind === 'checkAmount'}
            >
              Monthly check they received
            </button>
          </div>
        </div>

        {deceased.recordKind === 'pia' ? (
          <>
            <div className="field">
              <label htmlFor="dec-pia-amount">Benefit at full retirement age</label>
              <div className="currency-input">
                <span className="currency-prefix">$</span>
                <input
                  id="dec-pia-amount"
                  type="text"
                  inputMode="numeric"
                  maxLength={7}
                  value={piaText}
                  placeholder="0"
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, '');
                    setPiaText(digits);
                    setDeceased({ piaMonthly: digits === '' ? '' : Number(digits) });
                  }}
                />
              </div>
            </div>

            <div className="field">
              <span className="field-label">Had they filed before they died?</span>
              <div
                className="segmented-control"
                role="group"
                aria-label="Had they filed before they died?"
              >
                <button
                  type="button"
                  className={`segment-btn ${
                    deceased.hadFiled === true ? 'segment-btn-active' : ''
                  }`}
                  onClick={() => setDeceased({ hadFiled: true })}
                  aria-pressed={deceased.hadFiled === true}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className={`segment-btn ${
                    deceased.hadFiled === false ? 'segment-btn-active' : ''
                  }`}
                  onClick={() => setDeceased({ hadFiled: false, filedYear: '', filedMonth: '' })}
                  aria-pressed={deceased.hadFiled === false}
                >
                  No
                </button>
              </div>
            </div>

            {deceased.hadFiled === true && (
              <div className="field">
                <label htmlFor="dec-filed">Date They Filed</label>
                <div className="birth-row">
                  <select
                    id="dec-filed-month"
                    value={deceased.filedMonth}
                    onChange={(e) => {
                      const month = e.target.value === '' ? '' : Number(e.target.value);
                      setDeceased({ filedMonth: month });
                    }}
                    aria-label="Deceased spouse filing month"
                  >
                    {MONTH_OPTIONS}
                  </select>
                  <select
                    id="dec-filed"
                    value={deceased.filedYear}
                    onChange={(e) => {
                      const year = e.target.value === '' ? '' : Number(e.target.value);
                      setDeceased({ filedYear: year });
                    }}
                    aria-label="Deceased spouse filing year"
                  >
                    {YEAR_OPTIONS}
                  </select>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="field" data-testid="dec-check-amount-field">
              <label htmlFor="dec-check-amount">Monthly check they received</label>
              <div className="currency-input">
                <span className="currency-prefix">$</span>
                <input
                  id="dec-check-amount"
                  type="text"
                  inputMode="numeric"
                  maxLength={7}
                  value={checkText}
                  placeholder="0"
                  aria-describedby="dec-check-amount-hint"
                  aria-invalid={errors.checkAmount ? true : undefined}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, '');
                    setCheckText(digits);
                    setDeceased({ checkAmount: digits === '' ? '' : Number(digits) });
                  }}
                />
              </div>
              {errors.checkAmount && (
                <span className="field-error">{ERROR_TEXT[errors.checkAmount]}</span>
              )}
            </div>

            <div className="field">
              <label htmlFor="dec-filed">Date They Filed</label>
              <div className="birth-row">
                <select
                  id="dec-filed-month"
                  value={deceased.filedMonth}
                  onChange={(e) => {
                    const month = e.target.value === '' ? '' : Number(e.target.value);
                    setDeceased({ filedMonth: month });
                  }}
                  aria-label="Deceased spouse filing month"
                >
                  {MONTH_OPTIONS}
                </select>
                <select
                  id="dec-filed"
                  value={deceased.filedYear}
                  onChange={(e) => {
                    const year = e.target.value === '' ? '' : Number(e.target.value);
                    setDeceased({ filedYear: year });
                  }}
                  aria-label="Deceased spouse filing year"
                >
                  {YEAR_OPTIONS}
                </select>
              </div>
              <span className="field-hint" id="dec-check-amount-hint">
                This is an estimate — a current check includes every cost-of-living increase
                since they filed, which the benefit formula does not.
              </span>
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="person-fields" aria-label="Benefits you already receive">
        <legend>Benefits You Already Receive</legend>

        <div className="field" data-testid="ac-survivor-since-field">
          <label htmlFor="ac-survivor-since">Your survivor benefit started</label>
          <div className="birth-row">
            <select
              id="ac-survivor-since-month"
              value={alreadyClaimed.survivorSinceMonth}
              onChange={(e) => {
                const month = e.target.value === '' ? '' : Number(e.target.value);
                setAlreadyClaimed({ survivorSinceMonth: month });
              }}
              aria-label="Survivor benefit start month"
            >
              {MONTH_OPTIONS}
            </select>
            <select
              id="ac-survivor-since"
              value={alreadyClaimed.survivorSinceYear}
              onChange={(e) => {
                const year = e.target.value === '' ? '' : Number(e.target.value);
                setAlreadyClaimed({ survivorSinceYear: year });
              }}
              aria-label="Survivor benefit start year"
            >
              {YEAR_OPTIONS}
            </select>
          </div>
          {errors.survivorSince && (
            <span className="field-error">{ERROR_TEXT[errors.survivorSince]}</span>
          )}
        </div>

        <div className="field" data-testid="ac-own-since-field">
          <label htmlFor="ac-own-since">Your own benefit started</label>
          <div className="birth-row">
            <select
              id="ac-own-since-month"
              value={alreadyClaimed.ownSinceMonth}
              onChange={(e) => {
                const month = e.target.value === '' ? '' : Number(e.target.value);
                setAlreadyClaimed({ ownSinceMonth: month });
              }}
              aria-label="Own benefit start month"
            >
              {MONTH_OPTIONS}
            </select>
            <select
              id="ac-own-since"
              value={alreadyClaimed.ownSinceYear}
              onChange={(e) => {
                const year = e.target.value === '' ? '' : Number(e.target.value);
                setAlreadyClaimed({ ownSinceYear: year });
              }}
              aria-label="Own benefit start year"
            >
              {YEAR_OPTIONS}
            </select>
          </div>
          {errors.ownSince && <span className="field-error">{ERROR_TEXT[errors.ownSince]}</span>}
          {/* "they" was the deceased — a leftover from when these two dates
              sat inside the Deceased Spouse fieldset. The benefit is hers. */}
          <span className="field-hint">Leave blank if you have not started that benefit yet.</span>
        </div>
      </fieldset>
    </>
  );
}
