/**
 * Revokes an account's refresh token at the issuer when it signs out of this
 * app (single sign-out's front channel, "Sign out", removing an account).
 *
 * The session cookie holds the tokens, so clearing it only signs this browser
 * out: a copy of the cookie (or of the refresh token) would keep working for
 * the refresh token's 30 days. The auth server's POST /token/revoke (RFC 7009,
 * public clients identify themselves with client_id; holding the token is the
 * proof) deletes the refresh token, so a copy stops working when its 15-minute
 * access token expires.
 *
 * Best effort: a failure or a slow issuer never blocks signing out. Every
 * sign-out path that drops tokens goes through this.
 */
import { logger } from '@/lib/logger-server';

export interface RevocableTokens {
  userId: string;
  refreshToken: string;
}

/** How long one revocation may take before sign-out goes on without it. */
export const REVOKE_TIMEOUT_MS = 3000;

type Fetch = typeof fetch;

export async function revokeTokensOnSignOut(
  accounts: RevocableTokens[],
  deps: { issuer?: string; clientId?: string; fetch?: Fetch } = {},
): Promise<void> {
  const issuer = deps.issuer ?? process.env.Issuer;
  const clientId = deps.clientId ?? process.env.ClientId;
  const doFetch = deps.fetch ?? fetch;
  const tokens = accounts.map((a) => a?.refreshToken).filter((t): t is string => typeof t === 'string' && t.length > 0);
  if (!issuer || tokens.length === 0) return;

  let endpoint: string;
  try {
    endpoint = new URL('/token/revoke', new URL(issuer).origin).toString();
  } catch {
    logger.warn('[auth] Cannot revoke tokens on sign-out: the issuer URL is invalid');
    return;
  }

  await Promise.all(
    tokens.map(async (token) => {
      const body = new URLSearchParams({ token, token_type_hint: 'refresh_token' });
      if (clientId) body.set('client_id', clientId);
      try {
        const res = await doFetch(endpoint, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
        });
        if (!res.ok) logger.warn('[auth] Refresh token revocation was refused', { status: res.status });
      } catch (error) {
        logger.warn('[auth] Refresh token revocation failed', { error: error instanceof Error ? error.name : String(error) });
      }
    }),
  );
}
