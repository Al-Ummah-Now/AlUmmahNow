/**
 * Video Engagement Hook
 *
 * React hook for managing video engagement state (likes, dislikes, shares)
 * with optimistic updates and automatic rollback on errors.
 *
 * Features:
 * - Optimistic UI updates for instant feedback
 * - Automatic API synchronization
 * - Error handling with state rollback
 * - Debounced API calls to prevent spam
 * - Authentication-aware (requires user to be logged in)
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { getEngagementService, SharePlatform } from '@/services/api/engagement.service';
import { logger } from '@/lib/logger-client';


export interface UseVideoEngagementOptions {
  videoId: string;
  channelId?: string;
  userId?: string;
  initialLiked?: boolean;
  initialDisliked?: boolean;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

export interface VideoEngagementState {
  liked: boolean;
  disliked: boolean;
  pending: boolean;
}

export interface VideoEngagementActions {
  handleLike: () => Promise<void>;
  handleDislike: () => Promise<void>;
  handleShare: (platform: SharePlatform) => Promise<void>;
  copyShareUrl: () => Promise<void>;
}

export type UseVideoEngagementReturn = VideoEngagementState & VideoEngagementActions;

/**
 * Hook for managing video engagement (like, dislike, share)
 */
export function useVideoEngagement({
  videoId,
  channelId,
  userId,
  initialLiked = false,
  initialDisliked = false,
  onError,
  onSuccess
}: UseVideoEngagementOptions): UseVideoEngagementReturn {
  const [liked, setLiked] = useState(initialLiked);
  const [disliked, setDisliked] = useState(initialDisliked);
  const [pending, setPending] = useState(false);

  // Store previous state for rollback
  const previousStateRef = useRef({ liked: initialLiked, disliked: initialDisliked });

  // Debounce timeout ref
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Engagement service instance
  const serviceRef = useRef(getEngagementService());

  // Update previous state when initial values change
  useEffect(() => {
    setLiked(initialLiked);
    setDisliked(initialDisliked);
    previousStateRef.current = { liked: initialLiked, disliked: initialDisliked };
  }, [initialLiked, initialDisliked]);

  /**
   * Cleanup debounce timeout on unmount
   */
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Check if user is authenticated
   */
  const isAuthenticated = useCallback(() => {
    return !!(channelId && userId);
  }, [channelId, userId]);

  /**
   * Rollback state to previous values
   */
  const rollbackState = useCallback(() => {
    setLiked(previousStateRef.current.liked);
    setDisliked(previousStateRef.current.disliked);
  }, []);

  /**
   * Handle like button click
   */
  const handleLike = useCallback(async () => {
    // Check authentication
    if (!isAuthenticated()) {
      onError?.('Please sign in to like this video');
      return;
    }

    // Prevent multiple simultaneous requests
    if (pending) return;

    // Clear any pending debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Store current state for rollback
    previousStateRef.current = { liked, disliked };

    // Optimistic update
    const wasLiked = liked;
    const wasDisliked = disliked;

    if (wasLiked) {
      // Unlike
      setLiked(false);
    } else {
      // Like (and remove dislike if present)
      setLiked(true);
      if (wasDisliked) {
        setDisliked(false);
      }
    }

    // Debounce API call
    debounceTimeoutRef.current = setTimeout(async () => {
      setPending(true);

      try {
        const service = serviceRef.current;

        if (wasLiked) {
          // Unlike
          const result = await service.unlikeVideo(videoId, channelId!);
          if (!result.success) {
            throw new Error(result.error || 'Failed to unlike video');
          }
        } else {
          // Like
          const result = await service.likeVideo(videoId, channelId!);
          if (!result.success) {
            throw new Error(result.error || 'Failed to like video');
          }

          // Remove dislike if it was set
          if (wasDisliked) {
            await service.removeDislike(videoId, channelId!);
          }
        }

        // Success feedback
        if (onSuccess) {
          onSuccess(wasLiked ? 'Like removed' : 'Video liked');
        }
      } catch (error) {
        // Rollback on error
        rollbackState();

        const message = error instanceof Error ? error.message : 'Failed to update like status';
        logger.error('[useVideoEngagement] Like error:', { message, videoId, channelId, userId });
        onError?.(message);
      } finally {
        setPending(false);
      }
    }, 300); // 300ms debounce
  }, [
    videoId,
    channelId,
    userId,
    liked,
    disliked,
    pending,
    isAuthenticated,
    rollbackState,
    onError,
    onSuccess
  ]);

  /**
   * Handle dislike button click
   */
  const handleDislike = useCallback(async () => {
    // Check authentication
    if (!isAuthenticated()) {
      onError?.('Please sign in to dislike this video');
      return;
    }

    // Prevent multiple simultaneous requests
    if (pending) return;

    // Clear any pending debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Store current state for rollback
    previousStateRef.current = { liked, disliked };

    // Optimistic update
    const wasLiked = liked;
    const wasDisliked = disliked;

    if (wasDisliked) {
      // Remove dislike
      setDisliked(false);
    } else {
      // Dislike (and remove like if present)
      setDisliked(true);
      if (wasLiked) {
        setLiked(false);
      }
    }

    // Debounce API call
    debounceTimeoutRef.current = setTimeout(async () => {
      setPending(true);

      try {
        const service = serviceRef.current;

        if (wasDisliked) {
          // Remove dislike
          const result = await service.removeDislike(videoId, channelId!);
          if (!result.success) {
            throw new Error(result.error || 'Failed to remove dislike');
          }
        } else {
          // Dislike
          const result = await service.dislikeVideo(videoId, channelId!);
          if (!result.success) {
            throw new Error(result.error || 'Failed to dislike video');
          }

          // Remove like if it was set
          if (wasLiked) {
            await service.unlikeVideo(videoId, channelId!);
          }
        }

        // Success feedback
        if (onSuccess) {
          onSuccess(wasDisliked ? 'Dislike removed' : 'Video disliked');
        }
      } catch (error) {
        // Rollback on error
        rollbackState();

        const message = error instanceof Error ? error.message : 'Failed to update dislike status';
        logger.error('[useVideoEngagement] Dislike error:', message);
        onError?.(message);
      } finally {
        setPending(false);
      }
    }, 300); // 300ms debounce
  }, [
    videoId,
    channelId,
    userId,
    liked,
    disliked,
    pending,
    isAuthenticated,
    rollbackState,
    onError,
    onSuccess
  ]);

  /**
   * Handle share action
   */
  const handleShare = useCallback(async (platform: SharePlatform) => {
    try {
      const service = serviceRef.current;

      if (platform === 'copy') {
        const result = await service.copyShareUrl(videoId);
        if (!result.success) {
          throw new Error(result.error || 'Failed to copy URL');
        }
        onSuccess?.('Link copied to clipboard');
      } else {
        const url = service.getShareUrl(videoId, platform);
        if (!url) {
          throw new Error('Failed to generate share URL');
        }

        // Open share URL in new window
        window.open(url, '_blank', 'noopener,noreferrer');
      }

      // Track share event
      await service.trackShare(videoId, platform);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to share video';
      logger.error('[useVideoEngagement] Share error:', message);
      onError?.(message);
    }
  }, [videoId, onSuccess, onError]);

  /**
   * Copy share URL to clipboard (convenience method)
   */
  const copyShareUrl = useCallback(async () => {
    await handleShare('copy');
  }, [handleShare]);

  return {
    liked,
    disliked,
    pending,
    handleLike,
    handleDislike,
    handleShare,
    copyShareUrl
  };
}
