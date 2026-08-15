import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PersonFields } from './PersonFields';

const blank = {
  name: '', birthYear: '' as const, birthMonth: '' as const,
  gender: null, monthlyBenefit: '' as const,
};

describe('PersonFields', () => {
  it('labels the first person You and the second Spouse', () => {
    const { rerender } = render(
      <PersonFields person={blank} index={0} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('group', { name: /you/i })).toBeDefined();

    rerender(<PersonFields person={blank} index={1} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: /spouse/i })).toBeDefined();
  });

  it('prefers a supplied name in the group label', () => {
    render(<PersonFields person={{ ...blank, name: 'Sarah' }} index={1} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: /sarah/i })).toBeDefined();
  });

  it('reports gender selection to the parent', async () => {
    const onChange = vi.fn();
    render(<PersonFields person={blank} index={0} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Female' }));
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
});
