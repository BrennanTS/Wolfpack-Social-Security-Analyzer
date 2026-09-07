import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSavedClients } from './useSavedClients';

const KEY = 'ssa-clients';

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

const view = (label: string) => ({
  label,
  names: { a: 'Dan' },
  params: 'ay=1962&am=4&ag=m&ab=2400',
});

describe('useSavedClients', () => {
  beforeEach(() => useStorage());

  it('starts empty — there is no such thing as a preset client', () => {
    expect(renderHook(() => useSavedClients()).result.current.clients).toEqual([]);
  });

  it('saves newest first, which is the order the list is read in', () => {
    const { result } = renderHook(() => useSavedClients());
    act(() => void result.current.save(view('First')));
    act(() => void result.current.save(view('Second')));
    expect(result.current.clients.map((c) => c.label)).toEqual(['Second', 'First']);
  });

  it('remembers them across a reload', () => {
    const { result } = renderHook(() => useSavedClients());
    act(() => void result.current.save(view('Kept')));
    expect(renderHook(() => useSavedClients()).result.current.clients[0].label).toBe('Kept');
    expect(localStorage.getItem(KEY)).toContain('Kept');
  });

  it('overwrites one in place, keeping its id and its position', () => {
    const { result } = renderHook(() => useSavedClients());
    act(() => void result.current.save(view('First')));
    act(() => void result.current.save(view('Second')));
    const target = result.current.clients[1];
    act(() => result.current.update(target.id, { ...view('First'), params: 'ay=1970' }));
    expect(result.current.clients[1].id).toBe(target.id);
    expect(result.current.clients[1].params).toBe('ay=1970');
  });

  it('renames and removes', () => {
    const { result } = renderHook(() => useSavedClients());
    act(() => void result.current.save(view('Before')));
    const id = result.current.clients[0].id;
    act(() => result.current.rename(id, 'After'));
    expect(result.current.clients[0].label).toBe('After');
    act(() => result.current.remove(id));
    expect(result.current.clients).toEqual([]);
  });

  it('keeps a rename that is only whitespace from blanking the row', () => {
    const { result } = renderHook(() => useSavedClients());
    act(() => void result.current.save(view('Named')));
    act(() => result.current.rename(result.current.clients[0].id, '   '));
    expect(result.current.clients[0].label).toBe('Named');
  });

  it('gives imported records fresh ids rather than overwriting by id', () => {
    // Two advisers who both saved a household this morning have two records
    // with two ids; merging by id would lose one with nothing on screen.
    const { result } = renderHook(() => useSavedClients());
    act(() => void result.current.save(view('Mine')));
    const mine = result.current.clients[0];
    act(() => void result.current.importClients([{ ...mine, label: 'Theirs' }]));
    expect(result.current.clients).toHaveLength(2);
    expect(new Set(result.current.clients.map((c) => c.id)).size).toBe(2);
  });

  it('drops a stored record that no longer parses, keeping the rest', () => {
    useStorage({
      [KEY]: JSON.stringify([{ nope: true }, { id: 'x', label: 'Kept', names: {}, params: 'ay=1962', savedAt: 1 }]),
    });
    const { result } = renderHook(() => useSavedClients());
    expect(result.current.clients.map((c) => c.label)).toEqual(['Kept']);
  });
});
