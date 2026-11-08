/**
 * Video WebSocket Hook
 *
 * Connects to WebSocket server to provide real-time video metrics:
 * - Live viewer count updates
 * - Viewing heartbeat reporting (every 30s)
 * - Automatic reconnection on disconnect
 * - Graceful degradation if WebSocket unavailable
 *
 * Usage:
 * ```tsx
 * const { viewerCount, isConnected, sendViewingHeartbeat } = useVideoWebSocket({
 *   videoId: 'abc123',
 *   
 *   isPlaying: true
 * });
 * ```
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketManager } from '@/lib/websocket/WebSocketManager';
import { PresenceEvent } from '@/interfaces/websocket';
import { getWebSocketUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';
import { getRealtimeAccessToken } from '@/lib/actions/realtime';


export interface VideoWebSocketOptions {
  videoId: string;
  userId?: string;
  authToken?: string;
  autoConnect?: boolean;
  isPlaying?: boolean;
  onError?: (error: Error) => void;
}

/**
 * Engagement counters pushed by the API on `video:<id>` (only fields that
 * have been received are present).
 */
export interface VideoLiveCounts {
  viewCount?: number;
  likesCount?: number;
  dislikesCount?: number;
  commentsAdded?: number;
}

export interface VideoWebSocketReturn {
  viewerCount: number;
  liveCounts: VideoLiveCounts;
  isConnected: boolean;
  sendViewingHeartbeat: () => void;
  disconnect: () => void;
}

/**
 * Hook to manage WebSocket connection for video real-time metrics
 */
export function useVideoWebSocket({
  videoId,
  userId,
  authToken,
  autoConnect = true,
  isPlaying = false,
  onError
}: VideoWebSocketOptions): VideoWebSocketReturn {
  const [viewerCount, setViewerCount] = useState<number>(0);
  const [liveCounts, setLiveCounts] = useState<VideoLiveCounts>({});
  const [isConnected, setIsConnected] = useState(false);
  const wsManager = useRef<WebSocketManager | null>(null);
  const heartbeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialHeartbeatTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHeartbeatRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const onErrorRef = useRef(onError);

  // Keep refs in sync with props
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    onErrorRef.current = onError;
  }, [isPlaying, onError]);

  /**
   * Send viewing heartbeat to report active viewing
   * Only sends if connected and playing
   */
  const sendViewingHeartbeat = useCallback(() => {
    if (!wsManager.current?.isConnected() || !isPlayingRef.current) {
      return;
    }

    const now = Date.now();
    const HEARTBEAT_THROTTLE = 25000; // 25s throttle to prevent spam

    if (now - lastHeartbeatRef.current < HEARTBEAT_THROTTLE) {
      return;
    }

    try {
      wsManager.current.sendMessage('viewing', {
        videoId,
        userId,
        timestamp: now,
        isPlaying: isPlayingRef.current
      });
      lastHeartbeatRef.current = now;
      if (process.env.NODE_ENV !== 'production') {
        logger.info('[useVideoWebSocket] Sent viewing heartbeat');
      }
    } catch (error) {
      logger.error('[useVideoWebSocket] Error sending heartbeat:', error);
      if (onErrorRef.current) {
        onErrorRef.current(error instanceof Error ? error : new Error('Failed to send heartbeat'));
      }
    }
  }, [videoId, userId]);

  /**
   * Handle incoming messages from video channel
   * Wrapped in useCallback with no dependencies to prevent re-creation
   */
  const handleVideoUpdate = useCallback((eventData: unknown) => {
    // Type guard to ensure eventData is a valid object
    if (!eventData || typeof eventData !== 'object' || !('type' in eventData)) {
      return;
    }

    const data = eventData as PresenceEvent | { type: 'viewer_count'; viewerCount: number };

    if (process.env.NODE_ENV !== 'production') {
      logger.info('[useVideoWebSocket] Received update:', data);
    }

    if (data.type === 'presence_update' && 'viewerCount' in data && typeof data.viewerCount === 'number') {
      setViewerCount(data.viewerCount);
    } else if (data.type === 'user_joined' && 'viewerCount' in data && typeof data.viewerCount === 'number') {
      setViewerCount(data.viewerCount);
    } else if (data.type === 'user_left' && 'viewerCount' in data && typeof data.viewerCount === 'number') {
      setViewerCount(data.viewerCount);
    } else if (data.type === 'viewer_count' && 'viewerCount' in data && typeof data.viewerCount === 'number') {
      setViewerCount(data.viewerCount);
    } else {
      const counters = eventData as { type: string; viewCount?: unknown; likesCount?: unknown; dislikesCount?: unknown };
      if (counters.type === 'view_count_updated' && typeof counters.viewCount === 'number') {
        const viewCount = counters.viewCount;
        setLiveCounts(prev => ({ ...prev, viewCount }));
      } else if ((counters.type === 'video_liked' || counters.type === 'video_unliked') && typeof counters.likesCount === 'number') {
        const likesCount = counters.likesCount;
        const dislikesCount = typeof counters.dislikesCount === 'number' ? counters.dislikesCount : undefined;
        setLiveCounts(prev => ({ ...prev, likesCount, ...(dislikesCount !== undefined && { dislikesCount }) }));
      } else if (counters.type === 'comment_added') {
        setLiveCounts(prev => ({ ...prev, commentsAdded: (prev.commentsAdded || 0) + 1 }));
      }
    }
  }, []); // Empty deps - state setters are stable

  /**
   * Disconnect WebSocket and cleanup all timers
   */
  const disconnect = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
      heartbeatInterval.current = null;
    }

    if (initialHeartbeatTimeout.current) {
      clearTimeout(initialHeartbeatTimeout.current);
      initialHeartbeatTimeout.current = null;
    }

    if (wsManager.current) {
      wsManager.current.disconnect();
      wsManager.current = null;
    }

    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!autoConnect || !videoId) {
      return undefined;
    }

    // Get WebSocket URL from runtime config
    const wsUrl = getWebSocketUrl();

    if (!wsUrl) {
      logger.warn('[useVideoWebSocket] WEBSOCKET_URL not configured, WebSocket disabled');
      return undefined;
    }

    // The access token is in httpOnly cookies, so signed-in users fetch it via a
    // server action on each (re)connect. Anonymous viewers connect without one.
    const getAuthToken = authToken
      ? async () => authToken
      : userId
        ? getRealtimeAccessToken
        : undefined;

    if (process.env.NODE_ENV !== 'production') {
      logger.info('[useVideoWebSocket] Initializing WebSocket for video:', videoId);
    }

    try {
      // Initialize WebSocketManager
      wsManager.current = new WebSocketManager({
        url: wsUrl,
        userId,
        getAuthToken,
        reconnectInterval: 1000,
        maxReconnectAttempts: 5,
        heartbeatInterval: 30000
      });

      // Listen for connection state changes
      // Use a ref to track the last status to prevent unnecessary state updates
      let lastStatus: string | null = null;
      const unsubscribeState = wsManager.current.onStateChange((state) => {
        if (process.env.NODE_ENV !== 'production') {
          logger.info('[useVideoWebSocket] State changed:', state.status);
        }

        // Only update state if status actually changed
        const isNowConnected = state.status === 'connected';
        if (state.status !== lastStatus) {
          lastStatus = state.status;
          setIsConnected(isNowConnected);
        }

        if (state.status === 'error' && onErrorRef.current) {
          onErrorRef.current(new Error('WebSocket connection error'));
        }
      });

      // Connect to WebSocket
      wsManager.current.connect(userId).catch((error) => {
        logger.error('[useVideoWebSocket] Connection failed:', error);
        if (onErrorRef.current) {
          onErrorRef.current(error instanceof Error ? error : new Error('Failed to connect to WebSocket'));
        }
      });

      // Subscribe to video channel
      const unsubscribe = wsManager.current.subscribe(
        `video:${videoId}`,
        handleVideoUpdate
      );

      // Cleanup on unmount
      return () => {
        if (process.env.NODE_ENV !== 'production') {
          logger.info('[useVideoWebSocket] Cleaning up');
        }

        // Clear heartbeat interval
        if (heartbeatInterval.current) {
          clearInterval(heartbeatInterval.current);
          heartbeatInterval.current = null;
        }

        // Clear initial heartbeat timeout
        if (initialHeartbeatTimeout.current) {
          clearTimeout(initialHeartbeatTimeout.current);
          initialHeartbeatTimeout.current = null;
        }

        // Unsubscribe from channels
        unsubscribe();
        unsubscribeState();

        // Disconnect WebSocket
        if (wsManager.current) {
          wsManager.current.disconnect();
          wsManager.current = null;
        }

        setIsConnected(false);
      };
    } catch (error) {
      logger.error('[useVideoWebSocket] Initialization error:', error);
      if (onErrorRef.current) {
        onErrorRef.current(error instanceof Error ? error : new Error('Failed to initialize WebSocket'));
      }
      return undefined;
    }
    // handleVideoUpdate is stable (empty deps), but included for completeness
  }, [videoId, userId, authToken, autoConnect, handleVideoUpdate]);

  // Manage heartbeat interval - only run when playing and connected
  useEffect(() => {
    // Clear any existing interval
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
      heartbeatInterval.current = null;
    }

    // Clear any existing initial timeout
    if (initialHeartbeatTimeout.current) {
      clearTimeout(initialHeartbeatTimeout.current);
      initialHeartbeatTimeout.current = null;
    }

    if (isPlaying && isConnected) {
      // Send initial heartbeat immediately
      sendViewingHeartbeat();

      // Start interval for subsequent heartbeats (30s)
      heartbeatInterval.current = setInterval(() => {
        sendViewingHeartbeat();
      }, 30000);
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
        heartbeatInterval.current = null;
      }
      if (initialHeartbeatTimeout.current) {
        clearTimeout(initialHeartbeatTimeout.current);
        initialHeartbeatTimeout.current = null;
      }
    };
  }, [isPlaying, isConnected, sendViewingHeartbeat]);

  return {
    viewerCount,
    liveCounts,
    isConnected,
    sendViewingHeartbeat,
    disconnect
  };
}
