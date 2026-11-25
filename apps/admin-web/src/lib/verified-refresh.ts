/**
 * Refreshes a session and checks the new session like a sign-in: its access token is verified and its
 * roles open admin-web, before anything stores or returns it. Every refresh of admin-web goes through here.
 */
import { highestAdminRole, hasPanelAccess, type PanelRole } from './roles';
import type { SessionTokens } from './session-cookie';
import type { VerifyOutcome } from './session-state';
import { refreshTokens, type RefreshResult } from './token-refresh';

export type VerifiedRefresh =
  | { kind: 'refreshed'; tokens: SessionTokens; role: PanelRole }
  /** The account has no role that opens admin-web any more */
  | { kind: 'no_access' }
  | Exclude<RefreshResult, { kind: 'refreshed' }>;

export type VerifyToken = (accessToken: string) => Promise<VerifyOutcome>;

export async function refreshVerified(
  issuer: string,
  refreshToken: string,
  { verify, fetch: fetchImpl = fetch }: { verify: VerifyToken; fetch?: typeof fetch },
): Promise<VerifiedRefresh> {
  const result = await refreshTokens(issuer, refreshToken, fetchImpl);
  if (result.kind !== 'refreshed') return result;
  let verified: VerifyOutcome;
  try {
    verified = await verify(result.tokens.accessToken);
  } catch (error) {
    // The keys could not be read: nothing is known about the token, so nothing is stored
    return { kind: 'transient', reason: `keys unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
  // A new token that does not verify ends the session, as a refused refresh token does
  if (verified.err || !verified.subject) return { kind: 'invalid_grant', description: 'the new access token did not verify' };
  const role = highestAdminRole(verified.subject.properties.roles);
  return role && hasPanelAccess(role) ? { kind: 'refreshed', tokens: result.tokens, role } : { kind: 'no_access' };
}
