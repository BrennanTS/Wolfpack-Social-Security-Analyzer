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
