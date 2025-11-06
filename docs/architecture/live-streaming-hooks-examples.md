# Live Streaming Hooks - Implementation Examples

## Data Fetching Hooks with React Query

### 1. useStreams Hook - Main Data Fetching

```typescript
// lib/hooks/useStreams.ts
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LiveStreamsAPI } from '@/lib/api/livestreams';
import { LiveStream } from '@/interfaces';
import { useAuth } from '@/components/AuthProvider/authContext';

export interface UseStreamsOptions {
  status?: 'scheduled' | 'live' | 'ended' | 'cancelled';
  channelId?: string;
  limit?: number;
  enabled?: boolean;
}

// Fetch streams with pagination
export function useStreams(options: UseStreamsOptions = {}) {
  return useInfiniteQuery({
    queryKey: ['streams', options],
    queryFn: async ({ pageParam }) => {
      const response = await LiveStreamsAPI.list({
        ...options,
        cursor: pageParam,
      });

      if (!response?.success) {
        throw new Error('Failed to fetch streams');
      }

      return response.result;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.cursor,
    staleTime: 30 * 1000, // 30 seconds
    enabled: options.enabled !== false,
  });
}

// Fetch live streams only
export function useLiveStreams(limit = 12) {
  return useQuery({
    queryKey: ['streams', 'live', limit],
    queryFn: () => LiveStreamsAPI.getLiveNow(limit),
    staleTime: 10 * 1000, // 10 seconds - refresh more frequently for live
    refetchInterval: 30 * 1000, // Auto-refresh every 30 seconds
  });
}

// Fetch scheduled streams
export function useScheduledStreams(limit = 12) {
  return useQuery({
    queryKey: ['streams', 'scheduled', limit],
    queryFn: () => LiveStreamsAPI.getScheduled(limit),
    staleTime: 60 * 1000, // 1 minute
  });
}

// Fetch streams by channel
export function useChannelStreams(channelId: string, status?: string) {
  return useQuery({
    queryKey: ['streams', 'channel', channelId, status],
    queryFn: () => LiveStreamsAPI.getByChannel(
      channelId,
      status as any,
      20
    ),
    enabled: !!channelId,
    staleTime: 30 * 1000,
  });
}

// Create stream mutation
export function useCreateStream() {
  const queryClient = useQueryClient();
  const { token } = useAuth();

  return useMutation({
    mutationFn: (data: Parameters<typeof LiveStreamsAPI.create>[0]) => {
      if (!token) throw new Error('Authentication required');
      return LiveStreamsAPI.create(data, token);
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['streams'] });
    },
  });
}

// Update stream mutation
export function useUpdateStream(streamId: string) {
  const queryClient = useQueryClient();
  const { token } = useAuth();

  return useMutation({
    mutationFn: (data: Parameters<typeof LiveStreamsAPI.update>[1]) => {
      if (!token) throw new Error('Authentication required');
      return LiveStreamsAPI.update(streamId, data, token);
    },
    onSuccess: (response) => {
      if (response?.success && response.result) {
        // Update cache with new data
        queryClient.setQueryData(
          ['stream', streamId],
          response.result.stream
        );
        queryClient.invalidateQueries({ queryKey: ['streams'] });
      }
    },
  });
}

// Go live mutation
export function useGoLive(streamId: string) {
  const queryClient = useQueryClient();
  const { token } = useAuth();

  return useMutation({
    mutationFn: () => {
      if (!token) throw new Error('Authentication required');
      return LiveStreamsAPI.goLive(streamId, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams'] });
      queryClient.invalidateQueries({ queryKey: ['stream', streamId] });
    },
  });
}

// End stream mutation
export function useEndStream(streamId: string) {
  const queryClient = useQueryClient();
  const { token } = useAuth();

  return useMutation({
    mutationFn: () => {
      if (!token) throw new Error('Authentication required');
      return LiveStreamsAPI.endStream(streamId, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams'] });
      queryClient.invalidateQueries({ queryKey: ['stream', streamId] });
    },
  });
}
```

### 2. WebSocket Management Hook

```typescript
// lib/hooks/useStreamWebSocket.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuth } from '@/components/AuthProvider/authContext';

export interface WebSocketMessage {
  type: string;
  channel: string;
  data: any;
}

export interface UseStreamWebSocketOptions {
  autoConnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://ws.alummahnow.net';

export function useStreamWebSocket(options: UseStreamWebSocketOptions = {}) {
  const {
    autoConnect = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const { token } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const subscriptionsRef = useRef<Map<string, Set<Function>>>(new Map());

  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'error'
  >('disconnected');

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      setConnectionStatus('connecting');

      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;

        // Send authentication if token available
        if (token) {
          ws.send(JSON.stringify({
            type: 'auth',
            token,
          }));
        }

        // Re-subscribe to all channels
        subscriptionsRef.current.forEach((_, channel) => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            channel,
          }));
        });
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          // Handle different message types
          if (message.type === 'error') {
            console.error('WebSocket error:', message.data);
            return;
          }

          // Notify subscribers for this channel
          const handlers = subscriptionsRef.current.get(message.channel);
          if (handlers) {
            handlers.forEach(handler => handler(message.data));
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('error');
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnectionStatus('disconnected');
        wsRef.current = null;

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectDelay * reconnectAttemptsRef.current);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      setConnectionStatus('error');
    }
  }, [token, reconnectDelay, maxReconnectAttempts]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus('disconnected');
  }, []);

  // Subscribe to a channel
  const subscribe = useCallback((channel: string, handler: Function) => {
    // Add handler to subscriptions
    if (!subscriptionsRef.current.has(channel)) {
      subscriptionsRef.current.set(channel, new Set());
    }
    subscriptionsRef.current.get(channel)!.add(handler);

    // Send subscribe message if connected
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'subscribe',
        channel,
      }));
    }
  }, []);

  // Unsubscribe from a channel
  const unsubscribe = useCallback((channel: string, handler: Function) => {
    const handlers = subscriptionsRef.current.get(channel);
    if (handlers) {
      handlers.delete(handler);

      // If no more handlers, unsubscribe from channel
      if (handlers.size === 0) {
        subscriptionsRef.current.delete(channel);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'unsubscribe',
            channel,
          }));
        }
      }
    }
  }, []);

  // Send a message
  const sendMessage = useCallback((channel: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        channel,
        data,
      }));
    } else {
      console.error('WebSocket not connected');
    }
  }, []);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    connectionStatus,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    sendMessage,
  };
}
```

### 3. Stream-Specific Hooks

```typescript
// lib/hooks/useStreamStatus.ts
import { useEffect, useState } from 'react';
import { useStreamWebSocket } from './useStreamWebSocket';

export function useStreamStatus(streamId: string) {
  const [status, setStatus] = useState<string>('scheduled');
  const { subscribe, unsubscribe } = useStreamWebSocket();

  useEffect(() => {
    const channel = `/live-streams/${streamId}/status`;

    const handleStatusUpdate = (data: { status: string }) => {
      setStatus(data.status);
    };

    subscribe(channel, handleStatusUpdate);

    return () => {
      unsubscribe(channel, handleStatusUpdate);
    };
  }, [streamId, subscribe, unsubscribe]);

  return status;
}

// lib/hooks/useViewerCount.ts
export function useViewerCount(streamId: string, initialCount = 0) {
  const [count, setCount] = useState(initialCount);
  const [peakCount, setPeakCount] = useState(initialCount);
  const { subscribe, unsubscribe } = useStreamWebSocket();

  useEffect(() => {
    const channel = `/live-streams/${streamId}/viewers`;

    const handleViewerUpdate = (data: { viewers: number }) => {
      setCount(data.viewers);
      setPeakCount(prev => Math.max(prev, data.viewers));
    };

    subscribe(channel, handleViewerUpdate);

    return () => {
      unsubscribe(channel, handleViewerUpdate);
    };
  }, [streamId, subscribe, unsubscribe]);

  return { current: count, peak: peakCount };
}

// lib/hooks/useStreamChat.ts
export function useStreamChat(streamId: string) {
  const [messages, setMessages] = useState<any[]>([]);
  const { subscribe, unsubscribe, sendMessage } = useStreamWebSocket();

  useEffect(() => {
    const channel = `/live-streams/${streamId}/chat`;

    const handleChatMessage = (message: any) => {
      setMessages(prev => [...prev, message]);
    };

    subscribe(channel, handleChatMessage);

    return () => {
      unsubscribe(channel, handleChatMessage);
    };
  }, [streamId, subscribe, unsubscribe]);

  const sendChatMessage = useCallback((text: string) => {
    sendMessage(`/live-streams/${streamId}/chat`, {
      text,
      timestamp: new Date().toISOString(),
    });
  }, [streamId, sendMessage]);

  return {
    messages,
    sendMessage: sendChatMessage,
  };
}
```

### 4. Form Management Hook

```typescript
// lib/hooks/useStreamForm.ts
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const streamFormSchema = z.object({
  title: z.string()
    .min(3, 'Title must be at least 3 characters')
    .max(100, 'Title must be less than 100 characters'),
  description: z.string()
    .max(5000, 'Description must be less than 5000 characters')
    .optional(),
  scheduledStartTime: z.string().datetime().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional(),
  isPrivate: z.boolean().default(false),
  allowChat: z.boolean().default(true),
  language: z.enum(['en', 'ar']).default('en'),
});

export type StreamFormData = z.infer<typeof streamFormSchema>;

export function useStreamForm(defaultValues?: Partial<StreamFormData>) {
  const form = useForm<StreamFormData>({
    resolver: zodResolver(streamFormSchema),
    defaultValues: {
      title: '',
      description: '',
      isPrivate: false,
      allowChat: true,
      language: 'en',
      ...defaultValues,
    },
  });

  const isScheduled = form.watch('scheduledStartTime');
  const isPrivate = form.watch('isPrivate');

  return {
    ...form,
    isScheduled: !!isScheduled,
    isPrivate,
  };
}
```

### 5. RTMP Configuration Hook

```typescript
// lib/hooks/useRTMPConfig.ts
import { useMemo } from 'react';
import { toast } from 'sonner';

export interface RTMPConfig {
  url: string;
  streamKey: string;
  fullUrl: string;
  obsSettings: {
    server: string;
    key: string;
  };
}

export function useRTMPConfig(rtmpUrl?: string, streamKey?: string): RTMPConfig | null {
  const config = useMemo(() => {
    if (!rtmpUrl || !streamKey) return null;

    return {
      url: rtmpUrl,
      streamKey,
      fullUrl: `${rtmpUrl}/${streamKey}`,
      obsSettings: {
        server: rtmpUrl,
        key: streamKey,
      },
    };
  }, [rtmpUrl, streamKey]);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch (error) {
      toast.error(`Failed to copy ${label}`);
    }
  }, []);

  const copyUrl = useCallback(() => {
    if (config) {
      copyToClipboard(config.url, 'RTMP URL');
    }
  }, [config, copyToClipboard]);

  const copyKey = useCallback(() => {
    if (config) {
      copyToClipboard(config.streamKey, 'Stream Key');
    }
  }, [config, copyToClipboard]);

  const downloadOBSConfig = useCallback(() => {
    if (!config) return;

    const obsConfig = {
      settings: {
        server: config.url,
        key: config.streamKey,
        use_auth: false,
      },
      service: 'Custom',
    };

    const blob = new Blob([JSON.stringify(obsConfig, null, 2)], {
      type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'obs-stream-config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('OBS configuration downloaded');
  }, [config]);

  return config ? {
    ...config,
    copyUrl,
    copyKey,
    downloadOBSConfig,
  } : null;
}
```

### 6. Stream Analytics Hook

```typescript
// lib/hooks/useStreamAnalytics.ts
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

export interface StreamAnalytics {
  viewerCount: number;
  peakViewers: number;
  avgWatchTime: number;
  chatMessages: number;
  likes: number;
  shares: number;
  timeline: Array<{
    time: string;
    viewers: number;
  }>;
}

export function useStreamAnalytics(streamId: string, isLive: boolean) {
  const [realtimeData, setRealtimeData] = useState<Partial<StreamAnalytics>>({});
  const { subscribe, unsubscribe } = useStreamWebSocket();

  // Fetch historical data
  const { data: historicalData } = useQuery({
    queryKey: ['stream-analytics', streamId],
    queryFn: async () => {
      // Fetch from analytics API
      const response = await fetch(`/api/analytics/streams/${streamId}`);
      return response.json();
    },
    staleTime: 60 * 1000, // 1 minute
    enabled: !isLive, // Only fetch for ended streams
  });

  // Subscribe to real-time updates if live
  useEffect(() => {
    if (!isLive) return;

    const channel = `/live-streams/${streamId}/analytics`;

    const handleAnalyticsUpdate = (data: Partial<StreamAnalytics>) => {
      setRealtimeData(prev => ({ ...prev, ...data }));
    };

    subscribe(channel, handleAnalyticsUpdate);

    return () => {
      unsubscribe(channel, handleAnalyticsUpdate);
    };
  }, [streamId, isLive, subscribe, unsubscribe]);

  return isLive ? realtimeData : historicalData;
}
```

## Usage Examples in Components

### Example: LiveStreamBrowser Component

```typescript
// components/live-streaming/LiveStreamBrowser/index.tsx
import React, { useState } from 'react';
import { useLiveStreams, useScheduledStreams } from '@/lib/hooks/useStreams';
import { LiveStreamGrid } from '../LiveStreamGrid';
import { StreamFilterTabs } from '../StreamFilterTabs';

export function LiveStreamBrowser({ locale }: { locale: 'en' | 'ar' }) {
  const [activeTab, setActiveTab] = useState<'live' | 'scheduled' | 'past'>('live');

  const { data: liveStreams, isLoading: liveLoading } = useLiveStreams();
  const { data: scheduledStreams, isLoading: scheduledLoading } = useScheduledStreams();

  const getStreamsForTab = () => {
    switch (activeTab) {
      case 'live':
        return { streams: liveStreams || [], loading: liveLoading };
      case 'scheduled':
        return { streams: scheduledStreams || [], loading: scheduledLoading };
      case 'past':
        // Would use useStreams with status='ended'
        return { streams: [], loading: false };
      default:
        return { streams: [], loading: false };
    }
  };

  const { streams, loading } = getStreamsForTab();

  return (
    <div className="space-y-6">
      <StreamFilterTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        locale={locale}
      />

      <LiveStreamGrid
        streams={streams}
        loading={loading}
        locale={locale}
      />
    </div>
  );
}
```

## Testing Examples

```typescript
// __tests__/hooks/useStreams.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStreams } from '@/lib/hooks/useStreams';

describe('useStreams', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('should fetch live streams', async () => {
    const { result } = renderHook(
      () => useStreams({ status: 'live' }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeDefined();
  });
});
```

## Performance Considerations

1. **Query Caching**: Use appropriate `staleTime` values
2. **WebSocket Throttling**: Debounce rapid updates
3. **Memoization**: Use `useMemo` for expensive computations
4. **Cleanup**: Always unsubscribe from WebSocket channels
5. **Error Boundaries**: Wrap components with error boundaries
6. **Suspense**: Consider using React Suspense for data fetching

## Best Practices

1. **Type Safety**: Always define TypeScript interfaces
2. **Error Handling**: Handle all error cases gracefully
3. **Loading States**: Provide clear loading indicators
4. **Optimistic Updates**: Update UI before API confirmation
5. **Retry Logic**: Implement exponential backoff
6. **Connection Status**: Show WebSocket connection state
7. **Accessibility**: Announce real-time updates to screen readers
8. **Testing**: Test all hooks in isolation