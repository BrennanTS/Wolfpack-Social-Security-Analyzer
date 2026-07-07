/**
 * Lightweight demo gate.
 *
 * This is a client-side access gate for the private demo only — it is NOT real
 * authentication and provides no security. The password is intentionally simple
 * and lives in the bundle. Replace with a server-verified session before using
 * this app with real user data.
 */

const AUTH_KEY = 'ssa-demo-auth';

/** The shared demo password for the Wolfpack planning team. */
export const DEMO_PASSWORD = 'wolfpack';

export function isAuthenticated(): boolean {
  return sessionStorage.getItem(AUTH_KEY) === 'true';
}

export function signIn(): void {
  sessionStorage.setItem(AUTH_KEY, 'true');
}

export function logout(): void {
  sessionStorage.removeItem(AUTH_KEY);
}
