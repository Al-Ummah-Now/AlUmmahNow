# Task 2.12: Real-time Stream Status Updates (WebSocket)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 5 hours
**Dependencies**: Task 2.10 (Stream Dashboard)
**Status**: 📝 Not Started

---

## Goal

Implement real-time stream status change notifications via WebSocket to instantly inform creators and viewers when streams start, end, pause, or encounter errors.

## Architecture Pattern

**Pattern**: Event-Driven Notification System with Priority Queuing
**Strategy**: WebSocket events → Priority queue → Toast notifications → State updates

## Component Structure

```typescript
interface StatusUpdate {
  streamId: string;
  oldStatus: StreamStatus;
  newStatus: StreamStatus;
  timestamp: number;
  metadata?: Record<string, any>;
}

const useStreamStatusUpdates = (streamId: string) => {
  const [status, setStatus] = useState<StreamStatus>('scheduled');
  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribe(
      `stream:${streamId}:status`,
      (update: StatusUpdate) => {
        handleStatusChange(update);
      }
    );

    return unsubscribe;
  }, [streamId]);

  const handleStatusChange = (update: StatusUpdate) => {
    setStatus(update.newStatus);
    
    // Show notification
    notifyStatusChange(update);
    
    // Track analytics
    trackEvent('stream_status_change', {
      streamId: update.streamId,
      from: update.oldStatus,
      to: update.newStatus
    });
    
    // Trigger side effects
    handleStatusSideEffects(update);
  };

  return { status };
};

const notifyStatusChange = (update: StatusUpdate) => {
  const notifications = {
    live: {
      title: '🔴 Stream is now live!',
      message: 'Your stream is broadcasting to viewers.',
      type: 'success' as const,
      priority: 'high' as const
    },
    ended: {
      title: 'Stream ended',
      message: 'Your stream has ended. View analytics now.',
      type: 'info' as const,
      priority: 'normal' as const
    },
    error: {
      title: '⚠️ Stream error',
      message: 'Your stream encountered an error. Please check your connection.',
      type: 'error' as const,
      priority: 'critical' as const
    },
    paused: {
      title: 'Stream paused',
      message: 'Your stream is temporarily paused.',
      type: 'warning' as const,
      priority: 'normal' as const
    }
  };

  const config = notifications[update.newStatus];
  if (config) {
    showNotification(config);
  }
};
```

## Data Flow

```
Status Change Event → WebSocket Message → Client Receives
        ↓                    ↓                  ↓
Validate Update → Update Local State → Priority Queue
        ↓                                       ↓
Show Notification → Update UI → Trigger Side Effects
```

## Dependencies

- **WebSocketProvider** - Real-time connection
- **react-hot-toast** - Toast notifications
- **zustand** - State management

## Integration Points

- WebSocket channel: `stream:{streamId}:status`
- Notification service
- Analytics tracking
- State management store

## Performance Considerations

```typescript
// Debounce rapid status changes
const useDebouncedStatusUpdates = (streamId: string, delayMs: number = 500) => {
  const [status, setStatus] = useState<StreamStatus>('scheduled');
  const timeoutRef = useRef<NodeJS.Timeout>();

  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribe(`stream:${streamId}:status`, (update: StatusUpdate) => {
      // Clear previous timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Debounce update
      timeoutRef.current = setTimeout(() => {
        setStatus(update.newStatus);
        notifyStatusChange(update);
      }, delayMs);
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [streamId, delayMs]);

  return status;
};

// Notification queue management
class NotificationQueue {
  private queue: Array<{ notification: Notification; priority: number }> = [];
  private displaying: Set<string> = new Set();
  private maxConcurrent = 3;

  enqueue(notification: Notification, priority: 'low' | 'normal' | 'high' | 'critical' = 'normal') {
    const priorityMap = { low: 0, normal: 1, high: 2, critical: 3 };
    
    this.queue.push({ notification, priority: priorityMap[priority] });
    this.queue.sort((a, b) => b.priority - a.priority);
    
    this.processQueue();
  }

  private processQueue() {
    while (this.queue.length > 0 && this.displaying.size < this.maxConcurrent) {
      const item = this.queue.shift();
      if (item) {
        this.show(item.notification);
      }
    }
  }

  private show(notification: Notification) {
    const id = notification.id || crypto.randomUUID();
    this.displaying.add(id);
    
    toast(notification.message, {
      ...notification,
      onDismiss: () => {
        this.displaying.delete(id);
        this.processQueue();
      }
    });
  }
}
```

## Error Handling

```typescript
// Handle failed status updates
const handleStatusUpdateError = (error: Error, update: StatusUpdate) => {
  console.error('Status update failed:', error);
  
  // Log to error tracking
  logError(error, {
    context: 'stream_status_update',
    streamId: update.streamId,
    update
  });
  
  // Show user-friendly error
  showNotification({
    type: 'error',
    title: 'Update Failed',
    message: 'Failed to update stream status. Refreshing...',
    duration: 3000
  });
  
  // Refetch stream status
  refetchStreamStatus(update.streamId);
};

// Sync status on reconnection
const useSyncStatusOnReconnect = (streamId: string) => {
  const { isConnected } = useWebSocket();
  const previouslyConnected = useRef(false);

  useEffect(() => {
    if (isConnected && !previouslyConnected.current) {
      // Reconnected - sync status
      syncStreamStatus(streamId);
    }
    previouslyConnected.current = isConnected;
  }, [isConnected, streamId]);
};

const syncStreamStatus = async (streamId: string) => {
  try {
    const response = await fetch(`/api/live-streams/${streamId}/status`);
    const { status } = await response.json();
    
    // Update local state without notification
    updateStreamStatus(streamId, status, { silent: true });
  } catch (error) {
    console.error('Status sync failed:', error);
  }
};
```

## Type Safety

```typescript
type StreamStatus = 
  | 'scheduled' 
  | 'preparing' 
  | 'live' 
  | 'paused' 
  | 'ending' 
  | 'ended' 
  | 'cancelled' 
  | 'error';

interface StatusTransition {
  from: StreamStatus;
  to: StreamStatus;
  allowed: boolean;
  requiresConfirmation: boolean;
}

const statusTransitions: StatusTransition[] = [
  { from: 'scheduled', to: 'preparing', allowed: true, requiresConfirmation: false },
  { from: 'preparing', to: 'live', allowed: true, requiresConfirmation: false },
  { from: 'live', to: 'paused', allowed: true, requiresConfirmation: true },
  { from: 'live', to: 'ending', allowed: true, requiresConfirmation: true },
  { from: 'paused', to: 'live', allowed: true, requiresConfirmation: false },
  { from: 'ending', to: 'ended', allowed: true, requiresConfirmation: false },
  // ... more transitions
];

const isValidTransition = (from: StreamStatus, to: StreamStatus): boolean => {
  return statusTransitions.some(t => t.from === from && t.to === to && t.allowed);
};
```

## Testing Criteria

- [ ] Status updates received via WebSocket
- [ ] Notifications display correctly
- [ ] Priority queuing works
- [ ] Debouncing prevents spam
- [ ] Reconnection syncs status
- [ ] Invalid transitions blocked
- [ ] Side effects triggered
- [ ] Analytics tracked
- [ ] Offline mode queues updates
- [ ] No notification duplicates

## Acceptance Criteria

- [ ] Real-time status updates via WebSocket
- [ ] Toast notifications for status changes
- [ ] Priority-based notification queue
- [ ] Max 3 concurrent notifications
- [ ] Status badge in UI updates
- [ ] Side effects (redirects, etc.) work
- [ ] Analytics tracking complete
- [ ] Offline update queuing
- [ ] Sync on reconnection
- [ ] Accessible notifications

## Related Tasks

- **Depends On**: Task 2.10 (Dashboard)
- **Blocks**: None
- **Related**: Task 3.5 (Status notifications Phase 3)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
