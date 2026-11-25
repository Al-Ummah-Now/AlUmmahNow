/**
 * Server-only session helpers.
 *
 * This module deliberately has no 'use server' directive: that would expose
 * every export (including setAdminSession) as a client-callable server action.
 * Server actions that need auth belong in a separate 'use server' module.
 */
import { cache } from 'react';
import { cookies as getCookies, headers as getHeaders } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasPanelAccess, isReviewOnly, reviewOnlyRedirect, type PanelRole } from './roles';
import { adminAuth } from './auth-client';
import { logger } from './logger';
import { verifySessionTokens } from './session-state';
import {
  LEGACY_ACCESS_COOKIE,
  LEGACY_REFRESH_COOKIE,
  SESSION_COOKIE_NAME,
  readSession,
  sessionCookieOptions,
} from './session-cookie';
import { PATH_HEADER, loginPath, safeReturnPath } from './login-flow';
import { passkeyNeededPath, sessionPasskeyGate, type PasskeyGate } from './passkeys';

export { SESSION_COOKIE_NAME };

export const { getAuthClient, verifyAccessToken } = adminAuth((message, fields) => logger.warn(message, fields));

export interface AdminUser {
  id: string;
  email: string;
  role?: PanelRole;
  displayName?: string;
}

export interface AdminSession {
  user: AdminUser;
  accessToken: string;
  refreshToken: string;
}

/** A session that passed requireAdminRole, with the staff passkey state of its token (lib/passkeys.ts). */
export interface AdminPageSession extends AdminSession {
  passkey: PasskeyGate;
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
    const found = readSession(cookieStore);
    const tokens = found?.tokens ?? null;
    const fromLegacyCookies = !!found && !found.cookie;

    if (!tokens) {
      return { session: null, expired: false };
    }

    const verdict = await verifySessionTokens(tokens, verifyAccessToken);

    if (verdict.kind !== 'valid') {
      if (verdict.kind === 'refresh' && verdict.reason === 'legacy') {
        // The middleware refreshes these; requireAdminRole sends a render that
        // still sees one to /api/auth/refresh (#663)
        logger.info('[auth] Legacy long-lived access token; refresh required');
      }
      // A refresh token is there to try: let the refresh route decide
      return { session: null, expired: verdict.kind === 'refresh' };
    }

    const session: AdminSession = {
      user: verdict.user,
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

  cookieStore.set(SESSION_COOKIE_NAME, JSON.stringify(session), sessionCookieOptions((await getHeaders()).get('host')));
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
 * Require a role that opens admin-web - redirect to login / access-denied if not authorized.
 * A content or senior reviewer (VR7) gets the review-only shell: the review queue and its
 * settings; the landing pages go to the queue and every other page is access-denied.
 * Redirects to the "Passkey needed" page when the staff passkey deadline has passed
 * without a passkey sign-in (wiki AUTH-PASSKEYS). During the grace period the
 * session's `passkey` state carries the deadline for the banner.
 */
export async function requireAdminRole(): Promise<AdminPageSession> {
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

  if (!hasPanelAccess(session.user.role)) {
    redirect('/access-denied');
  }

  const passkey = sessionPasskeyGate(session.accessToken);
  if (passkey.state === 'blocked') {
    redirect(passkeyNeededPath((await getHeaders()).get(PATH_HEADER)));
  }

  if (isReviewOnly(session.user.role)) {
    const target = reviewOnlyRedirect((await getHeaders()).get(PATH_HEADER));
    if (target) redirect(target);
  }

  return { ...session, passkey };
}
