'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { WebSocketManager } from '@/lib/websocket/WebSocketManager';
import { WebSocketConnectionState, WebSocketConfig } from '@/interfaces/websocket';
import { User } from '@/interfaces';

interface WebSocketContextType {
  wsManager: WebSocketManager | null;
  connectionState: WebSocketConnectionState;
  subscribe: (channel: string, callback: (data: any) => void) => (() => void) | null;
  sendMessage: (type: any, data: any) => void;
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
  const [isConnected, setIsConnected] = useState(false);

  // Initialize WebSocket manager
  useEffect(() => {
    // Default WebSocket configuration
    const defaultConfig: WebSocketConfig = {
      url: process.env.NODE_ENV === 'production' 
        ? 'wss://realtime.alummahnow.net/ws' 
        : 'ws://localhost:8787/ws',
      reconnectInterval: 1000,
      maxReconnectAttempts: 5,
      heartbeatInterval: 30000,
      ...config
    };

    if (user?.id) {
      defaultConfig.userId = user.id;
      // In production, you would get this from your auth token
      // defaultConfig.authToken = getAuthToken();
    }

    wsManagerRef.current = new WebSocketManager(defaultConfig);

    // Listen for connection state changes
    const unsubscribeStateChange = wsManagerRef.current.onStateChange((state) => {
      setConnectionState(state);
      setIsConnected(state.status === 'connected');
    });

    // Auto-connect if user is authenticated
    if (user?.id) {
      wsManagerRef.current.connect(user.id).catch((error) => {
        console.error('Failed to connect to WebSocket:', error);
      });
    }

    return () => {
      unsubscribeStateChange();
      if (wsManagerRef.current) {
        wsManagerRef.current.disconnect();
        wsManagerRef.current = null;
      }
    };
  }, [user?.id, config]);

  // Reconnect when user changes
  useEffect(() => {
    if (wsManagerRef.current && user?.id) {
      if (!wsManagerRef.current.isConnected()) {
        wsManagerRef.current.connect(user.id).catch((error) => {
          console.error('Failed to reconnect to WebSocket:', error);
        });
      }
    } else if (wsManagerRef.current && !user?.id) {
      wsManagerRef.current.disconnect();
    }
  }, [user?.id]);

  const subscribe = (channel: string, callback: (data: any) => void): (() => void) | null => {
    if (wsManagerRef.current) {
      return wsManagerRef.current.subscribe(channel, callback);
    }
    return null;
  };

  const sendMessage = (type: any, data: any): void => {
    if (wsManagerRef.current) {
      wsManagerRef.current.sendMessage(type, data);
    }
  };

  const contextValue: WebSocketContextType = {
    wsManager: wsManagerRef.current,
    connectionState,
    subscribe,
    sendMessage,
    isConnected
  };

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
  callback: (data: any) => void, 
  deps: React.DependencyList = []
): boolean {
  const { subscribe, isConnected } = useWebSocket();
  
  useEffect(() => {
    if (!channel) return;
    
    const unsubscribe = subscribe(channel, callback);
    
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [channel, subscribe, ...deps]);
  
  return isConnected;
}