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
 *   userId: 'user456',
 *   isPlaying: true
 * });
 * ```
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketManager } from '@/lib/websocket/WebSocketManager';
import { PresenceEvent } from '@/interfaces/websocket';

export interface VideoWebSocketOptions {
  videoId: string;
  userId?: string;
  authToken?: string;
  autoConnect?: boolean;
  isPlaying?: boolean;
  onError?: (error: Error) => void;
}

export interface VideoWebSocketReturn {
  viewerCount: number;
  isConnected: boolean;
  sendViewingHeartbeat: () => void;
  disconnect: () => void;
}

/**
 * Get auth token from cookies (client-side)
 * Note: This is a simple implementation. In production, you might want
 * to use a more secure method or get the token from the auth context.
 */
function getAuthTokenFromCookies(): string | undefined {
  if (typeof document === 'undefined') return undefined;

  const cookies = document.cookie.split(';');
  const accessTokenCookie = cookies.find(c => c.trim().startsWith('access_token='));

  if (accessTokenCookie) {
    return accessTokenCookie.split('=')[1];
  }

  return undefined;
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
        console.log('[useVideoWebSocket] Sent viewing heartbeat');
      }
    } catch (error) {
      console.error('[useVideoWebSocket] Error sending heartbeat:', error);
      if (onErrorRef.current) {
        onErrorRef.current(error instanceof Error ? error : new Error('Failed to send heartbeat'));
      }
    }
  }, [videoId, userId]);

  /**
   * Handle incoming messages from video channel
   * Wrapped in useCallback with no dependencies to prevent re-creation
   */
  const handleVideoUpdate = useCallback((data: PresenceEvent | { type: 'viewer_count'; viewerCount: number }) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[useVideoWebSocket] Received update:', data);
    }

    if (data.type === 'presence_update' && typeof data.viewerCount === 'number') {
      setViewerCount(data.viewerCount);
    } else if (data.type === 'user_joined' && typeof data.viewerCount === 'number') {
      setViewerCount(data.viewerCount);
    } else if (data.type === 'user_left' && typeof data.viewerCount === 'number') {
      setViewerCount(data.viewerCount);
    } else if (data.type === 'viewer_count' && typeof data.viewerCount === 'number') {
      setViewerCount(data.viewerCount);
    }
  }, []); // Empty deps - setViewerCount is stable

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

    // Get WebSocket URL from environment
    const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL;

    if (!wsUrl) {
      console.warn('[useVideoWebSocket] NEXT_PUBLIC_WEBSOCKET_URL not configured, WebSocket disabled');
      return undefined;
    }

    // Get auth token if not provided
    const token = authToken || getAuthTokenFromCookies();

    if (process.env.NODE_ENV !== 'production') {
      console.log('[useVideoWebSocket] Initializing WebSocket for video:', videoId);
    }

    try {
      // Initialize WebSocketManager
      wsManager.current = new WebSocketManager({
        url: wsUrl,
        userId,
        authToken: token,
        reconnectInterval: 1000,
        maxReconnectAttempts: 5,
        heartbeatInterval: 30000
      });

      // Listen for connection state changes
      // Use a ref to track the last status to prevent unnecessary state updates
      let lastStatus: string | null = null;
      const unsubscribeState = wsManager.current.onStateChange((state) => {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useVideoWebSocket] State changed:', state.status);
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
        console.error('[useVideoWebSocket] Connection failed:', error);
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
          console.log('[useVideoWebSocket] Cleaning up');
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
      console.error('[useVideoWebSocket] Initialization error:', error);
      if (onErrorRef.current) {
        onErrorRef.current(error instanceof Error ? error : new Error('Failed to initialize WebSocket'));
      }
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, userId, authToken, autoConnect]);

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
    isConnected,
    sendViewingHeartbeat,
    disconnect
  };
}
