import { useEffect, useState } from 'react';
import { formatAgeDisplay, fraLabel, personLabel } from '../lib/format';
import { genderLabel } from '../lib/lifeExpectancy';
import { getCurrentAge, getFullRetirementAge } from '../lib/personAnalysis';
import {
  isBenefitInRange,
  MAX_BENEFIT,
  MIN_BENEFIT_BY_INDEX,
  type PersonFormFields,
} from '../lib/formState';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEARS = Array.from({ length: 70 }, (_, i) => CURRENT_YEAR - 18 - i);

interface PersonFieldsProps {
  person: PersonFormFields;
  index: 0 | 1;
  onChange: (next: PersonFormFields) => void;
}

export function PersonFields({ person, index, onChange }: PersonFieldsProps) {
  const label = personLabel(person.name, index);
  const idPrefix = index === 0 ? 'a' : 'b';
  const set = (patch: Partial<PersonFormFields>) => onChange({ ...person, ...patch });

  const currentAge =
    person.birthYear !== '' && person.birthMonth !== ''
      ? getCurrentAge(person.birthYear, person.birthMonth)
      : null;
  const fra = person.birthYear !== '' ? getFullRetirementAge(person.birthYear) : null;

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

  const minBenefit = MIN_BENEFIT_BY_INDEX[index];
  // Same predicate the submission gate uses (`formState.isFormComplete`), so
  // a field marked invalid can never also produce an analysis.
  const benefitOutOfRange = benefitText !== '' && !isBenefitInRange(Number(benefitText), index);

  return (
    <fieldset className="person-fields" aria-label={label}>
      <legend>{label}</legend>

      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>Name (optional)</label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={person.name}
          placeholder={label}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-birth`}>Date of Birth</label>
        <div className="birth-row">
          <select
            id={`${idPrefix}-birth-month`}
            value={person.birthMonth}
            onChange={(e) => {
              const month = e.target.value === '' ? '' : Number(e.target.value);
              set({ birthMonth: month });
            }}
            aria-label={`${label} birth month`}
          >
            <option value="">Month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            id={`${idPrefix}-birth`}
            value={person.birthYear}
            onChange={(e) => {
              const year = e.target.value === '' ? '' : Number(e.target.value);
              set({ birthYear: year });
            }}
            aria-label={`${label} birth year`}
          >
            <option value="">Year</option>
            {BIRTH_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
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
        <label htmlFor={`${idPrefix}-benefit`}>Benefit at full retirement age</label>
        <div className="currency-input">
          <span className="currency-prefix">$</span>
          <input
            id={`${idPrefix}-benefit`}
            type="text"
            inputMode="numeric"
            // A paste/fat-finger guard only — it does NOT enforce the $5,000
            // ceiling (4 digits still admits 9999). `isBenefitInRange` does,
            // in both the aria-invalid state above and the submission gate.
            maxLength={String(MAX_BENEFIT).length}
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
        <span className="field-hint" id={`${idPrefix}-benefit-hint`}>
          ${minBenefit.toLocaleString()}–${MAX_BENEFIT.toLocaleString()}.{' '}
          {index === 0
            ? 'From your SSA statement or mySocialSecurity.gov estimate.'
            : 'Enter $0 if they have little or no own work record.'}
        </span>
      </div>
    </fieldset>
  );
}
