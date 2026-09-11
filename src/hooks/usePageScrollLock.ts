import { useEffect } from 'react';

/**
 * Holds the page still behind an open dialog.
 *
 * Without it the wheel goes to whatever is under the pointer, and the report
 * scrolls away behind the dialog — most obviously once the dialog's own
 * scrolling region has reached its end, since that is when the wheel starts
 * being handed on. Padding replaces the width the scrollbar was holding,
 * where the platform draws one, so nothing shifts sideways as it goes.
 *
 * One copy, called by every dialog: the fourth identical transcription of it
 * is what prompted this, and a lock that is restored differently in one place
 * leaves the page unable to scroll at all.
 */
export function usePageScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousPadding = root.style.paddingRight;
    const scrollbar = window.innerWidth - root.clientWidth;
    root.style.overflow = 'hidden';
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    return () => {
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPadding;
    };
  }, [locked]);
}
