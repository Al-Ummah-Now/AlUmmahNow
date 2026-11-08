/**
 * Server-only session helpers.
 *
 * This module deliberately has no 'use server' directive: that would expose
 * every export (including setAdminSession) as a client-callable server action.
 * Server actions that need auth live in src/app/actions.ts.
 */
import { cache } from 'react';
import { cookies as getCookies } from 'next/headers';
import { createClient } from '@al-ummah-now/openauth/client';
import { redirect } from 'next/navigation';
import { subjects } from '@/interfaces/subjects';
import { highestAdminRole, hasAdminAccess, type SystemRole } from './roles';
import { logger } from './logger';

// Session configuration
export const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

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

function parseSessionCookie(value: string): { accessToken: string; refreshToken: string } | null {
  try {
    const parsed = JSON.parse(value) as Partial<AdminSession>;
    if (typeof parsed?.accessToken !== 'string' || typeof parsed?.refreshToken !== 'string') {
      return null;
    }
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch {
    return null;
  }
}

/**
 * Resolve the current admin session.
 *
 * The cookie is only a token carrier: the access token is verified against
 * the auth server's keys (refreshing it when expired) and the user identity
 * and role are taken from the verified token, never from the cookie JSON.
 * Memoised per request so layout, page and API helpers share one verification.
 */
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  try {
    const cookieStore = await getCookies();
    const sessionValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    let tokens: { accessToken: string; refreshToken: string } | null = null;
    let fromLegacyCookies = false;

    if (sessionValue) {
      tokens = parseSessionCookie(sessionValue);
    } else {
      const accessToken = cookieStore.get('access_token')?.value;
      const refreshToken = cookieStore.get('refresh_token')?.value;
      if (accessToken && refreshToken) {
        tokens = { accessToken, refreshToken };
        fromLegacyCookies = true;
      }
    }

    if (!tokens) {
      return null;
    }

    const client = await getAuthClient();
    const verified = await client.verify(subjects, tokens.accessToken, {
      refresh: tokens.refreshToken,
    });

    if (verified.err || !verified.subject) {
      logger.warn('[auth] Session token verification failed', {
        name: verified.err?.name,
        message: verified.err?.message,
      });
      return null;
    }

    const userInfo = verified.subject.properties;
    const session: AdminSession = {
      user: {
        id: userInfo.id,
        email: userInfo.email,
        role: highestAdminRole(userInfo.roles),
      },
      accessToken: verified.tokens?.access ?? tokens.accessToken,
      refreshToken: verified.tokens?.refresh ?? tokens.refreshToken,
    };

    if (verified.tokens || fromLegacyCookies) {
      // Cookies can only be written from route handlers and server actions;
      // during a server component render the refreshed tokens are still used
      // for this request and persisted on the next writable request.
      try {
        await setAdminSession(session);
      } catch {
        logger.debug('[auth] Refreshed session not persisted (read-only cookie context)');
      }
    }

    return session;
  } catch (error) {
    logger.error('[auth] Failed to resolve admin session', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
});

/**
 * Set admin session in cookies
 */
export async function setAdminSession(session: AdminSession | null): Promise<void> {
  const cookieStore = await getCookies();

  if (!session) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    return;
  }

  cookieStore.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

/**
 * Clear every cookie that can carry admin credentials.
 */
export async function clearAdminSession(): Promise<void> {
  const cookieStore = await getCookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');
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
  const session = await getAdminSession();

  if (!session) {
    redirect('/login');
  }

  if (!hasAdminAccess(session.user.role)) {
    redirect('/access-denied');
  }

  return session;
}
