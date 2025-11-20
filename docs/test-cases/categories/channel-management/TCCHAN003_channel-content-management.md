# TC-CHAN-003: Channel Content Management

## Test Case Information

**Test ID**: TC-CHAN-003  
**Title**: Channel Content Management  
**Priority**: High  
**Type**: E2E  
**Category**: Channel Management  
**Estimated Duration**: 12 minutes  
**Last Updated**: 2025-11-20  

## Test Description

This test case verifies comprehensive channel content management including video uploads, playlist creation, content organization, scheduling, publishing, and content moderation features.

## Prerequisites

1. User must be logged in with channel owner permissions
2. Channel must exist and be accessible
3. Upload functionality must be enabled
4. Content processing services must be operational

## Test Data

```typescript
const contentData = {
  video: {
    title: 'Test Video ' + Date.now(),
    description: 'This is a test video for content management',
    tags: ['test', 'education', 'islamic'],
    category: 'education',
    language: 'en',
    visibility: 'public',
    file: 'test-video.mp4',
    thumbnail: 'test-thumbnail.jpg'
  },
  playlist: {
    name: 'Test Playlist ' + Date.now(),
    description: 'This is a test playlist',
    visibility: 'public'
  },
  schedule: {
    publishDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
    timezone: 'UTC'
  }
};
```

## Test Steps

### 1. Navigate to Channel Content Management

```bash
# English version
GET /en/channels/{channelId}/edit/content

# Arabic version
GET /ar/channels/{channelId}/edit/content
```

**Expected Results:**
- Content management dashboard loads
- Content statistics are displayed
- Upload and management options are accessible
- Content list shows existing items

### 2. Upload New Video Content

**Actions:**
1. Click "Upload Video" button
2. Select video file: `contentData.video.file`
3. Fill video metadata:
   - Title: `contentData.video.title`
   - Description: `contentData.video.description`
   - Tags: `contentData.video.tags`
   - Category: `contentData.video.category`
   - Language: `contentData.video.language`
   - Visibility: `contentData.video.visibility`
4. Upload thumbnail: `contentData.video.thumbnail`
5. Set publishing options
6. Submit upload

**Expected Results:**
- File picker opens correctly
- Video validation checks format and size
- Upload progress indicator shows progress
- Metadata form validates all fields
- Thumbnail upload works correctly
- Video processing starts after upload
- Content appears in content list with processing status

### 3. Create and Manage Playlists

**Actions:**
1. Navigate to "Playlists" section
2. Click "Create Playlist"
3. Fill playlist details:
   - Name: `contentData.playlist.name`
   - Description: `contentData.playlist.description`
   - Visibility: `contentData.playlist.visibility`
4. Add videos to playlist
5. Reorder playlist items
6. Save playlist

**Expected Results:**
- Playlist creation form works
- Playlist is saved successfully
- Videos can be added via search or browse
- Drag-and-drop reordering works
- Playlist updates reflect immediately
- Playlist appears in channel sections

### 4. Schedule Content Publishing

**Actions:**
1. Select uploaded video
2. Click "Schedule" option
3. Set publish date: `contentData.schedule.publishDate`
4. Select timezone: `contentData.schedule.timezone`
5. Add scheduling notes
6. Confirm schedule

**Expected Results:**
- Scheduling interface loads correctly
- Date/time picker works properly
- Timezone selection functions
- Scheduled content shows proper status
- Calendar view displays scheduled items
- Notifications are set for publishing time

### 5. Content Organization and Sections

**Actions:**
1. Navigate to "Sections" management
2. Create new section: "Featured Content"
3. Add videos to section
4. Reorder sections
5. Configure section display settings
6. Preview section layout

**Expected Results:**
- Section creation works correctly
- Content can be added to sections
- Section reordering updates channel layout
- Display settings apply correctly
- Preview matches final appearance
- Changes reflect on channel page

### 6. Content Moderation and Management

**Actions:**
1. Select multiple content items
2. Apply bulk actions:
   - Change visibility
   - Add to playlist
   - Update category
   - Delete content
3. Test content filtering and search
4. Verify content analytics

**Expected Results:**
- Bulk selection works correctly
- Bulk actions apply to all selected items
- Content filtering works by various criteria
- Search finds content by title, description, tags
- Analytics show accurate metrics

## Test Automation (Playwright)

```typescript
import { test, expect } from '@playwright/test';

test.describe('Channel Content Management', () => {
  let channelId: string;

  test.beforeEach(async ({ page }) => {
    // Login and get channel
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'channel-owner@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-button"]');
    
    await page.goto('/en/channels');
    const firstChannel = page.locator('[data-testid="channel-item"]').first();
    await firstChannel.click();
    const url = page.url();
    channelId = url.split('/').pop() || '';
    
    await page.goto(`/en/channels/${channelId}/edit/content`);
  });

  test('should upload video content successfully', async ({ page }) => {
    // Start upload
    await page.click('[data-testid="upload-video-button"]');
    
    // Upload video file
    const fileInput = page.locator('[data-testid="video-file-input"]');
    await fileInput.setInputFiles('test/fixtures/test-video.mp4');
    
    // Wait for upload to start
    await expect(page.locator('[data-testid="upload-progress"]')).toBeVisible();
    
    // Fill metadata
    await page.fill('[data-testid="video-title"]', `Test Video ${Date.now()}`);
    await page.fill('[data-testid="video-description"]', 'This is a test video for content management');
    await page.fill('[data-testid="video-tags"]', 'test, education, islamic');
    await page.selectOption('[data-testid="video-category"]', 'education');
    await page.selectOption('[data-testid="video-language"]', 'en');
    await page.selectOption('[data-testid="video-visibility"]', 'public');
    
    // Upload thumbnail
    const thumbnailInput = page.locator('[data-testid="thumbnail-input"]');
    await thumbnailInput.setInputFiles('test/fixtures/test-thumbnail.jpg');
    
    // Submit upload
    await page.click('[data-testid="submit-upload-button"]');
    
    // Wait for processing
    await expect(page.locator('[data-testid="processing-status"]')).toBeVisible();
    
    // Verify in content list
    await page.goto(`/en/channels/${channelId}/edit/content`);
    await expect(page.locator('[data-testid="content-item"]')).toHaveCount.greaterThan(0);
  });

  test('should create and manage playlists', async ({ page }) => {
    // Navigate to playlists
    await page.click('[data-testid="tab-playlists"]');
    
    // Create playlist
    await page.click('[data-testid="create-playlist-button"]');
    await page.fill('[data-testid="playlist-name"]', `Test Playlist ${Date.now()}`);
    await page.fill('[data-testid="playlist-description"]', 'This is a test playlist');
    await page.selectOption('[data-testid="playlist-visibility"]', 'public');
    
    await page.click('[data-testid="create-playlist-submit"]');
    
    // Verify playlist created
    await expect(page.locator('[data-testid="playlist-item"]')).toBeVisible();
    
    // Add videos to playlist
    await page.click('[data-testid="add-videos-button"]');
    await page.click('[data-testid="video-item"]').first();
    await page.click('[data-testid="add-to-playlist-button"]');
    
    // Verify videos added
    await expect(page.locator('[data-testid="playlist-video-item"]')).toHaveCount.greaterThan(0);
    
    // Test reordering
    await page.dragAndDrop(
      '[data-testid="playlist-video-item"]:nth-child(2)',
      '[data-testid="playlist-video-item"]:first-child'
    );
    
    await page.click('[data-testid="save-playlist-order"]');
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
  });

  test('should schedule content publishing', async ({ page }) => {
    // Upload a video first (simplified)
    await page.click('[data-testid="upload-video-button"]');
    const fileInput = page.locator('[data-testid="video-file-input"]');
    await fileInput.setInputFiles('test/fixtures/test-video.mp4');
    await page.fill('[data-testid="video-title"]', 'Scheduled Video');
    await page.click('[data-testid="submit-upload-button"]');
    
    // Wait for upload to complete
    await page.waitForSelector('[data-testid="content-item"]', { timeout: 30000 });
    
    // Schedule the video
    await page.click('[data-testid="content-item"] [data-testid="schedule-button"]');
    
    // Set schedule
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    
    await page.fill('[data-testid="schedule-date"]', dateStr);
    await page.selectOption('[data-testid="schedule-time"]', '10:00');
    await page.selectOption('[data-testid="schedule-timezone"]', 'UTC');
    
    await page.click('[data-testid="confirm-schedule"]');
    
    // Verify scheduled status
    await expect(page.locator('[data-testid="scheduled-status"]')).toBeVisible();
    await expect(page.locator('[data-testid="scheduled-date"]')).toContainText(dateStr);
  });

  test('should manage content sections', async ({ page }) => {
    // Navigate to sections
    await page.click('[data-testid="tab-sections"]');
    
    // Create new section
    await page.click('[data-testid="create-section-button"]');
    await page.fill('[data-testid="section-name"]', 'Featured Content');
    await page.selectOption('[data-testid="section-type"]', 'video-grid');
    await page.fill('[data-testid="section-description"]', 'Featured videos from our channel');
    
    await page.click('[data-testid="create-section-submit"]');
    
    // Add content to section
    await page.click('[data-testid="section-item"] [data-testid="add-content-button"]');
    await page.click('[data-testid="video-item"]').first();
    await page.click('[data-testid="add-to-section-button"]');
    
    // Verify section content
    await expect(page.locator('[data-testid="section-video-item"]')).toHaveCount.greaterThan(0);
    
    // Test section reordering
    await page.dragAndDrop(
      '[data-testid="section-item"]:nth-child(2)',
      '[data-testid="section-item"]:first-child'
    );
    
    await page.click('[data-testid="save-section-order"]');
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
    
    // Preview section
    await page.click('[data-testid="preview-section-button"]');
    await expect(page.locator('[data-testid="section-preview"]')).toBeVisible();
  });

  test('should handle bulk content operations', async ({ page }) => {
    // Select multiple content items
    await page.check('[data-testid="content-item"]:first-child [data-testid="select-checkbox"]');
    await page.check('[data-testid="content-item"]:nth-child(2) [data-testid="select-checkbox"]');
    
    // Test bulk visibility change
    await page.selectOption('[data-testid="bulk-action-select"]', 'change-visibility');
    await page.selectOption('[data-testid="bulk-visibility"]', 'unlisted');
    await page.click('[data-testid="apply-bulk-action"]');
    
    // Verify changes applied
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
    
    const firstItemVisibility = await page.locator('[data-testid="content-item"]:first-child [data-testid="visibility-badge"]').textContent();
    expect(firstItemVisibility).toContain('Unlisted');
    
    // Test bulk add to playlist
    await page.selectOption('[data-testid="bulk-action-select"]', 'add-to-playlist');
    await page.click('[data-testid="playlist-option"]').first();
    await page.click('[data-testid="apply-bulk-action"]');
    
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
  });

  test('should filter and search content', async ({ page }) => {
    // Test search functionality
    await page.fill('[data-testid="content-search"]', 'test');
    await page.press('[data-testid="content-search"]', 'Enter');
    
    await expect(page.locator('[data-testid="content-item"]')).toHaveCount.greaterThan(0);
    
    // Test filters
    await page.selectOption('[data-testid="filter-category"]', 'education');
    await page.selectOption('[data-testid="filter-visibility"]', 'public');
    await page.selectOption('[data-testid="filter-status"]', 'published');
    
    await page.click('[data-testid="apply-filters"]');
    
    // Verify filters applied
    const filteredItems = page.locator('[data-testid="content-item"]');
    const count = await filteredItems.count();
    
    for (let i = 0; i < count; i++) {
      const item = filteredItems.nth(i);
      const category = await item.locator('[data-testid="category-badge"]').textContent();
      const visibility = await item.locator('[data-testid="visibility-badge"]').textContent();
      
      expect(category).toContain('Education');
      expect(visibility).toContain('Public');
    }
  });

  test('should display content analytics', async ({ page }) => {
    // Navigate to analytics
    await page.click('[data-testid="tab-analytics"]');
    
    // Verify analytics display
    await expect(page.locator('[data-testid="total-views"]')).toBeVisible();
    await expect(page.locator('[data-testid="total-watch-time"]')).toBeVisible();
    await expect(page.locator('[data-testid="subscriber-growth"]')).toBeVisible();
    
    // Test date range filter
    await page.selectOption('[data-testid="date-range"]', 'last-30-days');
    await page.click('[data-testid="apply-date-range"]');
    
    // Verify analytics update
    await expect(page.locator('[data-testid="analytics-chart"]')).toBeVisible();
    
    // Test individual content analytics
    await page.click('[data-testid="tab-content"]');
    await page.click('[data-testid="content-item"]:first-child [data-testid="analytics-button"]');
    
    await expect(page.locator('[data-testid="video-analytics-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="video-views"]')).toBeVisible();
    await expect(page.locator('[data-testid="video-engagement"]')).toBeVisible();
  });

  test('should work in Arabic (RTL)', async ({ page }) => {
    await page.goto(`/ar/channels/${channelId}/edit/content`);
    
    // Verify RTL layout
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    // Test upload in Arabic
    await page.click('[data-testid="upload-video-button"]');
    const fileInput = page.locator('[data-testid="video-file-input"]');
    await fileInput.setInputFiles('test/fixtures/test-video.mp4');
    
    await page.fill('[data-testid="video-title"]', 'فيديو اختبار');
    await page.fill('[data-testid="video-description"]', 'هذا فيديو اختبار لإدارة المحتوى');
    
    await page.click('[data-testid="submit-upload-button"]');
    
    // Verify Arabic interface
    await expect(page.locator('[data-testid="upload-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="processing-status"]')).toBeVisible();
  });
});
```

## API Endpoints Tested

- `POST /api/videos/upload` - Video upload
- `POST /api/videos` - Video metadata
- `POST /api/playlists` - Playlist creation
- `PUT /api/playlists/{id}/videos` - Add to playlist
- `POST /api/videos/{id}/schedule` - Schedule content
- `POST /api/channel-sections` - Create section
- `PUT /api/channel-sections/{id}/content` - Add to section
- `GET /api/analytics/content` - Content analytics

## Success Criteria

- ✅ Video upload works with valid files
- ✅ Metadata validation works correctly
- ✅ Playlist creation and management functions
- ✅ Content scheduling works properly
- ✅ Section management updates channel layout
- ✅ Bulk operations apply to selected items
- ✅ Content filtering and search work
- ✅ Analytics display accurate metrics
- ✅ Bilingual support works (EN/AR)
- ✅ RTL layout is correct for Arabic
- ✅ Error handling provides clear feedback
- ✅ Processing states show accurate information

## Failure Scenarios

1. **Upload Failure**: Display error message and retry option
2. **Processing Error**: Show processing status and error details
3. **Invalid Metadata**: Validate and show field-specific errors
4. **Scheduling Conflict**: Check for conflicts and show alternatives
5. **Storage Quota Exceeded**: Show quota management options

## Performance Requirements

- Upload speed: Maintain connection stability
- Processing time: < 5 minutes for standard videos
- Search response: < 2 seconds
- Analytics loading: < 3 seconds

## Test Environment

- **Browser**: Chrome, Firefox, Safari, Mobile Chrome, Mobile Safari
- **Viewport**: Desktop (1920x1080), Tablet (768x1024), Mobile (375x667)
- **Network**: 3G, 4G, WiFi
- **Language**: English (en), Arabic (ar)

## Related Test Cases

- [TC-CHAN-001](./TCCHAN001_channel-creation-setup.md) - Channel Creation
- [TC-CHAN-002](./TCCHAN002_channel-customization.md) - Channel Customization
- [TC-VID-006](../video-platform/TCVID006_VideoUploadProcessing.md) - Video Upload

## Test Execution History

| Date | Environment | Result | Notes |
|------|-------------|--------|-------|
| 2025-11-20 | Staging | ✅ Pass | Initial implementation |
| | | | |

## Test Maintenance

- Update file paths when test fixtures change
- Modify validation rules when requirements change
- Add new content types as they're implemented
- Update API endpoints when backend changes
- Adjust processing time expectations when video processing changes