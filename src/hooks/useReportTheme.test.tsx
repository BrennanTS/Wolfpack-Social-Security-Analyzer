import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReportTheme } from './useReportTheme';
import { DEFAULT_REPORT_THEME_ID } from '../lib/reportTheme';

const KEY = 'ssa-report-theme';

/**
 * jsdom here has no `localStorage`, so one is supplied per test — the same
 * pattern `Analyzer.test.tsx` uses. That absence is also why the hook wraps
 * every storage call: in this very environment, an unguarded read throws.
 */
function useStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage,
    configurable: true,
    writable: true,
  });
}

describe('useReportTheme', () => {
  beforeEach(() => {
    useStorage();
  });

  it('starts on the house palette when nothing has been chosen', () => {
    const { result } = renderHook(() => useReportTheme());
    expect(result.current.themeId).toBe(DEFAULT_REPORT_THEME_ID);
  });

  it('remembers the choice, so a firm sets it once', () => {
    const { result } = renderHook(() => useReportTheme());
    act(() => result.current.chooseTheme('midnight'));
    expect(result.current.themeId).toBe('midnight');
    expect(localStorage.getItem(KEY)).toBe('midnight');
    expect(renderHook(() => useReportTheme()).result.current.themeId).toBe('midnight');
  });

  it('ignores a stored id that no longer names a theme', () => {
    // A theme removed in a later version leaves this behind in every browser
    // that had picked it. Falling through to `undefined` would take the PDF
    // export down at the moment the adviser clicked Export.
    localStorage.setItem(KEY, 'retired-theme');
    expect(renderHook(() => useReportTheme()).result.current.themeId).toBe(
      DEFAULT_REPORT_THEME_ID,
    );
  });

  it('refuses an unknown id rather than storing it', () => {
    const { result } = renderHook(() => useReportTheme());
    act(() => result.current.chooseTheme('not-a-theme'));
    expect(result.current.themeId).toBe(DEFAULT_REPORT_THEME_ID);
  });

  it('is independent of dark mode', () => {
    // Different keys on purpose: dark mode is the adviser's preference for
    // their own screen, the report theme is a property of what the client is
    // handed. Sharing storage would eventually couple them.
    const { result } = renderHook(() => useReportTheme());
    act(() => result.current.chooseTheme('slate'));
    expect(localStorage.getItem('ssa-dark-mode')).toBeNull();
  });
});
