import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReportLayouts } from './useReportLayouts';
import { CLIENT_LAYOUT, DEFAULT_LAYOUT_ID, PRESETS } from '../lib/reportLayout';

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

const items = (n: number) => CLIENT_LAYOUT.items.slice(0, n);

describe('useReportLayouts', () => {
  beforeEach(() => useStorage());

  it('starts on the default preset', () => {
    const { result } = renderHook(() => useReportLayouts());
    expect(result.current.selectedId).toBe(DEFAULT_LAYOUT_ID);
    expect(result.current.layouts.length).toBe(PRESETS.length);
  });

  it('saves a layout and selects it', () => {
    const { result } = renderHook(() => useReportLayouts());
    act(() => void result.current.saveAs('Estate review', items(2)));
    expect(result.current.layout.name).toBe('Estate review');
    expect(result.current.layout.items).toHaveLength(2);
  });

  it('remembers saved layouts across a reload', () => {
    const { result } = renderHook(() => useReportLayouts());
    act(() => void result.current.saveAs('Kept', items(3)));
    const again = renderHook(() => useReportLayouts());
    expect(again.result.current.layouts.map((l) => l.name)).toContain('Kept');
  });

  it('refuses to edit or delete a preset', () => {
    // Presets are code so a later version can improve them. Letting one be
    // edited in place would fork it silently for this browser only.
    const { result } = renderHook(() => useReportLayouts());
    act(() => result.current.update(DEFAULT_LAYOUT_ID, items(1)));
    expect(result.current.layout.items).toEqual(CLIENT_LAYOUT.items);
    act(() => result.current.remove(DEFAULT_LAYOUT_ID));
    expect(result.current.layouts.map((l) => l.id)).toContain(DEFAULT_LAYOUT_ID);
  });

  it('updates a layout of your own in place', () => {
    const { result } = renderHook(() => useReportLayouts());
    act(() => void result.current.saveAs('Mine', items(4)));
    const id = result.current.selectedId;
    act(() => result.current.update(id, items(2)));
    expect(result.current.layout.items).toHaveLength(2);
  });

  it('falls back to a preset when the selected layout is deleted', () => {
    // The id is stored, so it outlives the layout. An export is the worst
    // moment to find out it names nothing.
    const { result } = renderHook(() => useReportLayouts());
    act(() => void result.current.saveAs('Temporary', items(2)));
    const id = result.current.selectedId;
    act(() => result.current.remove(id));
    expect(result.current.layout.id).toBe(DEFAULT_LAYOUT_ID);
  });

  it('never yields an undefined layout, even pointed at a stranger', () => {
    useStorage({ 'ssa-report-layout-id': 'layout-that-never-existed' });
    const { result } = renderHook(() => useReportLayouts());
    expect(result.current.layout).toBeTruthy();
    expect(result.current.layout.items.length).toBeGreaterThan(0);
  });

  it('survives a corrupt store rather than losing the ability to export', () => {
    useStorage({ 'ssa-report-layouts': '{not json' });
    const { result } = renderHook(() => useReportLayouts());
    expect(result.current.layouts.length).toBe(PRESETS.length);
  });

  it('drops only the bad entries from a partly corrupt store', () => {
    useStorage({
      'ssa-report-layouts': JSON.stringify([
        { id: 'good', name: 'Good', items: [{ kind: 'block', id: 'answer' }] },
        { id: 'bad', name: 'Bad', items: 'not an array' },
      ]),
    });
    const { result } = renderHook(() => useReportLayouts());
    const names = result.current.layouts.map((l) => l.name);
    expect(names).toContain('Good');
    expect(names).not.toContain('Bad');
  });

  it('builds the report from the draft, so Export matches what the editor shows', () => {
    // The defect this exists for: the draft lived in the editor component, so
    // dropping four charts, watching them leave the list and clicking Export
    // handed back the unedited preset.
    const { result } = renderHook(() => useReportLayouts());
    const full = result.current.layout.items.length;
    act(() => result.current.setDraftItems(items(2)));
    expect(result.current.layout.items).toHaveLength(2);
    expect(full).toBeGreaterThan(2);
  });

  it('abandons a draft when another layout is chosen', () => {
    // The draft belonged to the layout being edited; carrying it across would
    // silently apply one layout's edits to another.
    const { result } = renderHook(() => useReportLayouts());
    act(() => result.current.setDraftItems(items(1)));
    act(() => result.current.select(PRESETS[1].id));
    expect(result.current.layout.items).toEqual(PRESETS[1].items);
  });

  it('settles the draft once it is saved', () => {
    const { result } = renderHook(() => useReportLayouts());
    act(() => result.current.setDraftItems(items(2)));
    act(() => void result.current.saveAs('Saved from draft', result.current.layout.items));
    expect(result.current.draftItems).toBeNull();
    expect(result.current.layout.name).toBe('Saved from draft');
    expect(result.current.layout.items).toHaveLength(2);
  });

  it('gives an imported layout a fresh id, so it cannot collide', () => {
    const { result } = renderHook(() => useReportLayouts());
    act(() => void result.current.saveAs('First', items(2)));
    const existing = result.current.selectedId;
    act(() => void result.current.importLayout({ ...CLIENT_LAYOUT, id: existing, name: 'Theirs' }));
    const ids = result.current.layouts.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
