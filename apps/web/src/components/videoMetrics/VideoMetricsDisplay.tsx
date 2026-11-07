import { logger } from '@/lib/logger-client';

import React, { useState } from 'react';
import { useRealTimeVideoMetrics, useRealTimePresence } from '@/hooks/useRealTimeVideoMetrics';
import { Eye, Heart, MessageCircle, Users, ThumbsDown } from 'lucide-react';
import * as VideosAPI from '@/lib/api/videos';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';

interface VideoMetricsDisplayProps {
  videoId: string;
  channelId?: string;
  initialViewCount?: number;
  initialLikesCount?: number;
  initialDislikesCount?: number;
  initialCommentsCount?: number;
  onMetricsUpdate?: (metrics: unknown) => void;
}

export function VideoMetricsDisplay({
  videoId,
  channelId,
  initialViewCount = 0,
  initialLikesCount = 0,
  initialDislikesCount = 0,
  initialCommentsCount = 0,
  onMetricsUpdate
}: VideoMetricsDisplayProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [isLiked, setIsLiked] = useState(false);
  const [isDisliked, setIsDisliked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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

  const handleLike = async () => {
    if (!user || isLoading) return;

    setIsLoading(true);
    try {
      const headers = {
        channelId: user.id || '',
        userId: user.id || ''
      };

      if (isLiked) {
        // Optimistically update UI before API call
        updateMetrics({ likesCount: Math.max(0, metrics.likesCount - 1) });
        setIsLiked(false);

        await VideosAPI.unlikeVideo(videoId, headers);
        logger.debug('👍 Video unliked');
      } else {
        // If currently disliked, remove dislike first
        if (isDisliked) {
          updateMetrics({
            dislikesCount: Math.max(0, metrics.dislikesCount - 1),
            likesCount: metrics.likesCount + 1
          });
          setIsDisliked(false);
          await VideosAPI.removeVideoDislike(videoId, headers);
        } else {
          // Just add like
          updateMetrics({ likesCount: metrics.likesCount + 1 });
        }

        setIsLiked(true);
        await VideosAPI.likeVideo(videoId, headers);
        logger.debug('👍 Video liked');
      }
    } catch (error) {
      logger.error('Failed to toggle like:', error);
      // Revert optimistic update on error
      if (isLiked) {
        updateMetrics({ likesCount: metrics.likesCount + 1 });
        setIsLiked(true);
      } else {
        updateMetrics({ likesCount: Math.max(0, metrics.likesCount - 1) });
        setIsLiked(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDislike = async () => {
    if (!user || isLoading) return;

    setIsLoading(true);
    try {
      const headers = {
        channelId: user.id || '',
        userId: user.id || ''
      };

      if (isDisliked) {
        // Optimistically update UI before API call
        updateMetrics({ dislikesCount: Math.max(0, metrics.dislikesCount - 1) });
        setIsDisliked(false);

        await VideosAPI.removeVideoDislike(videoId, headers);
        logger.debug('👎 Video dislike removed');
      } else {
        // If currently liked, remove like first
        if (isLiked) {
          updateMetrics({
            likesCount: Math.max(0, metrics.likesCount - 1),
            dislikesCount: metrics.dislikesCount + 1
          });
          setIsLiked(false);
          await VideosAPI.unlikeVideo(videoId, headers);
        } else {
          // Just add dislike
          updateMetrics({ dislikesCount: metrics.dislikesCount + 1 });
        }

        setIsDisliked(true);
        await VideosAPI.dislikeVideo(videoId, headers);
        logger.debug('👎 Video disliked');
      }
    } catch (error) {
      logger.error('Failed to toggle dislike:', error);
      // Revert optimistic update on error
      if (isDisliked) {
        updateMetrics({ dislikesCount: metrics.dislikesCount + 1 });
        setIsDisliked(true);
      } else {
        updateMetrics({ dislikesCount: Math.max(0, metrics.dislikesCount - 1) });
        setIsDisliked(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400"
      role="group"
      aria-label={t.a11y.videoStats}
    >
      {/* View count */}
      <div className="flex items-center gap-1">
        <Eye className="w-4 h-4" aria-hidden="true" />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-700 dark:text-green-400' : ''}`}>
          {formatNumber(metrics.viewCount)} {t.video.views}
        </span>
      </div>

      {/* Likes */}
      <button
        onClick={handleLike}
        disabled={!user || isLoading}
        className={`flex items-center justify-center gap-1 min-h-11 min-w-11 px-2 rounded-md transition-all duration-200 active:scale-95 ${
          !user ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110'
        } ${isLiked ? 'text-red-600 dark:text-red-400' : ''}`}
        title={!user ? t.a11y.signInToReact : isLiked ? t.a11y.unlikeVideo : t.a11y.likeVideo}
        // Name includes the visible count (WCAG 2.5.3 Label in Name)
        aria-label={`${isLiked ? t.a11y.unlikeVideo : t.a11y.likeVideo} ${formatNumber(metrics.likesCount)}`}
        aria-pressed={isLiked}
        aria-describedby={!user ? `metrics-signin-hint-${videoId}` : undefined}
      >
        <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} aria-hidden="true" />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-700 dark:text-green-400' : ''}`}>
          {formatNumber(metrics.likesCount)}
        </span>
      </button>

      {/* Dislikes */}
      <button
        onClick={handleDislike}
        disabled={!user || isLoading}
        className={`flex items-center justify-center gap-1 min-h-11 min-w-11 px-2 rounded-md transition-all duration-200 active:scale-95 ${
          !user ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110'
        } ${isDisliked ? 'text-blue-700 dark:text-blue-300' : ''}`}
        title={!user ? t.a11y.signInToReact : isDisliked ? t.a11y.removeDislike : t.a11y.dislikeVideo}
        aria-label={`${isDisliked ? t.a11y.removeDislike : t.a11y.dislikeVideo} ${formatNumber(metrics.dislikesCount)}`}
        aria-pressed={isDisliked}
        aria-describedby={!user ? `metrics-signin-hint-${videoId}` : undefined}
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