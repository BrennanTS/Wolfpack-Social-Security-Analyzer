// src/components/DarkModeToggle.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DarkModeToggle } from './DarkModeToggle';

describe('DarkModeToggle', () => {
  it('reports pressed state and fires the toggle handler', async () => {
    const onToggle = vi.fn();
    render(<DarkModeToggle active={true} onToggle={onToggle} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
