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
  /** When accessToken expires (epoch ms), when the server knows */
  expiresAt?: number | null;
}

const TTL_MS = 60_000;
/** Stop using a cached token this long before it expires (the server refreshes it). */
const EXPIRY_MARGIN_MS = 90_000;

function isFresh(entry: { info: TokenInfo; at: number }, now: number): boolean {
  if (now - entry.at >= TTL_MS) return false;
  const expiresAt = entry.info.expiresAt;
  return typeof expiresAt !== 'number' || expiresAt - now > EXPIRY_MARGIN_MS;
}
let cached: { info: TokenInfo; at: number } | null = null;
let inflight: Promise<TokenInfo> | null = null;
/** Bumped by clearClientAuthToken: a read started before the clear never fills the cache. */
let epoch = 0;

export async function fetchClientAuthInfo(force = false): Promise<TokenInfo> {
  if (typeof window === 'undefined') return { accessToken: null, channelId: null };
  if (!force && cached && isFresh(cached, Date.now())) return cached.info;
  if (inflight) return inflight;
  const mine = epoch;
  const request: Promise<TokenInfo> = (async () => {
    try {
      const res = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' });
      const info: TokenInfo = res.ok ? await res.json() : { accessToken: null, channelId: null };
      if (mine === epoch) cached = { info, at: Date.now() };
      return info;
    } catch {
      return { accessToken: null, channelId: null };
    } finally {
      if (inflight === request) inflight = null;
    }
  })();
  inflight = request;
  return request;
}

export async function fetchClientAuthToken(force = false): Promise<string | null> {
  return (await fetchClientAuthInfo(force)).accessToken;
}

/** Synchronous accessor for the last fetched token (may be null). */
export function getClientAuthToken(): string | null {
  if (typeof window !== 'undefined' && !cached) void fetchClientAuthInfo();
  return cached?.info.accessToken ?? null;
}

/**
 * Forget the cached token, and any read still running. Call it when the active
 * account changes: the cached token is the previous account's for up to a minute.
 */
export function clearClientAuthToken(): void {
  cached = null;
  inflight = null;
  epoch += 1;
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
