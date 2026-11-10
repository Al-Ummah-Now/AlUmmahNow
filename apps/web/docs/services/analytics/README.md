# Video Analytics Service

**Phase 1.5**: Basic analytics event tracking (IMPLEMENTED)
**Phase 3**: Advanced analytics event tracking (IMPLEMENTED)

## Overview

The VideoAnalytics service tracks video playback events with:
- Event queueing and batch sending (every 30 seconds)
- Automatic flush on page unload and visibility changes
- LocalStorage backup for offline scenarios
- Non-blocking implementation (never blocks video playback)
- Session-based tracking
- **Phase 3**: Advanced tracking (seek, progress, quality changes, buffering, quartiles)

## Installation

```typescript
import { VideoAnalytics } from '@/services/analytics';
// or
import { VideoAnalytics } from '@/services/analytics/video-analytics';
```

## Basic Usage (Phase 1.5)

```typescript
// Create an analytics instance
const analytics = new VideoAnalytics('video-id', 'user-id');

// Track basic events
analytics.trackReady();
analytics.trackPlay();
analytics.trackPause();
analytics.trackComplete();
analytics.trackError({ code: 'MEDIA_ERR_NETWORK', message: 'Network error' });

// Clean up when done
analytics.destroy();
```

## Advanced Usage (Phase 3)

```typescript
// Create analytics instance
const analytics = new VideoAnalytics('video-id', 'user-id');

// Track seeking
player.on('seeking', () => {
  seekStartTime = player.currentTime();
});
player.on('seeked', () => {
  analytics.trackSeek(seekStartTime, player.currentTime());
});

// Track progress (throttled to every 10 seconds)
let lastProgressTrack = 0;
player.on('timeupdate', () => {
  const now = Date.now();
  if (now - lastProgressTrack >= 10000) {
    const time = player.currentTime();
    const duration = player.duration();
    const percentage = (time / duration) * 100;
    analytics.trackProgress(time, duration, percentage);
    lastProgressTrack = now;
  }
});

// Track buffering
player.on('waiting', () => {
  analytics.trackBufferStart();
});
player.on('canplay', () => {
  analytics.trackBufferEnd(); // Auto-calculates duration
});

// Track quality changes
qualityLevels.on('change', () => {
  analytics.trackQualityChange(previousQuality, currentQuality);
});

// Track quartiles (25%, 50%, 75%)
player.on('timeupdate', () => {
  const percentage = (player.currentTime() / player.duration()) * 100;
  if (percentage >= 25 && percentage < 50) {
    analytics.trackQuartile(25);
  } else if (percentage >= 50 && percentage < 75) {
    analytics.trackQuartile(50);
  } else if (percentage >= 75) {
    analytics.trackQuartile(75);
  }
});
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
| Event Type | Description | When Fired | Immediate Flush |
|------------|-------------|------------|-----------------|
| `READY` | Player initialized and ready | Player ready callback | No |
| `PLAY` | Playback started | Play button clicked or autoplay | No |
| `PAUSE` | Playback paused | Pause button clicked | No |
| `ENDED` | Playback completed | Video reaches end | **Yes** |
| `ERROR` | Error occurred | Any playback error | **Yes** |

### Phase 2 Events (Implemented)
| Event Type | Description | When Fired | Immediate Flush |
|------------|-------------|------------|-----------------|
| `SPEED_CHANGE` | Playback speed changed | Speed selector used | No |
| `FULLSCREEN_ENTER` | Fullscreen mode entered | Fullscreen button clicked | No |
| `FULLSCREEN_EXIT` | Fullscreen mode exited | Exit fullscreen | No |
| `PIP_ENTER` | Picture-in-Picture entered | PiP button clicked | No |
| `PIP_EXIT` | Picture-in-Picture exited | Exit PiP | No |

### Phase 3 Advanced Analytics (Implemented)
| Event Type | Description | When Fired | Throttling | Deduplication |
|------------|-------------|------------|------------|---------------|
| `SEEK` | User seeked to different time | After seek completes | No | No |
| `TIMEUPDATE` | Playback progress update | Every 10 seconds during playback | **Yes (10s)** | No |
| `QUALITY_CHANGE` | Video quality changed | Quality selector changed | No | No |
| `BUFFER_START` | Buffering started | Video waiting for data | No | No |
| `BUFFER_END` | Buffering ended | Buffering complete | No | No |
| `QUARTILE_25` | 25% watched | Playback reaches 25% | No | **Yes (once per session)** |
| `QUARTILE_50` | 50% watched | Playback reaches 50% | No | **Yes (once per session)** |
| `QUARTILE_75` | 75% watched | Playback reaches 75% | No | **Yes (once per session)** |

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
- Page hide / leave (`pagehide` event; `beforeunload` is never used)
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

## Phase 3 Methods API Reference

### `trackSeek(fromTime: number, toTime: number): void`

Tracks when user seeks to a different position in the video.

**Parameters:**
- `fromTime` - Previous playback position in seconds
- `toTime` - New playback position in seconds

**Event Data:**
```typescript
{
  fromTime: number,        // Starting position
  toTime: number,          // Ending position
  seekDistance: number,    // toTime - fromTime
  isForward: boolean       // true if seeking forward
}
```

**Usage:**
```typescript
let seekStartTime = 0;
player.on('seeking', () => {
  seekStartTime = player.currentTime();
});
player.on('seeked', () => {
  analytics.trackSeek(seekStartTime, player.currentTime());
});
```

### `trackProgress(currentTime: number, duration: number, percentage: number): void`

Tracks playback progress at intervals. **Must be throttled** to avoid excessive events.

**Parameters:**
- `currentTime` - Current playback position in seconds
- `duration` - Total video duration in seconds
- `percentage` - Playback progress percentage (0-100)

**Event Data:**
```typescript
{
  currentTime: number,     // Current position
  duration: number,        // Total duration
  percentage: number,      // Progress (0-100)
  remainingTime: number    // duration - currentTime
}
```

**Throttling:** This method should be called every 5-10 seconds, not on every `timeupdate` event (which fires ~4 times per second).

**Usage:**
```typescript
let lastProgressTrack = 0;
const PROGRESS_INTERVAL = 10000; // 10 seconds

player.on('timeupdate', () => {
  const now = Date.now();
  if (now - lastProgressTrack >= PROGRESS_INTERVAL) {
    const time = player.currentTime();
    const duration = player.duration();
    analytics.trackProgress(time, duration, (time / duration) * 100);
    lastProgressTrack = now;
  }
});
```

### `trackQualityChange(fromQuality: string, toQuality: string): void`

Tracks video quality changes (e.g., 720p to 1080p).

**Parameters:**
- `fromQuality` - Previous quality level (e.g., "720p", "auto")
- `toQuality` - New quality level (e.g., "1080p", "auto")

**Event Data:**
```typescript
{
  fromQuality: string,     // Previous quality
  toQuality: string,       // New quality
  isUpgrade: boolean,      // true if quality increased
  isAutomatic: boolean     // true if auto quality selection
}
```

**Usage:**
```typescript
let previousQuality = 'auto';
qualityLevels.on('change', () => {
  const currentQuality = qualityLevels[selectedIndex].height + 'p';
  analytics.trackQualityChange(previousQuality, currentQuality);
  previousQuality = currentQuality;
});
```

### `trackBufferStart(): void`

Tracks when buffering starts. Must be paired with `trackBufferEnd()`.

**Event Data:**
```typescript
{
  timestamp: number        // When buffering started
}
```

**Usage:**
```typescript
player.on('waiting', () => {
  analytics.trackBufferStart();
});
```

### `trackBufferEnd(duration?: number): void`

Tracks when buffering ends. Auto-calculates duration if `trackBufferStart()` was called.

**Parameters:**
- `duration` (optional) - Buffering duration in milliseconds

**Event Data:**
```typescript
{
  duration: number,        // Duration in milliseconds
  durationSeconds: number  // Duration in seconds
}
```

**Usage:**
```typescript
// Automatic duration calculation (recommended)
player.on('waiting', () => analytics.trackBufferStart());
player.on('canplay', () => analytics.trackBufferEnd());

// Manual duration
const bufferStart = Date.now();
player.on('canplay', () => {
  analytics.trackBufferEnd(Date.now() - bufferStart);
});
```

### `trackQuartile(quartile: 25 | 50 | 75): void`

Tracks quartile milestones. **Automatically deduplicated** - each quartile only fires once per session.

**Parameters:**
- `quartile` - Which quartile was reached (25, 50, or 75)

**Event Data:**
```typescript
{
  quartile: 25 | 50 | 75,  // Quartile reached
  percentage: number       // Same as quartile value
}
```

**Deduplication:** The VideoAnalytics service ensures each quartile is only tracked once per playback session, even if called multiple times.

**Usage:**
```typescript
player.on('timeupdate', () => {
  const percentage = (player.currentTime() / player.duration()) * 100;

  if (percentage >= 25 && percentage < 50) {
    analytics.trackQuartile(25); // Only fires once
  } else if (percentage >= 50 && percentage < 75) {
    analytics.trackQuartile(50); // Only fires once
  } else if (percentage >= 75 && percentage < 100) {
    analytics.trackQuartile(75); // Only fires once
  }
});
```

## Performance Considerations

### Phase 1.5 Performance
- **Non-blocking**: All network requests are asynchronous
- **Batching**: Reduces network requests by 95%+
- **keepalive flag**: Ensures events send even on page unload
- **LocalStorage fallback**: Prevents data loss
- **Memory efficient**: Queue limited to batch size

### Phase 3 Performance Optimizations

#### Progress Tracking Throttling
**Problem:** The `timeupdate` event fires approximately 4 times per second during playback. Without throttling, this would generate 240 events per minute.

**Solution:** Progress tracking is throttled to once per 10 seconds:
- Reduces events from 240/min to 6/min (96% reduction)
- Sufficient granularity for analytics
- No impact on user experience

**Implementation:**
```typescript
let lastProgressTrack = 0;
const PROGRESS_INTERVAL = 10000; // 10 seconds

player.on('timeupdate', () => {
  const now = Date.now();
  if (now - lastProgressTrack >= PROGRESS_INTERVAL) {
    // Track progress
    lastProgressTrack = now;
  }
});
```

#### Quartile Deduplication
**Problem:** `timeupdate` events fire continuously in each quartile range, potentially triggering duplicate quartile events.

**Solution:** Quartiles are deduplicated at two levels:
1. **Application level** (CustomVideoPlayer): Uses `Set` to track which quartiles have been fired
2. **Service level** (VideoAnalytics): Internal `quartilesFired` Set ensures each quartile only fires once

**Benefits:**
- Zero duplicate quartile events
- Clean analytics data
- Standard industry practice for video engagement metrics

#### Buffering Duration Auto-Calculation
**Problem:** Tracking buffering duration requires manual timestamp management.

**Solution:** `trackBufferStart()` stores the start timestamp internally, and `trackBufferEnd()` auto-calculates the duration:
- No manual timestamp tracking needed
- Prevents calculation errors
- Cleaner code

**Example:**
```typescript
// Simple and clean
player.on('waiting', () => analytics.trackBufferStart());
player.on('canplay', () => analytics.trackBufferEnd());
// Duration is calculated automatically
```

## Privacy Considerations

- User ID is optional (supports anonymous tracking)
- Session-based tracking (no persistent cookies)
- No PII collected in basic events
- Client-side data only (no server tracking without consent)

## Event Timeline Visualization

```
Video Playback Timeline:
┌────────────────────────────────────────────────────────────────┐
│ READY → PLAY → TIMEUPDATE ─┬─ 25% → QUARTILE_25               │
│                             │                                  │
│   ↓ User seeks              ├─ 50% → QUARTILE_50               │
│ SEEKING → SEEKED            │                                  │
│                             ├─ 75% → QUARTILE_75               │
│   ↓ Buffering               │                                  │
│ BUFFER_START → BUFFER_END   └─ 100% → ENDED                    │
│                                                                 │
│   ↓ Quality change                                             │
│ QUALITY_CHANGE (720p → 1080p)                                  │
│                                                                 │
│   ↓ User pauses                                                │
│ PAUSE → ... → PLAY                                             │
│                                                                 │
│   ↓ Error occurs                                               │
│ ERROR [immediate flush]                                        │
└────────────────────────────────────────────────────────────────┘

Throttling & Deduplication:
- TIMEUPDATE: Fired every 10 seconds (throttled)
- QUARTILE_*: Fired once per session (deduplicated)
- SEEK: Fired on each seek (no throttle)
- BUFFER_*: Fired on each buffer event (no throttle)
- QUALITY_CHANGE: Fired on each change (no throttle)
```

## Integration Status

### Phase 1.5 - Basic Analytics ✅ IMPLEMENTED
- VideoAnalytics service created
- Basic event tracking (ready, play, pause, ended, error)
- Integrated in CustomVideoPlayer
- Batch sending and flushing
- LocalStorage backup

### Phase 3 - Advanced Analytics ✅ IMPLEMENTED
- **Service Layer**: All Phase 3 methods implemented in VideoAnalytics
  - `trackSeek()` - Seek event tracking
  - `trackProgress()` - Progress tracking with throttling
  - `trackQualityChange()` - Quality change detection
  - `trackBufferStart()` / `trackBufferEnd()` - Buffering metrics
  - `trackQuartile()` - Quartile milestones with deduplication
- **Component Layer**: Fully integrated in CustomVideoPlayer
  - Seek tracking via seeking/seeked events
  - Progress tracking with 10-second throttle
  - Buffering tracking via waiting/canplay events
  - Quality change tracking (if quality selector available)
  - Quartile tracking with dual-layer deduplication

## Next Steps

### Phase 4 - Analytics Backend (Pending)
- Implement `/api/analytics/video` endpoint
- Process and store analytics events
- Database schema for analytics storage
- Analytics dashboard for viewing metrics
- Real-time analytics streaming (optional)

### Future Enhancements
- Heatmap tracking (most watched segments)
- Drop-off analysis (where users stop watching)
- A/B testing support
- Custom event tracking
- Analytics export functionality

## References

- **Phase 1.5**: [Issue #49 - Basic Analytics Tracking](https://github.com/meywd/AlUmmahNow/issues/49)
- **Phase 3**: Integration Guide - `apps/web/PHASE_3_INTEGRATION_GUIDE.md`
- **Service Code**: `src/services/analytics/video-analytics.ts`
- **Component Integration**: `src/components/VideoPlayer/CustomVideoPlayer.tsx`
- **Type Definitions**: `src/services/analytics/types.ts`
- **MDN Fetch API**: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- **keepalive flag**: https://developer.mozilla.org/en-US/docs/Web/API/fetch#keepalive
