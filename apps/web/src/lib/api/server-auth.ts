'use server';

import { cookies } from 'next/headers';
import { authenticated } from '@/lib/actions';
import { AuthContext } from './api-client';
import { logger } from '@/lib/logger-server';
import { readSessionValue } from '@/lib/auth/session-cookie';
import {
  SessionInfrastructureError,
  isNextControlFlowError,
  isOutsideRequestScopeError,
  reportWebServerError,
  safeErrorMeta,
} from '@/lib/errors/server-report';

/**
 * Get authentication context from server-side cookies.
 *
 * - Tries SessionManager first (multi-account support).
 * - Only falls back to legacy cookies when no `al_ummah_session` cookie exists.
 * - Logs, reports to the admin Errors page, and propagates infrastructure errors
 *   instead of silently treating the request as anonymous (#302).
 */
export async function getServerAuthContext(): Promise<AuthContext | null> {
  let session;
  try {
    const { SessionManager } = await import('../auth/session-manager');
    session = await SessionManager.getActiveSession();
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    if (!(error instanceof SessionInfrastructureError && error.reported)) {
      logger.error('[getServerAuthContext] Failed to resolve active session', safeErrorMeta(error));
      await reportWebServerError(error, { route: 'auth:server-context', extra: { stage: 'session_manager' } });
    }
    throw error instanceof SessionInfrastructureError
      ? error
      : new SessionInfrastructureError('Failed to resolve active session', error);
  }

  if (session) {
    return {
      userId: session.userId,
      accessToken: session.accessToken,
      channelId: session.channelId,
    };
  }

  // Only fall back to legacy cookies when there is no al_ummah_session cookie
  let cookieStore;
  try {
    cookieStore = await cookies();
  } catch (cookieError) {
    if (isNextControlFlowError(cookieError)) throw cookieError;
    if (isOutsideRequestScopeError(cookieError)) return null;
    logger.error('[getServerAuthContext] Failed to read cookies for legacy fallback', safeErrorMeta(cookieError));
    await reportWebServerError(cookieError, { route: 'auth:server-context', extra: { stage: 'legacy_cookies' } });
    throw new SessionInfrastructureError('Failed to read cookies', cookieError);
  }
  if (readSessionValue(cookieStore)) {
    return null;
  }

  const accessToken = cookieStore.get('access_token');
  const refreshToken = cookieStore.get('refresh_token');
  if (!accessToken?.value) {
    return null;
  }

  const auth = await authenticated();
  if (!auth) {
    return null;
  }

  const userId = auth.properties.id;

  // Auto-migrate legacy user to SessionManager
  try {
    const { SessionManager } = await import('../auth/session-manager');
    await SessionManager.addAccount(
      {
        accessToken: accessToken.value,
        refreshToken: refreshToken?.value || '',
      },
      {
        id: userId,
        email: auth.properties.email,
        displayName: auth.properties.email,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    );
    logger.debug('[getServerAuthContext] Auto-migrated user to SessionManager', { userId });
  } catch (migrationError) {
    logger.warn('[getServerAuthContext] Auto-migration failed', safeErrorMeta(migrationError));
  }

  return {
    userId,
    accessToken: accessToken.value,
    channelId: '',
  };
}
