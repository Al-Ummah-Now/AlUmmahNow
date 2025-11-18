'use server';

import { cookies } from 'next/headers';
import { authenticated } from '@/lib/actions';
import { AuthContext } from './api-client';
import { logger } from '@/lib/logger';

/**
 * Get authentication context from server-side cookies
 * This is a server action that can be used by all server-side API clients
 *
 * DUAL-MODE SUPPORT:
 * - Tries new SessionManager first (multi-account support)
 * - Falls back to legacy cookies for backward compatibility
 * - Auto-migrates legacy users to new system
 */
export async function getServerAuthContext(): Promise<AuthContext | null> {
  // Try new SessionManager first
  try {
    const { SessionManager } = await import('../auth/session-manager');
    const session = await SessionManager.getActiveSession();

    if (session) {
      return {
        userId: session.userId,
        accessToken: session.accessToken,
        channelId: session.channelId, // ✅ Now includes channelId!
      };
    }
  } catch (_error) {
    // SessionManager not available or error - fall back to legacy
    logger.info('[getServerAuthContext] SessionManager not available, using legacy auth');
  }

  // Fall back to legacy cookies
  const auth = await authenticated();

  if (!auth) {
    return null;
  }

  const userId = auth.properties.id;
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('access_token');
  const refreshToken = cookieStore.get('refresh_token');

  if (!accessToken?.value) {
    return null;
  }

  // Auto-migrate legacy user to SessionManager
  try {
    const { SessionManager } = await import('../auth/session-manager');
    // Note: OpenAuth JWT only includes id and email (see subjects.ts)
    await SessionManager.addAccount(
      {
        accessToken: accessToken.value,
        refreshToken: refreshToken?.value || '',
      },
      {
        id: userId,
        email: auth.properties.email,
        displayName: auth.properties.email, // Use email as fallback, profile API will provide actual displayName
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );
    logger.info('[getServerAuthContext] Auto-migrated user to SessionManager', { userId });
  } catch (migrationError) {
    // Migration failed, continue with legacy auth
    logger.error('[getServerAuthContext] Auto-migration failed', migrationError);
  }

  return {
    userId,
    accessToken: accessToken.value
  };
}
