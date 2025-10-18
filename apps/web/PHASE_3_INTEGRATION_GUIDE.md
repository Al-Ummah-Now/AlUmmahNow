# Phase 3: Advanced Analytics Integration Guide

## Overview

Phase 3 implements advanced video analytics tracking for comprehensive user engagement metrics. This document provides a reference implementation guide for developers who want to integrate similar analytics tracking in other video players.

**Status**: ✅ **FULLY IMPLEMENTED** in CustomVideoPlayer.tsx

## What's Included

Phase 3 adds five advanced tracking capabilities:

1. **Seek Tracking** - Track when users jump to different video positions
2. **Progress Tracking** - Monitor playback progress at regular intervals
3. **Quartile Milestones** - Track 25%, 50%, 75% completion
4. **Buffering Metrics** - Measure buffering frequency and duration
5. **Quality Change Tracking** - Monitor quality level changes

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    CustomVideoPlayer                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Video.js Player Events                                │  │
│  │  - seeking/seeked                                      │  │
│  │  - timeupdate (throttled)                              │  │
│  │  - waiting/canplay                                     │  │
│  │  - qualityLevels.on('change')                          │  │
│  └────────────────────┬──────────────────────────────────┘  │
│                       │                                      │
│                       ▼                                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  VideoAnalytics Service                                │  │
│  │  - trackSeek()                                         │  │
│  │  - trackProgress()                                     │  │
│  │  - trackQuartile()                                     │  │
│  │  - trackBufferStart() / trackBufferEnd()               │  │
│  │  - trackQualityChange()                                │  │
│  └────────────────────┬──────────────────────────────────┘  │
│                       │                                      │
│                       ▼                                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Event Queue (batched every 30s)                       │  │
│  │  - Max 20 events per batch                             │  │
│  │  - Auto-flush on page unload                           │  │
│  │  - LocalStorage backup                                 │  │
│  └────────────────────┬──────────────────────────────────┘  │
└────────────────────────┼──────────────────────────────────┘
                         │
                         ▼
              POST /api/analytics/video
              (To be implemented in Phase 4)
```

## Prerequisites

Before implementing Phase 3, ensure Phase 1.5 is working:

- [ ] VideoAnalytics service is initialized
- [ ] Basic events are tracked (ready, play, pause, ended, error)
- [ ] Events are batched and sent to server
- [ ] No console errors in development mode

## Files Modified

### 1. VideoAnalytics Service Enhancement
**File**: `src/services/analytics/video-analytics.ts`

Added methods:
- `trackSeek(fromTime, toTime)`
- `trackProgress(currentTime, duration, percentage)`
- `trackQualityChange(fromQuality, toQuality)`
- `trackBufferStart()`
- `trackBufferEnd(duration?)`
- `trackQuartile(quartile)`

Added state tracking:
- `quartilesFired: Set<25 | 50 | 75>` - Prevent duplicate quartile events
- `bufferStartTime?: number` - Auto-calculate buffering duration

### 2. CustomVideoPlayer Integration
**File**: `src/components/VideoPlayer/CustomVideoPlayer.tsx`

Added state:
- `seekStartTimeRef` - Track seek start position
- `lastProgressTrackRef` - Throttle progress events
- `quartilesFiredRef` - Component-level quartile deduplication

Added event listeners:
- `seeking` / `seeked` - Seek tracking
- `timeupdate` - Progress and quartile tracking (throttled)
- `waiting` / `canplay` - Buffering tracking
- `qualityLevels.on('change')` - Quality tracking

### 3. Type Definitions
**File**: `src/services/analytics/types.ts`

Added event types:
- `VideoEventType.SEEK`
- `VideoEventType.TIMEUPDATE`
- `VideoEventType.QUALITY_CHANGE`
- `VideoEventType.BUFFER_START`
- `VideoEventType.BUFFER_END`
- `VideoEventType.QUARTILE_25`
- `VideoEventType.QUARTILE_50`
- `VideoEventType.QUARTILE_75`

## Implementation Guide

### Step 1: Add State Tracking to Component

```typescript
// Add refs for Phase 3 tracking state
const seekStartTimeRef = useRef<number>(0);
const lastProgressTrackRef = useRef<number>(0);
const quartilesFiredRef = useRef<Set<25 | 50 | 75>>(new Set());
```

**Why refs?**: State doesn't need to trigger re-renders, and refs preserve values across renders.

### Step 2: Track Seek Events

```typescript
// Inside player.ready() callback

// Capture start position when seeking begins
player.on('seeking', () => {
  seekStartTimeRef.current = player.currentTime();
});

// Track the completed seek
player.on('seeked', () => {
  const fromTime = seekStartTimeRef.current;
  const toTime = player.currentTime();
  analyticsRef.current?.trackSeek(fromTime, toTime);
});
```

**Event data sent**:
```json
{
  "eventType": "seek",
  "data": {
    "fromTime": 10.5,
    "toTime": 45.2,
    "seekDistance": 34.7,
    "isForward": true
  }
}
```

### Step 3: Track Progress (Throttled)

```typescript
player.on('timeupdate', () => {
  const currentTime = player.currentTime();
  const duration = player.duration();

  // Guard against invalid duration
  if (!duration || isNaN(duration) || duration === 0) {
    return;
  }

  const now = Date.now();
  const percentage = (currentTime / duration) * 100;

  // Throttle to once per 10 seconds
  const PROGRESS_INTERVAL = 10000;
  if (now - lastProgressTrackRef.current >= PROGRESS_INTERVAL) {
    analyticsRef.current?.trackProgress(currentTime, duration, percentage);
    lastProgressTrackRef.current = now;
  }
});
```

**Why throttle?**: `timeupdate` fires ~4 times per second. Without throttling:
- 240 events/minute during playback
- Excessive network traffic
- Server overload

With 10-second throttle:
- 6 events/minute (96% reduction)
- Sufficient granularity for analytics
- Minimal performance impact

**Event data sent**:
```json
{
  "eventType": "timeupdate",
  "data": {
    "currentTime": 45.2,
    "duration": 180.0,
    "percentage": 25.1,
    "remainingTime": 134.8
  }
}
```

### Step 4: Track Quartiles (Deduplicated)

```typescript
player.on('timeupdate', () => {
  const currentTime = player.currentTime();
  const duration = player.duration();

  if (!duration || isNaN(duration) || duration === 0) {
    return;
  }

  const percentage = (currentTime / duration) * 100;

  // Track quartiles with component-level deduplication
  // Note: VideoAnalytics also deduplicates internally for safety
  if (percentage >= 25 && percentage < 50 && !quartilesFiredRef.current.has(25)) {
    analyticsRef.current?.trackQuartile(25);
    quartilesFiredRef.current.add(25);
  } else if (percentage >= 50 && percentage < 75 && !quartilesFiredRef.current.has(50)) {
    analyticsRef.current?.trackQuartile(50);
    quartilesFiredRef.current.add(50);
  } else if (percentage >= 75 && percentage < 100 && !quartilesFiredRef.current.has(75)) {
    analyticsRef.current?.trackQuartile(75);
    quartilesFiredRef.current.add(75);
  }
});
```

**Dual-layer deduplication**:
1. **Component level** (`quartilesFiredRef`): First line of defense
2. **Service level** (`VideoAnalytics.quartilesFired`): Ensures zero duplicates even if component logic changes

**Why deduplicate?**: Quartiles are engagement milestones tracked once per session. Duplicates would skew metrics.

**Event data sent**:
```json
{
  "eventType": "quartile_25",
  "data": {
    "quartile": 25,
    "percentage": 25
  }
}
```

### Step 5: Track Buffering

```typescript
// Track when buffering starts
player.on('waiting', () => {
  analyticsRef.current?.trackBufferStart();
});

// Track when buffering ends
player.on('canplay', () => {
  // Duration is auto-calculated from trackBufferStart()
  analyticsRef.current?.trackBufferEnd();
});
```

**Auto-duration calculation**:
- `trackBufferStart()` stores `bufferStartTime` internally
- `trackBufferEnd()` calculates `Date.now() - bufferStartTime`
- No manual timestamp tracking needed

**Event data sent**:
```json
// BUFFER_START
{
  "eventType": "buffer_start",
  "data": {
    "timestamp": 1736965200000
  }
}

// BUFFER_END
{
  "eventType": "buffer_end",
  "data": {
    "duration": 1250,
    "durationSeconds": 1.25
  }
}
```

### Step 6: Track Quality Changes (Optional)

```typescript
// Try to access quality levels API (if available)
const extPlayer = player as ExtendedPlayer;
if (typeof extPlayer.qualityLevels === 'function') {
  try {
    const qualityLevels = extPlayer.qualityLevels();
    let previousQuality = 'auto';

    qualityLevels.on('change', () => {
      const selectedIndex = qualityLevels.selectedIndex;
      if (selectedIndex >= 0 && selectedIndex < qualityLevels.length) {
        const currentLevel = qualityLevels[selectedIndex];
        const currentQuality = currentLevel.height ? `${currentLevel.height}p` : 'auto';

        analyticsRef.current?.trackQualityChange(previousQuality, currentQuality);
        previousQuality = currentQuality;
      }
    });
  } catch (err) {
    // Quality levels API not available
    if (process.env.NODE_ENV === 'development') {
      console.log('[CustomVideoPlayer] Quality levels API not available:', err);
    }
  }
}
```

**Note**: Quality tracking requires the Video.js quality levels plugin. It's optional and gracefully degrades if unavailable.

**Event data sent**:
```json
{
  "eventType": "quality_change",
  "data": {
    "fromQuality": "720p",
    "toQuality": "1080p",
    "isUpgrade": true,
    "isAutomatic": false
  }
}
```

## Expected Behavior

### Typical Playback Session

```
User Action                Analytics Event         Data Captured
──────────────────────────────────────────────────────────────────
Player loads              → READY                  Session ID created
User clicks play          → PLAY                   Playback started
10 seconds pass           → TIMEUPDATE             Progress: 10s / 180s
User seeks to 30s         → SEEK                   From 10s → 30s
10 more seconds pass      → TIMEUPDATE             Progress: 40s / 180s
Reaches 25%               → QUARTILE_25            Milestone reached
Network slow              → BUFFER_START           Buffering begins
Network recovers          → BUFFER_END             Duration: 2.3s
User changes quality      → QUALITY_CHANGE         720p → 1080p
Reaches 50%               → QUARTILE_50            Milestone reached
Reaches 75%               → QUARTILE_75            Milestone reached
Video ends                → ENDED                  Total watch time
```

### Throttling Behavior

**Progress Tracking**:
```
Time    Event           Tracked?    Reason
──────────────────────────────────────────────
0:00    timeupdate      ✅ Yes       First event
0:02    timeupdate      ❌ No        < 10s since last
0:05    timeupdate      ❌ No        < 10s since last
0:10    timeupdate      ✅ Yes       10s elapsed
0:15    timeupdate      ❌ No        < 10s since last
0:20    timeupdate      ✅ Yes       10s elapsed
```

**Quartile Tracking**:
```
Percentage   Event           Tracked?    Reason
─────────────────────────────────────────────────
24%          timeupdate      ❌ No        < 25%
25%          timeupdate      ✅ Yes       QUARTILE_25 fired
26%          timeupdate      ❌ No        Already fired
48%          timeupdate      ❌ No        < 50%
50%          timeupdate      ✅ Yes       QUARTILE_50 fired
51%          timeupdate      ❌ No        Already fired
```

## Testing Checklist

### Functional Testing

- [ ] **Seek Tracking**
  - [ ] Seek forward tracks correct from/to times
  - [ ] Seek backward tracks correct from/to times
  - [ ] `seekDistance` is calculated correctly
  - [ ] `isForward` flag is accurate

- [ ] **Progress Tracking**
  - [ ] Progress events fire every 10 seconds
  - [ ] No events between 10-second intervals
  - [ ] Percentage calculation is accurate
  - [ ] `remainingTime` is correct

- [ ] **Quartile Tracking**
  - [ ] 25% quartile fires once per session
  - [ ] 50% quartile fires once per session
  - [ ] 75% quartile fires once per session
  - [ ] No duplicate quartile events
  - [ ] Quartiles still fire if user seeks past them

- [ ] **Buffering Tracking**
  - [ ] `BUFFER_START` fires on buffering
  - [ ] `BUFFER_END` fires when buffering completes
  - [ ] Duration is calculated accurately
  - [ ] Multiple buffer events are tracked separately

- [ ] **Quality Change Tracking** (if applicable)
  - [ ] Quality changes are tracked
  - [ ] `isUpgrade` flag is correct
  - [ ] Manual quality changes tracked
  - [ ] Auto quality changes tracked

### Performance Testing

- [ ] **Event Volume**
  - [ ] Progress events: ~6 per minute (not 240)
  - [ ] Quartile events: max 3 per session
  - [ ] No excessive network traffic
  - [ ] Batch size stays under 20 events

- [ ] **Memory Usage**
  - [ ] No memory leaks on long playback
  - [ ] Event queue doesn't grow unbounded
  - [ ] Refs are cleaned up on unmount

- [ ] **Network Efficiency**
  - [ ] Events batched every 30 seconds
  - [ ] Immediate flush on `ENDED` and `ERROR`
  - [ ] `keepalive` flag ensures unload events send
  - [ ] Failed requests backed up to localStorage

### Error Handling

- [ ] **Edge Cases**
  - [ ] Handles `duration = 0` gracefully
  - [ ] Handles `duration = NaN` gracefully
  - [ ] Handles `currentTime > duration` edge case
  - [ ] Quality API missing doesn't throw errors

- [ ] **Cleanup**
  - [ ] Analytics destroyed on unmount
  - [ ] Event listeners removed
  - [ ] Refs cleared
  - [ ] No console errors after cleanup

## Debugging

### Enable Debug Logging

```typescript
const analytics = new VideoAnalytics(videoId, userId, {
  enableDebugLogging: true
});
```

**Console output**:
```
[VideoAnalytics] seek { fromTime: 10.5, toTime: 45.2, ... }
[VideoAnalytics] timeupdate { currentTime: 45.2, percentage: 25.1, ... }
[VideoAnalytics] quartile_25 { quartile: 25, percentage: 25 }
[VideoAnalytics] Quartile 50% already tracked, skipping
[VideoAnalytics] Flushed 8 events
```

### Common Issues

**Problem**: Progress events firing too frequently
- **Cause**: Throttle not working
- **Fix**: Verify `lastProgressTrackRef.current` is being updated
- **Check**: `now - lastProgressTrackRef.current >= PROGRESS_INTERVAL`

**Problem**: Duplicate quartile events
- **Cause**: Component-level deduplication not working
- **Fix**: Ensure `quartilesFiredRef.current.add()` is called
- **Check**: Service-level deduplication is backup, so events still deduplicated

**Problem**: Quality changes not tracked
- **Cause**: Quality levels API not available
- **Fix**: This is expected - quality tracking is optional
- **Check**: Look for console.log in development mode

**Problem**: Buffering duration is 0
- **Cause**: `trackBufferEnd()` called without `trackBufferStart()`
- **Fix**: Ensure both events are wired up
- **Check**: `bufferStartTime` is set in `trackBufferStart()`

## Performance Optimizations

### 1. Progress Throttling

**Impact**: 96% reduction in events (240/min → 6/min)

```typescript
// Bad: No throttling (240 events/min)
player.on('timeupdate', () => {
  analytics.trackProgress(time, duration, percentage);
});

// Good: Throttled to 10s (6 events/min)
let lastTrack = 0;
player.on('timeupdate', () => {
  if (Date.now() - lastTrack >= 10000) {
    analytics.trackProgress(time, duration, percentage);
    lastTrack = Date.now();
  }
});
```

### 2. Quartile Deduplication

**Impact**: Eliminates duplicate milestone events

```typescript
// Bad: Can fire multiple times
if (percentage >= 25) {
  analytics.trackQuartile(25);
}

// Good: Fires once per session
if (percentage >= 25 && !quartilesFired.has(25)) {
  analytics.trackQuartile(25);
  quartilesFired.add(25);
}
```

### 3. Event Batching

**Impact**: 95%+ reduction in network requests

```typescript
// Automatic in VideoAnalytics:
// - Queue events in memory
// - Flush every 30 seconds
// - Batch up to 20 events per request
// - Immediate flush on ENDED/ERROR
```

## Metrics & Analytics

### Key Performance Indicators (KPIs)

**Engagement Metrics**:
- **Quartile Completion Rate**: % of users reaching 25%, 50%, 75%
- **Average Watch Time**: Mean of `currentTime` from progress events
- **Completion Rate**: % of users triggering `ENDED` event

**Quality of Experience (QoE)**:
- **Buffering Frequency**: Count of `BUFFER_START` events per session
- **Total Buffering Time**: Sum of buffering durations
- **Quality Distribution**: % of time at each quality level

**User Behavior**:
- **Seek Frequency**: Number of seeks per session
- **Average Seek Distance**: Mean of `|seekDistance|`
- **Drop-off Points**: Where users pause or stop watching

### Sample Analytics Query

```sql
-- Calculate average watch time by video
SELECT
  videoId,
  AVG(data->>'currentTime') as avg_watch_time,
  COUNT(CASE WHEN eventType = 'quartile_25' THEN 1 END) / COUNT(DISTINCT sessionId) as q25_rate,
  COUNT(CASE WHEN eventType = 'quartile_50' THEN 1 END) / COUNT(DISTINCT sessionId) as q50_rate,
  COUNT(CASE WHEN eventType = 'quartile_75' THEN 1 END) / COUNT(DISTINCT sessionId) as q75_rate
FROM analytics_events
WHERE eventType IN ('timeupdate', 'quartile_25', 'quartile_50', 'quartile_75')
GROUP BY videoId;
```

## Next Steps

### Phase 4: Analytics Backend

Now that Phase 3 is complete, implement the backend to process these events:

1. **API Endpoint**: Create `/api/analytics/video` to receive events
2. **Database Schema**: Design schema for analytics storage
3. **Event Processing**: Validate and process incoming events
4. **Aggregation**: Calculate metrics (avg watch time, quartile rates, etc.)
5. **Dashboard**: Build analytics dashboard for viewing metrics

### Future Enhancements

- **Heatmap Tracking**: Track most-watched segments (needs `timeupdate` data)
- **A/B Testing**: Add experiment IDs to events
- **Real-time Analytics**: WebSocket streaming for live metrics
- **Custom Events**: Generic event tracking API
- **Export Functionality**: CSV/JSON export of analytics data

## Related Files

- **Service Implementation**: `src/services/analytics/video-analytics.ts`
- **Component Integration**: `src/components/VideoPlayer/CustomVideoPlayer.tsx`
- **Type Definitions**: `src/services/analytics/types.ts`
- **README**: `src/services/analytics/README.md`
- **Tests**: `src/services/analytics/__tests__/video-analytics.test.ts`

## Support

For questions or issues:
1. Check the [Analytics README](src/services/analytics/README.md)
2. Review implementation in `CustomVideoPlayer.tsx` (lines 310-411)
3. Enable debug logging for troubleshooting
4. Create a GitHub issue with logs and reproduction steps

---

**Document Version**: 1.0.0
**Last Updated**: January 2025
**Status**: ✅ Phase 3 Fully Implemented
