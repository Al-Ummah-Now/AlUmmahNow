---
name: "[Phase 1.5] Basic Analytics Tracking Service"
about: Implement basic video analytics tracking for play, pause, ended events
title: "[Phase 1.5] Implement Basic Analytics Tracking Service"
labels: phase-1, video-player, enhancement, high-priority, analytics
assignees: ''
---

## Overview
Create a foundational analytics service to track basic video events (play, pause, ended) with event queueing and batch sending. This establishes the analytics infrastructure that will be expanded in Phase 3.

## Acceptance Criteria
- [ ] `VideoAnalytics` class created with event tracking
- [ ] Track play, pause, ended events
- [ ] Session ID generation for each playback session
- [ ] Event queue with batch sending (every 30 seconds)
- [ ] Flush on page unload (beforeunload)
- [ ] Local event buffering for offline scenarios
- [ ] No analytics calls block video playback
- [ ] Events include video ID, user ID, session ID, timestamp
- [ ] Integration with existing API endpoint structure
- [ ] TypeScript types for all event schemas

## Technical Details

### Files to Create/Modify
- `apps/web/src/services/analytics/video-analytics.ts` - Main analytics service
- `apps/web/src/services/analytics/types.ts` - Event type definitions
- `apps/web/src/services/analytics/__tests__/video-analytics.test.ts` - Tests
- Update `CustomVideoPlayer.tsx` to use analytics service

### Implementation

```typescript
// apps/web/src/services/analytics/types.ts
export enum VideoEventType {
  // Phase 1: Basic events
  READY = 'ready',
  PLAY = 'play',
  PAUSE = 'pause',
  ENDED = 'ended',

  // Phase 3: Advanced events (defined now, implemented later)
  SEEK = 'seek',
  TIMEUPDATE = 'timeupdate',
  QUALITY_CHANGE = 'quality_change',
  BUFFER_START = 'buffer_start',
  BUFFER_END = 'buffer_end',
  ERROR = 'error',
  QUARTILE_25 = 'quartile_25',
  QUARTILE_50 = 'quartile_50',
  QUARTILE_75 = 'quartile_75'
}

export interface AnalyticsEvent {
  videoId: string;
  userId?: string;
  sessionId: string;
  eventType: VideoEventType;
  timestamp: string;       // ISO 8601
  relativeTime: number;    // ms since player init
  data?: Record<string, any>;
}

export interface AnalyticsConfig {
  endpoint: string;
  batchSize: number;
  flushInterval: number;  // ms
  enableDebugLogging?: boolean;
}
```

```typescript
// apps/web/src/services/analytics/video-analytics.ts
export class VideoAnalytics {
  private videoId: string;
  private userId?: string;
  private sessionId: string;
  private startTime: number;
  private eventQueue: AnalyticsEvent[] = [];
  private flushInterval?: NodeJS.Timeout;
  private config: AnalyticsConfig;

  constructor(
    videoId: string,
    userId?: string,
    config?: Partial<AnalyticsConfig>
  ) {
    this.videoId = videoId;
    this.userId = userId;
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();

    this.config = {
      endpoint: '/api/analytics/video',
      batchSize: 20,
      flushInterval: 30000,
      enableDebugLogging: process.env.NODE_ENV === 'development',
      ...config
    };

    this.startFlushTimer();
    this.setupUnloadHandler();
  }

  /**
   * Track video player ready event
   */
  trackReady() {
    this.addEvent({
      eventType: VideoEventType.READY,
      relativeTime: Date.now() - this.startTime
    });
  }

  /**
   * Track play event
   */
  trackPlay() {
    this.addEvent({
      eventType: VideoEventType.PLAY,
      relativeTime: Date.now() - this.startTime
    });
  }

  /**
   * Track pause event
   */
  trackPause() {
    this.addEvent({
      eventType: VideoEventType.PAUSE,
      relativeTime: Date.now() - this.startTime
    });
  }

  /**
   * Track video ended event
   */
  trackComplete() {
    this.addEvent({
      eventType: VideoEventType.ENDED,
      relativeTime: Date.now() - this.startTime,
      data: {
        totalWatchTime: Date.now() - this.startTime
      }
    });

    // Flush immediately on completion
    this.flush();
  }

  /**
   * Track error (basic implementation, expanded in Phase 1.4)
   */
  trackError(error: any) {
    this.addEvent({
      eventType: VideoEventType.ERROR,
      relativeTime: Date.now() - this.startTime,
      data: {
        code: error?.code,
        message: error?.message,
        type: error?.type
      }
    });

    // Flush errors immediately
    this.flush();
  }

  /**
   * Add event to queue
   */
  private addEvent(event: Partial<AnalyticsEvent>) {
    const fullEvent: AnalyticsEvent = {
      videoId: this.videoId,
      userId: this.userId,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      relativeTime: Date.now() - this.startTime,
      ...event
    } as AnalyticsEvent;

    this.eventQueue.push(fullEvent);

    if (this.config.enableDebugLogging) {
      console.log('[VideoAnalytics]', fullEvent.eventType, fullEvent);
    }

    // Flush if queue is full
    if (this.eventQueue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Flush events to server
   */
  private async flush() {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ events }),
        keepalive: true  // Important for beforeunload
      });

      if (!response.ok) {
        throw new Error(`Analytics flush failed: ${response.status}`);
      }

      if (this.config.enableDebugLogging) {
        console.log('[VideoAnalytics] Flushed', events.length, 'events');
      }
    } catch (error) {
      console.error('[VideoAnalytics] Failed to send events:', error);

      // Re-add events to queue on failure
      this.eventQueue.unshift(...events);

      // Store in localStorage as backup
      try {
        const stored = localStorage.getItem('pendingVideoAnalytics') || '[]';
        const pending = JSON.parse(stored);
        localStorage.setItem(
          'pendingVideoAnalytics',
          JSON.stringify([...pending, ...events])
        );
      } catch (e) {
        console.error('[VideoAnalytics] Failed to store events locally:', e);
      }
    }
  }

  /**
   * Start automatic flush timer
   */
  private startFlushTimer() {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  /**
   * Setup handler to flush on page unload
   */
  private setupUnloadHandler() {
    const handler = () => {
      this.flush();
    };

    window.addEventListener('beforeunload', handler);
    window.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.flush();
      }
    });

    // Store handler for cleanup
    (this as any)._unloadHandler = handler;
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Flush remaining events
    this.flush();

    // Clear flush timer
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    // Remove unload handler
    if ((this as any)._unloadHandler) {
      window.removeEventListener('beforeunload', (this as any)._unloadHandler);
    }
  }
}

// Singleton factory (optional)
const activeAnalytics = new Map<string, VideoAnalytics>();

export function getVideoAnalytics(
  videoId: string,
  userId?: string
): VideoAnalytics {
  const key = `${videoId}-${userId || 'anonymous'}`;

  if (!activeAnalytics.has(key)) {
    const analytics = new VideoAnalytics(videoId, userId);
    activeAnalytics.set(key, analytics);
  }

  return activeAnalytics.get(key)!;
}
```

```typescript
// Integration into CustomVideoPlayer.tsx
import { VideoAnalytics } from '@/services/analytics/video-analytics';

export function CustomVideoPlayer(props: CustomVideoPlayerProps) {
  const analyticsRef = useRef<VideoAnalytics | null>(null);

  useEffect(() => {
    // Initialize analytics
    analyticsRef.current = new VideoAnalytics(
      props.videoId,
      props.userId
    );

    // ... player setup

    player.on('ready', () => {
      analyticsRef.current?.trackReady();
    });

    player.on('play', () => {
      analyticsRef.current?.trackPlay();
    });

    player.on('pause', () => {
      analyticsRef.current?.trackPause();
    });

    player.on('ended', () => {
      analyticsRef.current?.trackComplete();
    });

    player.on('error', (error: any) => {
      analyticsRef.current?.trackError(error);
    });

    return () => {
      analyticsRef.current?.destroy();
      // ... player cleanup
    };
  }, [props.videoId, props.userId]);

  // ... rest of component
}
```

```typescript
// Unit tests
describe('VideoAnalytics', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should generate unique session ID', () => {
    const analytics1 = new VideoAnalytics('video-1');
    const analytics2 = new VideoAnalytics('video-1');
    expect((analytics1 as any).sessionId).not.toBe((analytics2 as any).sessionId);
  });

  it('should track play event', () => {
    const analytics = new VideoAnalytics('video-1');
    analytics.trackPlay();
    expect((analytics as any).eventQueue).toHaveLength(1);
    expect((analytics as any).eventQueue[0].eventType).toBe('play');
  });

  it('should flush events automatically', async () => {
    const analytics = new VideoAnalytics('video-1', undefined, {
      flushInterval: 1000
    });

    analytics.trackPlay();
    jest.advanceTimersByTime(1000);

    await Promise.resolve();  // Wait for async flush
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should flush on batch size reached', () => {
    const analytics = new VideoAnalytics('video-1', undefined, {
      batchSize: 3
    });

    analytics.trackPlay();
    analytics.trackPause();
    expect(global.fetch).not.toHaveBeenCalled();

    analytics.trackPlay();  // 3rd event triggers flush
    expect(global.fetch).toHaveBeenCalled();
  });
});
```

### Dependencies
- **Prerequisites**: Phase 1.1, 1.2, 1.3
- **API endpoints**: `/api/analytics/video` (to be created in processor)
- **npm packages**: None (uses built-in Fetch API)

### Testing Requirements
- [ ] Unit test: Session ID generation
- [ ] Unit test: Event queueing
- [ ] Unit test: Batch flushing
- [ ] Unit test: Timer-based flushing
- [ ] Unit test: Error handling for failed requests
- [ ] Unit test: LocalStorage fallback
- [ ] Integration test: Events sent to API
- [ ] Integration test: Unload handler flushes
- [ ] Manual test: Network tab shows batched requests
- [ ] Manual test: Events logged in development mode

## Design Considerations

### Performance
- Non-blocking: analytics never blocks video playback
- Batched requests reduce network overhead
- LocalStorage backup prevents data loss
- `keepalive` flag ensures unload events send

### Privacy
- User ID optional (anonymous tracking supported)
- Session-based tracking
- No PII collected in basic events
- Compliant with privacy regulations

### Scalability
- Event queue prevents memory bloat
- Configurable batch size and interval
- Failed events re-queued for retry
- Singleton pattern for multiple player instances

## Success Metrics
- Events successfully sent > 99%
- No playback blocking
- Event delivery latency < 5 seconds
- Zero data loss on page unload
- Debug logging helpful for development

## References
- Beacon API: https://developer.mozilla.org/en-US/docs/Web/API/Beacon_API
- Navigator.sendBeacon: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon
- Implementation Guide: `/docs/architecture/video-player-implementation-guide.md` (lines 649-837)

## Estimated Effort
**Medium** - 4-5 hours
