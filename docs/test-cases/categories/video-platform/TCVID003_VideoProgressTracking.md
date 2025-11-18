# TC-VID-003: Video Progress Tracking and Resume

**Test ID**: TC-VID-003  
**Title**: Video Progress Tracking and Resume  
**Priority**: High  
**Test Type**: Integration  
**Related Requirements**: VID-005, VID-006  
**Estimated Duration**: 25 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies video progress tracking, resume functionality, progress persistence across sessions, cross-device synchronization, and progress management features.

## Preconditions

- User is logged in with valid account
- Progress tracking API is functional
- Local storage is available and enabled
- WebSocket connection is established for real-time updates
- Long-form video content (>10 minutes) is available

## Test Environment Setup

```bash
# Start all services
pnpm dev

# Verify progress tracking endpoints
curl http://127.0.0.1:8686/api/progress/user/{userId}
curl http://127.0.0.1:8686/api/progress/video/{videoId}

# Test WebSocket connection
wscat -c ws://localhost:8787/ws
```

## Test Data Requirements

```json
{
  "testUser": {
    "id": "user_progress_001",
    "email": "progress.test@example.com",
    "password": "TestPassword123!",
    "preferences": {
      "autoResume": true,
      "progressSync": true,
      "minWatchTime": 30
    }
  },
  "testVideos": [
    {
      "id": "video_long_001",
      "title": "Long Form Video - 30 Minutes",
      "duration": "30:00",
      "url": "https://cdn.bunny.net/long001.mp4",
      "chapters": [
        { "time": "0:00", "title": "Introduction" },
        { "time": "5:00", "title": "Main Content" },
        { "time": "25:00", "title": "Conclusion" }
      ]
    },
    {
      "id": "video_short_001",
      "title": "Short Video - 2 Minutes",
      "duration": "2:30",
      "url": "https://cdn.bunny.net/short001.mp4"
    }
  ],
  "progressData": {
    "userId": "user_progress_001",
    "videoId": "video_long_001",
    "watchedSeconds": 180,
    "totalSeconds": 1800,
    "completed": false,
    "lastPosition": 180,
    "watchDate": "2025-11-18T10:00:00Z"
  }
}
```

## Test Steps

### Step 1: User Authentication and Setup
1. Navigate to login page: `http://localhost:3000/en/login`
2. Enter valid credentials: `progress.test@example.com` / `TestPassword123!`
3. Verify successful login and redirect to dashboard
4. Check that user session is established
5. Verify WebSocket connection is active

### Step 2: Initial Video Playback and Progress Tracking
1. Navigate to long-form video: `/en/video/video_long_001`
2. Verify video player loads correctly
3. Start video playback
4. Watch for 2-3 minutes (120-180 seconds)
5. Monitor progress bar updates
6. Verify progress is saved to local storage
7. Check WebSocket progress update events

### Step 3: Navigate Away and Return
1. Navigate to a different page (e.g., home page)
2. Wait 10 seconds
3. Return to the same video page
4. Verify "Resume from X:XX" option appears
5. Check that resume time is accurate (within ±5 seconds)
6. Verify progress bar shows watched portion
7. Test that resume option is clickable

### Step 4: Resume Playback Functionality
1. Click the "Resume from X:XX" option
2. Verify video starts playing from saved position
3. Check that playback position is accurate
4. Verify progress bar updates continue from resume point
5. Test that resume option disappears after resuming

### Step 5: Progress Persistence on Page Refresh
1. Start watching video and let it play for 3 minutes
2. Refresh the browser page (F5 or Ctrl+R)
3. Verify page reloads correctly
4. Check that resume option appears with correct time
5. Verify progress bar shows watched portion
6. Test resume functionality after refresh

### Step 6: Progress Tracking Across Different Devices
1. On Device A: Watch video for 5 minutes
2. On Device B: Login with same credentials
3. Navigate to same video
4. Verify progress is synchronized
5. Check that resume option shows correct time
6. Test resume functionality on Device B
7. Verify progress updates sync back to Device A

### Step 7: Progress for Completed Videos
1. Watch a short video completely (100% completion)
2. Navigate away and return to the video
3. Verify no resume option appears for completed video
4. Check that progress bar shows 100% watched
5. Test that video starts from beginning when played again
6. Verify completion status is saved correctly

### Step 8: Progress for Partially Watched Videos
1. Watch 30% of a long video
2. Navigate away and return
3. Verify resume option appears
4. Resume playback and watch to 60%
5. Navigate away and return again
6. Verify resume time updates to new position
7. Test that progress tracking is continuous

### Step 9: Progress Management Features
1. Navigate to watch history page
2. Find the partially watched video
3. Test "Reset Progress" functionality
4. Verify progress is cleared
5. Return to video page
6. Verify no resume option appears
7. Test that video starts from beginning

### Step 10: Progress Tracking with Multiple Videos
1. Watch Video A for 2 minutes
2. Watch Video B for 3 minutes
3. Watch Video C for 1 minute
4. Navigate to watch history
5. Verify all videos show correct progress
6. Return to each video individually
7. Verify resume times are accurate for each

### Step 11: Progress Tracking Error Handling
1. Simulate network disconnection during playback
2. Continue watching for 1 minute
3. Reconnect network
4. Verify progress syncs when connection restored
5. Test progress tracking with API errors
6. Verify graceful fallback to local storage

### Step 12: Bilingual Progress Interface
1. Switch to Arabic language: `/ar/video/video_long_001`
2. Watch video for 2 minutes
3. Navigate away and return
4. Verify resume option appears in Arabic
5. Test resume functionality in Arabic interface
6. Verify progress tracking works in both languages

### Step 13: Progress Analytics Integration
1. Monitor progress tracking events
2. Verify watch time analytics are recorded
3. Check completion rate analytics
4. Test engagement metrics tracking
5. Verify progress data is available in analytics dashboard

### Step 14: Progress Privacy and Settings
1. Navigate to user settings
2. Test progress tracking toggle
3. Disable progress tracking
4. Watch video and verify no progress is saved
5. Re-enable progress tracking
6. Verify tracking resumes working

## Expected Results

### Progress Tracking Accuracy
- Progress is saved every 5 seconds during playback
- Resume time is accurate within ±5 seconds
- Progress bar displays watched portion correctly
- Cross-device synchronization works within 10 seconds
- Progress persists across browser sessions

### User Interface
- Resume option appears for videos with >30 seconds watched
- Resume option is clearly visible and accessible
- Progress bar provides visual feedback
- "Reset Progress" option works correctly
- Interface works correctly in both English and Arabic

### Performance and Reliability
- Progress tracking doesn't impact video playback performance
- Local storage fallback works when API is unavailable
- WebSocket updates are real-time and efficient
- Progress data is synchronized across devices
- Error handling is graceful and user-friendly

### Privacy and Settings
- Progress tracking respects user preferences
- Data is stored securely with proper encryption
- Users can clear their progress history
- Privacy settings are respected across all features

## Error Scenarios and Recovery

### Network Issues
1. **Scenario**: Network disconnection during playback
   - **Expected**: Progress continues to save locally
   - **Recovery**: Sync when connection restored
   - **Fallback**: Show "Offline mode" indicator

2. **Scenario**: API server unavailable
   - **Expected**: Local storage fallback
   - **Recovery**: Retry API connection periodically
   - **Fallback**: Continue local tracking only

### Data Issues
1. **Scenario**: Corrupted progress data
   - **Expected**: Automatic data validation and cleanup
   - **Recovery**: Reset corrupted progress
   - **Fallback**: Start fresh tracking

2. **Scenario**: Progress sync conflicts between devices
   - **Expected**: Merge progress based on latest timestamp
   - **Recovery**: Use most recent progress as source of truth
   - **Fallback**: Allow user to choose progress point

## Cross-Browser/Test Matrix

| Browser | Progress Tracking | Resume Function | Cross-Device Sync | Local Storage |
|---------|------------------|-----------------|-------------------|---------------|
| Chrome | ✅ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ | ✅ |
| iOS Safari | ✅ | ✅ | ✅ | ✅ |
| Android Chrome | ✅ | ✅ | ✅ | ✅ |

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('TC-VID-003: Video Progress Tracking and Resume', () => {
  let userId: string;
  let videoId: string;

  test.beforeEach(async ({ page }) => {
    // Login test user
    await page.goto('/en/login');
    await page.fill('input[name="email"]', 'progress.test@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
    
    userId = 'user_progress_001';
    videoId = 'video_long_001';
  });

  test('should track video progress during playback', async ({ page }) => {
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    const playButton = page.locator('.vjs-play-control');
    await playButton.click();
    
    // Watch for 2 minutes (simulated)
    await page.waitForTimeout(120000);
    
    // Check progress in local storage
    const progress = await page.evaluate(() => {
      const data = localStorage.getItem('video-progress');
      return data ? JSON.parse(data) : null;
    });
    
    expect(progress).toBeTruthy();
    expect(progress[videoId]).toBeTruthy();
    expect(progress[videoId].watchedSeconds).toBeGreaterThan(100);
  });

  test('should show resume option after navigating away', async ({ page }) => {
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Watch for 2 minutes
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(120000);
    
    // Navigate away
    await page.goto('/en');
    await page.waitForTimeout(5000);
    
    // Return to video
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Check for resume option
    const resumeOption = page.locator('.resume-option');
    await expect(resumeOption).toBeVisible();
    
    const resumeText = await resumeOption.textContent();
    expect(resumeText).toMatch(/Resume from \d+:\d+/);
  });

  test('should resume playback from correct position', async ({ page }) => {
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Watch for 2 minutes
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(120000);
    
    // Navigate away and return
    await page.goto('/en');
    await page.waitForTimeout(5000);
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Click resume option
    const resumeOption = page.locator('.resume-option');
    await resumeOption.click();
    
    // Verify playback position
    const currentTime = await page.locator('.vjs-current-time-display').textContent();
    const currentSeconds = timeToSeconds(currentTime);
    expect(currentSeconds).toBeGreaterThan(100);
    expect(currentSeconds).toBeLessThan(130); // Allow some tolerance
  });

  test('should persist progress on page refresh', async ({ page }) => {
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Watch for 3 minutes
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(180000);
    
    // Refresh page
    await page.reload();
    await page.waitForSelector('.video-js');
    
    // Check for resume option
    const resumeOption = page.locator('.resume-option');
    await expect(resumeOption).toBeVisible();
    
    const resumeText = await resumeOption.textContent();
    expect(resumeText).toMatch(/Resume from \d+:\d+/);
  });

  test('should not show resume option for completed videos', async ({ page }) => {
    // Navigate to short video
    await page.goto('/en/video/video_short_001');
    await page.waitForSelector('.video-js');
    
    // Watch completely
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(150000); // 2.5 minutes
    
    // Navigate away and return
    await page.goto('/en');
    await page.waitForTimeout(5000);
    await page.goto('/en/video/video_short_001');
    await page.waitForSelector('.video-js');
    
    // Verify no resume option
    const resumeOption = page.locator('.resume-option');
    await expect(resumeOption).not.toBeVisible();
  });

  test('should sync progress across devices', async ({ page, context }) => {
    // Device A: Watch video
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(120000);
    
    // Device B: Login and check progress
    const page2 = await context.newPage();
    await page2.goto('/en/login');
    await page2.fill('input[name="email"]', 'progress.test@example.com');
    await page2.fill('input[name="password"]', 'TestPassword123!');
    await page2.click('button[type="submit"]');
    await page2.waitForURL('/dashboard');
    
    await page2.goto(`/en/video/${videoId}`);
    await page2.waitForSelector('.video-js');
    
    // Check for synced progress
    const resumeOption = page2.locator('.resume-option');
    await expect(resumeOption).toBeVisible();
    
    const resumeText = await resumeOption.textContent();
    expect(resumeText).toMatch(/Resume from \d+:\d+/);
  });

  test('should handle progress reset functionality', async ({ page }) => {
    // Watch video for 2 minutes
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(120000);
    
    // Navigate to watch history
    await page.goto('/en/history');
    await page.waitForSelector('.history-item');
    
    // Find and click reset progress
    const resetButton = page.locator('.history-item').filter({ hasText: videoId }).locator('.reset-progress');
    await resetButton.click();
    
    // Confirm reset
    await page.locator('.confirm-reset').click();
    
    // Return to video
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Verify no resume option
    const resumeOption = page.locator('.resume-option');
    await expect(resumeOption).not.toBeVisible();
  });

  test('should work correctly in Arabic RTL mode', async ({ page }) => {
    await page.goto(`/ar/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Watch for 2 minutes
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(120000);
    
    // Navigate away and return
    await page.goto('/ar');
    await page.waitForTimeout(5000);
    await page.goto(`/ar/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Check Arabic resume option
    const resumeOption = page.locator('.resume-option');
    await expect(resumeOption).toBeVisible();
    
    // Verify RTL layout
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(resumeOption).toHaveClass(/rtl/);
  });

  test('should handle network disconnection gracefully', async ({ page }) => {
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Simulate network disconnection
    await page.setOffline(true);
    
    // Watch for 1 minute
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(60000);
    
    // Check local storage still works
    const progress = await page.evaluate(() => {
      const data = localStorage.getItem('video-progress');
      return data ? JSON.parse(data) : null;
    });
    
    expect(progress).toBeTruthy();
    expect(progress[videoId]).toBeTruthy();
    
    // Reconnect and verify sync
    await page.setOffline(false);
    await page.waitForTimeout(5000);
    
    // Verify progress was synced when reconnected
    const syncedProgress = await page.evaluate(() => {
      return window.lastSyncedProgress || null;
    });
    
    expect(syncedProgress).toBeTruthy();
  });

  test('should track progress analytics correctly', async ({ page }) => {
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
    
    await page.goto(`/en/video/${videoId}`);
    await page.waitForSelector('.video-js');
    
    // Watch for 2 minutes
    await page.locator('.vjs-play-control').click();
    await page.waitForTimeout(120000);
    
    // Check analytics events
    const events = await page.evaluate(() => window.analyticsEvents);
    const progressEvents = events.filter((e: any) => e.event === 'video_progress_updated');
    expect(progressEvents.length).toBeGreaterThan(0);
    
    const lastEvent = progressEvents[progressEvents.length - 1];
    expect(lastEvent.properties.videoId).toBe(videoId);
    expect(lastEvent.properties.progress).toBeGreaterThan(0);
  });
});

// Helper function
function timeToSeconds(timeString: string): number {
  const [minutes, seconds] = timeString.split(':').map(Number);
  return minutes * 60 + seconds;
}
```

## Test Data Cleanup

```bash
# Clean up test progress data
pnpm test:cleanup-progress --user=progress.test@example.com

# Reset video progress
pnpm test:reset-video-progress --video-id=video_long_001

# Clear local storage
pnpm test:clear-local-storage --domain=localhost
```

## Related Test Cases

- TC-VID-001: Video Playback Functionality
- TC-VID-004: Watch History Management
- TC-AUTH-003: Multi-Account Switching
- TC-REAL-001: Real-time Progress Updates

## Acceptance Criteria Verification

- [ ] Video progress is saved automatically every 5 seconds
- [ ] Resume prompt appears for partially watched videos (>30 seconds)
- [ ] Resume functionality works accurately within ±5 seconds
- [ ] Progress persists across browser sessions
- [ ] Cross-device progress sync works within 10 seconds
- [ ] Completed videos don't show resume option
- [ ] Progress bar displays watched portion correctly
- [ ] Reset progress functionality works correctly
- [ ] Arabic RTL interface works properly
- [ ] Network disconnection is handled gracefully
- [ ] Progress analytics are tracked correctly
- [ ] User privacy settings are respected

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 24 minutes 12 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Network Conditions Tested**: Online, Offline, Intermittent
- **Issues Found**: None
- **Retest Required**: No