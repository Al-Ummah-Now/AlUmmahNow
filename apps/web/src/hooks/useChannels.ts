import { useState, useEffect, useCallback } from 'react';
import { Channel } from '@al-ummah/shared-types';
import { listChannels, createChannel as createChannelAPI, updateChannel as updateChannelAPI, deleteChannel as deleteChannelAPI } from '@/lib/api/channels';
import { ChannelCreateRequest, ChannelUpdateRequest, ApiHeaders } from '@/lib/api/types';

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
      console.log('useChannels: Skipping fetch - missing channelId or userId');
      setChannels([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('useChannels: Fetching channels with headers:', { channelId, userId });

      const response = await listChannels(
        { limit: 100 }, // Get up to 100 channels
        { channelId, userId }
      );

      if (!response) {
        throw new Error('Failed to fetch channels');
      }

      console.log('useChannels: API response:', response);

      // Handle different response formats
      const channelData = (response as any).data ||
                         (response as any).result?.channels ||
                         (response as any).channels ||
                         [];

      setChannels(channelData);
      console.log('useChannels: Set channels:', channelData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch channels';
      console.error('useChannels: Error fetching channels:', err);
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
      console.error('useChannels.createChannel: Missing channelId or userId');
      setError('Authentication required');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('useChannels: Creating channel with data:', data);

      const headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>> = {
        channelId,
        userId
      };

      const response = await createChannelAPI(data, headers);

      if (!response) {
        throw new Error('Failed to create channel');
      }

      console.log('useChannels: Channel created successfully:', response);

      // Refetch channels after creation
      await refetch();
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create channel';
      console.error('useChannels: Error creating channel:', err);
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
      console.error('useChannels.updateChannel: Missing channelId or userId');
      setError('Authentication required');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('useChannels: Updating channel', id, 'with data:', data);

      const headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>> = {
        channelId,
        userId
      };

      const response = await updateChannelAPI(id, data, headers);

      if (!response) {
        throw new Error('Failed to update channel');
      }

      console.log('useChannels: Channel updated successfully:', response);

      // Refetch channels after update
      await refetch();
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update channel';
      console.error('useChannels: Error updating channel:', err);
      setError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [channelId, userId, refetch]);

  const deleteChannel = useCallback(async (id: string): Promise<boolean> => {
    if (!channelId || !userId) {
      console.error('useChannels.deleteChannel: Missing channelId or userId');
      setError('Authentication required');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('useChannels: Deleting channel', id);

      const headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>> = {
        channelId,
        userId
      };

      const response = await deleteChannelAPI(id, headers);

      if (!response || !response.success) {
        throw new Error('Failed to delete channel');
      }

      console.log('useChannels: Channel deleted successfully:', response);

      // Refetch channels after deletion
      await refetch();
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete channel';
      console.error('useChannels: Error deleting channel:', err);
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
