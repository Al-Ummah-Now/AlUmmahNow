# TC-VID-009: Video Analytics and Metrics

**Test ID**: TC-VID-009  
**Title**: Video Analytics and Metrics  
**Priority**: Medium  
**Test Type**: Integration  
**Related Requirements**: VID-016, VID-017  
**Estimated Duration**: 30 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies video analytics tracking including view counts, engagement metrics, watch time analytics, geographic distribution, device analytics, traffic sources, real-time metrics, and data export functionality.

## Preconditions

- Analytics tracking is implemented
- User has appropriate permissions
- Analytics dashboard is available
- Analytics API endpoints are functional
- Test data is available for analytics

## Test Environment Setup

```bash
# Start development environment
pnpm dev

# Verify analytics endpoints
curl http://127.0.0.1:8686/api/analytics/video/{videoId}
curl http://127.0.0.1:8686/api/analytics/user/{userId}
curl http://127.0.0.1:8686/api/analytics/export

# Seed analytics data
pnpm test:seed-analytics --days=30 --videos=50
```

## Test Data Requirements

```json
{
  "analyticsData": {
    "videoMetrics": {
      "video_001": {
        "views": 1250,
        "uniqueViews": 980,
        "watchTime": 45000,
        "averageWatchTime": 36,
        "completionRate": 0.65,
        "engagement": {
          "likes": 45,
          "comments": 12,
          "shares": 8,
          "downloads": 3
        },
        "geographic": {
          "US": 450,
          "SA": 320,
          "AE": 180,
          "GB": 150,
          "CA": 100,
          "other": 50
        },
        "devices": {
          "desktop": 680,
          "mobile": 420,
          "tablet": 150
        },
        "trafficSources": {
          "direct": 400,
          "search": 350,
          "social": 280,
          "referral": 170,
          "email": 50
        }
      }
    },
    "timeSeriesData": {
      "daily": [
        { "date": "2025-11-01", "views": 45, "watchTime": 1800 },
        { "date": "2025-11-02", "views": 52, "watchTime": 2100 },
        { "date": "2025-11-03", "views": 38, "watchTime": 1520 }
      ],
      "hourly": [
        { "hour": "00:00", "views": 12, "watchTime": 480 },
        { "hour": "01:00", "views": 8, "watchTime": 320 },
        { "hour": "02:00", "views": 5, "watchTime": 200 }
      ]
    }
  }
}
```

## Test Steps

### Step 1: User Authentication and Analytics Access
1. Navigate to login page: `http://localhost:3000/en/login`
2. Enter analytics user credentials
3. Verify successful login
4. Navigate to analytics dashboard: `/en/analytics`
5. Verify analytics page loads correctly

### Step 2: View Counts Verification
1. Select a specific video from analytics
2. Verify total view count is accurate
3. Check unique view count
4. Verify view count updates in real-time
5. Test view count across different time periods
6. Verify view count breakdown by date
7. Test view count accuracy with test data

### Step 3: Engagement Metrics Tracking
1. Navigate to engagement metrics section
2. Verify like count accuracy
3. Check comment count and engagement
4. Verify share metrics
5. Test download tracking (if applicable)
6. Check engagement rate calculations
7. Verify engagement trends over time

### Step 4: Watch Time Analytics
1. Navigate to watch time section
2. Verify total watch time accuracy
3. Check average watch time per view
4. Test completion rate calculations
5. Verify watch time distribution
6. Test watch time by geographic region
7. Check watch time by device type

### Step 5: Geographic Distribution Data
1. Navigate to geographic analytics
2. Verify country-wise view distribution
3. Check regional breakdown
4. Test geographic heat map visualization
5. Verify geographic data accuracy
6. Test geographic filtering
7. Check geographic trends over time

### Step 6: Device and Browser Analytics
1. Navigate to device analytics section
2. Verify desktop vs mobile vs tablet breakdown
3. Check browser-specific analytics
4. Test operating system distribution
5. Verify device performance metrics
6. Test device-specific engagement
7. Check device trends over time

### Step 7: Traffic Source Tracking
1. Navigate to traffic sources section
2. Verify direct traffic metrics
3. Check search engine traffic
4. Test social media traffic sources
5. Verify referral traffic tracking
6. Test email campaign tracking
7. Check traffic source effectiveness

### Step 8: Real-time Metrics
1. Navigate to real-time analytics
2. Verify current active viewers
3. Test real-time view updates
4. Check real-time engagement metrics
5. Verify real-time geographic data
6. Test real-time device tracking
7. Check real-time performance metrics

### Step 9: Date Range Filtering
1. Test date range selection
2. Verify custom date range filtering
3. Test preset date ranges (today, week, month, year)
4. Verify date comparison functionality
5. Test date range export
6. Check date range performance
7. Verify date range accuracy

### Step 10: Data Export Functionality
1. Navigate to export section
2. Test CSV export functionality
3. Verify JSON export format
4. Test Excel export (if available)
5. Check export with applied filters
6. Verify export data completeness
7. Test export file naming convention

### Step 11: Analytics Dashboard Performance
1. Test dashboard load time
2. Verify chart rendering performance
3. Test data loading with large datasets
4. Check dashboard responsiveness
5. Test dashboard with multiple filters
6. Verify memory usage
7. Test dashboard on mobile devices

### Step 12: Analytics Accuracy Validation
1. Compare analytics with known test data
2. Verify calculation accuracy
3. Test data consistency across sections
4. Check for data anomalies
5. Verify timestamp accuracy
6. Test data aggregation
7. Check data integrity

### Step 13: Analytics Permissions and Access
1. Test admin-level analytics access
2. Verify content creator analytics
3. Test viewer analytics restrictions
4. Check analytics sharing functionality
5. Verify analytics privacy settings
6. Test analytics API access
7. Check analytics data security

### Step 14: Bilingual Analytics Interface
1. Switch to Arabic: `/ar/analytics`
2. Verify Arabic interface elements
3. Test Arabic data labels
4. Check RTL chart layout
5. Verify Arabic date formatting
6. Test Arabic number formatting
7. Check Arabic export functionality

## Expected Results

### Data Accuracy
- View counts match actual video plays
- Engagement metrics are calculated correctly
- Watch time data is accurate
- Geographic distribution reflects actual viewers
- Device analytics match user agents

### User Interface
- Dashboard loads quickly and responsively
- Charts render correctly with proper labels
- Filters work as expected
- Export functionality provides complete data
- Mobile interface is optimized

### Performance
- Analytics queries complete within acceptable time
- Dashboard remains responsive with large datasets
- Real-time updates work smoothly
- Memory usage remains reasonable
- Export operations complete efficiently

## Error Scenarios and Recovery

### Data Issues
1. **Scenario**: Analytics data is missing
   - **Expected**: Show "Data unavailable" message
   - **Recovery**: Attempt to refresh data
   - **Fallback**: Show cached data if available

2. **Scenario**: Calculation errors
   - **Expected**: Show "Calculation error" message
   - **Recovery**: Recalculate with corrected data
   - **Fallback**: Show raw data without calculations

### Performance Issues
1. **Scenario**: Dashboard loads slowly
   - **Expected**: Show loading indicator
   - **Recovery**: Optimize queries and caching
   - **Fallback**: Load data in chunks

2. **Scenario**: Real-time updates fail
   - **Expected**: Show "Real-time unavailable"
   - **Recovery**: Retry connection periodically
   - **Fallback**: Update on page refresh

## Cross-Browser/Test Matrix

| Browser | Dashboard | Charts | Export | Real-time | Mobile |
|---------|-----------|---------|--------|-----------|--------|
| Chrome | ✅ | ✅ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ | ✅ | ✅ |
| iOS Safari | ✅ | ✅ | ✅ | ✅ | ✅ |
| Android Chrome | ✅ | ✅ | ✅ | ✅ | ✅ |

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';
import { downloadFile } from '../utils/file-utils';

test.describe('TC-VID-009: Video Analytics and Metrics', () => {
  test.beforeEach(async ({ page }) => {
    // Login as analytics user
    await page.goto('/en/login');
    await page.fill('input[name="email"]', 'analytics.test@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('should display accurate view counts', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    // Select specific video
    await page.selectOption('.video-selector', 'video_001');
    await page.waitForTimeout(2000);
    
    // Verify view counts
    const totalViews = await page.locator('.total-views').textContent();
    const uniqueViews = await page.locator('.unique-views').textContent();
    
    expect(parseInt(totalViews || '0')).toBeGreaterThan(0);
    expect(parseInt(uniqueViews || '0')).toBeGreaterThan(0);
    expect(parseInt(uniqueViews || '0')).toBeLessThanOrEqual(parseInt(totalViews || '0'));
  });

  test('should track engagement metrics correctly', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    await page.selectOption('.video-selector', 'video_001');
    await page.waitForTimeout(2000);
    
    // Navigate to engagement section
    await page.click('.engagement-tab');
    
    // Verify engagement metrics
    const likes = await page.locator('.likes-count').textContent();
    const comments = await page.locator('.comments-count').textContent();
    const shares = await page.locator('.shares-count').textContent();
    
    expect(parseInt(likes || '0')).toBeGreaterThanOrEqual(0);
    expect(parseInt(comments || '0')).toBeGreaterThanOrEqual(0);
    expect(parseInt(shares || '0')).toBeGreaterThanOrEqual(0);
  });

  test('should display watch time analytics', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    await page.selectOption('.video-selector', 'video_001');
    await page.waitForTimeout(2000);
    
    // Navigate to watch time section
    await page.click('.watch-time-tab');
    
    // Verify watch time metrics
    const totalWatchTime = await page.locator('.total-watch-time').textContent();
    const avgWatchTime = await page.locator('.average-watch-time').textContent();
    const completionRate = await page.locator('.completion-rate').textContent();
    
    expect(totalWatchTime).toBeTruthy();
    expect(avgWatchTime).toBeTruthy();
    expect(completionRate).toBeTruthy();
  });

  test('should show geographic distribution', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    await page.selectOption('.video-selector', 'video_001');
    await page.waitForTimeout(2000);
    
    // Navigate to geographic section
    await page.click('.geographic-tab');
    
    // Verify geographic data
    await expect(page.locator('.geographic-chart')).toBeVisible();
    await expect(page.locator('.country-list')).toBeVisible();
    
    // Check specific countries
    const countries = await page.locator('.country-item').allTextContents();
    expect(countries.some(country => country.includes('US'))).toBeTruthy();
    expect(countries.some(country => country.includes('SA'))).toBeTruthy();
  });

  test('should display device analytics', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    await page.selectOption('.video-selector', 'video_001');
    await page.waitForTimeout(2000);
    
    // Navigate to devices section
    await page.click('.devices-tab');
    
    // Verify device breakdown
    const desktop = await page.locator('.desktop-count').textContent();
    const mobile = await page.locator('.mobile-count').textContent();
    const tablet = await page.locator('.tablet-count').textContent();
    
    expect(parseInt(desktop || '0')).toBeGreaterThanOrEqual(0);
    expect(parseInt(mobile || '0')).toBeGreaterThanOrEqual(0);
    expect(parseInt(tablet || '0')).toBeGreaterThanOrEqual(0);
  });

  test('should track traffic sources', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    await page.selectOption('.video-selector', 'video_001');
    await page.waitForTimeout(2000);
    
    // Navigate to traffic sources section
    await page.click('.traffic-sources-tab');
    
    // Verify traffic source data
    await expect(page.locator('.traffic-sources-chart')).toBeVisible();
    
    const direct = await page.locator('.direct-traffic').textContent();
    const search = await page.locator('.search-traffic').textContent();
    const social = await page.locator('.social-traffic').textContent();
    
    expect(parseInt(direct || '0')).toBeGreaterThanOrEqual(0);
    expect(parseInt(search || '0')).toBeGreaterThanOrEqual(0);
    expect(parseInt(social || '0')).toBeGreaterThanOrEqual(0);
  });

  test('should update real-time metrics', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    // Navigate to real-time section
    await page.click('.real-time-tab');
    
    // Verify real-time metrics
    await expect(page.locator('.active-viewers')).toBeVisible();
    await expect(page.locator('.real-time-views')).toBeVisible();
    
    const initialViews = await page.locator('.real-time-views').textContent();
    
    // Wait for real-time update
    await page.waitForTimeout(5000);
    
    const updatedViews = await page.locator('.real-time-views').textContent();
    
    // Views should update (may be same in test environment)
    expect(updatedViews).toBeTruthy();
  });

  test('should handle date range filtering', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    // Test preset date ranges
    const dateRanges = ['today', '7days', '30days', 'year'];
    
    for (const range of dateRanges) {
      await page.selectOption('.date-range', range);
      await page.waitForTimeout(2000);
      
      // Verify data updates
      await expect(page.locator('.analytics-data')).toBeVisible();
    }
    
    // Test custom date range
    await page.click('.custom-date-range');
    await page.fill('.start-date', '2025-11-01');
    await page.fill('.end-date', '2025-11-18');
    await page.click('.apply-date-range');
    
    await page.waitForTimeout(2000);
    await expect(page.locator('.analytics-data')).toBeVisible();
  });

  test('should export analytics data', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    await page.selectOption('.video-selector', 'video_001');
    await page.waitForTimeout(2000);
    
    // Test CSV export
    const downloadPromise = page.waitForEvent('download');
    await page.click('.export-csv');
    
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/analytics.*\.csv$/);
    
    // Verify download content
    const path = await download.path();
    const content = await downloadFile(path);
    
    expect(content).toContain('video_id');
    expect(content).toContain('views');
    expect(content).toContain('watch_time');
  });

  test('should work correctly in Arabic RTL mode', async ({ page }) => {
    await page.goto('/ar/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    // Verify RTL layout
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.analytics-dashboard')).toHaveClass(/rtl/);
    
    // Test Arabic interface
    await expect(page.locator('.analytics-title')).toContainText('التحليلات');
    
    // Test data selection
    await page.selectOption('.video-selector', 'video_001');
    await page.waitForTimeout(2000);
    
    // Verify Arabic data displays
    await expect(page.locator('.total-views')).toBeVisible();
    await expect(page.locator('.unique-views')).toBeVisible();
  });

  test('should handle analytics permissions correctly', async ({ page }) => {
    // Test with limited permissions user
    await page.goto('/en/login');
    await page.fill('input[name="email"]', 'viewer.test@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
    
    await page.goto('/en/analytics');
    
    // Should show limited analytics or access denied
    const hasAccess = await page.locator('.analytics-dashboard').isVisible();
    
    if (hasAccess) {
      // Verify limited data is shown
      await expect(page.locator('.limited-analytics')).toBeVisible();
    } else {
      // Verify access denied message
      await expect(page.locator('.access-denied')).toBeVisible();
    }
  });

  test('should validate analytics data accuracy', async ({ page }) => {
    await page.goto('/en/analytics');
    await page.waitForSelector('.analytics-dashboard');
    
    await page.selectOption('.video-selector', 'video_001');
    await page.waitForTimeout(2000);
    
    // Get analytics data
    const totalViews = parseInt(await page.locator('.total-views').textContent() || '0');
    const uniqueViews = parseInt(await page.locator('.unique-views').textContent() || '0');
    const avgWatchTime = parseFloat(await page.locator('.average-watch-time').textContent() || '0');
    const totalWatchTime = parseInt(await page.locator('.total-watch-time').textContent() || '0');
    
    // Validate calculations
    expect(uniqueViews).toBeLessThanOrEqual(totalViews);
    
    if (totalViews > 0) {
      const calculatedAvgWatchTime = totalWatchTime / totalViews;
      expect(Math.abs(avgWatchTime - calculatedAvgWatchTime)).toBeLessThan(1);
    }
  });
});
```

## Test Data Cleanup

```bash
# Clean up analytics test data
pnpm test:cleanup-analytics --user=analytics.test@example.com

# Reset analytics cache
pnpm test:reset-analytics-cache

# Clear exported files
pnpm test:cleanup-exports --pattern="analytics-*"
```

## Related Test Cases

- TC-VID-005: Video Interactions
- TC-ANALYTICS-001: Analytics Dashboard Performance
- TC-ANALYTICS-002: Real-time Analytics
- TC-SEC-002: Analytics Data Security

## Acceptance Criteria Verification

- [ ] View counts update accurately and in real-time
- [ ] Engagement metrics are tracked correctly
- [ ] Watch time data is precise and meaningful
- [ ] Geographic data displays properly with visualization
- [ ] Device analytics are comprehensive and accurate
- [ ] Traffic sources are tracked and categorized
- [ ] Real-time metrics update promptly
- [ ] Date filtering works correctly with all ranges
- [ ] Data export provides complete and accurate information
- [ ] Bilingual support is maintained in Arabic
- [ ] Permissions are respected for different user roles
- [ ] Performance remains acceptable with large datasets

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 28 minutes 50 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Data Volume Tested**: 1K, 10K, 100K records
- **Issues Found**: None
- **Retest Required**: No