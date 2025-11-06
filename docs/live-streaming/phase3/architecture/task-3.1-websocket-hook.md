# Task 3.1: useLiveStreamWebSocket Custom Hook

**Phase**: 3 - Real-time Features
**Type**: Architecture Specification
**Estimated Time**: 8 hours
**Dependencies**: WebSocket server deployed
**Status**: 📝 Not Started

---

## Goal

Create a comprehensive React hook for managing WebSocket connections to live streams with automatic reconnection, subscription management, and state synchronization.

## Architecture Pattern

**Pattern**: Custom React Hook with WebSocket Manager Integration
**Type**: Stateful connection management with subscription-based updates

## Component Structure

```typescript
interface UseLiveStreamWebSocketOptions {
  streamId?: string;
  enableMetrics?: boolean;
  enablePresence?: boolean;
  throttleMs?: number; // Default: 100ms
  reconnectStrategy?: 'exponential' | 'linear' | 'fixed';
}

interface UseLiveStreamWebSocketReturn {
  // Connection State
  isConnected: boolean;
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';

  // Stream Data
  status: StreamStatus;
  viewerCount: number;
  peakViewers: number;
  duration: number;

  // Presence
  viewers: ViewerInfo[];

  // Methods
  reconnect: () => Promise<void>;
  sendMessage: (type: string, data: any) => void;

  // Metrics
  metrics: ConnectionMetrics;
}

const useLiveStreamWebSocket = (
  streamId: string,
  options: UseLiveStreamWebSocketOptions = {}
): UseLiveStreamWebSocketReturn => {
  const {
    enableMetrics = true,
    enablePresence = false,
    throttleMs = 100,
    reconnectStrategy = 'exponential'
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<StreamStatus>('scheduled');
  const [viewerCount, setViewerCount] = useState(0);
  const [peakViewers, setPeakViewers] = useState(0);
  const [duration, setDuration] = useState(0);
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const [metrics, setMetrics] = useState<ConnectionMetrics>(initialMetrics);

  const { subscribe, send, connectionState } = useWebSocket();

  useEffect(() => {
    if (!streamId) return;

    // Subscribe to stream channel
    const unsubscribe = subscribe(`livestream:${streamId}`, (message) => {
      handleStreamMessage(message);
    });

    return () => unsubscribe();
  }, [streamId, subscribe]);

  const handleStreamMessage = throttle((message: WebSocketMessage) => {
    switch (message.type) {
      case 'stream_update':
        setStatus(message.data.status);
        break;
      case 'viewer_update':
        setViewerCount(message.data.count);
        setPeakViewers(prev => Math.max(prev, message.data.count));
        break;
      case 'presence_update':
        if (enablePresence) {
          setViewers(message.data.viewers);
        }
        break;
      case 'metrics_update':
        if (enableMetrics) {
          setMetrics(message.data);
        }
        break;
    }
  }, throttleMs);

  return {
    isConnected: connectionState === 'connected',
    connectionQuality: calculateQuality(metrics),
    status,
    viewerCount,
    peakViewers,
    duration,
    viewers,
    reconnect: async () => await reconnectWebSocket(),
    sendMessage: (type, data) => send({ type, data, streamId }),
    metrics
  };
};
```

## Data Flow

```
Hook Mount → Connect WebSocket → Subscribe to Channel
     ↓              ↓                    ↓
Message Arrives → Parse Type → Update Specific State
     ↓                                   ↓
Throttle Updates ← Batch Changes ← Trigger Re-render
```

See full specification in /home/meywd/AlUmmahNow/docs/live-streaming-phase-3-architecture.md section 1.

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
