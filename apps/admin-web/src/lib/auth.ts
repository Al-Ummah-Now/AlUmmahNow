'use server';

import { cookies as getCookies, headers } from 'next/headers';
import { createClient } from '@al-ummah-now/openauth/client';
import { redirect } from 'next/navigation';
import { subjects } from '@/interfaces/subjects';
import { normalizeRole, type SystemRole } from './roles';

// Session configuration
const SESSION_COOKIE_NAME = 'admin_session';
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

export async function getAuthClient() {
  return createClient({
    clientID: process.env.ClientId!,
    issuer: process.env.Issuer!,
  });
}

/**
 * Get current admin session from cookies
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    const cookieStore = await getCookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie?.value) {
      // Try legacy cookies
      const accessToken = cookieStore.get('access_token');
      const refreshToken = cookieStore.get('refresh_token');

      if (!accessToken?.value || !refreshToken?.value) {
        return null;
      }

      // Verify legacy tokens
      const client = await getAuthClient();
      const verified = await client.verify(subjects, accessToken.value, {
        refresh: refreshToken.value,
      });

      if (verified.err || !verified.subject) {
        return null;
      }

      const userInfo = verified.subject.properties;

      // Extract user roles and determine highest priority role
      const userRoles: string[] = (userInfo.roles || []).map((r: string) => normalizeRole(r));
      const role = userRoles.includes('super_admin')
        ? 'super_admin'
        : userRoles.includes('admin')
        ? 'admin'
        : userRoles.includes('moderator')
        ? 'moderator'
        : undefined;

      // Create session from legacy cookies
      const session: AdminSession = {
        user: {
          id: userInfo.id,
          email: userInfo.email,
          role,
        },
        accessToken: accessToken.value,
        refreshToken: refreshToken.value,
      };

      // Migrate to new session cookie
      await setAdminSession(session);

      return session;
    }

    return JSON.parse(sessionCookie.value) as AdminSession;
  } catch {
    return null;
  }
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

  cookieStore.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

/**
 * Set tokens from OAuth callback
 */
export async function setTokens(access: string, refresh: string): Promise<void> {
  const cookieStore = await getCookies();

  cookieStore.set('access_token', access, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });

  cookieStore.set('refresh_token', refresh, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getAdminSession();
  return session !== null;
}

/**
 * Require authentication - redirect to login if not authenticated
 */
export async function requireAuth(): Promise<AdminSession> {
  const session = await getAdminSession();

  if (!session) {
    redirect('/login');
  }

  return session;
}

/**
 * Require admin role - redirect to access-denied if not admin/moderator
 */
export async function requireAdminRole(): Promise<AdminSession> {
  const session = await getAdminSession();

  if (!session) {
    redirect('/login');
  }

  // Import hasAdminAccess here to avoid circular dependency
  const { hasAdminAccess } = await import('./roles');

  if (!hasAdminAccess(session.user.role)) {
    redirect('/access-denied');
  }

  return session;
}

/**
 * Login - redirect to OAuth provider
 */
export async function login(): Promise<void> {
  const session = await getAdminSession();
  if (session) {
    redirect('/dashboard');
  }

  const headersData = await headers();
  const host = headersData.get("host") ?? "localhost:3091";
  const protocol = host.includes("localhost") ? "http" : "https";
  const client = await getAuthClient();
  const { url } = await client.authorize(
    `${protocol}://${host}/api/callback`,
    'code',
  );
  redirect(url);
}

/**
 * Logout - clear session and redirect
 */
export async function logout(): Promise<void> {
  const cookieStore = await getCookies();

  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');

  redirect('/login');
}
