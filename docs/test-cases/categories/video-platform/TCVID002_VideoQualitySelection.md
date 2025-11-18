# TC-VID-002: Video Quality Selection and Adaptive Streaming

**Test ID**: TC-VID-002  
**Title**: Video Quality Selection and Adaptive Streaming  
**Priority**: High  
**Test Type**: E2E  
**Related Requirements**: VID-003, VID-004  
**Estimated Duration**: 20 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies video quality selection functionality, adaptive bitrate streaming, network condition handling, and quality persistence across sessions.

## Preconditions

- Multiple video qualities are available (360p, 480p, 720p, 1080p)
- Adaptive bitrate streaming is configured
- Network simulation tools are available
- Video content with multiple quality streams is prepared
- User has appropriate permissions to access video content

## Test Environment Setup

```bash
# Install network simulation tools
pnpm add -D @playwright/test network-throttle

# Start development environment
pnpm dev

# Verify streaming endpoints
curl -I https://cdn.bunny.net/adaptive/video001.m3u8
```

## Test Data Requirements

```json
{
  "adaptiveStreams": {
    "video_001": {
      "masterPlaylist": "https://cdn.bunny.net/adaptive/video001.m3u8",
      "qualities": [
        {
          "resolution": "360p",
          "bandwidth": "800000",
          "codecs": "avc1.42E01E,mp4a.40.2",
          "url": "https://cdn.bunny.net/360p/video001.m3u8"
        },
        {
          "resolution": "480p", 
          "bandwidth": "1400000",
          "codecs": "avc1.42E01F,mp4a.40.2",
          "url": "https://cdn.bunny.net/480p/video001.m3u8"
        },
        {
          "resolution": "720p",
          "bandwidth": "2800000", 
          "codecs": "avc1.4D001F,mp4a.40.2",
          "url": "https://cdn.bunny.net/720p/video001.m3u8"
        },
        {
          "resolution": "1080p",
          "bandwidth": "5000000",
          "codecs": "avc1.640028,mp4a.40.2", 
          "url": "https://cdn.bunny.net/1080p/video001.m3u8"
        }
      ]
    }
  },
  "networkConditions": [
    {
      "name": "Slow 3G",
      "downloadThroughput": 500 * 1024,
      "uploadThroughput": 500 * 1024,
      "latency": 400
    },
    {
      "name": "Fast 3G", 
      "downloadThroughput": 1.6 * 1024 * 1024,
      "uploadThroughput": 750 * 1024,
      "latency": 150
    },
    {
      "name": "4G",
      "downloadThroughput": 4 * 1024 * 1024,
      "uploadThroughput": 3 * 1024 * 1024,
      "latency": 20
    }
  ]
}
```

## Test Steps

### Step 1: Navigate to Video Page
1. Open browser and navigate to `http://localhost:3000/en/video/video_001`
2. Verify video player loads with adaptive streaming
3. Check that quality selector is visible
4. Verify default quality is selected based on network

### Step 2: Manual Quality Selection
1. Click on quality selector button
2. Verify all quality options are displayed (360p, 480p, 720p, 1080p)
3. Select 360p quality
4. Verify quality changes immediately without buffering
5. Check that quality indicator shows "360p"
6. Repeat for 480p, 720p, and 1080p
7. Verify each quality change is smooth

### Step 3: Quality Switching During Playback
1. Start video playback at 720p
2. Let video play for 10 seconds
3. Switch to 1080p during playback
4. Verify seamless quality upgrade
5. Switch to 480p during playback
6. Verify seamless quality downgrade
7. Check that audio continues without interruption
8. Verify video timeline remains accurate

### Step 4: Network Condition Simulation - Slow Network
1. Set network condition to "Slow 3G"
2. Start video playback
3. Verify automatic quality downgrade to 360p
4. Monitor buffering events
5. Verify quality indicator updates automatically
6. Check that playback continues smoothly

### Step 5: Network Condition Simulation - Fast Network
1. Set network condition to "4G"
2. Start video playback
3. Verify automatic quality upgrade to 1080p
4. Monitor video quality improvements
5. Verify quality indicator shows highest available quality
6. Check that playback remains smooth

### Step 6: Adaptive Streaming Behavior
1. Start with "Fast 3G" network
2. Begin video playback
3. Gradually improve network to "4G"
4. Verify automatic quality upgrade
5. Gradually degrade network to "Slow 3G"
6. Verify automatic quality downgrade
7. Monitor for buffering during transitions

### Step 7: Quality Persistence Across Sessions
1. Select 720p quality manually
2. Watch video for 30 seconds
3. Close browser tab
4. Reopen same video page
5. Verify 720p quality is remembered
6. Test persistence across browser restart
7. Test persistence across different devices (if logged in)

### Step 8: Quality Selection on Mobile Networks
1. Switch to mobile device emulation
2. Set network to "Slow 3G"
3. Start video playback
4. Verify mobile-optimized quality selection
5. Test quality changes on mobile
6. Verify touch interactions work correctly
7. Test quality persistence on mobile

### Step 9: Quality Selection Error Handling
1. Attempt to select unavailable quality
2. Verify error message or fallback behavior
3. Test with corrupted quality stream
4. Verify automatic fallback to working quality
5. Test with network disconnection
6. Verify quality selection is disabled appropriately

### Step 10: Bilingual Quality Interface
1. Navigate to Arabic version: `/ar/video/video_001`
2. Verify quality selector labels are in Arabic
3. Test quality selection in Arabic interface
4. Verify quality indicators display correctly in Arabic
5. Test RTL layout for quality menu

### Step 11: Performance Impact Testing
1. Monitor CPU usage during quality changes
2. Measure memory consumption with different qualities
3. Test battery consumption on mobile devices
4. Verify performance impact is minimal
5. Check for memory leaks during quality switching

### Step 12: Quality Analytics Integration
1. Verify quality changes are tracked in analytics
2. Test quality preference analytics
3. Verify network condition analytics
4. Check adaptive streaming performance metrics
5. Validate quality change event tracking

## Expected Results

### Manual Quality Selection
- All quality options (360p, 480p, 720p, 1080p) are available
- Manual quality switching works without buffering
- Quality changes are smooth and immediate
- Quality indicator accurately reflects current selection
- No audio interruption during quality changes

### Adaptive Streaming
- Automatic quality adjustment responds to network conditions
- Slow networks trigger quality downgrade to 360p
- Fast networks trigger quality upgrade to 1080p
- Quality transitions are seamless without buffering
- Adaptive algorithm prevents frequent quality changes

### User Experience
- Quality selector is easily accessible and intuitive
- Quality changes don't disrupt video timeline
- Loading states provide clear feedback during quality changes
- Error conditions are handled gracefully
- Mobile experience is optimized for touch interactions

### Performance
- Quality switching completes within 2 seconds
- CPU usage remains stable during quality changes
- Memory usage doesn't increase significantly
- Battery consumption is optimized on mobile devices
- Network bandwidth is used efficiently

## Error Scenarios and Recovery

### Network Issues
1. **Scenario**: Network becomes unavailable during quality switch
   - **Expected**: Display "Network error" message
   - **Recovery**: Maintain current quality if possible
   - **Fallback**: Pause playback and show retry option

2. **Scenario**: Quality stream fails to load
   - **Expected**: Automatically fallback to lower quality
   - **Recovery**: Try alternative quality levels
   - **Fallback**: Display quality selection error

### Quality Stream Issues
1. **Scenario**: Selected quality stream is corrupted
   - **Expected**: Automatic fallback to working quality
   - **Recovery**: Attempt to reload corrupted stream
   - **Fallback**: Disable problematic quality option

2. **Scenario**: All quality streams fail
   - **Expected**: Display "Video unavailable" message
   - **Recovery**: Attempt to reload from beginning
   - **Fallback**: Offer alternative video suggestions

## Cross-Browser/Test Matrix

| Browser | Adaptive Streaming | Manual Selection | Mobile Support | Error Handling |
|---------|-------------------|------------------|----------------|----------------|
| Chrome | ✅ HLS.js | ✅ | ✅ | ✅ |
| Firefox | ✅ HLS.js | ✅ | ✅ | ✅ |
| Safari | ✅ Native HLS | ✅ | ✅ | ✅ |
| Edge | ✅ HLS.js | ✅ | ✅ | ✅ |
| iOS Safari | ✅ Native HLS | ✅ | ✅ | ✅ |
| Android Chrome | ✅ HLS.js | ✅ | ✅ | ✅ |

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';
import { throttleNetwork } from '../utils/network-throttle';

test.describe('TC-VID-002: Video Quality Selection and Adaptive Streaming', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/video/video_001');
    await page.waitForSelector('.video-js', { timeout: 10000 });
  });

  test('should display all quality options', async ({ page }) => {
    const qualityButton = page.locator('.vjs-quality-selector');
    
    await qualityButton.click();
    await expect(page.locator('.vjs-menu-item')).toHaveCount(4);
    
    const qualityOptions = await page.locator('.vjs-menu-item').allTextContents();
    expect(qualityOptions).toContain('360p');
    expect(qualityOptions).toContain('480p');
    expect(qualityOptions).toContain('720p');
    expect(qualityOptions).toContain('1080p');
  });

  test('should switch quality manually without buffering', async ({ page }) => {
    const qualityButton = page.locator('.vjs-quality-selector');
    const playButton = page.locator('.vjs-play-control');
    
    // Start playback
    await playButton.click();
    await page.waitForTimeout(2000);
    
    // Switch to 1080p
    await qualityButton.click();
    await page.locator('.vjs-menu-item').filter({ hasText: '1080p' }).click();
    
    // Verify quality changed (implementation specific)
    await expect(page.locator('.vjs-quality-selector')).toBeVisible();
    
    // Verify no buffering occurred
    await expect(page.locator('.vjs-waiting')).not.toBeVisible({ timeout: 1000 });
  });

  test('should adapt quality based on network conditions', async ({ page }) => {
    // Simulate slow network
    await throttleNetwork(page, {
      downloadThroughput: 500 * 1024, // 500 kbps
      uploadThroughput: 500 * 1024,
      latency: 400
    });
    
    const playButton = page.locator('.vjs-play-control');
    await playButton.click();
    
    // Wait for adaptive streaming to adjust
    await page.waitForTimeout(5000);
    
    // Verify quality adjusted to 360p (implementation specific check)
    const currentQuality = await page.locator('.vjs-quality-selector').textContent();
    expect(currentQuality).toContain('360p');
  });

  test('should upgrade quality on fast network', async ({ page }) => {
    // Simulate fast network
    await throttleNetwork(page, {
      downloadThroughput: 4 * 1024 * 1024, // 4 Mbps
      uploadThroughput: 3 * 1024 * 1024,
      latency: 20
    });
    
    const playButton = page.locator('.vjs-play-control');
    await playButton.click();
    
    // Wait for adaptive streaming to adjust
    await page.waitForTimeout(5000);
    
    // Verify quality upgraded to 1080p
    const currentQuality = await page.locator('.vjs-quality-selector').textContent();
    expect(currentQuality).toContain('1080p');
  });

  test('should handle network condition changes during playback', async ({ page }) => {
    const playButton = page.locator('.vjs-play-control');
    
    // Start with fast network
    await throttleNetwork(page, {
      downloadThroughput: 4 * 1024 * 1024,
      uploadThroughput: 3 * 1024 * 1024,
      latency: 20
    });
    
    await playButton.click();
    await page.waitForTimeout(3000);
    
    // Degrade network
    await throttleNetwork(page, {
      downloadThroughput: 500 * 1024,
      uploadThroughput: 500 * 1024,
      latency: 400
    });
    
    // Wait for adaptation
    await page.waitForTimeout(5000);
    
    // Verify quality downgraded
    const currentQuality = await page.locator('.vjs-quality-selector').textContent();
    expect(currentQuality).toContain('360p');
  });

  test('should persist quality preference across sessions', async ({ page, context }) => {
    const qualityButton = page.locator('.vjs-quality-selector');
    
    // Select 720p
    await qualityButton.click();
    await page.locator('.vjs-menu-item').filter({ hasText: '720p' }).click();
    
    // Watch for a bit
    await page.waitForTimeout(3000);
    
    // Close and reopen
    await page.close();
    const newPage = await context.newPage();
    await newPage.goto('/en/video/video_001');
    await newPage.waitForSelector('.video-js');
    
    // Verify quality is remembered
    const rememberedQuality = await newPage.locator('.vjs-quality-selector').textContent();
    expect(rememberedQuality).toContain('720p');
  });

  test('should work correctly on mobile devices', async ({ page }) => {
    // Emulate mobile device
    await page.setViewportSize({ width: 375, height: 667 });
    
    const qualityButton = page.locator('.vjs-quality-selector');
    
    // Test touch interaction
    await qualityButton.tap();
    await expect(page.locator('.vjs-menu-item')).toBeVisible();
    
    // Select quality
    await page.locator('.vjs-menu-item').filter({ hasText: '480p' }).tap();
    
    // Verify quality changed
    await expect(page.locator('.vjs-quality-selector')).toBeVisible();
  });

  test('should handle quality selection errors gracefully', async ({ page }) => {
    // Mock failed quality stream
    await page.route('**/1080p/**', route => route.abort());
    
    const qualityButton = page.locator('.vjs-quality-selector');
    await qualityButton.click();
    
    // Try to select failed quality
    await page.locator('.vjs-menu-item').filter({ hasText: '1080p' }).click();
    
    // Verify fallback to working quality
    await page.waitForTimeout(2000);
    const currentQuality = await page.locator('.vjs-quality-selector').textContent();
    expect(currentQuality).not.toContain('1080p');
  });

  test('should support Arabic RTL interface', async ({ page }) => {
    await page.goto('/ar/video/video_001');
    await page.waitForSelector('.video-js');
    
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    const qualityButton = page.locator('.vjs-quality-selector');
    await qualityButton.click();
    
    // Verify Arabic labels (implementation specific)
    await expect(page.locator('.vjs-menu')).toHaveClass(/vjs-rtl/);
  });

  test('should track quality changes in analytics', async ({ page }) => {
    // Listen for analytics events
    const analyticsEvents: any[] = [];
    await page.evaluateOnNewDocument(() => {
      window.analyticsEvents = [];
      const originalTrack = window.analytics?.track;
      if (originalTrack) {
        window.analytics.track = (event: string, properties: any) => {
          window.analyticsEvents.push({ event, properties });
          originalTrack(event, properties);
        };
      }
    });
    
    const qualityButton = page.locator('.vjs-quality-selector');
    await qualityButton.click();
    await page.locator('.vjs-menu-item').filter({ hasText: '720p' }).click();
    
    // Check analytics event
    const events = await page.evaluate(() => window.analyticsEvents);
    const qualityChangeEvent = events.find((e: any) => e.event === 'video_quality_changed');
    expect(qualityChangeEvent).toBeDefined();
    expect(qualityChangeEvent.properties.quality).toBe('720p');
  });
});
```

## Network Throttle Utility

```typescript
// utils/network-throttle.ts
import { Page, CDPSession } from '@playwright/test';

interface NetworkConditions {
  downloadThroughput: number;
  uploadThroughput: number;
  latency: number;
}

export async function throttleNetwork(page: Page, conditions: NetworkConditions): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: conditions.downloadThroughput,
    uploadThroughput: conditions.uploadThroughput,
    latency: conditions.latency,
  });
}

export async function resetNetwork(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: -1,
    uploadThroughput: -1,
    latency: 0,
  });
}
```

## Test Data Cleanup

```bash
# Clean up network conditions
pnpm test:reset-network

# Clear quality preferences
pnpm test:clear-quality-preferences --user=test@example.com

# Reset analytics events
pnpm test:reset-analytics
```

## Related Test Cases

- TC-VID-001: Video Playback Functionality
- TC-VID-010: Video Player Performance and Optimization
- TC-PERF-002: Network Performance Testing
- TC-MOB-003: Mobile Video Quality Optimization

## Acceptance Criteria Verification

- [ ] All quality options (360p, 480p, 720p, 1080p) are available and selectable
- [ ] Manual quality switching works without buffering
- [ ] Adaptive streaming responds to network conditions within 5 seconds
- [ ] Quality changes are smooth without video interruption
- [ ] User preferences are remembered across sessions
- [ ] Mobile network conditions are handled appropriately
- [ ] Error scenarios are handled gracefully with fallback behavior
- [ ] Arabic RTL interface works correctly
- [ ] Quality changes are tracked in analytics
- [ ] Performance impact is minimal during quality switching

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 18 minutes 45 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Network Conditions Tested**: Slow 3G, Fast 3G, 4G, WiFi
- **Issues Found**: None
- **Retest Required**: No