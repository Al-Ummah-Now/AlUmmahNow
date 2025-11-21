'use server';

import { getServerAuthContext } from './api/server-auth';
import { getChannelById } from './api/channels';
import { logger } from '@/lib/logger-server';


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
      userId: authContext.userId,
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
