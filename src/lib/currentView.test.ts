import { beforeEach, describe, expect, it } from 'vitest';
import { clearCurrentView, readCurrentView, writeCurrentView } from './currentView';

const KEY = 'ssa-current-view';

/** jsdom here has no `localStorage`; one is supplied per test. */
function useStorage(seed: Record<string, string> = {}): void {
  const store = new Map(Object.entries(seed));
  Object.defineProperty(globalThis, 'localStorage', {
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

describe('the household on screen', () => {
  beforeEach(() => useStorage());

  it('is nothing until something is put there', () => {
    expect(readCurrentView()).toBeNull();
  });

  it('survives being written and read back', () => {
    writeCurrentView({ params: 'an=Dan&ay=1962', openClientId: 'client-1' });
    expect(readCurrentView()).toEqual({ params: 'an=Dan&ay=1962', openClientId: 'client-1' });
  });

  it('is cleared on request, which is how an adviser starts a new household', () => {
    // The refresh used to be that escape hatch; keeping the view across one
    // takes it away, so this replaces it.
    writeCurrentView({ params: 'an=Dan', openClientId: null });
    clearCurrentView();
    expect(readCurrentView()).toBeNull();
  });

  it('tolerates a leading question mark', () => {
    writeCurrentView({ params: '?an=Dan', openClientId: null });
    expect(readCurrentView()?.params).toBe('an=Dan');
  });

  it('treats an empty view as nothing to restore', () => {
    // Otherwise a blank form would be "restored" over the remembered plan-to
    // ages a first-time reader should get.
    writeCurrentView({ params: '   ', openClientId: null });
    expect(readCurrentView()).toBeNull();
  });

  it('refuses anything that is not a stored view', () => {
    for (const junk of ['not json', '[]', '{}', 'null', '{"params":42}']) {
      useStorage({ [KEY]: junk });
      expect(readCurrentView()).toBeNull();
    }
  });

  it('drops an open client id that is not one', () => {
    useStorage({ [KEY]: JSON.stringify({ params: 'an=Dan', openClientId: { nope: true } }) });
    expect(readCurrentView()?.openClientId).toBeNull();
  });

  it('does not throw when storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      } as unknown as Storage,
      configurable: true,
    });
    expect(readCurrentView()).toBeNull();
    expect(() => writeCurrentView({ params: 'a', openClientId: null })).not.toThrow();
    expect(() => clearCurrentView()).not.toThrow();
  });
});
