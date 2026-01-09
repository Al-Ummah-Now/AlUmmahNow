'use server';

import { ChannelTabConfig } from '@al-ummah/shared-types';
import { apiRequestServer, buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';
import { getChannelById } from './channels';
import { logger } from '@/lib/logger';

/**
 * Get channel tab configuration
 * GET /api/channels/{id}/tabs
 */
export async function getChannelTabConfig(
  channelId: string
): Promise<ChannelTabConfig | null> {
  return apiRequestServer<ChannelTabConfig>(
    {
      method: 'GET',
      url: buildApiUrl(`/api/channels/${channelId}/tabs`),
      functionName: 'getChannelTabConfig',
    },
    getServerAuthContext,
    false // Public endpoint
  );
}

/**
 * Update channel tab configuration
 * PUT /api/channels/{id}/tabs
 */
export async function updateChannelTabConfig(
  channelId: string,
  data: {
    defaultTab?: string;
    tabs?: Array<{
      id: string;
      visible?: boolean;
      position?: number;
    }>;
  }
): Promise<ChannelTabConfig | null> {
  logger.info('updateChannelTabConfig: Request', {
    channelId,
    defaultTab: data.defaultTab,
    tabsCount: data.tabs?.length,
  });

  return apiRequestServer<ChannelTabConfig>(
    {
      method: 'PUT',
      url: buildApiUrl(`/api/channels/${channelId}/tabs`),
      body: data,
      functionName: 'updateChannelTabConfig',
    },
    getServerAuthContext,
    true // Requires auth (owner only)
  );
}

/**
 * Verify if the current user owns the specified channel
 * Returns true if user is the channel owner, false otherwise
 */
export async function verifyChannelOwnership(
  channelId: string
): Promise<boolean> {
  try {
    // Get current user auth context
    const authContext = await getServerAuthContext();

    if (!authContext || !authContext.userId) {
      logger.warn('verifyChannelOwnership: No authenticated user', { channelId });
      return false;
    }

    // Fetch channel data
    const channel = await getChannelById(channelId);

    if (!channel) {
      logger.warn('verifyChannelOwnership: Channel not found', { channelId });
      return false;
    }

    // Check ownership
    const isOwner = channel.userId === authContext.userId;

    logger.info('verifyChannelOwnership: Ownership verified', {
      channelId,
      
      isOwner,
    });

    return isOwner;
  } catch (error) {
    logger.error('verifyChannelOwnership: Error verifying ownership', {
      channelId,
      error,
    });
    return false;
  }
}
