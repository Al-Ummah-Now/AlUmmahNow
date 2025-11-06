# Task 2.11: Real-time Viewer Count (WebSocket)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 5 hours
**Dependencies**: Task 2.10 (Stream Dashboard)
**Status**: 📝 Not Started

---

## Goal

Implement real-time viewer count updates via WebSocket with animations, trend indicators, and fallback polling for reliable display of concurrent viewer metrics.

## Architecture Pattern

**Pattern**: WebSocket Pub/Sub with Animated Counter
**Strategy**: Subscribe to stream channel → Receive count updates → Animate transitions

## Component Structure

```typescript
interface ViewerCountProps {
  streamId: string;
  initialCount?: number;
  showAnimation?: boolean;
  showTrend?: boolean;
  showPeak?: boolean;
  updateInterval?: number; // ms
}

const ViewerCount: React.FC<ViewerCountProps> = ({
  streamId,
  initialCount = 0,
  showAnimation = true,
  showTrend = true,
  showPeak = true,
  updateInterval = 100
}) => {
  const { count, trend, peak, isConnected } = useRealtimeViewerCount(streamId);
  const animatedCount = useAnimatedNumber(count, { duration: 300 });

  return (
    <div className="flex items-center gap-2">
      <EyeIcon className="w-5 h-5" />
      <span className="text-2xl font-bold">
        {formatNumber(animatedCount)}
      </span>
      {showTrend && <TrendIndicator trend={trend} />}
      {showPeak && <PeakBadge value={peak} />}
      {!isConnected && <OfflineIndicator />}
    </div>
  );
};

// Custom hook for real-time updates
const useRealtimeViewerCount = (streamId: string) => {
  const [count, setCount] = useState(0);
  const [peak, setPeak] = useState(0);
  const [trend, setTrend] = useState<'up' | 'down' | 'stable'>('stable');
  const [history, setHistory] = useState<number[]>([]);

  const { isConnected, subscribe } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribe(`stream:${streamId}:viewers`, (data: ViewerUpdate) => {
      const newCount = data.count;
      
      setCount(newCount);
      setPeak(prev => Math.max(prev, newCount));
      
      // Calculate trend
      setHistory(prev => {
        const updated = [...prev, newCount].slice(-10);
        const avgRecent = updated.slice(-3).reduce((a, b) => a + b, 0) / 3;
        const avgOlder = updated.slice(0, -3).reduce((a, b) => a + b, 0) / Math.max(1, updated.length - 3);
        
        if (avgRecent > avgOlder * 1.1) setTrend('up');
        else if (avgRecent < avgOlder * 0.9) setTrend('down');
        else setTrend('stable');
        
        return updated;
      });
    });

    return () => unsubscribe();
  }, [streamId, subscribe]);

  return { count, trend, peak, isConnected };
};
```

## Data Flow

```
Component Mount → Subscribe to Channel → Initial Count
       ↓                  ↓                    ↓
WebSocket Message → Parse Count → Update State
       ↓                             ↓
Calculate Trend ← Track History ← Animate Transition
```

## Dependencies

- **@react-spring/web** - Number animations
- **WebSocketProvider** - Connection management
- **react-use** - Utility hooks

## Integration Points

- WebSocket server channel: `stream:{streamId}:viewers`
- Fallback polling API: `GET /api/live-streams/{id}/viewers`
- Analytics tracking for viewer count milestones

## Performance Considerations

```typescript
// Throttled updates to prevent excessive renders
const useThrottledViewerCount = (streamId: string, throttleMs: number = 100) => {
  const [displayCount, setDisplayCount] = useState(0);
  const latestCountRef = useRef(0);

  const { subscribe } = useWebSocket();

  useEffect(() => {
    const updateDisplay = throttle(() => {
      setDisplayCount(latestCountRef.current);
    }, throttleMs);

    const unsubscribe = subscribe(`stream:${streamId}:viewers`, (data) => {
      latestCountRef.current = data.count;
      updateDisplay();
    });

    return () => {
      unsubscribe();
      updateDisplay.cancel();
    };
  }, [streamId, throttleMs]);

  return displayCount;
};

// Smooth animations with react-spring
const useAnimatedNumber = (value: number, config = {}) => {
  const [spring, api] = useSpring(() => ({
    number: value,
    config: {
      tension: 300,
      friction: 30,
      ...config
    }
  }));

  useEffect(() => {
    api.start({ number: value });
  }, [value, api]);

  return spring.number.to(n => Math.floor(n));
};
```

## Error Handling

```typescript
// Fallback to polling on WebSocket failure
const useViewerCountWithFallback = (streamId: string) => {
  const [count, setCount] = useState(0);
  const [method, setMethod] = useState<'websocket' | 'polling'>('websocket');
  
  const { isConnected } = useWebSocket();

  // WebSocket updates
  useEffect(() => {
    if (!isConnected) {
      setMethod('polling');
      return;
    }

    setMethod('websocket');
    const unsubscribe = subscribe(`stream:${streamId}:viewers`, (data) => {
      setCount(data.count);
    });

    return unsubscribe;
  }, [streamId, isConnected]);

  // Polling fallback
  useEffect(() => {
    if (method !== 'polling') return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/live-streams/${streamId}/viewers`);
        const data = await response.json();
        setCount(data.count);
      } catch (error) {
        console.error('Failed to fetch viewer count:', error);
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [streamId, method]);

  return { count, method };
};
```

## Testing Criteria

- [ ] Viewer count updates in real-time
- [ ] Animations smooth (60fps)
- [ ] Trend indicator accurate
- [ ] Peak count tracked correctly
- [ ] WebSocket reconnection works
- [ ] Polling fallback activates
- [ ] No memory leaks
- [ ] Performance acceptable with 10+ updates/sec

## Acceptance Criteria

- [ ] Display current viewer count
- [ ] Animate count changes smoothly
- [ ] Show trend indicator (↑↓→)
- [ ] Display peak viewer count
- [ ] Real-time updates via WebSocket
- [ ] Fallback to polling if WebSocket fails
- [ ] Connection status indicator
- [ ] Format large numbers (1K, 1M)
- [ ] Accessibility: screen reader support
- [ ] Mobile responsive

## Related Tasks

- **Depends On**: Task 2.10 (Dashboard)
- **Blocks**: None
- **Related**: Task 3.4 (Real-time viewer updates Phase 3)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md)
- [React Spring](https://react-spring.dev/)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
