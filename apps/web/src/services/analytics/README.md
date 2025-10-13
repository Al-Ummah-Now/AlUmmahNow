# Video Analytics Service

**Phase 1.5**: Basic analytics event tracking for video player

## Overview

The VideoAnalytics service tracks video playback events with:
- Event queueing and batch sending (every 30 seconds)
- Automatic flush on page unload and visibility changes
- LocalStorage backup for offline scenarios
- Non-blocking implementation (never blocks video playback)
- Session-based tracking

## Installation

```typescript
import { VideoAnalytics } from '@/services/analytics';
// or
import { VideoAnalytics } from '@/services/analytics/video-analytics';
```

## Basic Usage

```typescript
// Create an analytics instance
const analytics = new VideoAnalytics('video-id', 'user-id');

// Track events
analytics.trackReady();
analytics.trackPlay();
analytics.trackPause();
analytics.trackComplete();
analytics.trackError({ code: 'MEDIA_ERR_NETWORK', message: 'Network error' });

// Clean up when done
analytics.destroy();
```

## Integration with CustomVideoPlayer

```typescript
import { CustomVideoPlayer } from '@/components/VideoPlayer';

<CustomVideoPlayer
  videoId="video-123"
  userId="user-456"
  sources={[
    { src: 'https://example.com/video.m3u8', type: 'application/x-mpegURL' }
  ]}
  enableAnalytics={true} // Enable analytics tracking
/>
```

## Singleton Factory Pattern

For managing multiple video players:

```typescript
import { getVideoAnalytics, destroyVideoAnalytics, clearAllAnalytics } from '@/services/analytics';

// Get or create analytics instance
const analytics = getVideoAnalytics('video-id', 'user-id');
analytics.trackPlay();

// Destroy specific instance
destroyVideoAnalytics('video-id', 'user-id');

// Clear all instances
clearAllAnalytics();
```

## Configuration

```typescript
const analytics = new VideoAnalytics('video-id', 'user-id', {
  endpoint: '/api/analytics/video',  // API endpoint
  batchSize: 20,                     // Max events before flush
  flushInterval: 30000,              // Flush interval (ms)
  enableDebugLogging: true           // Enable debug logs
});
```

## Event Types

### Phase 1.5 (Implemented)
- `READY` - Player initialized and ready
- `PLAY` - Playback started
- `PAUSE` - Playback paused
- `ENDED` - Playback completed
- `ERROR` - Error occurred

### Phase 3 (Defined, Not Implemented)
- `SEEK` - User seeked to different time
- `TIMEUPDATE` - Playback progress update
- `QUALITY_CHANGE` - Video quality changed
- `BUFFER_START` - Buffering started
- `BUFFER_END` - Buffering ended
- `QUARTILE_25` - 25% watched
- `QUARTILE_50` - 50% watched
- `QUARTILE_75` - 75% watched

## Event Structure

```typescript
{
  videoId: string;        // Video identifier
  userId?: string;        // User identifier (optional)
  sessionId: string;      // Unique session ID
  eventType: string;      // Event type (PLAY, PAUSE, etc.)
  timestamp: string;      // ISO 8601 timestamp
  relativeTime: number;   // Milliseconds since player init
  data?: object;          // Optional event-specific data
}
```

## Features

### Batch Sending
Events are queued and sent in batches to reduce network overhead:
- Batch size: 20 events (configurable)
- Interval: 30 seconds (configurable)
- Immediate flush for: `ENDED` and `ERROR` events

### Automatic Flushing
Events are automatically flushed on:
- Page unload (`beforeunload` event)
- Tab hidden (`visibilitychange` event)
- Timer interval (every 30 seconds)
- Batch size reached (20 events)

### LocalStorage Backup
Failed requests are backed up to localStorage:
- Prevents data loss on network failures
- Automatic retry on next flush
- Stored in `pendingVideoAnalytics` key

### Session Tracking
Each playback session gets a unique session ID:
- Format: `{timestamp}-{random}`
- Persists for entire video session
- New session for each player instance

## Testing

Run analytics tests:
```bash
pnpm test src/services/analytics/__tests__/video-analytics.test.ts
```

## API Endpoint (To Be Implemented)

The analytics service sends events to `/api/analytics/video`:

**Request:**
```json
POST /api/analytics/video
Content-Type: application/json

{
  "events": [
    {
      "videoId": "video-123",
      "userId": "user-456",
      "sessionId": "1234567890-abc123",
      "eventType": "play",
      "timestamp": "2025-01-01T12:00:00.000Z",
      "relativeTime": 1500,
      "data": {}
    }
  ]
}
```

**Response:**
```json
HTTP 200 OK
```

## Debug Logging

Enable debug logging in development:
```typescript
const analytics = new VideoAnalytics('video-id', 'user-id', {
  enableDebugLogging: true
});
```

Console output:
```
[VideoAnalytics] play { videoId: "video-123", sessionId: "...", ... }
[VideoAnalytics] Flushed 5 events
[VideoAnalytics] Stored 3 events locally
```

## Performance Considerations

- **Non-blocking**: All network requests are asynchronous
- **Batching**: Reduces network requests by 95%+
- **keepalive flag**: Ensures events send even on page unload
- **LocalStorage fallback**: Prevents data loss
- **Memory efficient**: Queue limited to batch size

## Privacy Considerations

- User ID is optional (supports anonymous tracking)
- Session-based tracking (no persistent cookies)
- No PII collected in basic events
- Client-side data only (no server tracking without consent)

## Next Steps (Phase 3)

Phase 3 will add advanced analytics:
- Seek tracking
- Progress tracking (timeupdate)
- Quality change tracking
- Buffering metrics
- Quartile milestones (25%, 50%, 75%)
- Advanced error analytics

## References

- Issue: [#49 - Phase 1.5 Basic Analytics Tracking](https://github.com/meywd/AlUmmahNow/issues/49)
- Implementation Guide: `/docs/architecture/video-player-implementation-guide.md`
- MDN Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- keepalive flag: https://developer.mozilla.org/en-US/docs/Web/API/fetch#keepalive
