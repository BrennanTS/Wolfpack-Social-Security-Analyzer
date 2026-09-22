import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LifeExpectancyField } from './LifeExpectancyField';

const control = (over: Partial<Parameters<typeof LifeExpectancyField>[0]['control']> = {}) => ({
  label: 'John',
  value: 85 as number | null,
  onChange: vi.fn(),
  ssaSuggested: 82 as number | null,
  gender: 'male' as const,
  ...over,
});

/**
 * The plan-to age, which moved out of Planning assumptions and under the
 * person it belongs to. It was a per-person input sitting several sections
 * away from that person's name, date of birth and benefit.
 */
describe('LifeExpectancyField', () => {
  it('shows the age and moves it', async () => {
    const c = control();
    render(<LifeExpectancyField control={c} index={0} />);
    expect(screen.getByLabelText(/plan to age 85/)).toHaveValue('85');
    await userEvent.click(screen.getByRole('button', { name: /Use SSA age \(82\)/ }));
    expect(c.onChange).toHaveBeenCalledWith(82);
  });

  it('gives the two people different control ids', () => {
    // They render on the same page for a married household, so a shared id
    // would point both labels at the first slider.
    const { container } = render(
      <>
        <LifeExpectancyField control={control()} index={0} />
        <LifeExpectancyField control={control({ label: 'Jane', value: 92 })} index={1} />
      </>,
    );
    const ids = [...container.querySelectorAll('input[type=range]')].map((el) => el.id);
    expect(ids).toEqual(['life-0', 'life-1']);
  });

  it('asks for the inputs it needs before offering a slider', () => {
    render(<LifeExpectancyField control={control({ value: null, ssaSuggested: null })} index={0} />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.getByText(/Set date of birth and gender/)).toBeInTheDocument();
  });

  it('reads the suggestion from the person’s own gender', () => {
    render(
      <LifeExpectancyField
        control={control({ label: 'Jane', value: 92, ssaSuggested: 86, gender: 'female' })}
        index={1}
      />,
    );
    const hint = screen.getByText(
      (_, el) =>
        el?.className === 'field-hint' &&
        /86/.test(el.textContent ?? '') &&
        /female/i.test(el.textContent ?? ''),
    );
    expect(hint).toBeInTheDocument();
  });
});
