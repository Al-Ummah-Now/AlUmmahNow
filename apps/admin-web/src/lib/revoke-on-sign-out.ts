/**
 * Revokes the admin session's refresh token at the issuer when admin-web signs
 * out ("Log out" and single sign-out's front channel).
 *
 * admin_session holds the tokens, so clearing it only signs this browser out:
 * a copy of the cookie (or of the refresh token) would keep working for the
 * refresh token's lifetime. The auth server's POST /token/revoke (RFC 7009,
 * public clients identify themselves with client_id; holding the token is the
 * proof) deletes the refresh token. Verified access tokens are also recorded
 * in TOKEN_REVOCATIONS so a copied session is rejected when the write is visible.
 *
 * Best effort: a failure or a slow issuer never blocks signing out. Every
 * sign-out path that drops tokens goes through this.
 */
import { logger } from '@/lib/logger';
import { LEGACY_ACCESS_COOKIE, LEGACY_REFRESH_COOKIE, SESSION_COOKIE_NAME, parseSessionCookie } from '@/lib/session-cookie';
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
    const [{ getAuthClient }, { subjects }] = await Promise.all([
      import('./auth'),
      import('@/interfaces/subjects'),
    ]);
    const client = await getAuthClient();
    const verified = await client.verify(subjects, token);
    return !verified.err && Boolean(verified.subject);
  } catch {
    return false;
  }
}

/** The tokens a sign-out request carries: admin_session and the legacy cookies. */
export function refreshTokensOf(cookies: { get(name: string): { value: string } | undefined }): RevocableTokens[] {
  const out: RevocableTokens[] = [];
  const session = cookies.get(SESSION_COOKIE_NAME)?.value;
  const parsed = session ? parseSessionCookie(session) : null;
  if (parsed?.refreshToken || parsed?.accessToken) {
    out.push({ userId: '', refreshToken: parsed.refreshToken, accessToken: parsed.accessToken });
  }
  const legacyRefresh = cookies.get(LEGACY_REFRESH_COOKIE)?.value;
  const legacyAccess = cookies.get(LEGACY_ACCESS_COOKIE)?.value;
  if (
    (legacyRefresh && legacyRefresh !== parsed?.refreshToken)
    || (legacyAccess && legacyAccess !== parsed?.accessToken)
  ) {
    out.push({
      userId: '',
      refreshToken: legacyRefresh && legacyRefresh !== parsed?.refreshToken ? legacyRefresh : '',
      accessToken: legacyAccess && legacyAccess !== parsed?.accessToken ? legacyAccess : undefined,
    });
  }
  return out;
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
  // admin_session cookies stop working immediately after sign-out (#762).
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
