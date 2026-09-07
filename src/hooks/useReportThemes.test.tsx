import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReportThemes } from './useReportThemes';
import { DEFAULT_REPORT_THEME_ID, REPORT_THEMES, reportTheme } from '../lib/reportTheme';

const SELECTED_KEY = 'ssa-report-theme';
const SAVED_KEY = 'ssa-report-themes';

/** jsdom here has no `localStorage`; one is supplied per test. */
function useStorage(seed: Record<string, string> = {}): void {
  const store = new Map(Object.entries(seed));
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

const house = () => reportTheme(DEFAULT_REPORT_THEME_ID);

describe('useReportThemes', () => {
  beforeEach(() => useStorage());

  it('starts on the house palette when nothing has been chosen', () => {
    const { result } = renderHook(() => useReportThemes());
    expect(result.current.selectedId).toBe(DEFAULT_REPORT_THEME_ID);
    expect(result.current.themes).toHaveLength(REPORT_THEMES.length);
  });

  it('remembers the choice under the key the picker always used', () => {
    // An adviser who had already chosen Midnight keeps it across this change.
    const { result } = renderHook(() => useReportThemes());
    act(() => result.current.select('midnight'));
    expect(localStorage.getItem(SELECTED_KEY)).toBe('midnight');
    expect(renderHook(() => useReportThemes()).result.current.theme.name).toBe('Midnight');
  });

  it('falls back to the house palette for an id that no longer names a theme', () => {
    // A theme deleted in another tab leaves this behind, and `undefined.ink`
    // would take the export down at the moment Export was clicked.
    useStorage({ [SELECTED_KEY]: 'gone' });
    expect(renderHook(() => useReportThemes()).result.current.theme.id).toBe(
      DEFAULT_REPORT_THEME_ID,
    );
  });

  it('holds an edit to a preset as a draft rather than changing the preset', () => {
    // Presets are code. Editing one in place would fork what "Wolfpack" means
    // for this browser only, silently.
    const { result } = renderHook(() => useReportThemes());
    act(() => result.current.change({ ...house(), firm: 'Northgate' }));
    expect(result.current.theme.firm).toBe('Northgate');
    expect(result.current.draft).not.toBeNull();
    expect(reportTheme(DEFAULT_REPORT_THEME_ID).firm).not.toBe('Northgate');
  });

  it('saves a draft under a new name and selects it', () => {
    const { result } = renderHook(() => useReportThemes());
    act(() => result.current.change({ ...house(), brand: '#1f4e79' }));
    act(() => void result.current.saveAs('Northgate', result.current.theme));
    expect(result.current.theme.name).toBe('Northgate');
    expect(result.current.theme.brand).toBe('#1f4e79');
    expect(result.current.draft).toBeNull();
    expect(result.current.isPreset(result.current.selectedId)).toBe(false);
  });

  it('writes edits straight through for a theme of your own', () => {
    const { result } = renderHook(() => useReportThemes());
    act(() => void result.current.saveAs('Mine', house()));
    act(() => result.current.change({ ...result.current.theme, firm: 'Northgate' }));
    expect(result.current.draft).toBeNull();
    expect(result.current.theme.firm).toBe('Northgate');
    // And it survives a reload, which a draft would not.
    expect(renderHook(() => useReportThemes()).result.current.theme.firm).toBe('Northgate');
  });

  it('renames and deletes only themes of your own', () => {
    const { result } = renderHook(() => useReportThemes());
    act(() => void result.current.saveAs('Mine', house()));
    const id = result.current.selectedId;
    act(() => result.current.rename(id, 'Renamed'));
    expect(result.current.theme.name).toBe('Renamed');

    act(() => result.current.rename(DEFAULT_REPORT_THEME_ID, 'Nope'));
    expect(reportTheme(DEFAULT_REPORT_THEME_ID).name).toBe('Wolfpack');

    act(() => result.current.remove(id));
    expect(result.current.selectedId).toBe(DEFAULT_REPORT_THEME_ID);
    act(() => result.current.remove(DEFAULT_REPORT_THEME_ID));
    expect(result.current.themes).toHaveLength(REPORT_THEMES.length);
  });

  it('gives an imported theme a fresh id, so it cannot land on an existing one', () => {
    const { result } = renderHook(() => useReportThemes());
    act(() => void result.current.importTheme({ ...house(), id: 'wolfpack', name: 'From a colleague' }));
    expect(result.current.theme.name).toBe('From a colleague');
    expect(result.current.selectedId).not.toBe('wolfpack');
    expect(result.current.isPreset(result.current.selectedId)).toBe(false);
  });

  it('drops a stored theme that no longer parses, keeping the rest', () => {
    useStorage({
      [SAVED_KEY]: JSON.stringify([{ nonsense: true }, { ...house(), id: 'mine', name: 'Kept' }]),
    });
    const { result } = renderHook(() => useReportThemes());
    expect(result.current.themes.map((t) => t.name)).toContain('Kept');
    expect(result.current.themes).toHaveLength(REPORT_THEMES.length + 1);
  });

  it('abandons a draft when another theme is picked', () => {
    // The draft belonged to the theme being left, and carrying it across
    // would silently paint one theme in another's colors.
    const { result } = renderHook(() => useReportThemes());
    act(() => result.current.change({ ...house(), firm: 'Northgate' }));
    act(() => result.current.select('slate'));
    expect(result.current.draft).toBeNull();
    expect(result.current.theme.firm).toBe(house().firm);
  });
});
