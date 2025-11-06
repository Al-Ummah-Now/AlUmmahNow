# Live Streaming Phase 3: Implementation Guide

## Quick Reference Implementation Checklist

### Task 1: useLiveStreamWebSocket Hook
```typescript
// apps/web/src/hooks/useLiveStreamWebSocket.ts
import { useEffect, useCallback, useRef, useState } from 'react';
import { useWebSocket } from '@/lib/websocket/WebSocketProvider';
import { throttle } from '@/lib/utils/performance';

export function useLiveStreamWebSocket(streamId?: string, options = {}) {
  const { subscribe, sendMessage, isConnected } = useWebSocket();
  const [streamState, setStreamState] = useState({
    status: null,
    viewerCount: 0,
    peakViewers: 0,
    duration: 0,
    health: null
  });

  const throttledUpdate = useCallback(
    throttle((updates) => setStreamState(prev => ({ ...prev, ...updates })), 100),
    []
  );

  useEffect(() => {
    if (!streamId || !isConnected) return;

    const channel = `livestream:${streamId}`;
    const unsubscribe = subscribe(channel, (data) => {
      throttledUpdate(data);
    });

    return () => unsubscribe?.();
  }, [streamId, isConnected, subscribe, throttledUpdate]);

  return { ...streamState, isConnected };
}
```

### Task 2: WebSocket Connection with Auto-reconnect
```typescript
// apps/web/src/lib/websocket/AutoReconnectManager.ts
export class AutoReconnectManager {
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(
    private wsManager: WebSocketManager,
    private maxAttempts = 5,
    private baseDelay = 1000
  ) {}

  async handleDisconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );

    this.reconnectAttempts++;
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.wsManager.connect();
        this.reconnectAttempts = 0;
      } catch (error) {
        this.handleDisconnect();
      }
    }, delay);
  }

  reset(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
  }
}
```

### Task 3: Channel Subscription for Live Stream Updates
```typescript
// apps/web/src/lib/websocket/ChannelSubscriptionManager.ts
export class ChannelSubscriptionManager {
  private subscriptions = new Map<string, Set<(data: any) => void>>();
  private activeChannels = new Set<string>();

  subscribe(
    channel: string,
    callback: (data: any) => void,
    wsManager: WebSocketManager
  ): () => void {
    // Initialize channel subscription set if not exists
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());

      // Send subscription message to server
      if (!this.activeChannels.has(channel)) {
        wsManager.sendMessage('subscribe', { channel });
        this.activeChannels.add(channel);
      }
    }

    // Add callback to channel
    const callbacks = this.subscriptions.get(channel)!;
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      callbacks.delete(callback);

      // If no more subscribers, unsubscribe from channel
      if (callbacks.size === 0) {
        this.subscriptions.delete(channel);
        this.activeChannels.delete(channel);
        wsManager.sendMessage('unsubscribe', { channel });
      }
    };
  }

  handleMessage(channel: string, data: any): void {
    const callbacks = this.subscriptions.get(channel);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in channel callback:', error);
        }
      });
    }
  }
}
```

### Task 4: Real-time Viewer Count Updates with Animations
```typescript
// apps/web/src/components/live-streaming/AnimatedViewerCount.tsx
import React, { useEffect, useState } from 'react';
import { animated, useSpring } from '@react-spring/web';
import { Eye, TrendingUp, TrendingDown } from 'lucide-react';
import { useLiveStreamWebSocket } from '@/hooks/useLiveStreamWebSocket';

interface AnimatedViewerCountProps {
  streamId: string;
  initialCount?: number;
}

export function AnimatedViewerCount({
  streamId,
  initialCount = 0
}: AnimatedViewerCountProps) {
  const { viewerCount, isConnected } = useLiveStreamWebSocket(streamId);
  const [trend, setTrend] = useState<'up' | 'down' | 'stable'>('stable');
  const previousCount = useRef(initialCount);

  // Spring animation for smooth number transitions
  const { number } = useSpring({
    from: { number: previousCount.current },
    to: { number: viewerCount || initialCount },
    config: { tension: 300, friction: 30 }
  });

  // Pulsing animation for live indicator
  const pulseStyle = useSpring({
    from: { scale: 1, opacity: 0.8 },
    to: { scale: 1.1, opacity: 1 },
    loop: true,
    reverse: true,
    config: { duration: 1500 }
  });

  // Update trend indicator
  useEffect(() => {
    const diff = viewerCount - previousCount.current;
    if (diff > 10) setTrend('up');
    else if (diff < -10) setTrend('down');
    else setTrend('stable');

    previousCount.current = viewerCount;
  }, [viewerCount]);

  const formatCount = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  return (
    <div className="flex items-center gap-2">
      <animated.div style={pulseStyle} className="relative">
        <Eye className="w-4 h-4 text-red-500" />
      </animated.div>

      <animated.span className="font-semibold tabular-nums">
        {number.to(n => formatCount(Math.floor(n)))}
      </animated.span>

      {trend !== 'stable' && (
        <div className="animate-bounce-once">
          {trend === 'up' ? (
            <TrendingUp className="w-4 h-4 text-green-500" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-500" />
          )}
        </div>
      )}

      {!isConnected && (
        <div className="w-2 h-2 rounded-full bg-yellow-500"
             title="Updating..." />
      )}
    </div>
  );
}
```

### Task 5: Real-time Status Change Notifications
```typescript
// apps/web/src/lib/notifications/StreamStatusNotifier.ts
import { toast } from '@/components/ui/toast';

interface StatusNotification {
  streamId: string;
  oldStatus: string;
  newStatus: string;
  title?: string;
  message?: string;
}

export class StreamStatusNotifier {
  private notificationQueue: StatusNotification[] = [];
  private isProcessing = false;

  constructor(private maxConcurrent = 3) {}

  notify(notification: StatusNotification): void {
    // Priority for critical status changes
    const priority = this.getPriority(notification.newStatus);

    if (priority === 'critical') {
      this.showNotification(notification);
    } else {
      this.notificationQueue.push(notification);
      this.processQueue();
    }
  }

  private getPriority(status: string): 'critical' | 'high' | 'normal' {
    switch (status) {
      case 'live': return 'critical';
      case 'ended': return 'high';
      default: return 'normal';
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.notificationQueue.length === 0) return;

    this.isProcessing = true;

    while (this.notificationQueue.length > 0) {
      const batch = this.notificationQueue.splice(0, this.maxConcurrent);

      await Promise.all(
        batch.map(notification => this.showNotification(notification))
      );

      await this.delay(500); // Brief delay between batches
    }

    this.isProcessing = false;
  }

  private showNotification(notification: StatusNotification): void {
    const { newStatus, title, message } = notification;

    const defaultMessages = {
      live: { title: '🔴 Stream Started', message: 'The stream is now live!' },
      ended: { title: 'Stream Ended', message: 'Thanks for watching!' },
      scheduled: { title: 'Stream Scheduled', message: 'Get notified when it starts' }
    };

    const config = defaultMessages[newStatus] || {};

    toast({
      title: title || config.title,
      message: message || config.message,
      duration: 5000,
      variant: newStatus === 'live' ? 'success' : 'default'
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// React hook for notifications
export function useStreamStatusNotifications() {
  const notifierRef = useRef(new StreamStatusNotifier());

  const notifyStatusChange = useCallback((
    streamId: string,
    oldStatus: string,
    newStatus: string
  ) => {
    notifierRef.current.notify({
      streamId,
      oldStatus,
      newStatus
    });
  }, []);

  return { notifyStatusChange };
}
```

### Task 6: Presence Tracking (Who's Watching)
```typescript
// apps/web/src/lib/presence/PresenceTracker.ts
interface ViewerInfo {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  joinedAt: number;
  lastSeen: number;
}

export class PresenceTracker {
  private viewers = new Map<string, ViewerInfo>();
  private heartbeatTimer?: NodeJS.Timeout;
  private streamId?: string;

  constructor(
    private wsManager: WebSocketManager,
    private heartbeatInterval = 30000
  ) {}

  async join(streamId: string, userInfo: Partial<ViewerInfo>): Promise<void> {
    this.streamId = streamId;

    // Send join message
    this.wsManager.sendMessage('presence_update', {
      type: 'join',
      streamId,
      userInfo
    });

    // Start heartbeat
    this.startHeartbeat();
  }

  async leave(): Promise<void> {
    if (!this.streamId) return;

    // Send leave message
    this.wsManager.sendMessage('presence_update', {
      type: 'leave',
      streamId: this.streamId
    });

    this.stopHeartbeat();
    this.viewers.clear();
    this.streamId = undefined;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.streamId) {
        this.wsManager.sendMessage('presence_update', {
          type: 'heartbeat',
          streamId: this.streamId,
          timestamp: Date.now()
        });
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  updateViewers(viewers: ViewerInfo[]): void {
    this.viewers.clear();
    viewers.forEach(viewer => {
      this.viewers.set(viewer.userId, viewer);
    });

    // Remove stale viewers (not seen in 60 seconds)
    const staleThreshold = Date.now() - 60000;
    this.viewers.forEach((viewer, userId) => {
      if (viewer.lastSeen < staleThreshold) {
        this.viewers.delete(userId);
      }
    });
  }

  getViewers(): ViewerInfo[] {
    return Array.from(this.viewers.values())
      .sort((a, b) => b.joinedAt - a.joinedAt);
  }

  getViewerCount(): number {
    return this.viewers.size;
  }
}

// React hook for presence
export function usePresence(streamId?: string) {
  const { wsManager, isConnected } = useWebSocket();
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const trackerRef = useRef<PresenceTracker>();

  useEffect(() => {
    if (!streamId || !isConnected || !wsManager) return;

    trackerRef.current = new PresenceTracker(wsManager);

    // Join stream
    trackerRef.current.join(streamId, {
      userId: getCurrentUserId(),
      displayName: getCurrentUserName()
    });

    // Subscribe to presence updates
    const unsubscribe = wsManager.subscribe(
      `livestream:${streamId}:presence`,
      (data) => {
        if (data.viewers) {
          trackerRef.current?.updateViewers(data.viewers);
          setViewers(trackerRef.current?.getViewers() || []);
        }
      }
    );

    return () => {
      trackerRef.current?.leave();
      unsubscribe?.();
    };
  }, [streamId, isConnected, wsManager]);

  return {
    viewers,
    viewerCount: viewers.length,
    isTracking: isConnected
  };
}
```

### Task 7: Optimistic Updates for Better UX
```typescript
// apps/web/src/lib/optimistic/OptimisticStateManager.ts
export class OptimisticStateManager<T> {
  private optimisticUpdates = new Map<string, {
    original: T,
    optimistic: T,
    timestamp: number
  }>();

  applyOptimistic(
    id: string,
    currentState: T,
    optimisticState: T,
    timeout = 5000
  ): void {
    // Store original state for rollback
    this.optimisticUpdates.set(id, {
      original: currentState,
      optimistic: optimisticState,
      timestamp: Date.now()
    });

    // Auto-rollback after timeout
    setTimeout(() => {
      if (this.optimisticUpdates.has(id)) {
        this.rollback(id);
      }
    }, timeout);
  }

  confirm(id: string): void {
    this.optimisticUpdates.delete(id);
  }

  rollback(id: string): T | null {
    const update = this.optimisticUpdates.get(id);
    if (update) {
      this.optimisticUpdates.delete(id);
      return update.original;
    }
    return null;
  }

  getOptimisticState(id: string): T | null {
    return this.optimisticUpdates.get(id)?.optimistic || null;
  }
}

// React hook for optimistic updates
export function useOptimisticUpdate<T>(
  initialState: T
): [T, (optimistic: T) => void, () => void, (error?: Error) => void] {
  const [state, setState] = useState(initialState);
  const [updateId] = useState(() => crypto.randomUUID());
  const managerRef = useRef(new OptimisticStateManager<T>());

  const applyOptimistic = useCallback((optimisticState: T) => {
    managerRef.current.applyOptimistic(
      updateId,
      state,
      optimisticState
    );
    setState(optimisticState);
  }, [state, updateId]);

  const confirm = useCallback(() => {
    managerRef.current.confirm(updateId);
  }, [updateId]);

  const rollback = useCallback((error?: Error) => {
    const originalState = managerRef.current.rollback(updateId);
    if (originalState !== null) {
      setState(originalState);
    }
    if (error) {
      console.error('Optimistic update failed:', error);
    }
  }, [updateId]);

  return [state, applyOptimistic, confirm, rollback];
}
```

### Task 8: Message Throttling (Max 100/min)
```typescript
// apps/web/src/lib/throttle/MessageThrottler.ts
export class MessageThrottler {
  private tokens: number;
  private lastRefill: number;
  private messageQueue: Array<{
    message: any;
    priority: 'high' | 'normal' | 'low';
    callback?: (sent: boolean) => void;
  }> = [];

  constructor(
    private maxTokens = 100,
    private refillRate = 100 / 60000 // tokens per ms
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  canSend(): boolean {
    this.refillTokens();
    return this.tokens >= 1;
  }

  send(
    message: any,
    priority: 'high' | 'normal' | 'low' = 'normal',
    wsManager: WebSocketManager
  ): boolean {
    this.refillTokens();

    // High priority messages bypass throttling (use sparingly)
    if (priority === 'high' && this.tokens >= 0.5) {
      this.tokens -= 0.5;
      wsManager.sendMessage(message.type, message.data);
      return true;
    }

    // Check token availability
    if (this.tokens >= 1) {
      this.tokens--;
      wsManager.sendMessage(message.type, message.data);
      this.processQueue(wsManager);
      return true;
    }

    // Queue the message
    this.messageQueue.push({ message, priority });
    this.sortQueue();

    // Drop oldest low-priority messages if queue is too large
    if (this.messageQueue.length > 50) {
      const lowPriorityIndex = this.messageQueue.findIndex(
        m => m.priority === 'low'
      );
      if (lowPriorityIndex !== -1) {
        this.messageQueue.splice(lowPriorityIndex, 1);
      }
    }

    return false;
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  private processQueue(wsManager: WebSocketManager): void {
    this.refillTokens();

    while (this.messageQueue.length > 0 && this.tokens >= 1) {
      const item = this.messageQueue.shift();
      if (item) {
        this.tokens--;
        wsManager.sendMessage(item.message.type, item.message.data);
        item.callback?.(true);
      }
    }
  }

  private sortQueue(): void {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    this.messageQueue.sort((a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority]
    );
  }

  getQueueSize(): number {
    return this.messageQueue.length;
  }

  getRemainingTokens(): number {
    this.refillTokens();
    return Math.floor(this.tokens);
  }
}
```

### Task 9: Virtual Scrolling for Large Stream Lists
```typescript
// apps/web/src/components/VirtualStreamList.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualStreamListProps {
  streams: any[];
  itemHeight?: number;
  overscan?: number;
}

export function VirtualStreamList({
  streams,
  itemHeight = 280,
  overscan = 3
}: VirtualStreamListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: streams.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => itemHeight, [itemHeight]),
    overscan,
    // Enable smooth scrolling
    scrollingDelay: 150,
    // Measure items for dynamic heights
    measureElement: typeof itemHeight === 'function'
      ? (element) => element?.getBoundingClientRect().height ?? itemHeight
      : undefined
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      style={{
        contain: 'strict'
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative'
        }}
      >
        {virtualItems.map((virtualItem) => {
          const stream = streams[virtualItem.index];

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`
              }}
            >
              <StreamCard stream={stream} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Optimized stream card for virtual scrolling
const StreamCard = React.memo(({ stream }) => {
  return (
    <div className="p-4 border rounded-lg">
      <h3>{stream.title}</h3>
      <p>{stream.description}</p>
      {/* Card content */}
    </div>
  );
}, (prev, next) => prev.stream.id === next.stream.id);
```

### Task 10: Lazy Loading for Off-screen Cards
```typescript
// apps/web/src/components/LazyStreamCard.tsx
import React, { useRef, useState, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';

interface LazyStreamCardProps {
  stream: any;
  placeholder?: React.ReactNode;
  rootMargin?: string;
}

export function LazyStreamCard({
  stream,
  placeholder,
  rootMargin = '50px'
}: LazyStreamCardProps) {
  const { ref, inView, entry } = useInView({
    threshold: 0.1,
    rootMargin,
    triggerOnce: false
  });

  const [isLoaded, setIsLoaded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    if (inView && !isLoaded) {
      // Delay slightly to prevent thrashing
      const timer = setTimeout(() => setIsLoaded(true), 100);
      return () => clearTimeout(timer);
    }
  }, [inView, isLoaded]);

  // Unload when far off-screen to save memory
  useEffect(() => {
    if (!inView && entry && entry.boundingClientRect.top > window.innerHeight * 2) {
      const timer = setTimeout(() => {
        setIsLoaded(false);
        setImageLoaded(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [inView, entry]);

  if (!isLoaded) {
    return (
      <div ref={ref} className="h-64 bg-gray-200 animate-pulse rounded-lg">
        {placeholder || <div className="p-4">Loading...</div>}
      </div>
    );
  }

  return (
    <div ref={ref} className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="relative aspect-video">
        {!imageLoaded && (
          <div className="absolute inset-0 bg-gray-200 animate-pulse" />
        )}
        <img
          src={stream.thumbnail}
          alt={stream.title}
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {stream.isLive && (
          <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded text-sm">
            LIVE
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold line-clamp-2">{stream.title}</h3>
        <p className="text-sm text-gray-600 mt-1">{stream.channelName}</p>
        {stream.viewerCount !== undefined && (
          <p className="text-sm text-gray-500 mt-1">
            {stream.viewerCount.toLocaleString()} viewers
          </p>
        )}
      </div>
    </div>
  );
}

// Batch lazy loading for better performance
export function LazyStreamGrid({ streams }: { streams: any[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {streams.map(stream => (
        <LazyStreamCard
          key={stream.id}
          stream={stream}
          rootMargin="100px" // Start loading 100px before visible
        />
      ))}
    </div>
  );
}
```

### Task 11: Connection Status Indicator
```typescript
// apps/web/src/components/ConnectionStatusIndicator.tsx
import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, AlertCircle, CheckCircle } from 'lucide-react';
import { useWebSocket } from '@/lib/websocket/WebSocketProvider';
import { cn } from '@/lib/utils';

interface ConnectionStatusIndicatorProps {
  showDetails?: boolean;
  className?: string;
}

export function ConnectionStatusIndicator({
  showDetails = false,
  className
}: ConnectionStatusIndicatorProps) {
  const { connectionState, isConnected } = useWebSocket();
  const [latency, setLatency] = useState<number | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  // Measure latency with ping/pong
  useEffect(() => {
    if (!isConnected) {
      setLatency(null);
      return;
    }

    const measureLatency = () => {
      const start = Date.now();

      // Send ping and wait for pong
      sendMessage('ping', { timestamp: start });

      const timeout = setTimeout(() => {
        setLatency(null); // Timeout, no response
      }, 5000);

      const handlePong = (data: any) => {
        clearTimeout(timeout);
        const roundTrip = Date.now() - data.timestamp;
        setLatency(roundTrip);
      };

      // Subscribe to pong messages
      const unsubscribe = subscribe('pong', handlePong);

      return () => {
        clearTimeout(timeout);
        unsubscribe?.();
      };
    };

    const interval = setInterval(measureLatency, 30000);
    measureLatency(); // Initial measurement

    return () => clearInterval(interval);
  }, [isConnected]);

  const getStatusConfig = () => {
    switch (connectionState.status) {
      case 'connected':
        return {
          icon: CheckCircle,
          color: 'text-green-500',
          bgColor: 'bg-green-500',
          label: 'Connected',
          description: latency ? `${latency}ms` : 'Healthy'
        };
      case 'connecting':
        return {
          icon: Wifi,
          color: 'text-blue-500',
          bgColor: 'bg-blue-500',
          label: 'Connecting',
          description: 'Establishing connection...'
        };
      case 'disconnected':
        return {
          icon: WifiOff,
          color: 'text-gray-500',
          bgColor: 'bg-gray-500',
          label: 'Disconnected',
          description: 'No connection'
        };
      case 'error':
        return {
          icon: AlertCircle,
          color: 'text-red-500',
          bgColor: 'bg-red-500',
          label: 'Error',
          description: `Reconnecting (${connectionState.reconnectAttempts}/${connectionState.maxReconnectAttempts})`
        };
      default:
        return {
          icon: Wifi,
          color: 'text-gray-400',
          bgColor: 'bg-gray-400',
          label: 'Unknown',
          description: 'Status unknown'
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  const getLatencyQuality = () => {
    if (!latency) return 'unknown';
    if (latency < 50) return 'excellent';
    if (latency < 100) return 'good';
    if (latency < 200) return 'fair';
    return 'poor';
  };

  return (
    <div
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Status icon */}
      <div className="relative">
        <Icon className={cn('w-5 h-5 transition-colors', config.color)} />

        {/* Animated pulse for live connection */}
        {connectionState.status === 'connected' && (
          <span className={cn(
            'absolute top-0 right-0 -mt-1 -mr-1 flex h-3 w-3',
          )}>
            <span className={cn(
              'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
              config.bgColor
            )} />
            <span className={cn(
              'relative inline-flex rounded-full h-3 w-3',
              config.bgColor
            )} />
          </span>
        )}
      </div>

      {/* Details (if enabled) */}
      {showDetails && (
        <div className="ml-2 text-sm">
          <div className={cn('font-medium', config.color)}>
            {config.label}
          </div>
          {latency !== null && (
            <div className="text-xs text-gray-500">
              {latency}ms • {getLatencyQuality()}
            </div>
          )}
        </div>
      )}

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 z-50">
          <div className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 whitespace-nowrap">
            <div className="font-semibold">{config.label}</div>
            <div className="opacity-90">{config.description}</div>
            {latency !== null && (
              <div className="opacity-90 mt-1">
                Latency: {latency}ms ({getLatencyQuality()})
              </div>
            )}
            {connectionState.status === 'error' && (
              <div className="opacity-90 mt-1">
                Attempt {connectionState.reconnectAttempts} of {connectionState.maxReconnectAttempts}
              </div>
            )}
            <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
              <div className="border-4 border-transparent border-t-gray-900" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Task 12: WebSocket Reconnection Testing
```typescript
// apps/web/src/lib/testing/WebSocketReconnectionTest.ts
import { WebSocketManager } from '@/lib/websocket/WebSocketManager';

export class WebSocketReconnectionTester {
  private testResults: Map<string, TestResult> = new Map();

  async runAllTests(wsManager: WebSocketManager): Promise<TestReport> {
    const scenarios = [
      this.testNormalDisconnect,
      this.testNetworkLoss,
      this.testServerRestart,
      this.testAuthExpiry,
      this.testRateLimiting,
      this.testRapidReconnects
    ];

    for (const scenario of scenarios) {
      await scenario.call(this, wsManager);
    }

    return this.generateReport();
  }

  async testNormalDisconnect(wsManager: WebSocketManager): Promise<void> {
    const testName = 'Normal Disconnect';
    const startTime = Date.now();

    try {
      // Disconnect normally
      wsManager.disconnect();
      await this.delay(100);

      // Attempt reconnect
      const reconnectStart = Date.now();
      await wsManager.connect();
      const reconnectTime = Date.now() - reconnectStart;

      this.testResults.set(testName, {
        passed: true,
        duration: Date.now() - startTime,
        reconnectTime,
        message: `Reconnected in ${reconnectTime}ms`
      });
    } catch (error) {
      this.testResults.set(testName, {
        passed: false,
        duration: Date.now() - startTime,
        error: error.message
      });
    }
  }

  async testNetworkLoss(wsManager: WebSocketManager): Promise<void> {
    const testName = 'Network Loss Simulation';
    const startTime = Date.now();

    try {
      // Simulate network loss by forcibly closing WebSocket
      if (wsManager['ws']) {
        wsManager['ws'].close(1006); // Abnormal closure
      }

      // Wait for auto-reconnect
      const maxWait = 10000;
      const checkInterval = 100;
      let waited = 0;

      while (!wsManager.isConnected() && waited < maxWait) {
        await this.delay(checkInterval);
        waited += checkInterval;
      }

      this.testResults.set(testName, {
        passed: wsManager.isConnected(),
        duration: Date.now() - startTime,
        reconnectTime: waited,
        message: `Auto-reconnected after ${waited}ms`
      });
    } catch (error) {
      this.testResults.set(testName, {
        passed: false,
        duration: Date.now() - startTime,
        error: error.message
      });
    }
  }

  async testRateLimiting(wsManager: WebSocketManager): Promise<void> {
    const testName = 'Rate Limiting Recovery';
    const startTime = Date.now();

    try {
      // Send many messages to trigger rate limiting
      for (let i = 0; i < 150; i++) {
        wsManager.sendMessage('test', { index: i });
      }

      // Wait for throttling to kick in
      await this.delay(1000);

      // Check if connection is still healthy
      const isHealthy = wsManager.isConnected();

      this.testResults.set(testName, {
        passed: isHealthy,
        duration: Date.now() - startTime,
        message: 'Handled rate limiting gracefully'
      });
    } catch (error) {
      this.testResults.set(testName, {
        passed: false,
        duration: Date.now() - startTime,
        error: error.message
      });
    }
  }

  async testRapidReconnects(wsManager: WebSocketManager): Promise<void> {
    const testName = 'Rapid Reconnect Prevention';
    const startTime = Date.now();
    const reconnectDelays: number[] = [];

    try {
      // Trigger multiple disconnects rapidly
      for (let i = 0; i < 3; i++) {
        wsManager.disconnect();
        const reconnectStart = Date.now();
        await wsManager.connect();
        reconnectDelays.push(Date.now() - reconnectStart);
        await this.delay(100);
      }

      // Check if delays are increasing (exponential backoff)
      const isBackoffWorking = reconnectDelays[1] > reconnectDelays[0] ||
                               reconnectDelays[2] > reconnectDelays[1];

      this.testResults.set(testName, {
        passed: isBackoffWorking,
        duration: Date.now() - startTime,
        message: `Backoff delays: ${reconnectDelays.join(', ')}ms`
      });
    } catch (error) {
      this.testResults.set(testName, {
        passed: false,
        duration: Date.now() - startTime,
        error: error.message
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateReport(): TestReport {
    const results = Array.from(this.testResults.entries());
    const passed = results.filter(([_, r]) => r.passed).length;
    const failed = results.filter(([_, r]) => !r.passed).length;

    return {
      totalTests: results.length,
      passed,
      failed,
      successRate: (passed / results.length) * 100,
      results: Object.fromEntries(this.testResults),
      timestamp: Date.now()
    };
  }
}

interface TestResult {
  passed: boolean;
  duration: number;
  reconnectTime?: number;
  message?: string;
  error?: string;
}

interface TestReport {
  totalTests: number;
  passed: number;
  failed: number;
  successRate: number;
  results: Record<string, TestResult>;
  timestamp: number;
}

// React component for test UI
export function ReconnectionTestPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<TestReport | null>(null);
  const { wsManager } = useWebSocket();

  const runTests = async () => {
    setIsRunning(true);
    const tester = new WebSocketReconnectionTester();
    const testReport = await tester.runAllTests(wsManager);
    setReport(testReport);
    setIsRunning(false);
  };

  return (
    <div className="p-4 border rounded-lg">
      <h3 className="text-lg font-semibold mb-4">WebSocket Reconnection Tests</h3>

      <button
        onClick={runTests}
        disabled={isRunning}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {isRunning ? 'Running Tests...' : 'Run Tests'}
      </button>

      {report && (
        <div className="mt-4">
          <div className="mb-2">
            Success Rate: {report.successRate.toFixed(1)}%
            ({report.passed}/{report.totalTests} passed)
          </div>

          <div className="space-y-2">
            {Object.entries(report.results).map(([name, result]) => (
              <div
                key={name}
                className={`p-2 rounded ${
                  result.passed ? 'bg-green-100' : 'bg-red-100'
                }`}
              >
                <div className="font-medium">{name}</div>
                <div className="text-sm text-gray-600">
                  {result.message || result.error}
                  {result.reconnectTime && ` (${result.reconnectTime}ms)`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

## Testing Strategy Implementation

### Integration Test Suite
```typescript
// apps/web/src/__tests__/websocket-integration.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { WebSocketProvider } from '@/lib/websocket/WebSocketProvider';
import { useLiveStreamWebSocket } from '@/hooks/useLiveStreamWebSocket';
import { MockWebSocket } from '@/lib/testing/MockWebSocket';

describe('WebSocket Integration Tests', () => {
  let mockWs: MockWebSocket;

  beforeEach(() => {
    // Replace global WebSocket with mock
    global.WebSocket = MockWebSocket as any;
    mockWs = new MockWebSocket('ws://localhost:3087');
  });

  afterEach(() => {
    mockWs.close();
  });

  test('should connect and receive stream updates', async () => {
    const { result } = renderHook(
      () => useLiveStreamWebSocket('test-stream'),
      { wrapper: WebSocketProvider }
    );

    // Wait for connection
    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    // Simulate stream update
    act(() => {
      mockWs.simulateMessage({
        type: 'stream_update',
        data: {
          streamId: 'test-stream',
          viewerCount: 100,
          status: 'live'
        }
      });
    });

    // Verify update received
    await waitFor(() => {
      expect(result.current.viewerCount).toBe(100);
      expect(result.current.status).toBe('live');
    });
  });

  test('should handle reconnection on disconnect', async () => {
    const { result } = renderHook(
      () => useLiveStreamWebSocket('test-stream'),
      { wrapper: WebSocketProvider }
    );

    // Initial connection
    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    // Simulate disconnect
    act(() => {
      mockWs.simulateDisconnect();
    });

    // Verify disconnected state
    expect(result.current.isConnected).toBe(false);

    // Wait for reconnection
    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    }, { timeout: 5000 });
  });
});
```

## Performance Monitoring Implementation

```typescript
// apps/web/src/lib/monitoring/WebSocketMetrics.ts
export class WebSocketMetrics {
  private metrics = {
    messagesReceived: 0,
    messagesSent: 0,
    bytesReceived: 0,
    bytesSent: 0,
    reconnections: 0,
    errors: 0,
    latencyHistory: [] as number[]
  };

  trackMessage(direction: 'sent' | 'received', size: number): void {
    if (direction === 'sent') {
      this.metrics.messagesSent++;
      this.metrics.bytesSent += size;
    } else {
      this.metrics.messagesReceived++;
      this.metrics.bytesReceived += size;
    }
  }

  trackLatency(ms: number): void {
    this.metrics.latencyHistory.push(ms);
    // Keep only last 100 measurements
    if (this.metrics.latencyHistory.length > 100) {
      this.metrics.latencyHistory.shift();
    }
  }

  getAverageLatency(): number {
    if (this.metrics.latencyHistory.length === 0) return 0;
    const sum = this.metrics.latencyHistory.reduce((a, b) => a + b, 0);
    return sum / this.metrics.latencyHistory.length;
  }

  getMetrics() {
    return {
      ...this.metrics,
      averageLatency: this.getAverageLatency(),
      messagesPerSecond: this.calculateRate('messages'),
      bytesPerSecond: this.calculateRate('bytes')
    };
  }

  private calculateRate(type: 'messages' | 'bytes'): number {
    // Implementation for rate calculation
    return 0;
  }
}
```

## Deployment Configuration

```yaml
# .github/workflows/websocket-deploy.yml
name: Deploy WebSocket Features

on:
  push:
    branches: [main]
    paths:
      - 'apps/web/src/lib/websocket/**'
      - 'apps/web/src/hooks/useLiveStreamWebSocket.ts'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test:websocket

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy --env production
```

This implementation guide provides production-ready code for all 12 Phase 3 tasks with proper error handling, performance optimization, and type safety.