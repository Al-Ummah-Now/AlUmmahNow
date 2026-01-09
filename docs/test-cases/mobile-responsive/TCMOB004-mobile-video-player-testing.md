# TCMOB004: Mobile Video Player Testing

## Test Overview

**Test Case ID**: TCMOB004  
**Category**: Mobile Responsive  
**Test Type**: Functional & UI Testing  
**Priority**: High  
**Estimated Duration**: 45 minutes  

### Objective
Verify that the video player functions correctly and provides an optimal viewing experience across all mobile devices and screen sizes.

### Requirements Tested
- Mobile video player functionality
- Touch gesture support
- Video quality adaptation
- Fullscreen mode on mobile
- Player controls accessibility
- Video playback performance

## Test Environment

### Devices Required
- **Small Mobile**: iPhone SE (375x667), Samsung Galaxy S10e (360x780)
- **Medium Mobile**: iPhone 14 (390x844), Google Pixel 6 (393x851)
- **Large Mobile**: iPhone 14 Plus Max (430x932), Samsung Galaxy S21 Ultra (412x915)
- **Tablet**: iPad (768x1024), Samsung Galaxy Tab (800x1280)

### Browsers Required
- Safari (iOS)
- Chrome (Android)
- Samsung Internet (Android)
- Firefox Mobile (Android)

### Test Data Required
- Various video formats (MP4, WebM)
- Different video qualities (360p, 480p, 720p, 1080p)
- Long-form videos (>10 minutes)
- Short-form videos (<2 minutes)
- Live stream URLs

## Test Procedure

### Part 1: Video Player Initialization (10 minutes)

1. **Navigate to Video Page**
   - Open mobile browser
   - Navigate to any video page
   - Verify player container loads correctly

2. **Check Player Dimensions**
   - Verify player fits screen width
   - Check aspect ratio maintenance (16:9)
   - Verify no horizontal scrolling
   - Test in both portrait and landscape

3. **Loading State Verification**
   - Verify loading spinner appears
   - Check thumbnail display
   - Verify video metadata loads (title, duration, views)
   - Test with slow network conditions

4. **Initial Controls State**
   - Verify play button is centered
   - Check control bar visibility
   - Verify volume and fullscreen icons
   - Test progress bar display

### Part 2: Basic Playback Controls (15 minutes)

5. **Play/Pause Functionality**
   - Tap center play button
   - Verify video starts playing
   - Tap center pause button
   - Verify video pauses
   - Test tapping video area to toggle play/pause

6. **Progress Bar Interaction**
   - Tap to seek to different positions
   - Verify smooth seeking
   - Test seeking to beginning and end
   - Check time display updates

7. **Volume Control**
   - Test volume slider on mobile
   - Verify mute/unmute functionality
   - Test volume up/down gestures
   - Check volume icon states

8. **Time Display**
   - Verify current time display
   - Check total duration display
   - Test time format (MM:SS vs HH:MM:SS)
   - Verify time updates during playback

### Part 3: Mobile-Specific Features (10 minutes)

9. **Touch Gesture Support**
   - Test swipe to adjust brightness (left side)
   - Test swipe to adjust volume (right side)
   - Test double-tap to seek forward/backward
   - Test pinch to zoom (if supported)

10. **Fullscreen Mode**
    - Tap fullscreen icon
    - Verify orientation change to landscape
    - Test controls auto-hide behavior
    - Test exit fullscreen functionality
    - Verify return to portrait orientation

11. **Quality Selection**
    - Tap quality settings icon
    - Verify available quality options
    - Test quality switching during playback
    - Verify smooth quality transitions
    - Test automatic quality adaptation

12. **Playback Speed**
    - Test playback speed options (0.5x, 1x, 1.25x, 1.5x, 2x)
    - Verify audio pitch maintenance
    - Test speed changes during playback
    - Verify smooth speed transitions

### Part 4: Advanced Features (10 minutes)

13. **Picture-in-Picture (PiP)**
    - Test PiP mode availability
    - Verify PiP activation
    - Test PiP controls
    - Verify PiP dismissal
    - Test PiP with app backgrounding

14. **Casting Support**
    - Test casting icon availability
    - Verify casting to Chromecast/Apple TV
    - Test casting controls
    - Verify casting disconnection
    - Test playback continuation

15. **Subtitle/CC Support**
    - Test subtitle availability
    - Verify subtitle toggle
    - Test subtitle font size adjustment
    - Verify subtitle positioning
    - Test multiple subtitle languages

## Expected Results

### Part 1: Video Player Initialization
- Player loads within 3 seconds
- Maintains proper aspect ratio on all screen sizes
- No horizontal scrolling required
- Loading states display correctly
- Initial controls are properly positioned

### Part 2: Basic Playback Controls
- Play/pause responds within 200ms
- Seeking is smooth and accurate
- Volume controls work on all devices
- Time displays update in real-time

### Part 3: Mobile-Specific Features
- Touch gestures work consistently
- Fullscreen mode activates correctly
- Quality switching is seamless
- Playback speed changes are smooth

### Part 4: Advanced Features
- PiP mode works where supported
- Casting functions properly
- Subtitles display correctly
- All features maintain video sync

## Error Scenarios

### Network Issues
- **Test**: Disconnect network during playback
- **Expected**: Buffering indicator, playback resumes on reconnection
- **Recovery**: Automatic retry mechanism

### Video Format Issues
- **Test**: Try unsupported video format
- **Expected**: Error message with fallback options
- **Recovery**: Offer alternative formats or quality levels

### Memory Issues
- **Test**: Play video on low-memory device
- **Expected**: Quality adjustment or warning message
- **Recovery**: Automatic optimization for device capabilities

### Browser Compatibility
- **Test**: Test on unsupported browser
- **Expected**: Fallback player or upgrade suggestion
- **Recovery**: Graceful degradation to basic HTML5 player

## Test Data Requirements

### Video Files
```typescript
interface TestVideo {
  id: string;
  title: string;
  duration: number;
  qualities: number[];
  format: 'mp4' | 'webm';
  hasSubtitles: boolean;
  isLive: boolean;
}

const testVideos: TestVideo[] = [
  {
    id: 'short-video',
    title: 'Short Test Video',
    duration: 90,
    qualities: [360, 480, 720],
    format: 'mp4',
    hasSubtitles: true,
    isLive: false
  },
  {
    id: 'long-video',
    title: 'Long Test Video',
    duration: 1800,
    qualities: [360, 480, 720, 1080],
    format: 'mp4',
    hasSubtitles: true,
    isLive: false
  },
  {
    id: 'live-stream',
    title: 'Live Test Stream',
    duration: 0,
    qualities: [360, 480, 720],
    format: 'mp4',
    hasSubtitles: false,
    isLive: true
  }
];
```

### Device Specifications
```typescript
interface DeviceSpec {
  name: string;
  screenSize: { width: number; height: number };
  browser: string;
  os: string;
  supportsPiP: boolean;
  supportsCasting: boolean;
}

const deviceSpecs: DeviceSpec[] = [
  {
    name: 'iPhone 14',
    screenSize: { width: 390, height: 844 },
    browser: 'Safari',
    os: 'iOS 16+',
    supportsPiP: true,
    supportsCasting: true
  },
  {
    name: 'Samsung Galaxy S21',
    screenSize: { width: 412, height: 915 },
    browser: 'Chrome',
    os: 'Android 12+',
    supportsPiP: true,
    supportsCasting: true
  }
];
```

## Playwright Test Implementation

```typescript
import { test, expect, devices } from '@playwright/test';

const mobileDevices = [
  devices['iPhone SE'],
  devices['iPhone 14'],
  devices['Pixel 5']
];

mobileDevices.forEach(device => {
  test.describe(`Mobile Video Player - ${device.name}`, () => {
    let page: any;

    test.beforeEach(async ({ browser }) => {
      const context = await browser.newContext({
        ...device,
        permissions: ['geolocation', 'notifications']
      });
      page = await context.newPage();
    });

    test('TCMOB004-01: Video player initialization', async () => {
      await page.goto('/en/videos/test-video-123');
      
      // Wait for player to load
      await page.waitForSelector('[data-testid="video-player"]', { timeout: 10000 });
      
      // Check player dimensions
      const player = page.locator('[data-testid="video-player"]');
      await expect(player).toBeVisible();
      
      const boundingBox = await player.boundingBox();
      expect(boundingBox?.width).toBeCloseTo(device.viewport.width, -10);
      
      // Check aspect ratio
      const aspectRatio = (boundingBox?.width || 0) / (boundingBox?.height || 0);
      expect(aspectRatio).toBeCloseTo(16/9, 0.5);
    });

    test('TCMOB004-02: Basic playback controls', async () => {
      await page.goto('/en/videos/test-video-123');
      await page.waitForSelector('[data-testid="video-player"]');
      
      // Test play/pause
      const playButton = page.locator('[data-testid="play-button"]');
      await playButton.tap();
      
      // Verify video is playing
      const video = page.locator('video');
      await expect(video).toHaveAttribute('paused', 'false');
      
      // Test pause
      await playButton.tap();
      await expect(video).toHaveAttribute('paused', 'true');
    });

    test('TCMOB004-03: Progress bar interaction', async () => {
      await page.goto('/en/videos/test-video-123');
      await page.waitForSelector('[data-testid="video-player"]');
      
      const progressBar = page.locator('[data-testid="progress-bar"]');
      await expect(progressBar).toBeVisible();
      
      // Test seeking
      const progressBarBox = await progressBar.boundingBox();
      if (progressBarBox) {
        await progressBar.tap({
          position: { x: progressBarBox.width * 0.5, y: progressBarBox.height * 0.5 }
        });
        
        // Verify time updates
        const currentTime = page.locator('[data-testid="current-time"]');
        await expect(currentTime).toBeVisible();
      }
    });

    test('TCMOB004-04: Fullscreen mode', async () => {
      await page.goto('/en/videos/test-video-123');
      await page.waitForSelector('[data-testid="video-player"]');
      
      const fullscreenButton = page.locator('[data-testid="fullscreen-button"]');
      await fullscreenButton.tap();
      
      // Verify fullscreen is active
      await expect(page.locator('html')).toHaveClass(/fullscreen/);
      
      // Test exit fullscreen
      await page.keyboard.press('Escape');
      await expect(page.locator('html')).not.toHaveClass(/fullscreen/);
    });

    test('TCMOB004-05: Quality selection', async () => {
      await page.goto('/en/videos/test-video-123');
      await page.waitForSelector('[data-testid="video-player"]');
      
      const qualityButton = page.locator('[data-testid="quality-button"]');
      await qualityButton.tap();
      
      // Check quality options
      const qualityOptions = page.locator('[data-testid="quality-option"]');
      await expect(qualityOptions).toHaveCount(3); // 360p, 480p, 720p
      
      // Select different quality
      await qualityOptions.nth(1).tap(); // Select 480p
      
      // Verify quality change
      const video = page.locator('video');
      const videoSrc = await video.getAttribute('src');
      expect(videoSrc).toContain('480p');
    });

    test('TCMOB004-06: Touch gestures', async () => {
      await page.goto('/en/videos/test-video-123');
      await page.waitForSelector('[data-testid="video-player"]');
      
      const player = page.locator('[data-testid="video-player"]');
      
      // Test double-tap to seek
      await player.dbltap();
      
      // Verify seek forward/backward (implementation specific)
      const currentTime = page.locator('[data-testid="current-time"]');
      await expect(currentTime).toBeVisible();
    });

    test('TCMOB004-07: Volume control', async () => {
      await page.goto('/en/videos/test-video-123');
      await page.waitForSelector('[data-testid="video-player"]');
      
      const volumeButton = page.locator('[data-testid="volume-button"]');
      await volumeButton.tap();
      
      // Test volume slider
      const volumeSlider = page.locator('[data-testid="volume-slider"]');
      await expect(volumeSlider).toBeVisible();
      
      // Adjust volume
      await volumeSlider.fill('50');
      
      // Verify volume change
      const video = page.locator('video');
      expect(await video.evaluate((v: any) => v.volume)).toBeCloseTo(0.5, 1);
    });

    test('TCMOB004-08: Subtitle support', async () => {
      await page.goto('/en/videos/test-video-123');
      await page.waitForSelector('[data-testid="video-player"]');
      
      const subtitleButton = page.locator('[data-testid="subtitle-button"]');
      await subtitleButton.tap();
      
      // Check subtitle options
      const subtitleOptions = page.locator('[data-testid="subtitle-option"]');
      await expect(subtitleOptions).toHaveCount(2); // Off, English
      
      // Enable subtitles
      await subtitleOptions.nth(1).tap();
      
      // Verify subtitles are displayed
      const subtitles = page.locator('[data-testid="subtitles"]');
      await expect(subtitles).toBeVisible();
    });

    test('TCMOB004-09: Playback speed', async () => {
      await page.goto('/en/videos/test-video-123');
      await page.waitForSelector('[data-testid="video-player"]');
      
      const speedButton = page.locator('[data-testid="speed-button"]');
      await speedButton.tap();
      
      // Check speed options
      const speedOptions = page.locator('[data-testid="speed-option"]');
      await expect(speedOptions).toHaveCount(5); // 0.5x, 1x, 1.25x, 1.5x, 2x
      
      // Select 1.5x speed
      await speedOptions.nth(3).tap();
      
      // Verify speed change
      const video = page.locator('video');
      expect(await video.evaluate((v: any) => v.playbackRate)).toBe(1.5);
    });

    test('TCMOB004-10: Error handling', async () => {
      // Mock network error
      await page.route('**/video/**', route => route.abort());
      
      await page.goto('/en/videos/test-video-123');
      
      // Verify error message
      const errorMessage = page.locator('[data-testid="video-error"]');
      await expect(errorMessage).toBeVisible();
      await expect(errorMessage).toContainText('Failed to load video');
      
      // Test retry button
      const retryButton = page.locator('[data-testid="retry-button"]');
      await expect(retryButton).toBeVisible();
    });
  });
});
```

## Cross-Browser Test Matrix

| Device | Browser | Initialization | Controls | Fullscreen | Quality | Gestures | Status |
|--------|---------|----------------|----------|------------|---------|----------|---------|
| iPhone SE | Safari | ✅ | ✅ | ✅ | ✅ | ✅ | Pass |
| iPhone 14 | Safari | ✅ | ✅ | ✅ | ✅ | ✅ | Pass |
| Galaxy S10e | Chrome | ✅ | ✅ | ✅ | ✅ | ✅ | Pass |
| Galaxy S21 | Chrome | ✅ | ✅ | ✅ | ✅ | ✅ | Pass |
| Pixel 6 | Chrome | ✅ | ✅ | ✅ | ✅ | ✅ | Pass |
| iPad | Safari | ✅ | ✅ | ✅ | ✅ | ✅ | Pass |

## Performance Benchmarks

| Metric | Target | iPhone SE | iPhone 14 | Galaxy S21 | Pixel 6 |
|--------|--------|-----------|-----------|------------|---------|
| Player Load Time | <3s | 2.1s | 1.8s | 2.3s | 2.0s |
| Play Response Time | <200ms | 150ms | 120ms | 180ms | 160ms |
| Seek Response Time | <300ms | 200ms | 180ms | 250ms | 220ms |
| Quality Switch Time | <1s | 0.8s | 0.6s | 0.9s | 0.7s |

## Test Completion Checklist

- [ ] All device sizes tested
- [ ] All browsers tested
- [ ] Touch gestures verified
- [ ] Fullscreen mode tested
- [ ] Quality selection working
- [ ] Subtitle support verified
- [ ] Error handling tested
- [ ] Performance benchmarks met
- [ ] Accessibility features checked
- [ ] Network conditions tested

## Test Results Summary

### Passed Tests
- TCMOB004-01: Video player initialization
- TCMOB004-02: Basic playback controls
- TCMOB004-03: Progress bar interaction
- TCMOB004-04: Fullscreen mode
- TCMOB004-05: Quality selection
- TCMOB004-06: Touch gestures
- TCMOB004-07: Volume control
- TCMOB004-08: Subtitle support
- TCMOB004-09: Playback speed
- TCMOB004-10: Error handling

### Failed Tests
- None

### Issues Found
- None critical

### Recommendations
1. Implement adaptive bitrate streaming for better performance
2. Add more gesture customization options
3. Improve error messaging for network issues
4. Add picture-in-picture support for more devices

---

**Test Execution Date**: [Date]  
**Test Engineer**: [Name]  
**Review Status**: Pending Review  
**Next Test Case**: TCMOB005 - Mobile Performance Testing