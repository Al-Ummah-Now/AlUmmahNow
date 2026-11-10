/**
 * The browser's accounts on the auth server, and how the videos site follows
 * them ("if you are signed in, you are signed in").
 *
 * The auth server keeps every account signed in to this browser in its own
 * host-only `__session` cookie, which this app's server never sees. The page
 * asks the auth server directly, with a credentialed fetch:
 *   GET    {AUTH}/session/accounts           -> { accounts: [...] } ([] when signed out; older auth: 401)
 *   POST   {AUTH}/session/switch {userId}    -> changes the active account
 *   DELETE {AUTH}/session/accounts/:userId   -> signs one account out
 * Every app's next silent /authorize signs in the active account.
 *
 * The site still keeps per-account tokens locally (al_ummah_session, #446);
 * the LIST shown in the switcher comes from the auth server, merged with
 * them. Browser-only fetches, pure decisions (unit tested).
 */

export interface AuthAccount {
  userId: string;
  email: string;
  name?: string;
  isActive: boolean;
}

/** A switcher row (same shape the navigation always rendered, plus hasLocalSession). */
export interface SwitcherAccount {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  isActive: boolean;
  channelsCount: number;
  /** False for an account signed in to the browser but not to this site yet. */
  hasLocalSession: boolean;
}

export type LocalAccount = Omit<SwitcherAccount, 'hasLocalSession'>;

function authUrl(authOrigin: string, path: string): string {
  return new URL(path, authOrigin).toString();
}

/** Normalises the /session/accounts body; drops malformed rows. */
export function parseAuthAccounts(body: unknown): AuthAccount[] {
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
 * The browser's accounts: a list when the auth server answered, [] when it has
 * no browser session (200 with an empty list; older auth answered 401), null when it could not be asked (no auth URL,
 * network, CORS): callers then rely on the local sessions alone.
 */
export async function fetchAuthAccounts(authOrigin: string, fetchImpl: typeof fetch = fetch): Promise<AuthAccount[] | null> {
  if (!authOrigin) return null;
  try {
    const res = await fetchImpl(authUrl(authOrigin, '/session/accounts'), { credentials: 'include', cache: 'no-store' });
    if (res.status === 401) return [];
    if (!res.ok) return null;
    return parseAuthAccounts(await res.json());
  } catch {
    return null;
  }
}

export async function switchAuthAccount(authOrigin: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!authOrigin) return false;
  try {
    const res = await fetchImpl(authUrl(authOrigin, '/session/switch'), {
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

export async function removeAuthAccount(authOrigin: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!authOrigin) return false;
  try {
    const res = await fetchImpl(authUrl(authOrigin, `/session/accounts/${encodeURIComponent(userId)}`), {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The switcher's list: every account the auth server knows for this browser
 * (in its order), with this site's local data where it holds a session for it,
 * then any local account the auth server no longer lists (still usable here).
 * The active marker is this site's active account (what the page is signed in
 * as). Without the auth server's answer, the local sessions alone.
 */
export function mergeAccounts(local: LocalAccount[], auth: AuthAccount[] | null): SwitcherAccount[] {
  const withLocal = local.map((a) => ({ ...a, hasLocalSession: true }));
  if (!auth) return withLocal;
  const localById = new Map(withLocal.map((a) => [a.userId, a]));
  const merged: SwitcherAccount[] = auth.map((a) => {
    const mine = localById.get(a.userId);
    if (mine) return mine;
    return {
      userId: a.userId,
      email: a.email,
      displayName: a.name || a.email,
      // The page is signed in as this site's active account, never this one
      isActive: false,
      channelsCount: 0,
      hasLocalSession: false,
    };
  });
  const listed = new Set(auth.map((a) => a.userId));
  for (const a of withLocal) if (!listed.has(a.userId)) merged.push(a);
  return merged;
}

/** What switching to an account takes. */
export function switchPlan(
  accounts: Array<Pick<SwitcherAccount, 'userId'> & { hasLocalSession?: boolean }>,
  userId: string,
): 'local' | 'silent-sign-in' {
  const account = accounts.find((a) => a.userId === userId);
  return account && account.hasLocalSession !== false ? 'local' : 'silent-sign-in';
}

/**
 * After signing out of one account here (and in the auth server):
 * - the auth server still has an active account: use it here (locally when
 *   this site holds its tokens, else a silent sign-in);
 * - the auth server has none: the existing single sign-out (#308) when this
 *   was the site's last account, otherwise just refresh with what is left;
 * - the auth server could not be asked: the server action's answer (#308).
 */
export type AfterSignOut =
  | { kind: 'single-sign-out'; url: string }
  | { kind: 'switch-local'; userId: string }
  | { kind: 'silent-sign-in'; userId: string }
  | { kind: 'refresh' };

export function decideAfterSignOut(input: {
  authAccounts: AuthAccount[] | null;
  localUserIds: string[];
  signOutUrl: string | null;
}): AfterSignOut {
  const { authAccounts, localUserIds, signOutUrl } = input;
  if (authAccounts && authAccounts.length > 0) {
    const next = authAccounts.find((a) => a.isActive) ?? authAccounts[0];
    return localUserIds.includes(next.userId) ? { kind: 'switch-local', userId: next.userId } : { kind: 'silent-sign-in', userId: next.userId };
  }
  if (signOutUrl) return { kind: 'single-sign-out', url: signOutUrl };
  return { kind: 'refresh' };
}

/**
 * Following an account switch made in another app: when the auth server's
 * active account is not the one this site is using, use it here too (locally
 * when held, else silently). Once per account per tab, so a failing silent
 * sign-in can never loop.
 */
export function decideFollow(input: {
  authAccounts: AuthAccount[] | null;
  localActiveUserId: string | null;
  localUserIds: string[];
  alreadyFollowed: (userId: string) => boolean;
}): { kind: 'none' } | { kind: 'switch-local'; userId: string } | { kind: 'silent-sign-in'; userId: string } {
  const { authAccounts, localActiveUserId, localUserIds } = input;
  if (!authAccounts || !localActiveUserId) return { kind: 'none' };
  const active = authAccounts.find((a) => a.isActive);
  if (!active || active.userId === localActiveUserId) return { kind: 'none' };
  if (input.alreadyFollowed(active.userId)) return { kind: 'none' };
  return localUserIds.includes(active.userId) ? { kind: 'switch-local', userId: active.userId } : { kind: 'silent-sign-in', userId: active.userId };
}
