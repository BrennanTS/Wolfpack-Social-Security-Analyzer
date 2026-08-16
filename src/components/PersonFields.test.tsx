import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PersonFields } from './PersonFields';

const blank = {
  name: '', birthYear: '' as const, birthMonth: '' as const,
  gender: null, monthlyBenefit: '' as const,
};

describe('PersonFields', () => {
  it('labels the first person You and the second Spouse', () => {
    // Exact (non-regex) names: each person also has a "<label> gender"
    // group nested inside the fieldset, so a substring match like /you/i
    // would ambiguously match both.
    const { rerender } = render(
      <PersonFields person={blank} index={0} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('group', { name: 'You' })).toBeDefined();

    rerender(<PersonFields person={blank} index={1} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Spouse' })).toBeDefined();
  });

  it('prefers a supplied name in the group label', () => {
    render(<PersonFields person={{ ...blank, name: 'Sarah' }} index={1} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Sarah' })).toBeDefined();
  });

  it('reports gender selection to the parent', async () => {
    const onChange = vi.fn();
    render(<PersonFields person={blank} index={0} onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'You' }); // the fieldset
    await userEvent.click(within(group).getByRole('button', { name: 'Female' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gender: 'female' }));
  });

  // The red ring and the "will this analyze?" gate now share one predicate
  // (`isBenefitInRange`), so this asserts the UI half against the same cases
  // formState.test.ts asserts the gate half against. Both people share one
  // $0-$5,000 range now — there is no longer a $500 floor on person 0.
  it.each([
    { index: 0 as const, benefit: 0, invalid: false },
    { index: 0 as const, benefit: 250, invalid: false },
    { index: 0 as const, benefit: 500, invalid: false },
    { index: 0 as const, benefit: 5000, invalid: false },
    { index: 0 as const, benefit: 9999, invalid: true },
    { index: 1 as const, benefit: 0, invalid: false },
    { index: 1 as const, benefit: 250, invalid: false },
    { index: 1 as const, benefit: 9999, invalid: true },
  ])('marks $benefit for person $index invalid=$invalid', ({ index, benefit, invalid }) => {
    render(
      <PersonFields person={{ ...blank, monthlyBenefit: benefit }} index={index} onChange={vi.fn()} />,
    );
    const field = screen.getByLabelText(/benefit at full retirement age/i);
    expect(field.getAttribute('aria-invalid')).toBe(invalid ? 'true' : null);
  });

  it('reports the benefit amount as a number', async () => {
    const onChange = vi.fn();
    render(<PersonFields person={blank} index={0} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/benefit at full retirement age/i), '2400');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthlyBenefit: 2400 }),
    );
  });

  it('gives each person a distinctly-named gender group when both are rendered', () => {
    render(
      <>
        <PersonFields person={blank} index={0} onChange={vi.fn()} />
        <PersonFields person={blank} index={1} onChange={vi.fn()} />
      </>,
    );

    const you = within(screen.getByRole('group', { name: 'You' })).getByRole('group', {
      name: 'You gender',
    });
    const spouse = within(screen.getByRole('group', { name: 'Spouse' })).getByRole('group', {
      name: 'Spouse gender',
    });

    expect(you).not.toBe(spouse);
    expect(you.getAttribute('aria-label')).not.toBe(spouse.getAttribute('aria-label'));
  });
});

describe('yearly-entry nudge', () => {
  const blank = {
    name: '', birthYear: '' as const, birthMonth: '' as const,
    gender: null, monthlyBenefit: '' as const,
  };

  it('says the benefit is monthly, in the label', () => {
    render(<PersonFields person={blank} index={0} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/monthly benefit at full retirement age/i)).toBeDefined();
  });

  it('accepts more than four digits, so a yearly figure can be typed at all', async () => {
    const onChange = vi.fn();
    render(<PersonFields person={blank} index={0} onChange={onChange} />);
    await userEvent.type(
      screen.getByLabelText(/monthly benefit at full retirement age/i),
      '36000',
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthlyBenefit: 36000 }),
    );
  });

  it('offers the monthly equivalent when a yearly figure is entered', () => {
    render(
      <PersonFields person={{ ...blank, monthlyBenefit: 36000 }} index={0} onChange={vi.fn()} />,
    );
    const nudge = screen.getByTestId('yearly-entry-nudge');
    expect(nudge.textContent).toMatch(/36,000/);
    expect(nudge.textContent).toMatch(/3,000/);
  });

  it('applies the conversion when the suggestion is accepted', async () => {
    const onChange = vi.fn();
    render(
      <PersonFields person={{ ...blank, monthlyBenefit: 36000 }} index={0} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /use \$3,000/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthlyBenefit: 3000 }),
    );
    expect(screen.getByLabelText(/monthly benefit at full retirement age/i)).toHaveValue('3000');
  });

  it('stays quiet for a plausible monthly benefit', () => {
    render(
      <PersonFields person={{ ...blank, monthlyBenefit: 4800 }} index={0} onChange={vi.fn()} />,
    );
    expect(screen.queryByTestId('yearly-entry-nudge')).toBeNull();
  });
});
