/**
 * Proactive access-token refresh against the auth server's /token endpoint.
 *
 * Edge-safe. The openauth client's refresh() turns every non-OK response into
 * the same InvalidRefreshTokenError (and throws on a non-JSON body), so it
 * cannot tell "this refresh token is dead" (sign in again) from "the auth
 * server hiccupped" (keep the session, retry next request). This module calls
 * /token itself and keeps the two apart.
 */
import type { SessionTokens } from './session-cookie';

/** Refresh this long before the access token expires. */
export const REFRESH_SKEW_SECONDS = 120;

/** `exp` (seconds since epoch) of a JWT, without verifying it; null if unreadable. */
export function decodeJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    const exp = (payload as { exp?: unknown } | null)?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/**
 * Whether the access token expires within `skewSeconds`. An unreadable token
 * is left alone: signature verification in getAdminSession rejects it.
 */
export function shouldRefresh(
  accessToken: string,
  nowSeconds: number,
  skewSeconds: number = REFRESH_SKEW_SECONDS,
): boolean {
  const exp = decodeJwtExp(accessToken);
  if (exp === null) return false;
  return exp - nowSeconds <= skewSeconds;
}

export type RefreshResult =
  | { kind: 'refreshed'; tokens: SessionTokens }
  /** The auth server rejected the refresh token for good (invalid_grant). */
  | { kind: 'invalid_grant'; description?: string }
  /** Network error, 5xx, unexpected body: the session may still be fine. */
  | { kind: 'transient'; reason: string };

/**
 * Exchange a refresh token for a new pair. The issuer rotates the refresh
 * token on every use, so the caller must persist the returned one.
 */
export async function refreshTokens(
  issuer: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshResult> {
  let response: Response;
  try {
    response = await fetchImpl(new URL('/token', issuer).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
  } catch (error) {
    return { kind: 'transient', reason: error instanceof Error ? error.message : String(error) };
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && body?.error === 'invalid_grant') {
      const description = typeof body.error_description === 'string' ? body.error_description : undefined;
      return { kind: 'invalid_grant', description };
    }
    return { kind: 'transient', reason: `HTTP ${response.status}${body?.error ? ` ${String(body.error)}` : ''}` };
  }

  if (typeof body?.access_token !== 'string' || typeof body?.refresh_token !== 'string') {
    return { kind: 'transient', reason: 'token response without access_token/refresh_token' };
  }
  return { kind: 'refreshed', tokens: { accessToken: body.access_token, refreshToken: body.refresh_token } };
}
