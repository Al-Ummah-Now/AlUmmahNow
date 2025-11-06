# Task 2.10: Stream Dashboard (Live Status, Analytics)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 8 hours
**Dependencies**: Task 2.7 (StreamControls)
**Status**: 📝 Not Started

---

## Goal

Create a comprehensive stream management dashboard displaying live status, real-time metrics, viewer analytics, stream health, and control actions for active and scheduled streams.

## Architecture Pattern

**Pattern**: Real-time Dashboard with WebSocket Updates
**Strategy**: Server-sent initial state + WebSocket updates + polling fallback

## Component Structure

```typescript
// File: /apps/web/src/components/StreamDashboard/index.tsx
interface StreamDashboardProps {
  streamId: string;
}

interface DashboardData {
  stream: Stream;
  metrics: StreamMetrics;
  analytics: StreamAnalytics;
  health: StreamHealth;
}

interface StreamAnalytics {
  totalViews: number;
  uniqueViewers: number;
  peakViewers: number;
  averageWatchTime: number; // seconds
  viewerRetention: number; // percentage
  chatMessages: number;
  likes: number;
  shares: number;
  geographicDistribution: Record<string, number>;
  deviceBreakdown: Record<'desktop' | 'mobile' | 'tablet', number>;
}

interface StreamHealth {
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  bitrate: {
    current: number;
    recommended: number;
    min: number;
    max: number;
  };
  frameRate: {
    current: number;
    recommended: number;
  };
  droppedFrames: number;
  networkLatency: number;
  bufferHealth: number; // percentage
  issues: HealthIssue[];
}

interface HealthIssue {
  type: 'warning' | 'error' | 'critical';
  code: string;
  message: string;
  suggestion: string;
  timestamp: number;
}
```

## Data Flow

```
Dashboard Mount → Fetch Initial Data → Display Metrics
       ↓                 ↓                    ↓
Connect WebSocket → Subscribe to Stream → Real-time Updates
       ↓                                      ↓
Batch Updates → Throttle Renders → Update Charts
       ↓                                      ↓
User Actions → Control API → Update State → Broadcast
```

## Dependencies

- **recharts** - Analytics charts
- **framer-motion** - Animations
- **date-fns** - Time formatting
- **WebSocket** - Real-time updates

## Integration Points

- Stream API (`GET /api/live-streams/{id}`)
- Metrics WebSocket (`wss://ws.alummahnow.net/stream/{id}/metrics`)
- Analytics API (`GET /api/live-streams/{id}/analytics`)
- Control actions (start, end, pause from Task 2.7)

## Performance Considerations

```typescript
// Batched metric updates
const useBatchedMetrics = (streamId: string) => {
  const [metrics, setMetrics] = useState<StreamMetrics>(initialMetrics);
  const [pendingUpdates, setPendingUpdates] = useState<Partial<StreamMetrics>[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (pendingUpdates.length > 0) {
        // Merge all pending updates
        const merged = pendingUpdates.reduce((acc, update) => ({ ...acc, ...update }), {});
        setMetrics(prev => ({ ...prev, ...merged }));
        setPendingUpdates([]);
      }
    }, 1000); // Batch updates every second

    return () => clearInterval(interval);
  }, [pendingUpdates]);

  const queueUpdate = useCallback((update: Partial<StreamMetrics>) => {
    setPendingUpdates(prev => [...prev, update]);
  }, []);

  return { metrics, queueUpdate };
};

// Memoized chart data
const useChartData = (analytics: StreamAnalytics) => {
  return useMemo(() => ({
    viewerTrend: analytics.viewerHistory.map((v, i) => ({
      time: formatTime(i * analytics.intervalSeconds),
      viewers: v
    })),
    devicePie: Object.entries(analytics.deviceBreakdown).map(([device, count]) => ({
      name: device,
      value: count
    })),
    geographicBars: Object.entries(analytics.geographicDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([country, viewers]) => ({ country, viewers }))
  }), [analytics]);
};

// Virtual scrolling for large metric lists
const MetricsList = ({ metrics }: { metrics: HealthIssue[] }) => {
  return (
    <VirtualList
      height={400}
      itemCount={metrics.length}
      itemSize={60}
      width="100%"
    >
      {({ index, style }) => (
        <MetricItem metric={metrics[index]} style={style} />
      )}
    </VirtualList>
  );
};
```

## Security Considerations

```typescript
// Authorization checks
const useDashboardAuth = (streamId: string) => {
  const { user } = useAuth();
  const { data: stream } = useStream(streamId);

  const canView = useMemo(() => {
    if (!stream || !user) return false;
    
    // Owner can always view
    if (stream.userId === user.id) return true;

    // Admins can view all
    if (user.role === 'admin') return true;

    // Collaborators with view permission
    if (stream.collaborators?.some(c => c.userId === user.id && c.canView)) {
      return true;
    }

    return false;
  }, [stream, user]);

  const canControl = useMemo(() => {
    if (!stream || !user) return false;
    
    // Only owner and authorized collaborators
    return stream.userId === user.id ||
           stream.collaborators?.some(c => c.userId === user.id && c.canControl);
  }, [stream, user]);

  return { canView, canControl };
};

// Sensitive data masking for non-owners
const maskSensitiveData = (data: DashboardData, canView: boolean): DashboardData => {
  if (canView) return data;

  return {
    ...data,
    analytics: {
      ...data.analytics,
      // Mask detailed analytics for non-owners
      geographicDistribution: {},
      deviceBreakdown: {} as any
    }
  };
};
```

## Error Handling

```typescript
// Comprehensive error handling
const useStreamDashboard = (streamId: string) => {
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['stream-dashboard', streamId],
    queryFn: () => fetchStreamDashboard(streamId),
    retry: (failureCount, error) => {
      if (failureCount >= maxRetries) return false;
      if (error.status === 404 || error.status === 403) return false;
      return true;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    onError: (err) => {
      setError(err);
      setRetryCount(prev => prev + 1);
    }
  });

  // WebSocket fallback to polling
  const { status: wsStatus } = useWebSocket(`wss://ws.alummahnow.net/stream/${streamId}`, {
    onError: () => {
      console.warn('WebSocket failed, falling back to polling');
      startPolling(streamId, 5000); // Poll every 5 seconds
    }
  });

  return { data, isLoading, error, refetch, retryCount };
};

// Health issue alerts
const useHealthAlerts = (health: StreamHealth) => {
  useEffect(() => {
    health.issues.forEach(issue => {
      if (issue.type === 'critical') {
        showNotification({
          type: 'error',
          title: 'Critical Stream Issue',
          message: issue.message,
          duration: 0, // Don't auto-dismiss
          actions: [
            { label: 'View Details', onClick: () => showHealthDetails(issue) },
            { label: 'Get Help', onClick: () => openSupportChat() }
          ]
        });
      } else if (issue.type === 'warning') {
        showNotification({
          type: 'warning',
          title: 'Stream Warning',
          message: issue.message,
          duration: 10000
        });
      }
    });
  }, [health.issues]);
};
```

## Type Safety

```typescript
// Dashboard layout types
interface DashboardLayout {
  header: {
    title: string;
    status: StreamStatus;
    controls: React.ReactNode;
  };
  metrics: {
    primary: MetricCard[];
    secondary: MetricCard[];
  };
  charts: {
    viewerTrend: ChartConfig;
    engagement: ChartConfig;
    geographic: ChartConfig;
  };
  health: {
    overall: HealthStatus;
    issues: HealthIssue[];
    recommendations: string[];
  };
}

interface MetricCard {
  id: string;
  label: string;
  value: number | string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: number;
  icon: React.ReactNode;
  color: string;
  format: (value: number) => string;
}

interface ChartConfig {
  type: 'line' | 'bar' | 'pie' | 'area';
  data: any[];
  xKey: string;
  yKey: string;
  title: string;
  height: number;
}
```

## Testing Criteria

- [ ] Dashboard loads initial data
- [ ] WebSocket connects and updates
- [ ] Metrics update in real-time
- [ ] Charts render correctly
- [ ] Health issues display
- [ ] Control actions work
- [ ] Authorization enforced
- [ ] Polling fallback works
- [ ] Error states handled
- [ ] Performance acceptable (60fps)

## Acceptance Criteria

- [ ] Stream status indicator (live/scheduled/ended)
- [ ] Real-time viewer count
- [ ] Peak viewers metric
- [ ] Total views counter
- [ ] Average watch time
- [ ] Engagement metrics (likes, shares, chats)
- [ ] Viewer trend chart (line graph)
- [ ] Geographic distribution chart (bar/map)
- [ ] Device breakdown chart (pie)
- [ ] Stream health indicator
- [ ] Bitrate/FPS/dropped frames metrics
- [ ] Stream controls (start/end/pause)
- [ ] Auto-refresh every 5 seconds (fallback)
- [ ] WebSocket real-time updates
- [ ] Export analytics button

## Related Tasks

- **Depends On**: Task 2.7 (StreamControls)
- **Blocks**: Tasks 2.11, 2.12 (Real-time features)
- **Related**: Task 3.4 (Real-time viewer updates)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md)
- [Recharts Documentation](https://recharts.org/)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
