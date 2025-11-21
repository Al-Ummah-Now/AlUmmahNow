import { useState, useEffect, useCallback } from 'react';
import { Channel } from '@al-ummah/shared-types';
import { listChannels, createChannel as createChannelAPI, updateChannel as updateChannelAPI, deleteChannel as deleteChannelAPI } from '@/lib/api/channels';
import { ChannelCreateRequest, ChannelUpdateRequest, ApiHeaders } from '@/lib/api/types';
import { logger } from '@/lib/logger-client';


interface UseChannelsOptions {
  channelId?: string;
  userId?: string;
  autoFetch?: boolean;
}

interface UseChannelsReturn {
  channels: Channel[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createChannel: (data: ChannelCreateRequest) => Promise<boolean>;
  updateChannel: (id: string, data: ChannelUpdateRequest) => Promise<boolean>;
  deleteChannel: (id: string) => Promise<boolean>;
}

/**
 * Hook to manage channels for the current user
 * Fetches channels using ChannelsAPI and provides CRUD operations
 */
export const useChannels = (options: UseChannelsOptions = {}): UseChannelsReturn => {
  const { channelId, userId, autoFetch = true } = options;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    // Skip if no auth headers
    if (!channelId || !userId) {
      logger.info('useChannels: Skipping fetch - missing channelId or userId');
      setChannels([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      logger.info('useChannels: Fetching channels with headers:', { channelId, userId });

      const response = await listChannels(
        { limit: 100 }, // Get up to 100 channels
        { channelId, userId }
      );

      if (!response) {
        throw new Error('Failed to fetch channels');
      }

      logger.info('useChannels: API response:', response);

      // Handle different response formats
      if ('data' in response && Array.isArray(response.data)) {
        const channelData = response.data as Channel[];
        setChannels(channelData);
        logger.info('useChannels: Set channels:', channelData);
      } else if ('result' in response) {
        const resultObj = response.result as Record<string, unknown>;
        if (resultObj && 'channels' in resultObj && Array.isArray(resultObj.channels)) {
          const channelData = resultObj.channels as Channel[];
          setChannels(channelData);
          logger.info('useChannels: Set channels:', channelData);
        } else {
          setChannels([]);
        }
      } else if ('channels' in response && Array.isArray(response.channels)) {
        const channelData = response.channels as Channel[];
        setChannels(channelData);
        logger.info('useChannels: Set channels:', channelData);
      } else {
        setChannels([]);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch channels';
      logger.error('useChannels: Error fetching channels:', err);
      setError(errorMessage);
      setChannels([]);
    } finally {
      setIsLoading(false);
    }
  }, [channelId, userId]);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch && channelId && userId) {
      refetch();
    }
  }, [autoFetch, channelId, userId, refetch]);

  const createChannel = useCallback(async (data: ChannelCreateRequest): Promise<boolean> => {
    if (!channelId || !userId) {
      logger.error('useChannels.createChannel: Missing channelId or userId');
      setError('Authentication required');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      logger.info('useChannels: Creating channel with data:', data);

      const headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>> = {
        channelId,
        userId
      };

      const response = await createChannelAPI(data, headers);

      if (!response) {
        throw new Error('Failed to create channel');
      }

      logger.info('useChannels: Channel created successfully:', response);

      // Refetch channels after creation
      await refetch();
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create channel';
      logger.error('useChannels: Error creating channel:', err);
      setError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [channelId, userId, refetch]);

  const updateChannel = useCallback(async (
    id: string,
    data: ChannelUpdateRequest
  ): Promise<boolean> => {
    if (!channelId || !userId) {
      logger.error('useChannels.updateChannel: Missing channelId or userId');
      setError('Authentication required');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      logger.info('useChannels: Updating channel', id, 'with data:', data);

      const headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>> = {
        channelId,
        userId
      };

      const response = await updateChannelAPI(id, data, headers);

      if (!response) {
        throw new Error('Failed to update channel');
      }

      logger.info('useChannels: Channel updated successfully:', response);

      // Refetch channels after update
      await refetch();
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update channel';
      logger.error('useChannels: Error updating channel:', err);
      setError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [channelId, userId, refetch]);

  const deleteChannel = useCallback(async (id: string): Promise<boolean> => {
    if (!channelId || !userId) {
      logger.error('useChannels.deleteChannel: Missing channelId or userId');
      setError('Authentication required');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      logger.info('useChannels: Deleting channel', id);

      const headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>> = {
        channelId,
        userId
      };

      const response = await deleteChannelAPI(id, headers);

      if (!response || !response.success) {
        throw new Error('Failed to delete channel');
      }

      logger.info('useChannels: Channel deleted successfully:', response);

      // Refetch channels after deletion
      await refetch();
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete channel';
      logger.error('useChannels: Error deleting channel:', err);
      setError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [channelId, userId, refetch]);

  return {
    channels,
    isLoading,
    error,
    refetch,
    createChannel,
    updateChannel,
    deleteChannel,
  };
};
