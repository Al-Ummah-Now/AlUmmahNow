# Task 2.7: StreamControlsComponent (Start/Stop/Pause)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 6 hours
**Dependencies**: Task 2.6 (StreamSetupComponent)
**Status**: 📝 Not Started

---

## Goal

Create a state machine-driven control component for managing live stream lifecycle (go live, pause, resume, end) with real-time metrics, error handling, and emergency stop functionality.

## Architecture Pattern

**Pattern**: State Machine Control Component with Real-time Updates
**Strategy**: Action-based state transitions with WebSocket metrics

## Component Structure

```typescript
// File: /apps/web/src/components/StreamControls/index.tsx
interface StreamControlsProps {
  streamId: string;
  status: StreamStatus;
  currentViewers: number;
  peakViewers: number;
  startTime?: string;
  onGoLive: () => Promise<void>;
  onEndStream: () => Promise<void>;
  onCancelStream: () => Promise<void>;
  onEmergencyStop?: () => Promise<void>;
  disabled?: boolean;
}

type StreamStatus = 'scheduled' | 'preparing' | 'live' | 'paused' | 'ending' | 'ended' | 'cancelled' | 'error';

interface StreamMetrics {
  viewers: number;
  peakViewers: number;
  duration: number; // seconds
  health: 'excellent' | 'good' | 'fair' | 'poor';
  bitrate: number; // kbps
  droppedFrames: number;
  fps: number;
}

// State machine transitions
type StreamStateMachine = {
  scheduled: { goLive: 'preparing'; cancel: 'cancelled' };
  preparing: { ready: 'live'; cancel: 'cancelled'; error: 'error' };
  live: { pause: 'paused'; end: 'ending'; emergencyStop: 'ended'; error: 'error' };
  paused: { resume: 'live'; end: 'ending' };
  ending: { complete: 'ended'; error: 'error' };
  ended: {};
  cancelled: {};
  error: { retry: 'scheduled'; cancel: 'cancelled' };
};
```

## Data Flow

```
User Action → Validate Transition → Confirm (if needed)
      ↓              ↓                       ↓
Execute API → Update Local State → Broadcast via WebSocket
      ↓                                      ↓
Server Response → Update Final State → Show Notification
      ↓                                      ↓
Real-time Metrics ← WebSocket Updates ← Stream Health Monitor
```

## Dependencies

- **framer-motion** - Button animations and transitions
- **react-use** - Hook utilities (useInterval, useToggle)
- **date-fns** - Duration formatting
- **WebSocket** - Real-time metrics updates

## Integration Points

- Stream lifecycle API (`POST /api/live-streams/{id}/start`, `/end`, `/pause`)
- WebSocket server for real-time metrics
- Analytics event tracking
- Notification service

## Performance Considerations

```typescript
// Batch metric updates to prevent excessive re-renders
const useStreamMetrics = (streamId: string) => {
  const [metrics, setMetrics] = useState<StreamMetrics>(initialMetrics);
  const [buffer, setBuffer] = useState<Partial<StreamMetrics>>({});

  // Batch updates every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (Object.keys(buffer).length > 0) {
        setMetrics(prev => ({ ...prev, ...buffer }));
        setBuffer({});
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [buffer]);

  // WebSocket with throttling
  useWebSocket(`wss://ws.alummahnow.net/stream/${streamId}/metrics`, {
    onMessage: throttle((data: Partial<StreamMetrics>) => {
      setBuffer(prev => ({ ...prev, ...data }));
    }, 100),
    enabled: true
  });

  return metrics;
};

// Memoized action handlers
const useStreamActions = (streamId: string, status: StreamStatus) => {
  const goLive = useCallback(async () => {
    await api.post(`/live-streams/${streamId}/start`);
  }, [streamId]);

  const endStream = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: 'End Stream?',
      message: 'Are you sure you want to end this stream?',
      confirmText: 'End Stream',
      confirmStyle: 'danger'
    });

    if (confirmed) {
      await api.post(`/live-streams/${streamId}/end`);
    }
  }, [streamId]);

  return { goLive, endStream };
};
```

## Security Considerations

```typescript
// Action authorization checks
const useStreamAuthorization = (streamId: string) => {
  const { user } = useAuth();
  const { stream } = useStream(streamId);

  const canGoLive = useMemo(() => {
    return (
      stream?.userId === user?.id &&
      stream?.status === 'scheduled' &&
      hasStreamingQuota(user) &&
      !isRateLimited(user)
    );
  }, [stream, user]);

  const canEndStream = useMemo(() => {
    return (
      stream?.userId === user?.id &&
      stream?.status === 'live' &&
      stream?.duration > 10 // Minimum 10 seconds
    );
  }, [stream, user]);

  const canEmergencyStop = useMemo(() => {
    return (
      (stream?.userId === user?.id || user?.role === 'admin') &&
      ['live', 'preparing'].includes(stream?.status)
    );
  }, [stream, user]);

  return { canGoLive, canEndStream, canEmergencyStop };
};

// Rate limiting protection
const useActionRateLimit = () => {
  const [lastAction, setLastAction] = useState<number>(0);
  const COOLDOWN_MS = 2000; // 2 second cooldown

  const executeAction = async (action: () => Promise<void>) => {
    const now = Date.now();
    if (now - lastAction < COOLDOWN_MS) {
      throw new Error('Please wait before performing another action');
    }

    setLastAction(now);
    await action();
  };

  return executeAction;
};
```

## Error Handling

```typescript
// Comprehensive error handling with retry logic
const handleStreamAction = async (
  action: 'goLive' | 'end' | 'pause' | 'resume',
  streamId: string
) => {
  const strategies = {
    goLive: {
      maxRetries: 3,
      timeout: 30000,
      fallback: () => showManualStreamingInstructions(),
      errorMessages: {
        timeout: 'Stream start is taking longer than expected. Check your RTMP connection.',
        network: 'Network error. Please check your internet connection.',
        quota: 'Streaming quota exceeded. Upgrade your plan to continue.',
        default: 'Failed to start stream. Please try again.'
      }
    },
    end: {
      maxRetries: 5,
      timeout: 10000,
      fallback: () => forceEndStream(streamId),
      errorMessages: {
        timeout: 'Stream end is taking longer than expected.',
        network: 'Network error. Stream will end automatically.',
        default: 'Failed to end stream gracefully.'
      }
    },
    pause: {
      maxRetries: 2,
      timeout: 5000,
      fallback: () => null,
      errorMessages: {
        default: 'Failed to pause stream.'
      }
    },
    resume: {
      maxRetries: 2,
      timeout: 5000,
      fallback: () => null,
      errorMessages: {
        default: 'Failed to resume stream.'
      }
    }
  };

  const strategy = strategies[action];

  try {
    return await retryWithBackoff(
      () => executeStreamAction(action, streamId),
      {
        maxRetries: strategy.maxRetries,
        timeout: strategy.timeout
      }
    );
  } catch (error) {
    const errorType = getErrorType(error);
    const message = strategy.errorMessages[errorType] || strategy.errorMessages.default;

    showNotification({
      type: 'error',
      title: 'Action Failed',
      message,
      actions: [
        { label: 'Retry', onClick: () => handleStreamAction(action, streamId) },
        { label: 'Support', onClick: () => openSupportChat() }
      ]
    });

    if (strategy.fallback) {
      strategy.fallback();
    }

    throw error;
  }
};

// Stream health monitoring
const useStreamHealth = (streamId: string, status: StreamStatus) => {
  const [health, setHealth] = useState<StreamMetrics['health']>('good');

  useEffect(() => {
    if (status !== 'live') return;

    const checkHealth = async () => {
      try {
        const metrics = await api.get(`/live-streams/${streamId}/health`);
        
        if (metrics.droppedFrames > 10) {
          setHealth('poor');
          showWarning('Stream quality degraded. Check your internet connection.');
        } else if (metrics.bitrate < 1000) {
          setHealth('fair');
          showWarning('Low bitrate detected.');
        } else {
          setHealth('good');
        }
      } catch (error) {
        setHealth('poor');
      }
    };

    const interval = setInterval(checkHealth, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [streamId, status]);

  return health;
};
```

## Type Safety

```typescript
// Strongly typed state transitions
type ValidTransition<S extends keyof StreamStateMachine> = keyof StreamStateMachine[S];

const transition = <S extends keyof StreamStateMachine>(
  from: S,
  action: ValidTransition<S>
): StreamStateMachine[S][ValidTransition<S>] => {
  const machine = streamStateMachine[from];
  if (!(action in machine)) {
    throw new Error(`Invalid transition: ${action} from ${from}`);
  }
  return machine[action];
};

// Action result types
interface ActionResult {
  success: boolean;
  newStatus?: StreamStatus;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metrics?: Partial<StreamMetrics>;
}

// Control button configuration
interface ControlButton {
  action: 'goLive' | 'end' | 'pause' | 'resume' | 'cancel' | 'emergencyStop';
  label: string;
  icon: React.ReactNode;
  variant: 'primary' | 'danger' | 'secondary';
  confirmRequired: boolean;
  confirmMessage?: string;
  enabled: (status: StreamStatus) => boolean;
}
```

## Testing Criteria

- [ ] Go Live button starts stream
- [ ] End Stream button ends stream
- [ ] Pause/Resume toggle works
- [ ] Emergency stop works immediately
- [ ] Confirmation dialogs appear
- [ ] Real-time metrics update
- [ ] Health indicator accurate
- [ ] Error handling works
- [ ] Rate limiting prevents spam
- [ ] Authorization enforced

## Acceptance Criteria

- [ ] Go Live button (when status=scheduled)
- [ ] End Stream button (when status=live)
- [ ] Pause/Resume buttons (when status=live/paused)
- [ ] Emergency Stop button (admin/owner only)
- [ ] Real-time viewer count
- [ ] Stream duration timer
- [ ] Stream health indicator
- [ ] Bitrate/FPS metrics
- [ ] Confirmation for destructive actions
- [ ] Loading states during actions
- [ ] Error notifications with retry

## Related Tasks

- **Depends On**: Task 2.6 (StreamSetupComponent)
- **Blocks**: Task 2.10 (Stream Dashboard)
- **Related**: Task 2.11 (Real-time Viewer Count), Task 2.12 (Status Updates)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md#task-7-streamcontrols-component)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
