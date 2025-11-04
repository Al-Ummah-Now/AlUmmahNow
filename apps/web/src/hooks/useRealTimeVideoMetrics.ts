import { useState, useEffect, useCallback, useRef } from 'react';

import { useVideoWebSocket } from '@/hooks/useVideoWebSocket';

export interface VideoMetrics {
  videoId: string;
  viewCount: number;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;
  liveViewers: number;
  lastUpdated: Date;
}

export interface UseRealTimeVideoMetricsOptions {
  videoId: string;
  userId?: string;
  initialMetrics?: Partial<VideoMetrics>;
  onMetricsUpdate?: (metrics: VideoMetrics) => void;
}

export interface UseRealTimeVideoMetricsReturn {
  metrics: VideoMetrics;
  isConnected: boolean;
  updateMetrics: (updates: Partial<VideoMetrics>) => void;
}

export function useRealTimeVideoMetrics(
  options: UseRealTimeVideoMetricsOptions
): UseRealTimeVideoMetricsReturn {
  const { videoId, userId, initialMetrics = {}, onMetricsUpdate } = options;

  const [metrics, setMetrics] = useState<VideoMetrics>({
    videoId,
    viewCount: 0,
    likesCount: 0,
    dislikesCount: 0,
    commentsCount: 0,
    liveViewers: 0,
    lastUpdated: new Date(),
    ...initialMetrics
  });

  // Use the anonymous video WebSocket (works without authentication)
  const { viewerCount, isConnected } = useVideoWebSocket({
    videoId,
    userId, // Optional - can be undefined for anonymous users
    autoConnect: true
  });

  // Update liveViewers when viewerCount changes
  useEffect(() => {
    setMetrics(prev => ({
      ...prev,
      liveViewers: viewerCount,
      lastUpdated: new Date()
    }));
  }, [viewerCount]);

  // Store callback in ref to prevent re-subscription on every render
  const onMetricsUpdateRef = useRef(onMetricsUpdate);

  useEffect(() => {
    onMetricsUpdateRef.current = onMetricsUpdate;
  }, [onMetricsUpdate]);

  // Notify parent when metrics change
  useEffect(() => {
    if (onMetricsUpdateRef.current) {
      onMetricsUpdateRef.current(metrics);
    }
  }, [metrics]);

  // Update metrics manually (optimistic updates)
  const updateMetrics = useCallback((updates: Partial<VideoMetrics>) => {
    setMetrics(prevMetrics => ({
      ...prevMetrics,
      ...updates,
      lastUpdated: new Date()
    }));
  }, []);

  // Store initial metrics in ref to avoid infinite loops from object reference changes
  const initialMetricsRef = useRef(initialMetrics);

  useEffect(() => {
    initialMetricsRef.current = initialMetrics;
  }, [initialMetrics]);

  // Update metrics when videoId changes (but not when initialMetrics reference changes)
  useEffect(() => {
    setMetrics(prevMetrics => ({
      ...prevMetrics,
      ...initialMetricsRef.current,
      videoId,
      lastUpdated: new Date()
    }));
  }, [videoId]); // Only re-run when videoId changes, not initialMetrics

  return {
    metrics,
    isConnected,
    updateMetrics
  };
}

// Hook for tracking presence in a video/channel
export function useRealTimePresence(channelId: string) {
  // Use the anonymous video WebSocket for presence tracking
  const { viewerCount, isConnected } = useVideoWebSocket({
    videoId: channelId,
    autoConnect: true
  });

  return {
    viewers: [], // Not tracking individual viewers anymore, just count
    viewerCount,
    isConnected
  };
}