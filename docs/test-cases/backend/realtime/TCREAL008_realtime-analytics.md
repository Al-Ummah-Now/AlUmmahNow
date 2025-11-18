# TC-REAL-008: Real-time Analytics

## Test Case Information

- **Test ID**: TC-REAL-008
- **Title**: Real-time Analytics
- **Priority**: Medium
- **Type**: Analytics
- **Category**: Realtime Features
- **Estimated Duration**: 15 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that real-time analytics data is collected, processed, and delivered accurately including viewer metrics, engagement statistics, and performance indicators with minimal latency.

## Test Prerequisites

- WebSocket server running at `wss://ws.alummahnow.net`
- Analytics processing service configured
- Real-time data aggregation pipelines
- Test analytics events and metrics
- Analytics dashboard access

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: 3G, 4G, WiFi, Ethernet
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
interface AnalyticsEvent {
  id: string;
  type: 'view' | 'engagement' | 'performance' | 'conversion';
  userId?: string;
  sessionId: string;
  timestamp: number;
  data: any;
  metadata: {
    userAgent: string;
    ip: string;
    location?: string;
    device: string;
  };
}

interface RealtimeMetrics {
  activeUsers: number;
  totalViews: number;
  engagementRate: number;
  averageWatchTime: number;
  bounceRate: number;
  conversionRate: number;
  performanceScore: number;
}

const testAnalyticsEvents: AnalyticsEvent[] = [
  {
    id: 'analytics-001',
    type: 'view',
    userId: 'user-001',
    sessionId: 'session-001',
    timestamp: Date.now(),
    data: { videoId: 'video-001', duration: 300 },
    metadata: {
      userAgent: 'Chrome/120.0',
      ip: '192.168.1.1',
      location: 'US',
      device: 'desktop'
    }
  }
];
```

## Test Scenarios

### Scenario 1: Real-time User Activity Tracking

**Test Steps:**

1. **Setup Analytics Tracking**
   ```typescript
   const analyticsClient = await createWebSocketClient(analyticsToken);
   await analyticsClient.connect();
   await analyticsClient.subscribe('realtime-analytics');
   
   const analyticsUpdates: RealtimeMetrics[] = [];
   analyticsClient.on('metrics-update', (metrics) => {
     analyticsUpdates.push(metrics);
   });
   ```

2. **Simulate User Activity**
   ```typescript
   // Simulate multiple user sessions
   const sessions = [];
   for (let i = 0; i < 100; i++) {
     const session = await simulateUserSession({
       userId: `user-${i}`,
       videoId: 'video-analytics-test',
       duration: Math.random() * 600, // 0-10 minutes
       interactions: Math.floor(Math.random() * 10)
     });
     sessions.push(session);
   }
   
   // Wait for analytics processing
   await waitFor(() => analyticsUpdates.length > 0, 5000);
   ```

3. **Verify Metrics Accuracy**
   ```typescript
   const latestMetrics = analyticsUpdates[analyticsUpdates.length - 1];
   
   // Verify active users
   expect(latestMetrics.activeUsers).toBeGreaterThan(0);
   expect(latestMetrics.activeUsers).toBeLessThanOrEqual(100);
   
   // Verify total views
   expect(latestMetrics.totalViews).toBe(sessions.length);
   
   // Verify engagement rate calculation
   const expectedEngagement = sessions.filter(s => s.interactions > 0).length / sessions.length;
   expect(Math.abs(latestMetrics.engagementRate - expectedEngagement)).toBeLessThan(0.1);
   ```

### Scenario 2: Live Stream Analytics

**Test Steps:**

1. **Setup Stream Analytics**
   ```typescript
   await analyticsClient.subscribe('stream-analytics', { streamId: 'stream-analytics-test' });
   
   const streamMetrics: any[] = [];
   analyticsClient.on('stream-metrics', (metrics) => {
     streamMetrics.push(metrics);
   });
   ```

2. **Simulate Live Stream Activity**
   ```typescript
   // Start live stream
   const stream = await startLiveStream({
     id: 'stream-analytics-test',
     title: 'Analytics Test Stream'
   });
   
   // Simulate viewer joins and leaves
   const viewerEvents = [];
   for (let i = 0; i < 50; i++) {
     const joinEvent = await simulateViewerJoin(stream.id, `viewer-${i}`);
     viewerEvents.push(joinEvent);
     
     // Some viewers leave
     if (i % 3 === 0 && i > 0) {
       const leaveEvent = await simulateViewerLeave(stream.id, `viewer-${i - 2}`);
       viewerEvents.push(leaveEvent);
     }
     
     await new Promise(resolve => setTimeout(resolve, 100));
   }
   
   // Wait for metrics aggregation
   await waitFor(() => streamMetrics.length > 0, 3000);
   ```

3. **Verify Stream Analytics**
   ```typescript
   const latestStreamMetrics = streamMetrics[streamMetrics.length - 1];
   
   // Verify viewer count
   const expectedViewers = viewerEvents.filter(e => e.type === 'join').length - 
                          viewerEvents.filter(e => e.type === 'leave').length;
   expect(latestStreamMetrics.currentViewers).toBe(expectedViewers);
   
   // Verify peak viewers
   expect(latestStreamMetrics.peakViewers).toBeGreaterThan(0);
   expect(latestStreamMetrics.peakViewers).toBeGreaterThanOrEqual(latestStreamMetrics.currentViewers);
   
   // Verify average watch time
   expect(latestStreamMetrics.averageWatchTime).toBeGreaterThan(0);
   ```

### Scenario 3: Performance Analytics

**Test Steps:**

1. **Setup Performance Monitoring**
   ```typescript
   await analyticsClient.subscribe('performance-analytics');
   
   const performanceMetrics: any[] = [];
   analyticsClient.on('performance-metrics', (metrics) => {
     performanceMetrics.push(metrics);
   });
   ```

2. **Generate Performance Data**
   ```typescript
   // Simulate various performance scenarios
   const performanceScenarios = [
     { type: 'fast_load', loadTime: 500, bufferSize: 1000 },
     { type: 'slow_load', loadTime: 3000, bufferSize: 5000 },
     { type: 'buffering', loadTime: 1500, bufferSize: 10000 },
     { type: 'optimal', loadTime: 800, bufferSize: 2000 }
   ];
   
   for (const scenario of performanceScenarios) {
     await simulatePerformanceEvent({
       userId: `perf-user-${scenario.type}`,
       videoId: 'video-perf-test',
       ...scenario
     });
   }
   
   // Wait for aggregation
   await waitFor(() => performanceMetrics.length > 0, 5000);
   ```

3. **Verify Performance Analytics**
   ```typescript
   const latestPerfMetrics = performanceMetrics[performanceMetrics.length - 1];
   
   // Verify average load time
   expect(latestPerfMetrics.averageLoadTime).toBeGreaterThan(0);
   expect(latestPerfMetrics.averageLoadTime).toBeLessThan(5000);
   
   // Verify performance score
   expect(latestPerfMetrics.performanceScore).toBeGreaterThan(0);
   expect(latestPerfMetrics.performanceScore).toBeLessThanOrEqual(100);
   
   // Verify buffering metrics
   expect(latestPerfMetrics.bufferingEvents).toBeGreaterThan(0);
   expect(latestPerfMetrics.averageBufferTime).toBeGreaterThan(0);
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page, Browser } from '@playwright/test';
import { WebSocketClient } from '../helpers/websocket-client';
import { TestDataFactory } from '../helpers/test-data-factory';

test.describe('TC-REAL-008: Real-time Analytics', () => {
  let analyticsClient: WebSocketClient;
  let page: Page;
  let browser: Browser;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    
    const context = await browser.newContext();
    page = await context.newPage();
    
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'analytics@test.com');
    await page.fill('[data-testid="password"]', 'testpass123');
    await page.click('[data-testid="login-button"]');
    
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
    analyticsClient = new WebSocketClient(authToken!);
    await analyticsClient.connect();
  });

  test.afterAll(async () => {
    await analyticsClient.disconnect();
    await page.close();
  });

  test('should track real-time user activity accurately', async () => {
    await analyticsClient.subscribe('realtime-analytics');

    const analyticsUpdates: any[] = [];
    analyticsClient.on('metrics-update', (metrics) => {
      analyticsUpdates.push(metrics);
    });

    // Simulate user activity
    await page.goto('/en/videos/test-video-analytics');
    await page.waitForSelector('[data-testid="video-player"]');

    // Simulate multiple user sessions
    for (let i = 0; i < 10; i++) {
      await page.evaluate((sessionNum) => {
        window.simulateUserSession({
          userId: `user-${sessionNum}`,
          videoId: 'test-video-analytics',
          duration: Math.random() * 300,
          interactions: Math.floor(Math.random() * 5)
        });
      }, i);
    }

    // Wait for analytics processing
    await page.waitForTimeout(5000);

    // Verify metrics received
    expect(analyticsUpdates.length).toBeGreaterThan(0);

    const latestMetrics = analyticsUpdates[analyticsUpdates.length - 1];
    
    // Verify basic metrics
    expect(latestMetrics.activeUsers).toBeGreaterThan(0);
    expect(latestMetrics.totalViews).toBeGreaterThan(0);
    expect(latestMetrics.engagementRate).toBeGreaterThanOrEqual(0);
    expect(latestMetrics.engagementRate).toBeLessThanOrEqual(1);
  });

  test('should provide live stream analytics in real-time', async () => {
    await analyticsClient.subscribe('stream-analytics', { streamId: 'stream-test-001' });

    const streamMetrics: any[] = [];
    analyticsClient.on('stream-metrics', (metrics) => {
      streamMetrics.push(metrics);
    });

    // Start test stream
    await page.goto('/en/studio');
    await page.fill('[data-testid="stream-title"]', 'Analytics Test Stream');
    await page.click('[data-testid="start-stream"]');

    await page.waitForSelector('[data-testid="stream-status-live"]', { timeout: 10000 });
    const streamId = await page.getAttribute('[data-testid="stream-id"]', 'data-stream-id');

    // Simulate viewer activity
    for (let i = 0; i < 20; i++) {
      await page.evaluate((viewerNum, streamId) => {
        window.simulateViewerJoin(streamId, `viewer-${viewerNum}`);
      }, i, streamId);
      
      // Some viewers leave
      if (i % 4 === 0 && i > 0) {
        await page.evaluate((viewerNum, streamId) => {
          window.simulateViewerLeave(streamId, `viewer-${viewerNum}`);
        }, i - 2, streamId);
      }
      
      await page.waitForTimeout(200);
    }

    // Wait for metrics aggregation
    await page.waitForTimeout(3000);

    // Verify stream metrics
    expect(streamMetrics.length).toBeGreaterThan(0);

    const latestStreamMetrics = streamMetrics[streamMetrics.length - 1];
    
    expect(latestStreamMetrics.currentViewers).toBeGreaterThan(0);
    expect(latestStreamMetrics.peakViewers).toBeGreaterThan(0);
    expect(latestStreamMetrics.totalViews).toBeGreaterThan(0);
    expect(latestStreamMetrics.averageWatchTime).toBeGreaterThan(0);
  });

  test('should collect and process performance analytics', async () => {
    await analyticsClient.subscribe('performance-analytics');

    const performanceMetrics: any[] = [];
    analyticsClient.on('performance-metrics', (metrics) => {
      performanceMetrics.push(metrics);
    });

    // Simulate performance events
    const performanceScenarios = [
      { type: 'fast_load', loadTime: 500, bufferSize: 1000 },
      { type: 'slow_load', loadTime: 3000, bufferSize: 5000 },
      { type: 'buffering', loadTime: 1500, bufferSize: 10000 }
    ];

    for (const scenario of performanceScenarios) {
      await page.evaluate((scenario) => {
        window.simulatePerformanceEvent({
          userId: `perf-user-${scenario.type}`,
          videoId: 'video-perf-test',
          ...scenario
        });
      }, scenario);
    }

    // Wait for aggregation
    await page.waitForTimeout(5000);

    // Verify performance metrics
    expect(performanceMetrics.length).toBeGreaterThan(0);

    const latestPerfMetrics = performanceMetrics[performanceMetrics.length - 1];
    
    expect(latestPerfMetrics.averageLoadTime).toBeGreaterThan(0);
    expect(latestPerfMetrics.performanceScore).toBeGreaterThan(0);
    expect(latestPerfMetrics.performanceScore).toBeLessThanOrEqual(100);
    expect(latestPerfMetrics.bufferingEvents).toBeGreaterThan(0);
  });

  test('should update analytics dashboard in real-time', async () => {
    // Open analytics dashboard
    await page.goto('/en/analytics/dashboard');
    await page.waitForSelector('[data-testid="analytics-dashboard"]', { timeout: 10000 });

    // Get initial metrics
    const initialActiveUsers = await page.textContent('[data-testid="active-users"]');
    const initialTotalViews = await page.textContent('[data-testid="total-views"]');

    // Generate new activity
    await page.evaluate(() => {
      window.simulateUserActivity({
        sessions: 5,
        views: 10,
        interactions: 15
      });
    });

    // Wait for dashboard update
    await page.waitForTimeout(3000);

    // Verify updated metrics
    const updatedActiveUsers = await page.textContent('[data-testid="active-users"]');
    const updatedTotalViews = await page.textContent('[data-testid="total-views"]');

    expect(parseInt(updatedActiveUsers || '0')).toBeGreaterThan(parseInt(initialActiveUsers || '0'));
    expect(parseInt(updatedTotalViews || '0')).toBeGreaterThan(parseInt(initialTotalViews || '0'));

    // Verify real-time indicators
    const liveIndicator = await page.isVisible('[data-testid="live-indicator"]');
    expect(liveIndicator).toBe(true);
  });

  test('should handle high-volume analytics events efficiently', async () => {
    await analyticsClient.subscribe('high-volume-analytics');

    const highVolumeMetrics: any[] = [];
    analyticsClient.on('high-volume-metrics', (metrics) => {
      highVolumeMetrics.push(metrics);
    });

    const startTime = Date.now();

    // Generate high volume events
    for (let i = 0; i < 1000; i++) {
      await page.evaluate((eventNum) => {
        window.simulateAnalyticsEvent({
          id: `event-${eventNum}`,
          type: 'view',
          userId: `user-${eventNum}`,
          timestamp: Date.now(),
          data: { videoId: 'video-high-volume' }
        });
      }, i);
    }

    const endTime = Date.now();
    const processingTime = endTime - startTime;

    // Wait for processing
    await page.waitForTimeout(5000);

    // Verify processing efficiency
    expect(processingTime).toBeLessThan(10000); // Should process within 10 seconds
    expect(highVolumeMetrics.length).toBeGreaterThan(0);

    const latestMetrics = highVolumeMetrics[highVolumeMetrics.length - 1];
    expect(latestMetrics.processedEvents).toBeGreaterThan(900); // Allow minimal loss
    expect(latestMetrics.processingRate).toBeGreaterThan(50); // Events per second
  });

  test('should provide analytics data filtering and segmentation', async () => {
    await analyticsClient.subscribe('segmented-analytics');

    const segmentedMetrics: any[] = [];
    analyticsClient.on('segmented-metrics', (metrics) => {
      segmentedMetrics.push(metrics);
    });

    // Generate segmented data
    await page.evaluate(() => {
      // Desktop users
      for (let i = 0; i < 20; i++) {
        window.simulateAnalyticsEvent({
          id: `desktop-${i}`,
          type: 'view',
          userId: `desktop-user-${i}`,
          data: { device: 'desktop', location: 'US' }
        });
      }

      // Mobile users
      for (let i = 0; i < 15; i++) {
        window.simulateAnalyticsEvent({
          id: `mobile-${i}`,
          type: 'view',
          userId: `mobile-user-${i}`,
          data: { device: 'mobile', location: 'UK' }
        });
      }
    });

    // Wait for segmentation
    await page.waitForTimeout(3000);

    // Verify segmented metrics
    expect(segmentedMetrics.length).toBeGreaterThan(0);

    const latestSegmented = segmentedMetrics[segmentedMetrics.length - 1];
    
    // Verify device segmentation
    expect(latestSegmented.byDevice.desktop).toBe(20);
    expect(latestSegmented.byDevice.mobile).toBe(15);

    // Verify location segmentation
    expect(latestSegmented.byLocation.US).toBe(20);
    expect(latestSegmented.byLocation.UK).toBe(15);

    // Test filtering
    await page.click('[data-testid="filter-desktop"]');
    await page.waitForTimeout(1000);

    const desktopOnly = await page.textContent('[data-testid="filtered-count"]');
    expect(desktopOnly).toContain('20');
  });

  test('should maintain analytics accuracy during network issues', async () => {
    await analyticsClient.subscribe('resilient-analytics');

    const resilientMetrics: any[] = [];
    analyticsClient.on('resilient-metrics', (metrics) => {
      resilientMetrics.push(metrics);
    });

    // Generate events before network issue
    for (let i = 0; i < 50; i++) {
      await page.evaluate((eventNum) => {
        window.simulateAnalyticsEvent({
          id: `before-${eventNum}`,
          type: 'view',
          userId: `user-before-${eventNum}`
        });
      }, i);
    }

    // Simulate network issue
    await page.evaluate(() => {
      window.simulateNetworkDisconnection(5000);
    });

    // Generate events during network issue
    for (let i = 0; i < 30; i++) {
      await page.evaluate((eventNum) => {
        window.simulateAnalyticsEvent({
          id: `during-${eventNum}`,
          type: 'view',
          userId: `user-during-${eventNum}`
        });
      }, i);
    }

    // Wait for reconnection and recovery
    await page.waitForTimeout(10000);

    // Generate events after recovery
    for (let i = 0; i < 20; i++) {
      await page.evaluate((eventNum) => {
        window.simulateAnalyticsEvent({
          id: `after-${eventNum}`,
          type: 'view',
          userId: `user-after-${eventNum}`
        });
      }, i);
    }

    // Wait for final processing
    await page.waitForTimeout(5000);

    // Verify data integrity
    expect(resilientMetrics.length).toBeGreaterThan(0);

    const finalMetrics = resilientMetrics[resilientMetrics.length - 1];
    expect(finalMetrics.totalEvents).toBeGreaterThanOrEqual(80); // Allow minimal loss
    expect(finalMetrics.lostEvents).toBeLessThan(20); // Acceptable loss
    expect(finalMetrics.recoveredEvents).toBeGreaterThan(0);
  });
});

async function waitFor(condition: () => boolean | Promise<boolean>, timeout: number): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}
```

## Performance Metrics

### Latency Requirements
- **Event Processing**: < 100ms
- **Metrics Aggregation**: < 500ms
- **Dashboard Updates**: < 1s
- **Real-time Alerts**: < 200ms

### Throughput Requirements
- **Events/Second**: 10,000+
- **Concurrent Users**: 50,000+
- **Metrics Updates**: 100/second
- **Dashboard Sessions**: 1,000+

## Error Handling

### Expected Error Scenarios
1. **Data Loss**
   - Event buffering
   - Recovery mechanisms
   - Loss reporting

2. **Processing Delays**
   - Queue management
   - Priority handling
   - Performance alerts

3. **Aggregation Errors**
   - Data validation
   - Error correction
   - Fallback calculations

## Cross-Browser Testing Matrix

| Browser | Version | User Tracking | Stream Analytics | Performance | Dashboard |
|---------|---------|---------------|-----------------|-------------|-----------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing

### Mobile Analytics
- Touch event tracking
- Mobile performance metrics
- Device-specific analytics
- Battery usage tracking

### Performance
- Low overhead tracking
- Efficient data transmission
- Background processing
- Memory optimization

## RTL Testing

### Arabic Analytics
- RTL dashboard layout
- Arabic metric labels
- Right-aligned charts
- Arabic date formatting

## Test Execution

### Running Tests
```bash
# Run all analytics tests
pnpm test:e2e --grep "TC-REAL-008"

# Run specific scenarios
pnpm test:e2e --grep "should track real-time user activity"
pnpm test:e2e --grep "should provide live stream analytics"
```

## Validation Criteria

### Success Criteria
- ✅ Real-time tracking accurate
- ✅ Stream analytics functional
- ✅ Performance metrics collected
- ✅ Dashboard updates working
- ✅ High-volume handling efficient
- ✅ Data filtering functional

### Failure Criteria
- ❌ Tracking inaccuracies
- ❌ Stream analytics failures
- ❌ Performance collection errors
- ❌ Dashboard update failures
- ❌ High-volume processing issues
- ❌ Data filtering failures

## Related Test Cases

- [TC-REAL-001](./TCREAL001_websocket-connection-management.md) - WebSocket Connection Management
- [TC-PERF-001](../performance/tcperf001_load-testing-performance.md) - Load Testing Performance
- [TC-VID-009](../video-platform/TCVID009_VideoAnalytics.md) - Video Analytics

## Document Information

- **Created**: 2025-11-18
- **Last Updated**: 2025-11-18
- **Version**: 1.0
- **Review Date**: 2025-11-25
- **Next Review**: 2025-12-25

---

**Test Team**: test-team@alummahnow.net  
**QA Lead**: qa-lead@alummahnow.net  
**DevOps**: devops@alummahnow.net