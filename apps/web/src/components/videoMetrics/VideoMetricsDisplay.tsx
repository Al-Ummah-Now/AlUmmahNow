import { logger } from '@/lib/logger-client';

import React, { useEffect, useState } from 'react';
import { useRealTimeVideoMetrics, useRealTimePresence } from '@/hooks/useRealTimeVideoMetrics';
import { Eye, Heart, MessageCircle, Users, ThumbsDown } from 'lucide-react';
import * as VideosAPI from '@/lib/api/videos';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import type { VideoReaction } from '@/components/VideoPagePlayer/interface';
import { formatViews } from '@/lib/format/videoMeta';

interface VideoMetricsDisplayProps {
  videoId: string;
  channelId?: string;
  initialViewCount?: number;
  initialLikesCount?: number;
  initialDislikesCount?: number;
  initialCommentsCount?: number;
  /** Existing reactions on the video (from GET /api/videos/:id) */
  likes?: VideoReaction[];
  dislikes?: VideoReaction[];
  onMetricsUpdate?: (metrics: unknown) => void;
}

export function VideoMetricsDisplay({
  videoId,
  channelId,
  initialViewCount = 0,
  initialLikesCount = 0,
  initialDislikesCount = 0,
  initialCommentsCount = 0,
  likes,
  dislikes,
  onMetricsUpdate
}: VideoMetricsDisplayProps) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const { user: account, loading: accountLoading } = useMultiAccount();
  // Reactions are made as the active channel (accounts without one react as the
  // user). Wait for the account to load: reacting earlier would use the user id
  // and then have the restored state reset once the channel is known.
  const reactorChannelId = accountLoading ? '' : (account?.channel?.id || user?.id || '');
  const [isLiked, setIsLiked] = useState(false);
  const [isDisliked, setIsDisliked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Restore the viewer's existing reaction (after a reload the API still has it)
  useEffect(() => {
    if (!reactorChannelId) return;
    setIsLiked(!!likes?.some((r) => r.channelId === reactorChannelId));
    setIsDisliked(!!dislikes?.some((r) => r.channelId === reactorChannelId));
  }, [reactorChannelId, likes, dislikes]);

  const { metrics, isConnected, updateMetrics } = useRealTimeVideoMetrics({
    videoId,
    initialMetrics: {
      viewCount: initialViewCount,
      likesCount: initialLikesCount,
      dislikesCount: initialDislikesCount,
      commentsCount: initialCommentsCount
    },
    onMetricsUpdate
  });

  const { viewerCount, isConnected: presenceConnected } = useRealTimePresence(channelId || videoId);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  type Reaction = 'like' | 'dislike' | null;

  /**
   * Toggle the viewer's reaction. Updates optimistically, then calls the API
   * (removing the opposite reaction first) and restores the previous counts
   * and state when any call fails (the API helpers return null on failure).
   */
  const setReaction = async (target: Exclude<Reaction, null>) => {
    if (!user || !reactorChannelId || isLoading) return;

    const previous: Reaction = isLiked ? 'like' : isDisliked ? 'dislike' : null;
    const next: Reaction = previous === target ? null : target;
    const before = { likesCount: metrics.likesCount, dislikesCount: metrics.dislikesCount };
    const headers = { channelId: reactorChannelId };

    setIsLoading(true);
    updateMetrics({
      likesCount: Math.max(0, before.likesCount - (previous === 'like' ? 1 : 0) + (next === 'like' ? 1 : 0)),
      dislikesCount: Math.max(0, before.dislikesCount - (previous === 'dislike' ? 1 : 0) + (next === 'dislike' ? 1 : 0)),
    });
    setIsLiked(next === 'like');
    setIsDisliked(next === 'dislike');

    try {
      // Run every step even if one reports failure, then verify against the server
      const results: unknown[] = [];
      if (previous === 'like') results.push(await VideosAPI.unlikeVideo(videoId, headers));
      if (previous === 'dislike') results.push(await VideosAPI.removeVideoDislike(videoId, headers));
      if (next === 'like') results.push(await VideosAPI.likeVideo(videoId, headers));
      if (next === 'dislike') results.push(await VideosAPI.dislikeVideo(videoId, headers));
      if (results.some((result) => !result)) throw new Error('reaction request failed');
      logger.debug('[VideoMetricsDisplay] Reaction updated', { videoId, previous, next });
    } catch (error) {
      logger.error('[VideoMetricsDisplay] Failed to update reaction', { videoId, previous, next, error });
      // A failed response does not prove the change was not stored: show what
      // the server actually has, and fall back to the previous state if that
      // cannot be read either.
      const fresh = await VideosAPI.getVideoById(videoId).catch(() => null);
      if (fresh) {
        setIsLiked(!!fresh.likes?.some((r) => r.channelId === reactorChannelId));
        setIsDisliked(!!fresh.dislikes?.some((r) => r.channelId === reactorChannelId));
        updateMetrics({
          likesCount: fresh.likes?.length ?? fresh.likesCount ?? before.likesCount,
          dislikesCount: fresh.dislikes?.length ?? fresh.dislikesCount ?? before.dislikesCount,
        });
      } else {
        updateMetrics(before);
        setIsLiked(previous === 'like');
        setIsDisliked(previous === 'dislike');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLike = () => setReaction('like');
  const handleDislike = () => setReaction('dislike');

  return (
    <div
      data-testid="video-metrics"
      className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400"
      role="group"
      aria-label={t.a11y.videoStats}
    >
      {/* View count */}
      <div className="flex items-center gap-1" data-testid="video-metrics-views">
        <Eye className="w-4 h-4" aria-hidden="true" />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-700 dark:text-green-400' : ''}`}>
          {formatViews(metrics.viewCount, lang)}
        </span>
      </div>

      {/* Likes */}
      <button
        onClick={handleLike}
        disabled={!user || isLoading || !reactorChannelId}
        className={`flex items-center justify-center gap-1 min-h-11 min-w-11 px-2 rounded-md transition-all duration-200 active:scale-95 ${
          !user ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110'
        } ${isLiked ? 'text-red-600 dark:text-red-400' : ''}`}
        title={!user ? t.a11y.signInToReact : isLiked ? t.a11y.unlikeVideo : t.a11y.likeVideo}
        // Name includes the visible count (WCAG 2.5.3 Label in Name)
        aria-label={`${isLiked ? t.a11y.unlikeVideo : t.a11y.likeVideo} ${formatNumber(metrics.likesCount)}`}
        aria-pressed={isLiked}
        aria-describedby={!user ? `metrics-signin-hint-${videoId}` : undefined}
        data-testid="video-like-button"
      >
        <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} aria-hidden="true" />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-700 dark:text-green-400' : ''}`}>
          {formatNumber(metrics.likesCount)}
        </span>
      </button>

      {/* Dislikes */}
      <button
        onClick={handleDislike}
        disabled={!user || isLoading || !reactorChannelId}
        className={`flex items-center justify-center gap-1 min-h-11 min-w-11 px-2 rounded-md transition-all duration-200 active:scale-95 ${
          !user ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110'
        } ${isDisliked ? 'text-blue-700 dark:text-blue-300' : ''}`}
        title={!user ? t.a11y.signInToReact : isDisliked ? t.a11y.removeDislike : t.a11y.dislikeVideo}
        aria-label={`${isDisliked ? t.a11y.removeDislike : t.a11y.dislikeVideo} ${formatNumber(metrics.dislikesCount)}`}
        aria-pressed={isDisliked}
        aria-describedby={!user ? `metrics-signin-hint-${videoId}` : undefined}
        data-testid="video-dislike-button"
      >
        <ThumbsDown className={`w-4 h-4 ${isDisliked ? 'fill-current' : ''}`} aria-hidden="true" />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-700 dark:text-green-400' : ''}`}>
          {formatNumber(metrics.dislikesCount)}
        </span>
      </button>

      {/* Comments */}
      <div className="flex items-center gap-1" aria-label={t.a11y.commentsCount.replace('{count}', String(metrics.commentsCount))}>
        <MessageCircle className="w-4 h-4" aria-hidden="true" />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-700 dark:text-green-400' : ''}`}>
          {formatNumber(metrics.commentsCount)}
        </span>
      </div>

      {/* Live viewers (if available) */}
      {channelId && presenceConnected && viewerCount > 0 && (
        <div className="flex items-center gap-1">
          <Users className="w-4 h-4" aria-hidden="true" />
          <span className="text-red-600 dark:text-red-400 font-medium">
            {t.a11y.watchingNow.replace('{count}', formatNumber(viewerCount))}
          </span>
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" aria-hidden="true" />
        </div>
      )}

      {!user && (
        <span id={`metrics-signin-hint-${videoId}`} className="sr-only">
          {t.a11y.signInToReact}
        </span>
      )}

      {/* Connection status indicator */}
      {process.env.NODE_ENV === 'development' && (
        <div className={`text-xs px-2 py-1 rounded ${
          isConnected ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                     : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
        }`}>
          {isConnected ? '🟢 Live' : '🔴 Static'}
        </div>
      )}
    </div>
  );
}

interface LiveViewerIndicatorProps {
  channelId: string;
  className?: string;
}

export function LiveViewerIndicator({ channelId, className = "" }: LiveViewerIndicatorProps) {
  const { viewerCount, isConnected } = useRealTimePresence(channelId);

  if (!isConnected || viewerCount === 0) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-center gap-1 text-red-500">
        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        <span className="text-sm font-medium">LIVE</span>
      </div>
      
      <div className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
        <Users className="w-4 h-4" />
        <span className="text-sm">
          {viewerCount} viewer{viewerCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* Note: Individual viewer tracking disabled for privacy */}
      {viewerCount > 0 && (
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span>👥</span>
        </div>
      )}
    </div>
  );
}