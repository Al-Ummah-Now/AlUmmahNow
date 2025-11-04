'use client';

import React from 'react';
import { useRealTimeVideoMetrics, useRealTimePresence } from '@/hooks/useRealTimeVideoMetrics';
import { Eye, Heart, MessageCircle, Users } from 'lucide-react';

interface VideoMetricsDisplayProps {
  videoId: string;
  channelId?: string;
  initialViewCount?: number;
  initialLikesCount?: number;
  initialDislikesCount?: number;
  initialCommentsCount?: number;
  onMetricsUpdate?: (metrics: any) => void;
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
  const { metrics, isConnected } = useRealTimeVideoMetrics({
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
      <div className="flex items-center gap-1">
        <Heart className="w-4 h-4" />
        <span className={`transition-colors duration-200 ${isConnected ? 'text-green-600' : ''}`}>
          {formatNumber(metrics.likesCount)}
        </span>
      </div>

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