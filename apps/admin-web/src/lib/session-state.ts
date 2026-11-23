/**
 * The verification step of getAdminSessionState (lib/auth.ts), without
 * cookies or the OpenAuth client so it can be tested on its own.
 */
import { highestAdminRole, type PanelRole } from './roles';
import { decodeJwtExp, isLegacyLongLivedToken } from './token-refresh';

export interface VerifyOutcome {
  err?: { name?: string; message?: string } | null;
  subject?: { properties: { id: string; email: string; roles?: string[] } } | null;
}

export type SessionTokenVerdict =
  | { kind: 'valid'; user: { id: string; email: string; role?: PanelRole } }
  /** Not usable as is, but a refresh token is there to try (/api/auth/refresh). */
  | { kind: 'refresh'; reason: 'invalid' | 'legacy' | 'expired' }
  | { kind: 'signed-out' };

/**
 * Verifies the access token. A legacy 30-day token (issued before 15-minute
 * tokens) carries the roles from its issue, so a revoked admin would keep
 * them: it is not used, and is refreshed like an expired one (#663).
 * An expired token is an everyday state (every 15 minutes on a tab left open): never verified, never logged.
 */
export async function verifySessionTokens(
  tokens: { accessToken: string; refreshToken: string },
  verify: (accessToken: string) => Promise<VerifyOutcome>,
  { nowSeconds = Math.floor(Date.now() / 1000), isRevoked }: {
    nowSeconds?: number;
    isRevoked?: (token: { userId: string; accessToken: string }) => Promise<boolean>;
  } = {},
): Promise<SessionTokenVerdict> {
  // Past its own time: nothing to verify (and not a failed verification), it is refreshed
  const exp = decodeJwtExp(tokens.accessToken);
  if (exp !== null && exp <= nowSeconds) {
    return tokens.refreshToken ? { kind: 'refresh', reason: 'expired' } : { kind: 'signed-out' };
  }
  const verified = await verify(tokens.accessToken);
  if (verified.err || !verified.subject) {
    return tokens.refreshToken ? { kind: 'refresh', reason: 'invalid' } : { kind: 'signed-out' };
  }
  if (isLegacyLongLivedToken(tokens.accessToken)) {
    return tokens.refreshToken ? { kind: 'refresh', reason: 'legacy' } : { kind: 'signed-out' };
  }
  const { id, email, roles } = verified.subject.properties;
  if (isRevoked && (await isRevoked({ userId: id, accessToken: tokens.accessToken }))) {
    return { kind: 'signed-out' };
  }
  return { kind: 'valid', user: { id, email, role: highestAdminRole(roles) } };
}
