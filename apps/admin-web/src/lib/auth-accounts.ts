/**
 * The browser's accounts on the auth server (the account menu).
 *
 * The auth server keeps every account signed in to this browser in its own
 * host-only `__session` cookie, which this app's server never sees. The page
 * asks the auth server directly with a credentialed fetch:
 *   GET    {AUTH}/session/accounts            -> { accounts: [...] } ([] when signed out; older auth: 401)
 *   POST   {AUTH}/session/switch {userId}     -> changes the active account
 *   DELETE {AUTH}/session/accounts/:userId    -> signs one account out
 * Every app's next silent /authorize then signs in the active account.
 *
 * Browser-only (fetch with credentials: 'include'), no Next.js imports.
 */
import { loginPath, type LoginPrompt } from './login-flow';

export interface AuthAccount {
  userId: string;
  email: string;
  name?: string;
  isActive: boolean;
}

function authUrl(issuer: string, path: string): string {
  return new URL(path, new URL(issuer).origin).toString();
}

/** Normalises the /session/accounts body; drops malformed rows. */
export function parseAccounts(body: unknown): AuthAccount[] {
  const rows = (body as { accounts?: unknown } | null)?.accounts;
  if (!Array.isArray(rows)) return [];
  const accounts: AuthAccount[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown> | null;
    if (!r || typeof r.userId !== 'string' || !r.userId) continue;
    accounts.push({
      userId: r.userId,
      email: typeof r.email === 'string' ? r.email : '',
      name: typeof r.name === 'string' && r.name ? r.name : undefined,
      isActive: r.isActive === true,
    });
  }
  return accounts;
}

/**
 * The browser's accounts: a list (possibly empty) when the auth server
 * answered, [] when it has no session (401), null when it could not be asked
 * (network, CORS): callers then keep what they know locally.
 */
export async function fetchAuthAccounts(issuer: string, fetchImpl: typeof fetch = fetch): Promise<AuthAccount[] | null> {
  try {
    const res = await fetchImpl(authUrl(issuer, '/session/accounts'), { credentials: 'include', cache: 'no-store' });
    if (res.status === 401) return [];
    if (!res.ok) return null;
    return parseAccounts(await res.json());
  } catch {
    return null;
  }
}

export async function switchAuthAccount(issuer: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(authUrl(issuer, '/session/switch'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeAuthAccount(issuer: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(authUrl(issuer, `/session/accounts/${encodeURIComponent(userId)}`), {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Where the browser goes to get tokens for the auth server's (new) active account. */
export function reauthPath(currentPath: string, prompt: LoginPrompt): string {
  return loginPath(currentPath, prompt);
}

/**
 * Signing out of one account: with other accounts left in the browser, only
 * that account leaves (DELETE) and the panel signs in silently as the auth
 * server's new active account. The last account out is the existing single
 * sign-out (POST /api/logout -> auth /logout), so nothing signs back in.
 */
export function signOutOneDecision(accounts: AuthAccount[] | null, userId: string): 'remove-and-reauth' | 'single-sign-out' {
  if (!accounts) return 'single-sign-out';
  const others = accounts.filter((a) => a.userId !== userId);
  return others.length > 0 ? 'remove-and-reauth' : 'single-sign-out';
}
