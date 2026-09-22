import { genderLabel, SSA_LIFE_TABLE_URL } from '../lib/lifeExpectancy';
import type { Gender } from '../lib/lifeExpectancy';
import { LIFE_EXPECTANCY_BOUNDS } from '../lib/formBounds';

export interface LifeExpectancyControl {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  ssaSuggested: number | null;
  gender: Gender | null;
}

/**
 * One person's plan-to age.
 *
 * Its own component because it moved: it used to sit in Planning assumptions
 * with the household-wide settings, which put a PER-PERSON input several
 * sections away from that person's name, date of birth and benefit — the
 * three things an adviser is typing when they know the answer to it. The
 * panel it left now holds only settings that apply to the whole report.
 *
 * `index` distinguishes the two sliders' ids on a married household, which is
 * also what the label element needs to point at the right one.
 */
export function LifeExpectancyField({
  control,
  index,
}: {
  control: LifeExpectancyControl;
  index: number;
}) {
  const id = `life-${index}`;
  return (
    <div className="field">
      <label htmlFor={id}>
        Life expectancy
        {control.value !== null ? `, plan to age ${control.value}` : ''}
      </label>
      {control.value !== null ? (
        <>
          <input
            id={id}
            type="range"
            min={LIFE_EXPECTANCY_BOUNDS.min}
            max={LIFE_EXPECTANCY_BOUNDS.max}
            value={control.value}
            onChange={(e) => control.onChange(Number(e.target.value))}
          />
          <div className="range-labels">
            <span>{LIFE_EXPECTANCY_BOUNDS.min}</span>
            <span>{LIFE_EXPECTANCY_BOUNDS.max}</span>
          </div>
        </>
      ) : (
        <p className="field-hint assumptions-placeholder">
          Set date of birth and gender to enable life expectancy planning.
        </p>
      )}
      {control.ssaSuggested !== null && control.gender !== null && (
        <div className="ssa-life-row">
          <span className="field-hint">
            SSA suggests age <strong>{control.ssaSuggested}</strong> for{' '}
            {genderLabel(control.gender).toLowerCase()} (
            <a href={SSA_LIFE_TABLE_URL} target="_blank" rel="noopener noreferrer">
              period life table
            </a>
            )
          </span>
          <button
            type="button"
            className="btn-reset-cola"
            onClick={() => control.onChange(control.ssaSuggested as number)}
          >
            Use SSA age ({control.ssaSuggested})
          </button>
        </div>
      )}
    </div>
  );
}
