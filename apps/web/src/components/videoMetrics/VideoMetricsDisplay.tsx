import { logger } from '@/lib/logger-client';

import React, { useEffect, useState } from 'react';
import { useRealTimeVideoMetrics, useRealTimePresence } from '@/hooks/useRealTimeVideoMetrics';
import { Eye, MessageCircle, Users, ThumbsUp } from 'lucide-react';
import * as VideosAPI from '@/lib/api/videos';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import type { VideoReaction } from '@/components/VideoPagePlayer/interface';
import { formatViews } from '@/lib/format/videoMeta';
import { COMMENTS_ID } from '@/components/SkipLinks';

interface VideoMetricsDisplayProps {
  videoId: string;
  channelId?: string;
  initialViewCount?: number;
  initialLikesCount?: number;
  initialCommentsCount?: number;
  /** Existing reactions on the video (from GET /api/videos/:id) */
  likes?: VideoReaction[];
  onMetricsUpdate?: (metrics: unknown) => void;
}

export function VideoMetricsDisplay({
  videoId,
  channelId,
  initialViewCount = 0,
  initialLikesCount = 0,
  initialCommentsCount = 0,
  likes,
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
  const [isLoading, setIsLoading] = useState(false);

  // Restore the viewer's existing reaction (after a reload the API still has it)
  useEffect(() => {
    if (!reactorChannelId) return;
    setIsLiked(!!likes?.some((r) => r.channelId === reactorChannelId));
  }, [reactorChannelId, likes]);

  const { metrics, updateMetrics } = useRealTimeVideoMetrics({
    videoId,
    initialMetrics: {
      viewCount: initialViewCount,
      likesCount: initialLikesCount,
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

  /**
   * Toggle the viewer's like. Updates optimistically, then calls the API and
   * shows what the server has when the call fails (the API helpers return
   * null on failure). Dislikes are turned off (owner decision 2026-11-11);
   * liking also clears a dislike the viewer left before then (API side).
   */
  const handleLike = async () => {
    if (!user || !reactorChannelId || isLoading) return;

    const wasLiked = isLiked;
    const before = metrics.likesCount;
    const headers = { channelId: reactorChannelId };

    setIsLoading(true);
    updateMetrics({ likesCount: Math.max(0, before + (wasLiked ? -1 : 1)) });
    setIsLiked(!wasLiked);

    try {
      const result = wasLiked
        ? await VideosAPI.unlikeVideo(videoId, headers)
        : await VideosAPI.likeVideo(videoId, headers);
      if (!result) throw new Error('reaction request failed');
      logger.debug('[VideoMetricsDisplay] Like updated', { videoId, liked: !wasLiked });
    } catch (error) {
      logger.error('[VideoMetricsDisplay] Failed to update like', { videoId, liked: !wasLiked, error });
      // A failed response does not prove the change was not stored: show what
      // the server actually has, and fall back to the previous state if that
      // cannot be read either.
      const fresh = await VideosAPI.getVideoById(videoId).catch(() => null);
      if (fresh) {
        setIsLiked(!!fresh.likes?.some((r) => r.channelId === reactorChannelId));
        updateMetrics({ likesCount: fresh.likes?.length ?? fresh.likesCount ?? before });
      } else {
        updateMetrics({ likesCount: before });
        setIsLiked(wasLiked);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      data-testid="video-metrics"
      className="flex items-center gap-4 text-sm"
      role="group"
      aria-label={t.a11y.videoStats}
    >
      {/* View count */}
      <div className="flex items-center gap-1" data-testid="video-metrics-views">
        <Eye className="w-4 h-4" aria-hidden="true" />
        <span>
          {formatViews(metrics.viewCount, lang)}
        </span>
      </div>

      {/* Like: a pill like the other actions (watch-actions in theme/system.css); pressed uses the
          theme's primary colour. No dislike control: dislikes are turned off (2026-11-11). */}
      <button
        type="button"
        onClick={handleLike}
        disabled={!user || isLoading || !reactorChannelId}
        className={!user ? 'cursor-not-allowed' : 'cursor-pointer'}
        title={!user ? t.a11y.signInToReact : isLiked ? t.a11y.unlikeVideo : t.a11y.likeVideo}
        // Name includes the visible count (WCAG 2.5.3 Label in Name)
        aria-label={`${isLiked ? t.a11y.unlikeVideo : t.a11y.likeVideo} ${formatNumber(metrics.likesCount)}`}
        aria-pressed={isLiked}
        aria-describedby={!user ? `metrics-signin-hint-${videoId}` : undefined}
        data-testid="video-like-button"
      >
        <ThumbsUp className={isLiked ? 'fill-current' : undefined} aria-hidden="true" data-icon="thumbs-up" />
        <span>{formatNumber(metrics.likesCount)}</span>
      </button>

      {/* Comments: a pill like the other actions, jumping to the comments section */}
      <a
        href={`#${COMMENTS_ID}`}
        className="wa-comments"
        data-testid="video-comments-count"
        aria-label={t.a11y.commentsCount.replace('{count}', String(metrics.commentsCount))}
      >
        <MessageCircle aria-hidden="true" />
        <span>{formatNumber(metrics.commentsCount)}</span>
      </a>

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