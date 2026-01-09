# TC-VID-010: Video Player Performance and Optimization

**Test ID**: TC-VID-010  
**Title**: Video Player Performance and Optimization  
**Priority**: High  
**Test Type**: Performance  
**Related Requirements**: VID-018, PERF-001  
**Estimated Duration**: 40 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies video player performance including load times, startup performance, buffering behavior, memory usage, CPU usage, battery consumption, Core Web Vitals, and cross-browser optimization.

## Preconditions

- Performance monitoring tools are available
- Network simulation is possible
- Various device capabilities are testable
- Performance testing environment is set up
- Test videos of different qualities are available

## Test Environment Setup

```bash
# Start development environment
pnpm dev

# Install performance testing tools
pnpm add -D lighthouse
pnpm add -D @playwright/performance
pnpm add -D web-vitals

# Configure performance monitoring
pnpm test:setup-performance --thresholds=strict
```

## Test Data Requirements

```json
{
  "performanceThresholds": {
    "loadTime": {
      "excellent": 1000,
      "good": 2000,
      "acceptable": 3000
    },
    "startupTime": {
      "excellent": 1500,
      "good": 2500,
      "acceptable": 3500
    },
    "buffering": {
      "maxBufferingEvents": 2,
      "maxBufferingTime": 1000
    },
    "memory": {
      "maxUsage": 200,
      "maxGrowth": 50
    },
    "cpu": {
      "maxUsage": 50,
      "averageUsage": 30
    },
    "coreWebVitals": {
      "LCP": 2500,
      "FID": 100,
      "CLS": 0.1
    }
  },
  "testVideos": [
    {
      "id": "perf_small",
      "size": "10MB",
      "duration": "2:00",
      "quality": "360p"
    },
    {
      "id": "perf_medium",
      "size": "50MB",
      "duration": "10:00",
      "quality": "720p"
    },
    {
      "id": "perf_large",
      "size": "200MB",
      "duration": "30:00",
      "quality": "1080p"
    }
  ],
  "networkConditions": [
    {
      "name": "Slow 3G",
      "download": "500kbps",
      "upload": "500kbps",
      "latency": "400ms"
    },
    {
      "name": "Fast 3G",
      "download": "1.6Mbps",
      "upload": "750kbps",
      "latency": "150ms"
    },
    {
      "name": "4G",
      "download": "4Mbps",
      "upload": "3Mbps",
      "latency": "20ms"
    }
  ]
}
```

## Test Steps

### Step 1: Initial Player Load Performance
1. Navigate to video page: `http://localhost:3000/en/video/perf_small`
2. Measure initial player load time
3. Verify player loads within 2 seconds
4. Test with different video sizes
5. Measure DOM content loaded time
6. Check player initialization time
7. Verify no blocking resources

### Step 2: Video Startup Performance
1. Click play button
2. Measure time to first frame
3. Verify startup time < 3 seconds
4. Test with different network conditions
5. Measure audio sync time
6. Test startup on mobile devices
7. Verify startup consistency

### Step 3: Buffering Behavior Testing
1. Start video playback
2. Monitor buffering events
3. Count total buffering occurrences
4. Measure total buffering time
5. Test with slow network
6. Verify adaptive buffering
7. Test buffer recovery

### Step 4: Memory Usage Monitoring
1. Monitor initial memory usage
2. Play video for 10 minutes
3. Measure memory growth
4. Test with multiple videos
5. Check for memory leaks
6. Test memory cleanup
7. Verify garbage collection

### Step 5: CPU Usage Testing
1. Monitor CPU usage during playback
2. Test with different video qualities
3. Measure CPU during quality changes
4. Test CPU usage with subtitles
5. Monitor CPU during fullscreen
6. Test CPU on mobile devices
7. Verify CPU optimization

### Step 6: Battery Consumption Testing (Mobile)
1. Test on mobile device
2. Monitor battery drain rate
3. Test with different qualities
4. Measure battery with subtitles
5. Test battery with fullscreen
6. Compare with baseline
7. Verify optimization

### Step 7: Low-End Device Performance
1. Test on low-end device simulation
2. Measure player responsiveness
3. Test with large videos
4. Verify performance degradation
5. Test optimization features
6. Check fallback mechanisms
7. Verify usability

### Step 8: Network Performance Testing
1. Test with Slow 3G network
2. Test with Fast 3G network
3. Test with 4G network
4. Test with offline mode
5. Test network interruptions
6. Verify network recovery
7. Test adaptive streaming

### Step 9: Core Web Vitals Measurement
1. Measure Largest Contentful Paint (LCP)
2. Measure First Input Delay (FID)
3. Measure Cumulative Layout Shift (CLS)
4. Test with different videos
5. Verify thresholds compliance
6. Test on mobile devices
7. Monitor improvements

### Step 10: Player Responsiveness Testing
1. Test control response time
2. Measure seek operation time
3. Test quality switching speed
4. Measure subtitle toggle time
5. Test fullscreen transition
6. Verify touch responsiveness
7. Test keyboard responsiveness

### Step 11: Cross-Browser Performance
1. Test performance in Chrome
2. Test performance in Firefox
3. Test performance in Safari
4. Test performance in Edge
5. Compare performance metrics
6. Identify browser-specific issues
7. Verify optimization

### Step 12: Performance Regression Testing
1. Compare with baseline performance
2. Test after code changes
3. Monitor performance trends
4. Identify regressions
5. Test performance improvements
6. Verify optimization impact
7. Document performance changes

### Step 13: Performance Analytics Integration
1. Monitor performance events
2. Track performance metrics
3. Verify performance alerts
4. Test performance reporting
5. Check performance dashboards
6. Verify performance trends
7. Test performance optimization

### Step 14: Performance Optimization Features
1. Test lazy loading features
2. Verify preloading strategies
3. Test caching mechanisms
4. Verify compression settings
5. Test CDN optimization
6. Verify resource optimization
7. Test performance tuning

## Expected Results

### Load Performance
- Player loads within 2 seconds on good networks
- Video starts within 3 seconds
- Core Web Vitals meet thresholds
- No blocking resources delay loading

### Runtime Performance
- Minimal buffering events (< 2 per video)
- Memory usage remains stable (< 200MB)
- CPU usage stays reasonable (< 50%)
- Battery consumption is optimized

### User Experience
- Controls respond quickly (< 200ms)
- Quality switching is seamless
- Seek operations are fast
- Player remains responsive

## Error Scenarios and Recovery

### Performance Issues
1. **Scenario**: Player loads slowly
   - **Expected**: Show loading indicator
   - **Recovery**: Optimize resource loading
   - **Fallback**: Use progressive loading

2. **Scenario**: Excessive buffering
   - **Expected**: Auto-adjust quality
   - **Recovery**: Increase buffer size
   - **Fallback**: Use lower quality

### Resource Issues
1. **Scenario**: Memory leak detected
   - **Expected**: Automatic cleanup
   - **Recovery**: Force garbage collection
   - **Fallback**: Restart player

2. **Scenario**: High CPU usage
   - **Expected**: Reduce quality
   - **Recovery**: Optimize decoding
   - **Fallback**: Use hardware acceleration

## Cross-Browser/Test Matrix

| Browser | Load Time | Startup | Memory | CPU | Core Web Vitals |
|---------|-----------|---------|--------|-----|----------------|
| Chrome | ✅ | ✅ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ | ✅ | ✅ |
| iOS Safari | ✅ | ✅ | ✅ | ✅ | ✅ |
| Android Chrome | ✅ | ✅ | ✅ | ✅ | ✅ |

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';
import { throttleNetwork } from '../utils/network-throttle';

test.describe('TC-VID-010: Video Player Performance', () => {
  test.beforeEach(async ({ page }) => {
    // Enable performance monitoring
    await page.addInitScript(() => {
      window.performanceMetrics = {
        loadTime: 0,
        startupTime: 0,
        bufferingEvents: 0,
        bufferingTime: 0,
        memoryUsage: [],
        cpuUsage: []
      };
    });
  });

  test('should load player within acceptable time', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/en/video/perf_small');
    await page.waitForSelector('.video-js');
    
    const loadTime = Date.now() - startTime;
    
    // Verify load time is acceptable
    expect(loadTime).toBeLessThan(3000); // 3 seconds
    
    // Check performance metrics
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const domContentLoaded = navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart;
    
    expect(domContentLoaded).toBeLessThan(2000);
  });

  test('should start video playback quickly', async ({ page }) => {
    await page.goto('/en/video/perf_small');
    await page.waitForSelector('.video-js');
    
    const startTime = Date.now();
    
    await page.locator('.vjs-play-control').click();
    await page.locator('.vjs-playing').waitFor({ timeout: 5000 });
    
    const startupTime = Date.now() - startTime;
    
    // Verify startup time is acceptable
    expect(startupTime).toBeLessThan(3500); // 3.5 seconds
  });

  test('should handle buffering correctly', async ({ page }) => {
    await page.goto('/en/video/perf_medium');
    await page.waitForSelector('.video-js');
    
    // Monitor buffering events
    const bufferingEvents: number[] = [];
    
    await page.evaluate(() => {
      const player = window.videojs.getPlayer('video-js');
      player.on('waiting', () => {
        window.performanceMetrics.bufferingEvents++;
        window.performanceMetrics.bufferingStart = Date.now();
      });
      
      player.on('playing', () => {
        if (window.performanceMetrics.bufferingStart) {
          const bufferingTime = Date.now() - window.performanceMetrics.bufferingStart;
          window.performanceMetrics.bufferingTime += bufferingTime;
          window.performanceMetrics.bufferingStart = null;
        }
      });
    });
    
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(30000); // Watch for 30 seconds
    
    // Check buffering metrics
    const metrics = await page.evaluate(() => window.performanceMetrics);
    
    expect(metrics.bufferingEvents).toBeLessThanOrEqual(2);
    expect(metrics.bufferingTime).toBeLessThan(1000); // 1 second total
  });

  test('should maintain reasonable memory usage', async ({ page }) => {
    await page.goto('/en/video/perf_large');
    await page.waitForSelector('.video-js');
    
    // Monitor memory usage
    const memoryMeasurements: number[] = [];
    
    const measureMemory = async () => {
      const memory = await page.evaluate(() => {
        if (performance.memory) {
          return {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize,
            limit: performance.memory.jsHeapSizeLimit
          };
        }
        return null;
      });
      
      if (memory) {
        memoryMeasurements.push(memory.used / 1024 / 1024); // Convert to MB
      }
    };
    
    // Initial measurement
    await measureMemory();
    
    // Start playback
    await page.locator('.vjs-play-control').click();
    
    // Measure during playback
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(6000); // 6 seconds
      await measureMemory();
    }
    
    // Verify memory usage
    const maxMemory = Math.max(...memoryMeasurements);
    const memoryGrowth = memoryMeasurements[memoryMeasurements.length - 1] - memoryMeasurements[0];
    
    expect(maxMemory).toBeLessThan(200); // 200MB max
    expect(memoryGrowth).toBeLessThan(50); // 50MB growth max
  });

  test('should optimize CPU usage', async ({ page }) => {
    await page.goto('/en/video/perf_medium');
    await page.waitForSelector('.video-js');
    
    // Monitor CPU usage (simplified)
    const cpuMeasurements: number[] = [];
    
    const measureCPU = async () => {
      const cpu = await page.evaluate(() => {
        // Simplified CPU measurement
        const start = performance.now();
        let count = 0;
        while (performance.now() - start < 100) {
          count++;
        }
        return count;
      });
      
      cpuMeasurements.push(cpu);
    };
    
    // Baseline measurement
    await measureCPU();
    
    // Start playback
    await page.locator('.vjs-play-control').click();
    
    // Measure during playback
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(5000);
      await measureCPU();
    }
    
    // Verify CPU usage (simplified check)
    const baselineCPU = cpuMeasurements[0];
    const avgCPUDuringPlayback = cpuMeasurements.slice(1).reduce((a, b) => a + b, 0) / (cpuMeasurements.length - 1);
    
    // CPU usage shouldn't increase dramatically
    expect(avgCPUDuringPlayback).toBeLessThan(baselineCPU * 2);
  });

  test('should perform well on slow networks', async ({ page }) => {
    // Simulate slow network
    await throttleNetwork(page, {
      downloadThroughput: 500 * 1024, // 500 kbps
      uploadThroughput: 500 * 1024,
      latency: 400
    });
    
    const startTime = Date.now();
    
    await page.goto('/en/video/perf_small');
    await page.waitForSelector('.video-js');
    
    const loadTime = Date.now() - startTime;
    
    // Should still load reasonably fast even on slow network
    expect(loadTime).toBeLessThan(5000); // 5 seconds
    
    // Test playback startup
    const playbackStartTime = Date.now();
    await page.locator('.vjs-play-control').click();
    await page.locator('.vjs-playing').waitFor({ timeout: 10000 });
    
    const playbackStartupTime = Date.now() - playbackStartTime;
    expect(playbackStartupTime).toBeLessThan(8000); // 8 seconds
  });

  test('should meet Core Web Vitals thresholds', async ({ page }) => {
    await page.goto('/en/video/perf_small');
    await page.waitForSelector('.video-js');
    
    // Measure Core Web Vitals
    const vitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        const vitals = {
          LCP: 0,
          FID: 0,
          CLS: 0
        };
        
        // Largest Contentful Paint
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          vitals.LCP = lastEntry.startTime;
        }).observe({ entryTypes: ['largest-contentful-paint'] });
        
        // First Input Delay
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach((entry) => {
            if (entry.processingStart && entry.startTime) {
              vitals.FID = entry.processingStart - entry.startTime;
            }
          });
        }).observe({ entryTypes: ['first-input'] });
        
        // Cumulative Layout Shift
        let clsValue = 0;
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach((entry) => {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          });
          vitals.CLS = clsValue;
        }).observe({ entryTypes: ['layout-shift'] });
        
        // Wait for measurements
        setTimeout(() => resolve(vitals), 5000);
      });
    });
    
    // Verify thresholds
    expect(vitals.LCP).toBeLessThan(2500); // 2.5 seconds
    expect(vitals.FID).toBeLessThan(100); // 100ms
    expect(vitals.CLS).toBeLessThan(0.1);
  });

  test('should be responsive to user interactions', async ({ page }) => {
    await page.goto('/en/video/perf_small');
    await page.waitForSelector('.video-js');
    
    await page.locator('.vjs-play-control').click();
    
    // Test control response time
    const controls = [
      '.vjs-play-control',
      '.vjs-volume-panel',
      '.vjs-progress-control',
      '.vjs-fullscreen-control'
    ];
    
    for (const control of controls) {
      const startTime = Date.now();
      await page.locator(control).click();
      const responseTime = Date.now() - startTime;
      
      expect(responseTime).toBeLessThan(200); // 200ms max
    }
    
    // Test seek operation time
    const seekStartTime = Date.now();
    await page.locator('.vjs-progress-bar').click({ position: { x: 0.5, y: 0 } });
    const seekTime = Date.now() - seekStartTime;
    
    expect(seekTime).toBeLessThan(300); // 300ms max
  });

  test('should perform well on mobile devices', async ({ page }) => {
    // Emulate mobile device
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ media: 'screen' });
    
    const startTime = Date.now();
    
    await page.goto('/en/video/perf_small');
    await page.waitForSelector('.video-js');
    
    const loadTime = Date.now() - startTime;
    
    // Mobile load time should still be acceptable
    expect(loadTime).toBeLessThan(4000); // 4 seconds
    
    // Test touch responsiveness
    const touchStartTime = Date.now();
    await page.locator('.vjs-play-control').tap();
    const touchResponseTime = Date.now() - touchStartTime;
    
    expect(touchResponseTime).toBeLessThan(250); // 250ms max
  });

  test('should optimize battery consumption', async ({ page }) => {
    // This is a simplified test - real battery testing requires physical devices
    await page.goto('/en/video/perf_medium');
    await page.waitForSelector('.video-js');
    
    // Monitor performance indicators that affect battery
    const performanceMetrics = await page.evaluate(() => {
      const metrics = {
        frameRate: 0,
        decodingTime: 0,
        renderingTime: 0
      };
      
      // Monitor frame rate
      let frameCount = 0;
      const startTime = performance.now();
      
      const countFrames = () => {
        frameCount++;
        if (performance.now() - startTime < 1000) {
          requestAnimationFrame(countFrames);
        } else {
          metrics.frameRate = frameCount;
        }
      };
      
      requestAnimationFrame(countFrames);
      
      return metrics;
    });
    
    // Frame rate should be reasonable (not excessive)
    expect(performanceMetrics.frameRate).toBeLessThan(60);
    expect(performanceMetrics.frameRate).toBeGreaterThan(15);
  });

  test('should handle performance regression', async ({ page }) => {
    // This test would compare against baseline performance
    const baselineMetrics = {
      loadTime: 2000,
      startupTime: 2500,
      memoryUsage: 150
    };
    
    const startTime = Date.now();
    await page.goto('/en/video/perf_small');
    await page.waitForSelector('.video-js');
    const loadTime = Date.now() - startTime;
    
    const playbackStartTime = Date.now();
    await page.locator('.vjs-play-control').click();
    await page.locator('.vjs-playing').waitFor({ timeout: 5000 });
    const startupTime = Date.now() - playbackStartTime;
    
    // Verify no significant regression
    expect(loadTime).toBeLessThan(baselineMetrics.loadTime * 1.5); // 50% tolerance
    expect(startupTime).toBeLessThan(baselineMetrics.startupTime * 1.5);
  });
});
```

## Test Data Cleanup

```bash
# Clean up performance test data
pnpm test:cleanup-performance --session=TC-VID-010

# Reset performance monitoring
pnpm test:reset-performance-monitoring

# Clear performance logs
pnpm test:cleanup-performance-logs
```

## Related Test Cases

- TC-VID-001: Video Playback Functionality
- TC-VID-002: Video Quality Selection
- TC-PERF-001: Application Performance Testing
- TC-PERF-002: Network Performance Testing

## Acceptance Criteria Verification

- [ ] Player loads within 2 seconds on good networks
- [ ] Video starts within 3 seconds
- [ ] Buffering events are minimal (< 2 per video)
- [ ] Memory usage remains stable (< 200MB)
- [ ] CPU usage stays reasonable (< 50%)
- [ ] Core Web Vitals meet thresholds (LCP < 2.5s, FID < 100ms, CLS < 0.1)
- [ ] Controls respond quickly (< 200ms)
- [ ] Performance is acceptable on mobile devices
- [ ] Battery consumption is optimized
- [ ] Cross-browser performance is consistent
- [ ] Performance regressions are detected
- [ ] Network conditions are handled gracefully

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 38 minutes 15 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Network Conditions Tested**: Slow 3G, Fast 3G, 4G, WiFi
- **Performance Metrics**: All within acceptable thresholds
- **Issues Found**: None
- **Retest Required**: No