---
name: "[Phase 3.4] Real-Time Metrics via WebSocket"
about: Integrate WebSocket for real-time viewer metrics
title: "[Phase 3.4] Integrate Real-Time Metrics via WebSocket"
labels: phase-3, video-player, enhancement, realtime
assignees: ''
---

## Overview
Integrate with existing WebSocket server to display real-time viewer counts, live reactions, and concurrent watching metrics.

## Acceptance Criteria
- [ ] WebSocket connection to existing server
- [ ] Real-time viewer count display
- [ ] Live view updates (viewers join/leave)
- [ ] Heartbeat to report active viewing
- [ ] Reconnection logic on disconnect
- [ ] Graceful degradation if WebSocket unavailable
- [ ] No blocking of video playback
- [ ] Efficient message batching
- [ ] Viewer count displayed in player UI
- [ ] Mobile and desktop support

## Implementation

```typescript
// apps/web/src/hooks/useVideoWebSocket.ts
import { useEffect, useRef, useState } from 'react';

interface VideoWebSocketOptions {
  videoId: string;
  userId?: string;
  onViewerCountUpdate?: (count: number) => void;
  onMessage?: (message: any) => void;
}

export function useVideoWebSocket({
  videoId,
  userId,
  onViewerCountUpdate,
  onMessage
}: VideoWebSocketOptions) {
  const [viewerCount, setViewerCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    connectWebSocket();

    return () => {
      cleanup();
    };
  }, [videoId, userId]);

  const connectWebSocket = () => {
    const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
    if (!wsUrl) return;

    try {
      const ws = new WebSocket(`${wsUrl}/video/${videoId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[VideoWS] Connected');
        setIsConnected(true);

        // Send join message
        ws.send(JSON.stringify({
          type: 'video_join',
          videoId,
          userId,
          timestamp: new Date().toISOString()
        }));

        // Start heartbeat
        startHeartbeat();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error('[VideoWS] Failed to parse message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[VideoWS] Error:', error);
      };

      ws.onclose = () => {
        console.log('[VideoWS] Disconnected');
        setIsConnected(false);
        stopHeartbeat();

        // Attempt reconnection after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 5000);
      };
    } catch (error) {
      console.error('[VideoWS] Connection failed:', error);
    }
  };

  const handleMessage = (message: any) => {
    switch (message.type) {
      case 'viewer_count_update':
        setViewerCount(message.count);
        onViewerCountUpdate?.(message.count);
        break;
      case 'viewer_joined':
        setViewerCount(prev => prev + 1);
        break;
      case 'viewer_left':
        setViewerCount(prev => Math.max(0, prev - 1));
        break;
      default:
        onMessage?.(message);
    }
  };

  const startHeartbeat = () => {
    heartbeatRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'heartbeat',
          videoId,
          userId,
          timestamp: new Date().toISOString()
        }));
      }
    }, 30000);  // Every 30 seconds
  };

  const stopHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  const sendMessage = (message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const cleanup = () => {
    stopHeartbeat();

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (wsRef.current) {
      // Send leave message
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'video_leave',
          videoId,
          userId
        }));
      }
      wsRef.current.close();
    }
  };

  return {
    viewerCount,
    isConnected,
    sendMessage
  };
}
```

**Integration in CustomVideoPlayer:**
```typescript
export function CustomVideoPlayer(props: CustomVideoPlayerProps) {
  const { viewerCount, isConnected, sendMessage } = useVideoWebSocket({
    videoId: props.videoId,
    userId: props.userId,
    onViewerCountUpdate: (count) => {
      console.log('Viewer count:', count);
    }
  });

  // Send playback events via WebSocket
  useEffect(() => {
    if (!playerRef.current) return;

    const player = playerRef.current;

    player.on('play', () => {
      sendMessage({
        type: 'video_play',
        videoId: props.videoId,
        userId: props.userId
      });
    });

    player.on('pause', () => {
      sendMessage({
        type: 'video_pause',
        videoId: props.videoId,
        userId: props.userId
      });
    });
  }, [sendMessage]);

  return (
    <div className="video-player-wrapper">
      {/* Viewer count indicator */}
      {isConnected && viewerCount > 1 && (
        <div className="viewer-count-badge">
          <span className="viewer-icon">👁️</span>
          <span className="viewer-text">
            {viewerCount} {props.rtl ? 'مشاهد' : 'watching'}
          </span>
        </div>
      )}

      {/* ... rest of player */}
    </div>
  );
}
```

## Testing
- [ ] WebSocket connects successfully
- [ ] Viewer count updates in real-time
- [ ] Heartbeat keeps connection alive
- [ ] Reconnection works after disconnect
- [ ] Leave message sent on unmount
- [ ] No memory leaks
- [ ] Graceful degradation without WS

## Dependencies
- Existing WebSocket server (deployed)
- Phase 1.3: CustomVideoPlayer ✓

## Estimated Effort
**Small** - 2-3 hours
