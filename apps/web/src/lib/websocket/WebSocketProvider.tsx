'use client';
import { logger } from '@/lib/logger-client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { WebSocketManager } from '@/lib/websocket/WebSocketManager';
import { WebSocketConnectionState, WebSocketConfig, WebSocketEventType } from '@/interfaces/websocket';
import { User } from '@/interfaces';
import { fetchClientAuthToken } from '@/lib/auth/client-token';

interface WebSocketContextType {
  wsManager: WebSocketManager | null;
  connectionState: WebSocketConnectionState;
  subscribe: (channel: string, callback: (data: unknown) => void) => (() => void) | null;
  sendMessage: (type: string, data: unknown) => void;
  isConnected: boolean;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

interface WebSocketProviderProps {
  children: React.ReactNode;
  user?: User | null;
  config?: Partial<WebSocketConfig>;
}

export function WebSocketProvider({ children, user, config = {} }: WebSocketProviderProps) {
  const [connectionState, setConnectionState] = useState<WebSocketConnectionState>({
    status: 'disconnected',
    reconnectAttempts: 0,
    maxReconnectAttempts: 5
  });
  
  const wsManagerRef = useRef<WebSocketManager | null>(null);
  
  // Subscriptions made by children. Child effects run before this provider's
  
  // effect creates the manager (and the manager is recreated on sign-in), so
  
  // every subscription is kept here and replayed onto each new manager.
  
  const registryRef = useRef(new Set<{ channel: string; callback: (data: unknown) => void; off: (() => void) | null }>());
  const [isConnected, setIsConnected] = useState(false);

  // Initialize WebSocket manager
  useEffect(() => {
    // Get WebSocket URL from runtime config or environment variable
    const wsUrl = (typeof window !== 'undefined' && (window as {__RUNTIME_CONFIG__?: {WEBSOCKET_URL?: string}}).__RUNTIME_CONFIG__?.WEBSOCKET_URL)
      || process.env.NEXT_PUBLIC_WEBSOCKET_URL
      || '';

    // Default WebSocket configuration
    const defaultConfig: WebSocketConfig = {
      url: wsUrl,
      reconnectInterval: 1000,
      maxReconnectAttempts: 5,
      heartbeatInterval: 30000,
      ...config
    };

    if (user?.id) {
      defaultConfig.userId = user.id;
    }
    let cancelled = false;
    const manager = new WebSocketManager(defaultConfig);
    wsManagerRef.current = manager;
    registryRef.current.forEach((entry) => {
      entry.off = manager.subscribe(entry.channel, entry.callback);
    });

    // Listen for connection state changes
    const unsubscribeStateChange = wsManagerRef.current.onStateChange((state) => {
      setConnectionState(state);
      setIsConnected(state.status === 'connected');
    });

    // Auto-connect for both authenticated and anonymous users.
    // Authenticated users get their access token from the same-origin token
    // endpoint (cookies are httpOnly) and authenticate via the first message.
    void (async () => {
      if (user?.id) {
        const token = await fetchClientAuthToken();
        if (token) manager.setAuthToken(token);
      }
      if (cancelled) return;
      manager.connect(user?.id).catch((error) => {
        logger.error("Failed to connect to WebSocket:", error);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribeStateChange();
      registryRef.current.forEach((entry) => {
        entry.off = null;
      });
      if (wsManagerRef.current) {
        wsManagerRef.current.disconnect();
        wsManagerRef.current = null;
      }
    };
    // Fixed: Removed config from dependencies to prevent reconnection loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Reconnect when user changes (from anonymous to authenticated or vice versa)
  useEffect(() => {
    if (wsManagerRef.current) {
      if (!wsManagerRef.current.isConnected()) {
        wsManagerRef.current.connect(user?.id).catch((error) => {
          logger.error('Failed to reconnect to WebSocket:', error);
        });
      }
    }
  }, [user?.id]);

  const subscribe = useCallback((channel: string, callback: (data: unknown) => void): (() => void) | null => {
    const entry = { channel, callback, off: wsManagerRef.current ? wsManagerRef.current.subscribe(channel, callback) : null };
    registryRef.current.add(entry);
    return () => {
      entry.off?.();
      entry.off = null;
      registryRef.current.delete(entry);
    };
  }, []);

  const sendMessage = useCallback((type: string, data: unknown): void => {
    if (wsManagerRef.current) {
      wsManagerRef.current.sendMessage(type as WebSocketEventType, data);
    }
  }, []);

  const contextValue: WebSocketContextType = useMemo(() => ({
    wsManager: wsManagerRef.current,
    connectionState,
    subscribe,
    sendMessage,
    isConnected
  }), [connectionState, subscribe, sendMessage, isConnected]);

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextType {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

export function useWebSocketSubscription(
  channel: string,
  callback: (data: unknown) => void,
  deps: React.DependencyList = []
): boolean {
  const { subscribe, isConnected } = useWebSocket();

  // Store callback in ref to prevent re-subscription when callback changes
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!channel) return;

    // Use stable callback from ref
    const unsubscribe = subscribe(channel, (data: unknown) => {
      callbackRef.current(data);
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
    // Only re-subscribe when channel or subscribe changes, NOT when callback changes
    // The deps array is only used for external dependencies (like userId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, subscribe, ...deps]);

  return isConnected;
}

/**
 * Like useWebSocketSubscription, but a no-op when rendered outside a
 * WebSocketProvider (e.g. isolated widgets and tests), so realtime stays an
 * enhancement on top of polling/fetching rather than a hard dependency.
 */
export function useOptionalWebSocketSubscription(
  channel: string,
  callback: (data: unknown) => void
): boolean {
  const context = useContext(WebSocketContext);
  const subscribe = context?.subscribe;
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!channel || !subscribe) return undefined;
    const unsubscribe = subscribe(channel, (data: unknown) => {
      callbackRef.current(data);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [channel, subscribe]);

  return context?.isConnected ?? false;
}