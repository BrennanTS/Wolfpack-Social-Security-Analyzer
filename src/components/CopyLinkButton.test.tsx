import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyLinkButton } from './CopyLinkButton';
import { BLANK_FORM } from '../lib/formState';

const form = {
  ...BLANK_FORM,
  personA: {
    name: 'Dan', birthYear: 1962, birthMonth: 4, gender: 'male' as const,
    monthlyBenefit: 2400, lifeExpectancy: 85,
  },
  hasSpouse: false,
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

  // The panel shows a URL encoding the client's date of birth and benefit.
  // Nothing used to clear it, so it sat in the header for the rest of the
  // session and went stale the moment the adviser touched the form — showing
  // a scenario that no longer existed.
  describe('the clipboard fallback does not outlive the state it encodes', () => {
    async function openFallback(initial = form) {
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      });
      const view = render(<CopyLinkButton form={initial} disabled={false} />);
      await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
      await screen.findByTestId('share-link-fallback');
      return view;
    }

    it('clears the stale URL when the form changes', async () => {
      const { rerender } = await openFallback();

      // The adviser edits the benefit — the visible URL now encodes a
      // scenario that no longer exists.
      rerender(
        <CopyLinkButton
          form={{ ...form, personA: { ...form.personA, monthlyBenefit: 3100 } }}
          disabled={false}
        />,
      );
      expect(screen.queryByTestId('share-link-fallback')).toBeNull();
    });

    it('stays put across a re-render that does not change the form', async () => {
      const { rerender } = await openFallback();
      rerender(<CopyLinkButton form={form} disabled={false} />);
      expect(screen.queryByTestId('share-link-fallback')).not.toBeNull();
    });

    it('can be dismissed by hand', async () => {
      await openFallback();
      await userEvent.click(screen.getByTestId('share-link-fallback-dismiss'));
      expect(screen.queryByTestId('share-link-fallback')).toBeNull();
    });

    it('gives the dismiss control an accessible name', async () => {
      await openFallback();
      expect(screen.getByRole('button', { name: /dismiss link/i })).toBeDefined();
    });

    it('can be reopened after dismissing, if the clipboard still fails', async () => {
      await openFallback();
      await userEvent.click(screen.getByTestId('share-link-fallback-dismiss'));
      await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
      expect(await screen.findByTestId('share-link-fallback')).toBeDefined();
    });
  });
});
