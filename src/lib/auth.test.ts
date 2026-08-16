import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PASSWORD, isAuthenticated, logout, signIn } from './auth';

describe('demo auth gate', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it('starts unauthenticated', () => {
    expect(isAuthenticated()).toBe(false);
  });

  it('authenticates after signIn and clears after logout', () => {
    signIn();
    expect(isAuthenticated()).toBe(true);
    logout();
    expect(isAuthenticated()).toBe(false);
  });

  it('exposes the documented demo password', () => {
    expect(DEMO_PASSWORD).toBe('wolfpack');
  });
});
