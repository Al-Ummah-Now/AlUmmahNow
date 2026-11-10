/**
 * Revokes the admin session's refresh token at the issuer when admin-web signs
 * out ("Log out" and single sign-out's front channel).
 *
 * admin_session holds the tokens, so clearing it only signs this browser out:
 * a copy of the cookie (or of the refresh token) would keep working for the
 * refresh token's lifetime. The auth server's POST /token/revoke (RFC 7009,
 * public clients identify themselves with client_id; holding the token is the
 * proof) deletes the refresh token, so a copy stops working when its 15-minute
 * access token expires.
 *
 * Best effort: a failure or a slow issuer never blocks signing out. Every
 * sign-out path that drops tokens goes through this.
 */
import { logger } from '@/lib/logger';
import { LEGACY_REFRESH_COOKIE, SESSION_COOKIE_NAME, parseSessionCookie } from '@/lib/session-cookie';

export interface RevocableTokens {
  userId: string;
  refreshToken: string;
}

/** How long one revocation may take before sign-out goes on without it. */
export const REVOKE_TIMEOUT_MS = 3000;

type Fetch = typeof fetch;

/** The refresh tokens a sign-out request carries: admin_session and the legacy cookie. */
export function refreshTokensOf(cookies: { get(name: string): { value: string } | undefined }): RevocableTokens[] {
  const out: RevocableTokens[] = [];
  const session = cookies.get(SESSION_COOKIE_NAME)?.value;
  const parsed = session ? parseSessionCookie(session) : null;
  if (parsed?.refreshToken) out.push({ userId: '', refreshToken: parsed.refreshToken });
  const legacy = cookies.get(LEGACY_REFRESH_COOKIE)?.value;
  if (legacy && legacy !== parsed?.refreshToken) out.push({ userId: '', refreshToken: legacy });
  return out;
}

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
