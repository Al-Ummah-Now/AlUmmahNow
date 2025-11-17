'use client';

import React, { useState } from 'react';
import { useRealTimeVideoMetrics, useRealTimePresence } from '@/hooks/useRealTimeVideoMetrics';
import { Eye, Heart, MessageCircle, Users, ThumbsDown } from 'lucide-react';
import * as VideosAPI from '@/lib/api/videos';
import { useAuth } from '@/components/AuthProvider/authContext';

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
        console.log('👍 Video unliked');
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
        console.log('👍 Video liked');
      }
    } catch (error) {
      console.error('Failed to toggle like:', error);
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
        console.log('👎 Video dislike removed');
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
        console.log('👎 Video disliked');
      }
    } catch (error) {
      console.error('Failed to toggle dislike:', error);
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
    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
      {/* View count */}
      <div className="flex items-center gap-1">
        <Eye className="w-4 h-4" />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-600' : ''}`}>
          {formatNumber(metrics.viewCount)} views
        </span>
      </div>

      {/* Likes */}
      <button
        onClick={handleLike}
        disabled={!user || isLoading}
        className={`flex items-center gap-1 transition-all duration-200 ${
          !user ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110'
        } ${isLiked ? 'text-red-500' : ''}`}
        title={!user ? 'Sign in to like' : isLiked ? 'Unlike' : 'Like'}
      >
        <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-600' : ''}`}>
          {formatNumber(metrics.likesCount)}
        </span>
      </button>

      {/* Dislikes */}
      <button
        onClick={handleDislike}
        disabled={!user || isLoading}
        className={`flex items-center gap-1 transition-all duration-200 ${
          !user ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110'
        } ${isDisliked ? 'text-blue-500' : ''}`}
        title={!user ? 'Sign in to dislike' : isDisliked ? 'Remove dislike' : 'Dislike'}
      >
        <ThumbsDown className={`w-4 h-4 ${isDisliked ? 'fill-current' : ''}`} />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-600' : ''}`}>
          {formatNumber(metrics.dislikesCount)}
        </span>
      </button>

      {/* Comments */}
      <div className="flex items-center gap-1">
        <MessageCircle className="w-4 h-4" />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-600' : ''}`}>
          {formatNumber(metrics.commentsCount)}
        </span>
      </div>

      {/* Live viewers (if available) */}
      {channelId && presenceConnected && viewerCount > 0 && (
        <div className="flex items-center gap-1">
          <Users className="w-4 h-4" />
          <span className="text-red-500 font-medium">
            {formatNumber(viewerCount)} watching
          </span>
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        </div>
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