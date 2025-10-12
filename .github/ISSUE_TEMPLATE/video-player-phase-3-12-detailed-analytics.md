---
name: "[Phase 3.1] Detailed Analytics Event Tracking"
about: Expand analytics to track all player events
title: "[Phase 3.1] Implement Detailed Analytics Event Tracking"
labels: phase-3, video-player, enhancement, analytics
assignees: ''
---

## Overview
Expand the basic analytics service (Phase 1.5) to track comprehensive video events including seek, buffering, quality changes, quartiles, and engagement metrics.

## Acceptance Criteria
- [ ] Track seek events with from/to timestamps
- [ ] Track timeupdate events (throttled every 5s)
- [ ] Track quality change events
- [ ] Track buffering start/end with duration
- [ ] Track quartile milestones (25%, 50%, 75%, 100%)
- [ ] Track playback errors with details
- [ ] Track engagement actions (like, share, comment)
- [ ] Track playback speed changes
- [ ] Track fullscreen/PiP mode changes
- [ ] All events include video metadata context
- [ ] Events batched efficiently
- [ ] Analytics never block playback

## Implementation

**Expand VideoAnalytics class:**
```typescript
// Add to VideoAnalytics class (apps/web/src/services/analytics/video-analytics.ts)

export class VideoAnalytics {
  // ... existing code

  private watchedSegments: Set<number> = new Set();
  private quartiles: Set<number> = new Set();
  private bufferStartTime?: number;

  /**
   * Track seek event
   */
  trackSeek(from: number, to: number) {
    this.addEvent({
      eventType: VideoEventType.SEEK,
      data: { from, to, distance: Math.abs(to - from) }
    });
  }

  /**
   * Track progress (throttled timeupdate)
   */
  trackProgress(currentTime: number, duration: number) {
    // Track 10-second segments watched
    const segment = Math.floor(currentTime / 10);
    if (!this.watchedSegments.has(segment)) {
      this.watchedSegments.add(segment);
      this.addEvent({
        eventType: VideoEventType.TIMEUPDATE,
        data: { segment, currentTime, duration }
      });
    }

    // Check quartile milestones
    const progress = (currentTime / duration) * 100;
    [25, 50, 75].forEach(quartile => {
      if (progress >= quartile && !this.quartiles.has(quartile)) {
        this.trackQuartile(quartile);
      }
    });
  }

  /**
   * Track quartile milestone
   */
  trackQuartile(quartile: 25 | 50 | 75) {
    if (!this.quartiles.has(quartile)) {
      this.quartiles.add(quartile);
      this.addEvent({
        eventType: `quartile_${quartile}` as VideoEventType,
        relativeTime: Date.now() - this.startTime
      });
    }
  }

  /**
   * Track quality change
   */
  trackQualityChange(from: string, to: string) {
    this.addEvent({
      eventType: VideoEventType.QUALITY_CHANGE,
      data: { from, to }
    });
  }

  /**
   * Track buffering start
   */
  trackBufferingStart() {
    this.bufferStartTime = Date.now();
    this.addEvent({
      eventType: VideoEventType.BUFFER_START,
      relativeTime: Date.now() - this.startTime
    });
  }

  /**
   * Track buffering end
   */
  trackBufferingEnd() {
    if (this.bufferStartTime) {
      const bufferDuration = Date.now() - this.bufferStartTime;
      this.addEvent({
        eventType: VideoEventType.BUFFER_END,
        data: { duration: bufferDuration },
        relativeTime: Date.now() - this.startTime
      });
      this.bufferStartTime = undefined;
    }
  }

  /**
   * Track engagement action
   */
  trackEngagement(action: 'like' | 'dislike' | 'share' | 'comment') {
    this.addEvent({
      eventType: action as any,
      relativeTime: Date.now() - this.startTime
    });
  }

  /**
   * Track playback speed change
   */
  trackSpeedChange(speed: number) {
    this.addEvent({
      eventType: 'speed_change' as any,
      data: { speed }
    });
  }

  /**
   * Track fullscreen mode change
   */
  trackFullscreenChange(isFullscreen: boolean) {
    this.addEvent({
      eventType: 'fullscreen_change' as any,
      data: { isFullscreen }
    });
  }

  /**
   * Track Picture-in-Picture mode
   */
  trackPictureInPicture(isActive: boolean) {
    this.addEvent({
      eventType: 'pip_change' as any,
      data: { isActive }
    });
  }

  /**
   * Get analytics summary for current session
   */
  getSessionSummary() {
    return {
      sessionId: this.sessionId,
      videoId: this.videoId,
      userId: this.userId,
      watchedSegments: Array.from(this.watchedSegments),
      quartiles: Array.from(this.quartiles),
      totalWatchTime: Date.now() - this.startTime,
      eventsTracked: this.eventQueue.length
    };
  }

  /**
   * Check if quartile reached
   */
  hasReachedQuartile(quartile: number): boolean {
    return this.quartiles.has(quartile);
  }
}
```

**Integration in CustomVideoPlayer:**
```typescript
// Add to setupPlayerEvents in CustomVideoPlayer.tsx

player.on('seeking', () => {
  const from = (player as any).lastSeekPosition || 0;
  const to = player.currentTime();
  analyticsRef.current?.trackSeek(from, to);
  (player as any).lastSeekPosition = to;
});

player.on('timeupdate', throttle(() => {
  const currentTime = player.currentTime();
  const duration = player.duration();
  analyticsRef.current?.trackProgress(currentTime, duration);
}, 5000));

player.on('waiting', () => {
  analyticsRef.current?.trackBufferingStart();
});

player.on('playing', () => {
  analyticsRef.current?.trackBufferingEnd();
});

player.on('ratechange', () => {
  analyticsRef.current?.trackSpeedChange(player.playbackRate());
});

player.on('fullscreenchange', () => {
  analyticsRef.current?.trackFullscreenChange(player.isFullscreen());
});
```

## Testing
- [ ] All events tracked correctly
- [ ] Throttling prevents event spam
- [ ] Quartiles fire only once
- [ ] Buffering duration accurate
- [ ] Seek distance calculated
- [ ] No performance impact
- [ ] Events batched properly

## Dependencies
- Phase 1.5: Basic analytics ✓
- Phase 2: Player features ✓

## Estimated Effort
**Small** - 2-3 hours
