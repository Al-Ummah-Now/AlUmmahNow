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
import { getRevocationKv, revokeVerifiedAccessToken, type RevocationKv } from './token-revocation';

export interface RevocableTokens {
  userId: string;
  refreshToken: string;
  accessToken?: string;
}

/** How long one revocation may take before sign-out goes on without it. */
export const REVOKE_TIMEOUT_MS = 3000;

type Fetch = typeof fetch;
type VerifyAccessToken = (token: string) => Promise<boolean>;

async function defaultVerifyAccessToken(token: string): Promise<boolean> {
  try {
    const [{ getOpenAuthClient }, { subjects }] = await Promise.all([
      import('./openauth-client'),
      import('../auth'),
    ]);
    const verified = await getOpenAuthClient().verify(subjects, token);
    return !verified.err && Boolean(verified.subject);
  } catch {
    return false;
  }
}

export async function revokeTokensOnSignOut(
  accounts: RevocableTokens[],
  deps: {
    issuer?: string;
    clientId?: string;
    fetch?: Fetch;
    kv?: RevocationKv | null;
    verifyAccessToken?: VerifyAccessToken;
    now?: number;
  } = {},
): Promise<void> {
  const issuer = deps.issuer ?? process.env.Issuer;
  const clientId = deps.clientId ?? process.env.ClientId;
  const doFetch = deps.fetch ?? fetch;
  const refreshTokens = accounts.map((a) => a?.refreshToken).filter((t): t is string => typeof t === 'string' && t.length > 0);
  const accessTokens = [...new Set(accounts.map((a) => a?.accessToken).filter((t): t is string => typeof t === 'string' && t.length > 0))];

  const tasks: Promise<unknown>[] = [];

  if (issuer && refreshTokens.length > 0) {
    let endpoint: string | null = null;
    try {
      endpoint = new URL('/token/revoke', new URL(issuer).origin).toString();
    } catch {
      logger.warn('[auth] Cannot revoke tokens on sign-out: the issuer URL is invalid');
    }
    if (endpoint) {
      for (const token of refreshTokens) {
        tasks.push(
          (async () => {
            const body = new URLSearchParams({ token, token_type_hint: 'refresh_token' });
            if (clientId) body.set('client_id', clientId);
            try {
              const res = await doFetch(endpoint!, {
                method: 'POST',
                body,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
              });
              if (!res.ok) logger.warn('[auth] Refresh token revocation was refused', { status: res.status });
            } catch (error) {
              logger.warn('[auth] Refresh token revocation failed', { error: error instanceof Error ? error.name : String(error) });
            }
          })(),
        );
      }
    }
  }

  // Also mark verified access tokens revoked in TOKEN_REVOCATIONS KV so copied
  // session cookies stop working immediately across web, admin-web and APIs (#762).
  if (accessTokens.length > 0) {
    tasks.push(
      (async () => {
        const kv = deps.kv === undefined ? await getRevocationKv() : (deps.kv ?? undefined);
        if (!kv?.put) return;
        const verify = deps.verifyAccessToken ?? defaultVerifyAccessToken;
        await Promise.all(
          accessTokens.map(async (token) => {
            if (await verify(token)) {
              await revokeVerifiedAccessToken(kv, token, 'single_sign_out', deps.now);
            }
          }),
        );
      })(),
    );
  }

  await Promise.all(tasks);
}
