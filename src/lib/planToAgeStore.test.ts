import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPlanToAges, writePlanToAge } from './planToAgeStore';
import { LIFE_EXPECTANCY_BOUNDS } from './formBounds';

const KEY = 'wolfpack.planToAge.v1';

/**
 * The tests bring their own `Storage` rather than borrowing the environment's.
 *
 * Not merely convenient: jsdom as configured here has a `window` whose
 * `localStorage` is `undefined`, so a test leaning on the environment would
 * have exercised the not-available path while appearing to test the happy
 * one. Supplying a controlled implementation means each case below tests the
 * behaviour it names.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

let store: Storage;

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('window', { localStorage: store });
});
afterEach(() => vi.unstubAllGlobals());

describe('readPlanToAges', () => {
  it('is empty before anything is set', () => {
    expect(readPlanToAges()).toEqual({});
  });

  it('returns each slot independently', () => {
    writePlanToAge('a', 88);
    expect(readPlanToAges()).toEqual({ a: 88 });
    writePlanToAge('b', 92);
    expect(readPlanToAges()).toEqual({ a: 88, b: 92 });
  });

  it('overwrites one slot without disturbing the other', () => {
    writePlanToAge('a', 88);
    writePlanToAge('b', 92);
    writePlanToAge('a', 79);
    expect(readPlanToAges()).toEqual({ a: 79, b: 92 });
  });
});

describe('what comes back out is untrusted', () => {
  // `localStorage` is user-writable and survives across app versions, so a
  // stored value gets the same dropped-not-clamped treatment `shareLink.ts`
  // gives a query parameter.
  it('ignores a value outside the slider bounds rather than clamping it', () => {
    store.setItem(KEY, JSON.stringify({ a: 200, b: 10 }));
    expect(readPlanToAges()).toEqual({});
    // The point of "not clamped": 200 does not come back as the maximum.
    expect(readPlanToAges().a).not.toBe(LIFE_EXPECTANCY_BOUNDS.max);
  });

  it('drops one bad slot and keeps the other', () => {
    store.setItem(KEY, JSON.stringify({ a: 88, b: 999 }));
    expect(readPlanToAges()).toEqual({ a: 88 });
  });

  it('ignores non-integers, strings and nulls', () => {
    store.setItem(KEY, JSON.stringify({ a: 88.5, b: '92' }));
    expect(readPlanToAges()).toEqual({});
    store.setItem(KEY, JSON.stringify({ a: null }));
    expect(readPlanToAges()).toEqual({});
  });

  it('survives malformed JSON and non-object payloads', () => {
    store.setItem(KEY, 'not json at all');
    expect(readPlanToAges()).toEqual({});
    store.setItem(KEY, JSON.stringify(['a', 'b']));
    expect(readPlanToAges().a).toBeUndefined();
    store.setItem(KEY, JSON.stringify(42));
    expect(readPlanToAges()).toEqual({});
  });

  it('refuses to write a value it would refuse to read', () => {
    writePlanToAge('a', 200);
    writePlanToAge('b', 88.5);
    expect(readPlanToAges()).toEqual({});
  });
});

describe('when storage is unavailable', () => {
  // Safari private mode and some enterprise policies THROW on access rather
  // than returning null. An uncaught throw here would happen inside
  // `Analyzer`'s state initializer, taking the app down before first paint.
  const throwingStorage = () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError: storage is disabled');
      },
    });
  };

  it('reads as empty when the DOM has no storage at all', () => {
    // jsdom's own default, and some embedded webviews: `window` exists and
    // `window.localStorage` is `undefined`. Without the `?? null` guard this
    // reached `undefined.getItem`.
    vi.stubGlobal('window', {});
    expect(readPlanToAges()).toEqual({});
    expect(() => writePlanToAge('a', 88)).not.toThrow();
  });

  it('reads as empty rather than throwing', () => {
    throwingStorage();
    expect(() => readPlanToAges()).not.toThrow();
    expect(readPlanToAges()).toEqual({});
  });

  it('writes silently rather than throwing', () => {
    throwingStorage();
    expect(() => writePlanToAge('a', 88)).not.toThrow();
  });

  it('survives a quota error on write', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      } as unknown as Storage,
    });
    expect(() => writePlanToAge('a', 88)).not.toThrow();
  });
});
