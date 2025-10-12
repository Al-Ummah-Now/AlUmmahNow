---
name: "[Phase 5.4] Performance Monitoring Setup"
about: Set up performance monitoring and metrics collection
title: "[Phase 5.4] Set Up Performance Monitoring"
labels: phase-5, video-player, monitoring, performance, observability
assignees: ''
---

## Overview
Implement comprehensive performance monitoring to track key video player metrics including load time, rebuffering, quality distribution, and user engagement.

## Acceptance Criteria
- [ ] Web Vitals tracked (LCP, FID, CLS)
- [ ] Custom video metrics tracked
- [ ] Real User Monitoring (RUM) integration
- [ ] Performance budgets defined
- [ ] Dashboard for metrics visualization
- [ ] Alerts for performance degradation
- [ ] Correlation with user engagement
- [ ] A/B test performance comparison
- [ ] Export to analytics platform
- [ ] Error rate monitoring

## Key Metrics to Track

```typescript
// apps/web/src/services/monitoring/video-performance.ts
export interface VideoPerformanceMetrics {
  // Load Performance
  timeToFirstFrame: number;
  playerInitTime: number;
  videoLoadTime: number;

  // Playback Quality
  rebufferCount: number;
  totalRebufferDuration: number;
  averageBitrate: number;
  qualityChanges: number;

  // User Engagement
  watchTime: number;
  completionRate: number;
  engagementRate: number;

  // Errors
  errorRate: number;
  errorTypes: Record<string, number>;
}

export class VideoPerformanceMonitor {
  private metrics: Partial<VideoPerformanceMetrics> = {};
  private startTime = Date.now();

  trackTimeToFirstFrame() {
    const ttff = Date.now() - this.startTime;
    this.metrics.timeToFirstFrame = ttff;

    // Send to analytics
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'video_ttff', {
        value: ttff,
        metric_name: 'time_to_first_frame'
      });
    }
  }

  trackRebuffer(duration: number) {
    this.metrics.rebufferCount = (this.metrics.rebufferCount || 0) + 1;
    this.metrics.totalRebufferDuration = 
      (this.metrics.totalRebufferDuration || 0) + duration;
  }

  trackQualityChange(from: string, to: string) {
    this.metrics.qualityChanges = (this.metrics.qualityChanges || 0) + 1;
  }

  getMetrics(): VideoPerformanceMetrics {
    return {
      timeToFirstFrame: this.metrics.timeToFirstFrame || 0,
      playerInitTime: this.metrics.playerInitTime || 0,
      videoLoadTime: this.metrics.videoLoadTime || 0,
      rebufferCount: this.metrics.rebufferCount || 0,
      totalRebufferDuration: this.metrics.totalRebufferDuration || 0,
      averageBitrate: this.metrics.averageBitrate || 0,
      qualityChanges: this.metrics.qualityChanges || 0,
      watchTime: this.metrics.watchTime || 0,
      completionRate: this.metrics.completionRate || 0,
      engagementRate: this.metrics.engagementRate || 0,
      errorRate: this.metrics.errorRate || 0,
      errorTypes: this.metrics.errorTypes || {}
    };
  }

  async sendToAnalytics() {
    const metrics = this.getMetrics();

    await fetch('/api/analytics/performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'video_performance',
        metrics,
        timestamp: new Date().toISOString()
      })
    });
  }
}
```

**Web Vitals integration:**
```typescript
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

function sendToAnalytics(metric: any) {
  fetch('/api/analytics/web-vitals', {
    method: 'POST',
    body: JSON.stringify(metric),
    keepalive: true
  });
}

getCLS(sendToAnalytics);
getFID(sendToAnalytics);
getFCP(sendToAnalytics);
getLCP(sendToAnalytics);
getTTFB(sendToAnalytics);
```

**Performance budgets:**
```typescript
// performance-budgets.json
{
  "video_player": {
    "timeToFirstFrame": {
      "target": 1000,
      "max": 2000
    },
    "rebufferRatio": {
      "target": 0.01,
      "max": 0.05
    },
    "errorRate": {
      "target": 0.001,
      "max": 0.01
    },
    "bundleSize": {
      "target": 400000,
      "max": 500000
    }
  }
}
```

## Testing
- [ ] Metrics collected accurately
- [ ] Dashboard displays correctly
- [ ] Alerts trigger appropriately
- [ ] Performance budgets enforced in CI
- [ ] Correlation with engagement visible

## Estimated Effort
**Medium** - 4-5 hours
