'use server';

import { getServerAuthContext } from './api/server-auth';
import { getChannelById } from './api/channels';
import { logger } from '@/lib/logger-server';
import { apiRequestServer, buildApiUrl } from './api/api-client';
import { can, type AccessibleChannel, type ChannelCapability, type ChannelRole } from '@al-ummah/shared-types';


/**
 * Verify if the current authenticated user is the owner of the specified channel
 *
 * @param channelId - The channel ID to check ownership for
 * @returns Promise<boolean> - true if user is the channel owner, false otherwise
 */
export async function isChannelOwner(channelId: string): Promise<boolean> {
  try {
    // Get current user auth context
    const authContext = await getServerAuthContext();

    if (!authContext || !authContext.userId) {
      logger.info('[isChannelOwner] No authenticated user', { channelId });
      return false;
    }

    // Fetch channel data
    const channel = await getChannelById(channelId);

    if (!channel) {
      logger.warn('[isChannelOwner] Channel not found', { channelId });
      return false;
    }

    // Check ownership
    const isOwner = channel.userId === authContext.userId;

    logger.info('[isChannelOwner] Ownership checked', {
      channelId,
      
      isOwner,
    });

    return isOwner;
  } catch (error) {
    logger.error('[isChannelOwner] Error checking ownership', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * The signed-in user's role on a channel (owner, or a channel role they were
 * given), from the live "my channels" list (GET /api/channels/access). Null
 * when signed out, when they hold no role, or when the list can't be read
 * (fail closed: the API enforces the same rules on every write anyway).
 * A site admin holds no channel role.
 */
export async function getChannelRole(channelId: string): Promise<ChannelRole | null> {
  try {
    const authContext = await getServerAuthContext();
    if (!authContext?.userId) return null;
    const response = await apiRequestServer<{ data?: AccessibleChannel[] }>(
      { method: 'GET', url: buildApiUrl('/api/channels/access'), functionName: 'getChannelRole' },
      async () => authContext,
      true,
    );
    if (!Array.isArray(response?.data)) {
      logger.warn('[getChannelRole] Channel list unavailable; no role assumed', { channelId });
      return null;
    }
    return response.data.find(c => c.id === channelId)?.role ?? null;
  } catch (error) {
    logger.error('[getChannelRole] Error reading the channel list', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Whether the signed-in user's channel role grants `capability` on this channel. */
export async function channelAllows(channelId: string, capability: ChannelCapability): Promise<boolean> {
  return can(await getChannelRole(channelId), capability);
}

/**
 * Get the authenticated user ID if available
 *
 * @returns Promise<string | null> - User ID or null if not authenticated
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const authContext = await getServerAuthContext();
    return authContext?.userId || null;
  } catch (error) {
    logger.error('[getCurrentUserId] Error getting user ID', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
