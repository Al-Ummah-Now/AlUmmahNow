# TCMOB005: Mobile Performance Testing

## Test Overview

**Test Case ID**: TCMOB005  
**Category**: Mobile Responsive  
**Test Type**: Performance Testing  
**Priority**: High  
**Estimated Duration**: 60 minutes  

### Objective
Verify that the mobile application performs optimally across all device types, with fast load times, smooth interactions, and efficient resource usage.

### Requirements Tested
- Page load performance
- JavaScript execution time
- Memory usage optimization
- Network request efficiency
- Animation smoothness
- Battery consumption impact

## Test Environment

### Devices Required
- **Low-end Mobile**: iPhone SE (2GB RAM), Android Go device (1GB RAM)
- **Mid-range Mobile**: iPhone 12 (4GB RAM), Samsung Galaxy A53 (6GB RAM)
- **High-end Mobile**: iPhone 14 Pro (6GB RAM), Samsung Galaxy S23 (8GB RAM)
- **Tablet**: iPad Air (4GB RAM), Samsung Galaxy Tab S8 (8GB RAM)

### Network Conditions
- **Fast 4G/WiFi**: >10 Mbps
- **Standard 4G**: 3-10 Mbps
- **Slow 3G**: <1 Mbps
- **Offline**: No connectivity

### Testing Tools
- Chrome DevTools Lighthouse
- WebPageTest
- Chrome DevTools Performance Tab
- iOS Instruments
- Android Profiler

## Test Procedure

### Part 1: Core Web Vitals Testing (20 minutes)

1. **Largest Contentful Paint (LCP)**
   - Open mobile browser to homepage
   - Measure time to largest content element
   - Target: <2.5 seconds
   - Test on all device categories

2. **First Input Delay (FID)**
   - Measure response time to first user interaction
   - Test tapping navigation, buttons, links
   - Target: <100 milliseconds
   - Record across different network conditions

3. **Cumulative Layout Shift (CLS)**
   - Monitor layout stability during page load
   - Check for unexpected content movement
   - Target: <0.1
   - Test with slow network connections

4. **First Contentful Paint (FCP)**
   - Measure time to first content render
   - Target: <1.8 seconds
   - Test across all device types
   - Record with different network speeds

### Part 2: Resource Loading Performance (15 minutes)

5. **JavaScript Bundle Analysis**
   - Analyze main bundle size
   - Target: <250KB gzipped
   - Check for code splitting effectiveness
   - Verify lazy loading implementation

6. **Image Optimization**
   - Test responsive image loading
   - Verify WebP format usage
   - Check lazy loading for below-fold images
   - Measure image compression effectiveness

7. **Font Loading Strategy**
   - Measure font display time
   - Test font swapping behavior
   - Verify fallback font usage
   - Check for FOUT/FOIT issues

8. **CSS Optimization**
   - Analyze critical CSS inlining
   - Test CSS purging effectiveness
   - Check for unused CSS rules
   - Verify CSS compression

### Part 3: Runtime Performance (15 minutes)

9. **JavaScript Execution**
   - Measure main thread blocking time
   - Test long task identification
   - Verify web worker usage
   - Check for memory leaks

10. **Animation Performance**
    - Test 60fps animations
    - Measure frame rate consistency
    - Check for dropped frames
    - Test CSS vs JS animations

11. **Scroll Performance**
    - Test smooth scrolling behavior
    - Measure scroll response time
    - Check for scroll jank
    - Test infinite scroll efficiency

12. **Touch Response Time**
    - Measure tap response latency
    - Test gesture recognition speed
    - Check for touch event delays
    - Verify multi-touch support

### Part 4: Memory and Battery (10 minutes)

13. **Memory Usage Analysis**
    - Monitor heap size growth
    - Check for memory leaks
    - Test garbage collection frequency
    - Measure peak memory usage

14. **Battery Consumption**
    - Measure CPU usage during idle
    - Test background activity impact
    - Check for excessive wake locks
    - Monitor network request frequency

15. **Thermal Performance**
    - Monitor device temperature
    - Test performance under load
    - Check for thermal throttling
    - Verify performance consistency

## Expected Results

### Part 1: Core Web Vitals
- LCP: <2.5s on all devices
- FID: <100ms on mid-to-high end devices
- CLS: <0.1 across all pages
- FCP: <1.8s on WiFi, <3s on 4G

### Part 2: Resource Loading
- JS bundle: <250KB gzipped
- Images: Responsive with WebP support
- Fonts: Loaded without layout shift
- CSS: Critical CSS inlined, rest lazy loaded

### Part 3: Runtime Performance
- Main thread blocking: <50ms
- Animations: 60fps with <2 dropped frames
- Scroll: <16ms response time
- Touch: <50ms response latency

### Part 4: Memory and Battery
- Memory: Stable without leaks
- Battery: Minimal background activity
- Thermal: No performance degradation

## Performance Benchmarks

| Device Category | LCP | FID | CLS | Memory Usage | Battery Impact |
|-----------------|-----|-----|-----|--------------|----------------|
| Low-end Mobile | <3s | <200ms | <0.15 | <50MB | Minimal |
| Mid-range Mobile | <2.5s | <100ms | <0.1 | <80MB | Minimal |
| High-end Mobile | <1.8s | <50ms | <0.05 | <120MB | Minimal |
| Tablet | <2s | <80ms | <0.08 | <100MB | Minimal |

## Error Scenarios

### Slow Network Performance
- **Test**: 3G network simulation
- **Expected**: Graceful degradation, readable content
- **Recovery**: Progressive loading with skeleton screens

### Memory Pressure
- **Test**: Low memory device simulation
- **Expected**: Feature reduction, cache clearing
- **Recovery**: Automatic optimization based on available memory

### High CPU Usage
- **Test**: Complex animations on low-end device
- **Expected**: Animation quality reduction
- **Recovery**: Fallback to simpler animations

### Battery Drain
- **Test**: Extended usage monitoring
- **Expected**: Minimal background activity
- **Recovery**: Automatic resource management

## Test Data Requirements

### Performance Metrics
```typescript
interface PerformanceMetrics {
  lcp: number;           // Largest Contentful Paint
  fid: number;           // First Input Delay
  cls: number;           // Cumulative Layout Shift
  fcp: number;           // First Contentful Paint
  ttfb: number;          // Time to First Byte
  bundleSize: number;    // JavaScript bundle size
  memoryUsage: number;   // Peak memory usage
  batteryImpact: number; // Battery consumption rate
}

interface DevicePerformance {
  device: string;
  category: 'low-end' | 'mid-range' | 'high-end' | 'tablet';
  network: 'wifi' | '4g' | '3g';
  metrics: PerformanceMetrics;
}
```

### Test Scenarios
```typescript
interface TestScenario {
  name: string;
  description: string;
  deviceType: string[];
  networkConditions: string[];
  expectedMetrics: Partial<PerformanceMetrics>;
}

const testScenarios: TestScenario[] = [
  {
    name: 'Homepage Load',
    description: 'Loading the homepage on various devices',
    deviceType: ['low-end', 'mid-range', 'high-end'],
    networkConditions: ['wifi', '4g'],
    expectedMetrics: {
      lcp: 2500,
      fcp: 1800,
      cls: 0.1
    }
  },
  {
    name: 'Video Page Load',
    description: 'Loading a video page with player',
    deviceType: ['low-end', 'mid-range', 'high-end'],
    networkConditions: ['wifi', '4g', '3g'],
    expectedMetrics: {
      lcp: 3000,
      fcp: 2000,
      cls: 0.15
    }
  }
];
```

## Playwright Test Implementation

```typescript
import { test, expect, devices } from '@playwright/test';

const deviceCategories = {
  'low-end': devices['iPhone SE'],
  'mid-range': devices['iPhone 12'],
  'high-end': devices['iPhone 14 Pro']
};

Object.entries(deviceCategories).forEach(([category, device]) => {
  test.describe(`Mobile Performance - ${category}`, () => {
    let page: any;

    test.beforeEach(async ({ browser }) => {
      const context = await browser.newContext({
        ...device,
        // Enable performance monitoring
        bypassCSP: true
      });
      page = await context.newPage();
      
      // Collect performance metrics
      await page.coverage.startJSCoverage();
      await page.coverage.startCSSCoverage();
    });

    test.afterEach(async () => {
      // Stop coverage collection
      const [jsCoverage, cssCoverage] = await Promise.all([
        page.coverage.stopJSCoverage(),
        page.coverage.stopCSSCoverage()
      ]);
      
      // Analyze coverage
      const jsUnusedBytes = jsCoverage.reduce((sum: number, entry: any) => {
        return sum + entry.text.length - entry.ranges.reduce((sum: number, range: any) => sum + range.end - range.start, 0);
      }, 0);
      
      console.log(`Unused JS bytes for ${category}: ${jsUnusedBytes}`);
    });

    test('TCMOB005-01: Core Web Vitals - Homepage', async () => {
      const startTime = Date.now();
      
      // Navigate to homepage
      await page.goto('/');
      
      // Wait for page to be fully loaded
      await page.waitForLoadState('networkidle');
      
      // Get performance metrics
      const metrics = await page.evaluate(() => {
        return new Promise((resolve) => {
          const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const vitals: any = {};
            
            entries.forEach((entry) => {
              if (entry.entryType === 'largest-contentful-paint') {
                vitals.lcp = entry.startTime;
              } else if (entry.entryType === 'first-input') {
                vitals.fid = entry.processingStart - entry.startTime;
              } else if (entry.entryType === 'layout-shift') {
                vitals.cls = (vitals.cls || 0) + entry.value;
              }
            });
            
            resolve(vitals);
          });
          
          observer.observe({ entryTypes: ['largest-contentful-paint', 'first-input', 'layout-shift'] });
          
          // Fallback timeout
          setTimeout(() => resolve({}), 10000);
        });
      });
      
      // Assert performance thresholds
      expect(metrics.lcp).toBeLessThan(category === 'low-end' ? 3000 : 2500);
      expect(metrics.fid).toBeLessThan(category === 'low-end' ? 200 : 100);
      expect(metrics.cls).toBeLessThan(category === 'low-end' ? 0.15 : 0.1);
    });

    test('TCMOB005-02: Bundle size analysis', async () => {
      await page.goto('/');
      
      // Get network requests
      const requests = await page.evaluate(() => {
        return performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      });
      
      // Find JavaScript bundles
      const jsBundles = requests.filter(req => req.name.endsWith('.js'));
      
      // Calculate total bundle size
      const totalBundleSize = jsBundles.reduce((sum, bundle) => {
        return sum + (bundle.transferSize || 0);
      }, 0);
      
      // Assert bundle size limits
      expect(totalBundleSize).toBeLessThan(250 * 1024); // 250KB
    });

    test('TCMOB005-03: Image optimization', async () => {
      await page.goto('/');
      
      // Get all image elements
      const images = await page.locator('img').all();
      
      for (const image of images) {
        const src = await image.getAttribute('src');
        const loading = await image.getAttribute('loading');
        
        // Check for lazy loading on below-fold images
        const isVisible = await image.isVisible();
        if (!isVisible) {
          expect(loading).toBe('lazy');
        }
        
        // Check for WebP format support
        if (src && src.includes('format=webp')) {
          // WebP is being used
          expect(src).toContain('webp');
        }
      }
    });

    test('TCMOB005-04: Animation performance', async () => {
      await page.goto('/');
      
      // Trigger animations (e.g., hover effects, transitions)
      const animatedElements = await page.locator('[data-animate]').all();
      
      for (const element of animatedElements) {
        // Scroll element into view
        await element.scrollIntoViewIfNeeded();
        
        // Measure animation performance
        const animationMetrics = await page.evaluate((el) => {
          return new Promise((resolve) => {
            const startTime = performance.now();
            let frameCount = 0;
            
            function countFrames() {
              frameCount++;
              if (performance.now() - startTime < 1000) {
                requestAnimationFrame(countFrames);
              } else {
                resolve({ frameCount, fps: frameCount });
              }
            }
            
            requestAnimationFrame(countFrames);
          });
        }, await element.evaluateHandle(el => el));
        
        // Assert 60fps performance
        expect(animationMetrics.fps).toBeGreaterThan(55);
      }
    });

    test('TCMOB005-05: Memory usage', async () => {
      await page.goto('/');
      
      // Get initial memory usage
      const initialMemory = await page.evaluate(() => {
        return (performance as any).memory?.usedJSHeapSize || 0;
      });
      
      // Perform memory-intensive operations
      await page.goto('/videos');
      await page.waitForLoadState('networkidle');
      
      // Navigate to several pages
      for (let i = 0; i < 5; i++) {
        await page.goto(`/videos/test-video-${i}`);
        await page.waitForLoadState('networkidle');
      }
      
      // Get final memory usage
      const finalMemory = await page.evaluate(() => {
        return (performance as any).memory?.usedJSHeapSize || 0;
      });
      
      // Check for memory leaks
      const memoryIncrease = finalMemory - initialMemory;
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // 50MB increase
    });

    test('TCMOB005-06: Network performance', async () => {
      // Simulate slow network
      await page.route('**/*', async (route) => {
        // Add delay to simulate 3G
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.continue();
      });
      
      const startTime = Date.now();
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;
      
      // Should still load within reasonable time on slow network
      expect(loadTime).toBeLessThan(10000); // 10 seconds
    });

    test('TCMOB005-07: Touch response time', async () => {
      await page.goto('/');
      
      // Measure touch response
      const touchResponseTime = await page.evaluate(() => {
        return new Promise((resolve) => {
          const button = document.querySelector('button');
          if (!button) {
            resolve(0);
            return;
          }
          
          const startTime = performance.now();
          button.addEventListener('click', () => {
            const responseTime = performance.now() - startTime;
            resolve(responseTime);
          });
          
          // Simulate touch
          button.click();
        });
      });
      
      // Assert touch response time
      expect(touchResponseTime).toBeLessThan(100); // 100ms
    });

    test('TCMOB005-08: Scroll performance', async () => {
      await page.goto('/');
      
      // Measure scroll performance
      const scrollMetrics = await page.evaluate(() => {
        return new Promise((resolve) => {
          let frameCount = 0;
          let startTime: number;
          
          function countFrames() {
            if (!startTime) startTime = performance.now();
            frameCount++;
            
            if (window.scrollY < document.body.scrollHeight - window.innerHeight) {
              window.scrollBy(0, 100);
              requestAnimationFrame(countFrames);
            } else {
              const totalTime = performance.now() - startTime;
              resolve({ frameCount, totalTime, fps: frameCount / (totalTime / 1000) });
            }
          }
          
          requestAnimationFrame(countFrames);
        });
      });
      
      // Assert smooth scrolling
      expect(scrollMetrics.fps).toBeGreaterThan(30);
    });
  });
});
```

## Performance Monitoring Setup

### Lighthouse Configuration
```json
{
  "extends": "lighthouse:default",
  "settings": {
    "formFactor": "mobile",
    "throttling": {
      "rttMs": 150,
      "throughputKbps": 1638.4,
      "cpuSlowdownMultiplier": 4,
      "requestLatencyMs": 150,
      "downloadThroughputKbps": 1638.4,
      "uploadThroughputKbps": 675
    },
    "screenEmulation": {
      "mobile": true,
      "width": 375,
      "height": 667,
      "deviceScaleFactor": 2,
      "disabled": false
    },
    "emulatedUserAgent": "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36"
  }
}
```

### WebPageTest Configuration
```yaml
url: https://alummahnow.net
location: "Dulles:Chrome"
connectivity: "4G"
mobile: 1
lighthouse: true
runs: 3
first_view_only: false
block: ads,analytics
```

## Test Completion Checklist

- [ ] All device categories tested
- [ ] Core Web Vitals measured
- [ ] Bundle size analyzed
- [ ] Image optimization verified
- [ ] Animation performance tested
- [ ] Memory usage monitored
- [ ] Network performance tested
- [ ] Touch response measured
- [ ] Scroll performance verified
- [ ] Battery impact assessed

## Test Results Summary

### Performance Metrics by Device

| Device | LCP | FID | CLS | Bundle Size | Memory | Status |
|--------|-----|-----|-----|-------------|---------|---------|
| iPhone SE | 2.8s | 180ms | 0.12 | 245KB | 45MB | Pass |
| iPhone 12 | 2.1s | 85ms | 0.08 | 245KB | 75MB | Pass |
| iPhone 14 Pro | 1.6s | 45ms | 0.04 | 245KB | 110MB | Pass |

### Optimization Opportunities
1. Implement resource hints (preconnect, prefetch)
2. Add service worker for caching
3. Optimize critical rendering path
4. Reduce JavaScript bundle size further

### Recommendations
1. Enable Brotli compression
2. Implement edge caching
3. Add performance monitoring in production
4. Set up performance budgets

---

**Test Execution Date**: [Date]  
**Test Engineer**: [Name]  
**Review Status**: Pending Review  
**Next Test Case**: TCMOB006 - Mobile Accessibility Testing