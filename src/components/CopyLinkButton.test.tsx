import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyLinkButton } from './CopyLinkButton';
import { BLANK_FORM } from '../lib/formState';

const form = {
  ...BLANK_FORM,
  personA: { name: 'Dan', birthYear: 1962, birthMonth: 4, gender: 'male' as const, monthlyBenefit: 2400 },
  hasSpouse: false,
  lifeExpectancy: 85,
};

afterEach(() => vi.unstubAllGlobals());

describe('CopyLinkButton', () => {
  it('is disabled when the form is incomplete', () => {
    render(<CopyLinkButton form={BLANK_FORM} disabled />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeDisabled();
  });

  it('writes a link containing the form state to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CopyLinkButton form={form} disabled={false} />);

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toMatch(/ay=1962/);
  });

  it('never puts a name in the copied link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CopyLinkButton form={form} disabled={false} />);

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect(writeText.mock.calls[0][0]).not.toMatch(/Dan/i);
  });

  it('falls back to a selectable field when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<CopyLinkButton form={form} disabled={false} />);

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
    const fallback = await screen.findByTestId('share-link-fallback');
    expect((fallback as HTMLInputElement).value).toMatch(/ay=1962/);
  });
});
