/**
 * The OpenAuth client of the admin site and the verification of an access token. No next/headers, React
 * or logger here: the middleware (edge) uses it too.
 */
import { createClient } from '@al-ummah-now/openauth/client';
import { audienceMode, withAudienceCheck } from '@al-ummah/shared-types';
import { subjects } from '@/interfaces/subjects';
import type { VerifyOutcome } from './session-state';

type AuthClient = ReturnType<typeof createClient>;

export function adminAuth(warn: (message: string, fields: Record<string, unknown>) => void) {
  let authClient: AuthClient | null = null;

  /**
   * Reuse the client per isolate. OpenAuth caches discovery and JWKS by issuer
   * and refreshes keys after a signature or key lookup failure, with a cooldown.
   */
  async function getAuthClient(): Promise<AuthClient> {
    if (!authClient) {
      // verify() also checks aud: only admin-web's own client's tokens (AUD_MODE log|enforce|off)
      authClient = withAudienceCheck(
        createClient({ clientID: process.env.ClientId!, issuer: process.env.Issuer! }),
        { service: 'admin-web', issuer: process.env.Issuer, mode: () => audienceMode(process.env.AUD_MODE), route: 'admin-web session' },
        warn,
      );
    }
    return authClient;
  }

  /** Verifies an access token against the auth server's keys. Throws when the keys cannot be read. */
  async function verifyAccessToken(accessToken: string): Promise<VerifyOutcome> {
    const verified = await (await getAuthClient()).verify(subjects, accessToken);
    if (verified.err) warn('[auth] Session token verification failed', { name: verified.err.name, message: verified.err.message });
    return verified;
  }

  return { getAuthClient, verifyAccessToken };
}
