/**
 * Server Authentication Context V2
 *
 * This is the new version that supports multi-account and multi-channel.
 * It will replace server-auth.ts after migration is complete.
 */

'use server';

import { SessionManager, type SessionContext } from '../auth/session-manager';
import { AuthContext } from './api-client';
import { logger } from '@/lib/logger-server';


/**
 * Get authentication context from server-side session
 * This is a server action that can be used by all server-side API clients
 *
 * @returns AuthContext with userId, channelId, and accessToken
 */
export async function getServerAuthContext(): Promise<AuthContext | null> {
  try {
    // Get active session from SessionManager
    const session = await SessionManager.getActiveSession();

    if (!session) {
      // Try to migrate from legacy cookies if no session exists
      const migrated = await migrateLegacyAuth();
      if (migrated) {
        return getServerAuthContext(); // Recursive call after migration
      }
      return null;
    }

    // Return auth context in the format expected by API clients
    return {
      
      accessToken: session.accessToken,
      channelId: session.channelId, // Now includes active channel
    };
  } catch (error) {
    logger.error('[getServerAuthContext] Error:', error);
    return null;
  }
}

/**
 * Get full session context with all account and channel information
 * Use this when you need more than just auth tokens
 */
export async function getFullSessionContext(): Promise<SessionContext | null> {
  return SessionManager.getActiveSession();
}

/**
 * Get authentication context for a specific user
 * Useful for background jobs or admin operations
 */
export async function getAuthContextForUser(userId: string): Promise<AuthContext | null> {
  const userSession = await SessionManager.getSessionForUser(userId);

  if (!userSession) {
    return null;
  }

  return {
    
    accessToken: userSession.accessToken,
    channelId: userSession.activeChannelId || undefined,
  };
}

/**
 * Migrate from legacy authentication cookies
 * This is a temporary function during the migration period
 */
async function migrateLegacyAuth(): Promise<boolean> {
  try {
    const { cookies } = await import('next/headers');
    const { authenticated } = await import('@/lib/actions');

    const auth = await authenticated();
    if (!auth) {
      return false;
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token');
    const refreshToken = cookieStore.get('refresh_token');

    if (!accessToken?.value || !refreshToken?.value) {
      return false;
    }

    // Add account to SessionManager
    // Note: OpenAuth JWT only includes id and email (see subjects.ts)
    await SessionManager.addAccount(
      {
        accessToken: accessToken.value,
        refreshToken: refreshToken.value,
      },
      {
        id: auth.properties.id,
        email: auth.properties.email,
        displayName: auth.properties.email, // Use email as fallback, profile API will provide actual displayName
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );

    // Clean up legacy cookies
    cookieStore.delete('access_token');
    cookieStore.delete('refresh_token');

    return true;
  } catch (error) {
    logger.error('[migrateLegacyAuth] Migration failed:', error);
    return false;
  }
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const context = await getServerAuthContext();
  return context !== null;
}

/**
 * Check if user has a channel selected
 */
export async function hasActiveChannel(): Promise<boolean> {
  const context = await getServerAuthContext();
  return context?.channelId !== undefined;
}

/**
 * Ensure user is authenticated, throw if not
 */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getServerAuthContext();

  if (!context) {
    throw new Error('Authentication required');
  }

  return context;
}

/**
 * Ensure user has a channel selected, throw if not
 */
export async function requireChannel(): Promise<Required<AuthContext>> {
  const context = await requireAuth();

  if (!context.channelId) {
    throw new Error('Channel selection required');
  }

  return context as Required<AuthContext>;
}