import { useEffect, useState } from 'react';
import { detectYearlyEntry } from '../lib/benefitEntry';
import { formatAgeDisplay, formatCurrency, fraLabel, personLabel } from '../lib/format';
import { genderLabel } from '../lib/lifeExpectancy';
import { getCurrentAge, getFullRetirementAge } from '../lib/personAnalysis';
import {
  claimantBirthDateBounds,
  fromBirthDateInput,
  isBirthDateInRange,
  toBirthDateInput,
} from '../lib/birthDate';
import { isBenefitInRange, MAX_BENEFIT, MIN_BENEFIT } from '../lib/formBounds';
import type { PersonFormFields } from '../lib/formState';

interface PersonFieldsProps {
  person: PersonFormFields;
  index: 0 | 1;
  onChange: (next: PersonFormFields) => void;
}

export function PersonFields({ person, index, onChange }: PersonFieldsProps) {
  const label = personLabel(person.name, index);
  const idPrefix = index === 0 ? 'a' : 'b';
  const set = (patch: Partial<PersonFormFields>) => onChange({ ...person, ...patch });

  const birthDateValue = toBirthDateInput(person);
  const birthBounds = claimantBirthDateBounds();
  const birthOutOfRange = !isBirthDateInRange(birthDateValue, birthBounds);

  // Both gated on the date being in range, and that is not cosmetic:
  // `fraFromBirthYear` builds a `Birthdate`, which THROWS on a year before
  // 1900 rather than returning something wrong. This hint renders on every
  // keystroke, before any completeness gate has a say, so a typed 1875 took
  // the whole app down from inside a render.
  const birthUsable = !birthOutOfRange && birthDateValue !== '';
  const currentAge =
    birthUsable && person.birthYear !== '' && person.birthMonth !== ''
      ? getCurrentAge(person.birthYear, person.birthMonth)
      : null;
  // Month and day are passed together: a 1 January birthday reads into the
  // previous year's bracket, so the hint is exact rather than provisional.
  const fra =
    birthUsable && person.birthYear !== '' && person.birthMonth !== '' && person.birthDay !== ''
      ? getFullRetirementAge(person.birthYear, person.birthMonth, person.birthDay)
      : null;

  // Buffered locally rather than reading `person.monthlyBenefit` directly:
  // a controlled input whose value never advances between keystrokes forces
  // React to snap the DOM value back to the stale prop after every
  // keystroke, so typing "2400" would collapse to whatever digit was typed
  // last. Local state lets the field track what's actually been typed while
  // still reporting each change to the parent immediately.
  const [benefitText, setBenefitText] = useState(
    person.monthlyBenefit === '' ? '' : String(person.monthlyBenefit),
  );
  useEffect(() => {
    setBenefitText(person.monthlyBenefit === '' ? '' : String(person.monthlyBenefit));
    // Re-sync only when the parent hands us a genuinely new value (e.g. form
    // reset, or switching which person these fields display).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.monthlyBenefit]);

  // Same predicate the submission gate uses (`formState.isFormComplete`), so
  // a field marked invalid can never also produce an analysis.
  const benefitOutOfRange = benefitText !== '' && !isBenefitInRange(Number(benefitText));

  // A suggestion, never a block: the field stays valid/invalid per
  // `benefitOutOfRange` above regardless of what this says.
  const yearlySuspicion =
    benefitText === '' ? null : detectYearlyEntry(Number(benefitText));

  return (
    <fieldset className="person-fields" aria-label={label}>
      <legend>{label}</legend>

      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>Name (optional)</label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          className="text-input"
          value={person.name}
          placeholder={label}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-birth`}>Date of Birth</label>
        {/* One control for one fact. Three selects made sense while the app
            collected a partial birthday; the day made it a complete date, and
            the browser's own calendar knows which Februaries have 29 days. */}
        <input
          id={`${idPrefix}-birth`}
          type="date"
          className="text-input"
          value={birthDateValue}
          min={birthBounds.min}
          max={birthBounds.max}
          aria-label={`${label} date of birth`}
          aria-invalid={birthOutOfRange || undefined}
          aria-describedby={birthOutOfRange ? `${idPrefix}-birth-hint` : undefined}
          onChange={(e) => set(fromBirthDateInput(e.target.value))}
        />
        {/* Kept rather than cleared: `min`/`max` mark an out-of-range date
            invalid but do not stop it being typed, and blanking the field
            mid-entry is how a controlled input starts fighting its user. The
            completeness gate refuses it; this says why. */}
        {birthOutOfRange && (
          <span className="field-hint" id={`${idPrefix}-birth-hint`}>
            This analysis covers claimants between 18 and 87 years old.
          </span>
        )}
        {currentAge && fra && (
          <div className="age-badge">
            <div>
              <span className="age-badge-label">{label} age</span>
              <span className="age-badge-meta">FRA {fraLabel(fra)}</span>
            </div>
            <span className="age-badge-value">{formatAgeDisplay(currentAge)}</span>
          </div>
        )}
      </div>

      <div className="field">
        <span className="field-label">Gender</span>
        <div className="segmented-control" role="group" aria-label={`${label} gender`}>
          {(['female', 'male'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`segment-btn ${person.gender === g ? 'segment-btn-active' : ''}`}
              onClick={() => set({ gender: g })}
              aria-pressed={person.gender === g}
            >
              {genderLabel(g)}
            </button>
          ))}
        </div>
        <span className="field-hint">
          Used for SSA life expectancy tables (period life table)
        </span>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-benefit`}>Monthly benefit at full retirement age</label>
        <div className="currency-input">
          <span className="currency-prefix">$</span>
          <input
            id={`${idPrefix}-benefit`}
            type="text"
            inputMode="numeric"
            // A paste/fat-finger guard only — it does NOT enforce the $5,000
            // ceiling. It's wide enough to admit a mistyped yearly figure
            // (e.g. 36000) so `detectYearlyEntry` can catch and explain it;
            // `isBenefitInRange` enforces the real ceiling, in both the
            // aria-invalid state above and the submission gate.
            maxLength={7}
            value={benefitText}
            placeholder="0"
            aria-describedby={`${idPrefix}-benefit-hint`}
            aria-invalid={benefitOutOfRange || undefined}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, '');
              setBenefitText(digits);
              set({ monthlyBenefit: digits === '' ? '' : Number(digits) });
            }}
          />
        </div>
        {yearlySuspicion && (
          <div className="benefit-nudge" data-testid="yearly-entry-nudge" role="status">
            <span>
              {formatCurrency(yearlySuspicion.entered)} looks like a yearly amount.
            </span>
            <button
              type="button"
              className="benefit-nudge-action"
              onClick={() => {
                const next = yearlySuspicion.monthly;
                setBenefitText(String(next));
                set({ monthlyBenefit: next });
              }}
            >
              Use {formatCurrency(yearlySuspicion.monthly)}/month
            </button>
          </div>
        )}
        <span className="field-hint" id={`${idPrefix}-benefit-hint`}>
          ${MIN_BENEFIT.toLocaleString()}–${MAX_BENEFIT.toLocaleString()}.{' '}
          {index === 0
            ? 'From your SSA statement or mySocialSecurity.gov estimate.'
            : 'Enter $0 if they have little or no own work record.'}
        </span>
      </div>
    </fieldset>
  );
}
