/**
 * Server-only session helpers.
 *
 * This module deliberately has no 'use server' directive: that would expose
 * every export (including setAdminSession) as a client-callable server action.
 * Server actions that need auth belong in a separate 'use server' module.
 */
import { cache } from 'react';
import { cookies as getCookies, headers as getHeaders } from 'next/headers';
import { createClient } from '@al-ummah-now/openauth/client';
import { redirect } from 'next/navigation';
import { subjects } from '@/interfaces/subjects';
import { highestAdminRole, hasAdminAccess, type SystemRole } from './roles';
import { logger } from './logger';
import {
  LEGACY_ACCESS_COOKIE,
  LEGACY_REFRESH_COOKIE,
  SESSION_COOKIE_NAME,
  parseSessionCookie,
  sessionCookieOptions,
} from './session-cookie';
import { PATH_HEADER, loginPath, safeReturnPath } from './login-flow';

export { SESSION_COOKIE_NAME };

export interface AdminUser {
  id: string;
  email: string;
  role?: SystemRole;
  displayName?: string;
}

export interface AdminSession {
  user: AdminUser;
  accessToken: string;
  refreshToken: string;
}

type AuthClient = ReturnType<typeof createClient>;
let authClient: AuthClient | null = null;

/**
 * The client is cached per isolate so its JWKS cache survives across
 * requests instead of re-fetching the auth server keys on every page view.
 */
export async function getAuthClient(): Promise<AuthClient> {
  if (!authClient) {
    authClient = createClient({
      clientID: process.env.ClientId!,
      issuer: process.env.Issuer!,
    });
  }
  return authClient;
}

/**
 * Resolve the current admin session.
 *
 * The cookie is only a token carrier: the access token is verified against
 * the auth server's keys and the user identity and role are taken from the
 * verified token, never from the cookie JSON. Memoised per request so layout,
 * page and API helpers share one verification.
 *
 * Never refreshes (SCALABILITY-AUDIT AW-1): a render cannot store the rotated
 * pair, so spending the refresh token here signed the admin out a minute
 * later. The middleware refreshes ahead of expiry; if a render still sees an
 * expired token, requireAdminRole sends the browser to /api/auth/refresh.
 */
export const getAdminSessionState = cache(async (): Promise<{ session: AdminSession | null; expired: boolean }> => {
  try {
    const cookieStore = await getCookies();
    const sessionValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    let tokens: { accessToken: string; refreshToken: string } | null = null;
    let fromLegacyCookies = false;

    if (sessionValue) {
      tokens = parseSessionCookie(sessionValue);
    } else {
      const accessToken = cookieStore.get(LEGACY_ACCESS_COOKIE)?.value;
      const refreshToken = cookieStore.get(LEGACY_REFRESH_COOKIE)?.value;
      if (accessToken && refreshToken) {
        tokens = { accessToken, refreshToken };
        fromLegacyCookies = true;
      }
    }

    if (!tokens) {
      return { session: null, expired: false };
    }

    const client = await getAuthClient();
    const verified = await client.verify(subjects, tokens.accessToken);

    if (verified.err || !verified.subject) {
      logger.warn('[auth] Session token verification failed', {
        name: verified.err?.name,
        message: verified.err?.message,
      });
      // A refresh token is there to try: let the refresh route decide
      return { session: null, expired: Boolean(tokens.refreshToken) };
    }

    const userInfo = verified.subject.properties;
    const session: AdminSession = {
      user: {
        id: userInfo.id,
        email: userInfo.email,
        role: highestAdminRole(userInfo.roles),
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };

    if (fromLegacyCookies) {
      // Move the legacy pair into admin_session where cookies are writable
      // (route handlers, server actions); in a render this is a no-op.
      try {
        await setAdminSession(session);
      } catch {
        logger.debug('[auth] Legacy cookies not migrated (read-only cookie context)');
      }
    }

    return { session, expired: false };
  } catch (error) {
    logger.error('[auth] Failed to resolve admin session', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { session: null, expired: false };
  }
});

export async function getAdminSession(): Promise<AdminSession | null> {
  return (await getAdminSessionState()).session;
}

/**
 * Set admin session in cookies
 */
export async function setAdminSession(session: AdminSession | null): Promise<void> {
  const cookieStore = await getCookies();

  if (!session) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    return;
  }

  cookieStore.set(SESSION_COOKIE_NAME, JSON.stringify(session), sessionCookieOptions());
}

/**
 * Clear every cookie that can carry admin credentials.
 */
export async function clearAdminSession(): Promise<void> {
  const cookieStore = await getCookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete(LEGACY_ACCESS_COOKIE);
  cookieStore.delete(LEGACY_REFRESH_COOKIE);
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getAdminSession();
  return session !== null;
}

/**
 * Require admin role - redirect to login / access-denied if not authorized
 */
export async function requireAdminRole(): Promise<AdminSession> {
  const { session, expired } = await getAdminSessionState();

  if (!session) {
    // The middleware passes the path being rendered, to come back to it
    const path = (await getHeaders()).get(PATH_HEADER);
    if (expired) {
      // Refresh where the rotated pair can be stored (AW-1), then come back
      const next = safeReturnPath(path);
      redirect(next ? `/api/auth/refresh?next=${encodeURIComponent(next)}` : '/api/auth/refresh');
    }
    // Straight to sign-in
    redirect(loginPath(path));
  }

  if (!hasAdminAccess(session.user.role)) {
    redirect('/access-denied');
  }

  return session;
}
