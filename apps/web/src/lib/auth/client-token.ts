'use client';

/**
 * Client-side access to the active account's access token.
 *
 * Auth cookies are httpOnly, so the token is obtained from the same-origin
 * /api/auth/token endpoint and cached in memory for a short time.
 * Use fetchClientAuthToken() (async). getClientAuthToken() returns the cached
 * value synchronously (null until the first fetch completes).
 */

interface TokenInfo {
  accessToken: string | null;
  channelId: string | null;
  userId?: string;
}

const TTL_MS = 60_000;
let cached: { info: TokenInfo; at: number } | null = null;
let inflight: Promise<TokenInfo> | null = null;

export async function fetchClientAuthInfo(force = false): Promise<TokenInfo> {
  if (typeof window === 'undefined') return { accessToken: null, channelId: null };
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.info;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' });
      const info: TokenInfo = res.ok ? await res.json() : { accessToken: null, channelId: null };
      cached = { info, at: Date.now() };
      return info;
    } catch {
      return { accessToken: null, channelId: null };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function fetchClientAuthToken(force = false): Promise<string | null> {
  return (await fetchClientAuthInfo(force)).accessToken;
}

/** Synchronous accessor for the last fetched token (may be null). */
export function getClientAuthToken(): string | null {
  if (typeof window !== 'undefined' && !cached) void fetchClientAuthInfo();
  return cached?.info.accessToken ?? null;
}

export function clearClientAuthToken(): void {
  cached = null;
}

/** Authorization (+channelId) headers for direct API calls from the browser. */
export async function getClientAuthHeaders(): Promise<Record<string, string>> {
  const info = await fetchClientAuthInfo();
  const h: Record<string, string> = {};
  if (info.accessToken) h['Authorization'] = `Bearer ${info.accessToken}`;
  if (info.channelId) h['channelId'] = info.channelId;
  return h;
}

/** Sync variant kept for existing callers; uses the cached token. */
export function getAuthHeaders(): Record<string, string> {
  const token = getClientAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
