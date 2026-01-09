# TC-CHAN-002: Channel Customization

## Test Case Information

**Test ID**: TC-CHAN-002  
**Title**: Channel Customization  
**Priority**: Medium  
**Type**: E2E  
**Category**: Channel Management  
**Estimated Duration**: 8 minutes  
**Last Updated**: 2025-11-20  

## Test Description

This test case verifies channel customization features including avatar upload, cover image, branding colors, layout preferences, and channel sections configuration.

## Prerequisites

1. User must be logged in with an existing channel
2. User must have channel owner permissions
3. File upload functionality must be enabled
4. Image processing services must be available

## Test Data

```typescript
const customizationData = {
  avatar: {
    file: 'test-avatar.png',
    size: '2MB',
    dimensions: '400x400'
  },
  cover: {
    file: 'test-cover.jpg', 
    size: '5MB',
    dimensions: '2560x1440'
  },
  branding: {
    primaryColor: '#1e40af',
    secondaryColor: '#f59e0b',
    accentColor: '#10b981'
  },
  layout: {
    theme: 'dark',
    compactMode: false,
    showSubscriberCount: true
  }
};

const invalidFiles = {
  oversizedAvatar: 'avatar-10mb.png',
  invalidFormat: 'avatar.gif',
  corruptedImage: 'corrupted.jpg'
};
```

## Test Steps

### 1. Navigate to Channel Settings

```bash
# English version
GET /en/channels/{channelId}/edit

# Arabic version
GET /ar/channels/{channelId}/edit
```

**Expected Results:**
- Channel settings page loads successfully
- All customization sections are accessible
- Current channel settings are displayed
- Form is in the correct language (EN/AR)

### 2. Upload Channel Avatar

**Actions:**
1. Navigate to "Branding" section
2. Click "Upload Avatar" button
3. Select valid avatar image file
4. Wait for upload and processing
5. Crop and adjust if needed
6. Save changes

**Expected Results:**
- File picker opens correctly
- Image validation checks file size and format
- Upload progress indicator is shown
- Image preview displays correctly
- Cropping tool works properly
- Avatar is updated across all channel pages
- Thumbnail versions are generated

### 3. Upload Cover Image

**Actions:**
1. Navigate to "Cover Image" section
2. Click "Upload Cover" button
3. Select valid cover image file
4. Adjust positioning and zoom
5. Preview on different screen sizes
6. Save changes

**Expected Results:**
- Cover image uploads successfully
- Positioning controls work correctly
- Responsive preview shows proper scaling
- Image optimization is applied
- Cover displays correctly on channel page
- Mobile and desktop versions are optimized

### 4. Customize Branding Colors

**Actions:**
1. Navigate to "Branding Colors" section
2. Select primary color: `#1e40af`
3. Select secondary color: `#f59e0b`
4. Select accent color: `#10b981`
5. Preview color scheme
6. Apply changes

**Expected Results:**
- Color picker works correctly
- Live preview updates immediately
- Color contrast meets accessibility standards
- Colors are applied consistently
- Changes persist after page refresh
- Dark/light mode variations work

### 5. Configure Layout Preferences

**Actions:**
1. Navigate to "Layout" section
2. Select theme: "dark"
3. Toggle compact mode: false
4. Enable subscriber count display
5. Configure section ordering
6. Save preferences

**Expected Results:**
- Theme switch applies correctly
- Layout options work as expected
- Section ordering is customizable
- Changes reflect immediately
- Preferences are saved persistently
- Mobile layout adapts properly

### 6. Test File Validation (Negative Cases)

**Actions:**
1. Try uploading oversized avatar file
2. Try uploading invalid file format
3. Try uploading corrupted image
4. Test network interruption during upload
5. Test concurrent uploads

**Expected Results:**
- Appropriate error messages are shown
- File size limits are enforced
- Format validation works correctly
- Corrupted files are rejected
- Network errors are handled gracefully
- Upload queue prevents conflicts

## Test Automation (Playwright)

```typescript
import { test, expect } from '@playwright/test';

test.describe('Channel Customization', () => {
  let channelId: string;

  test.beforeEach(async ({ page }) => {
    // Login and navigate to channel edit
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'channel-owner@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-button"]');
    
    // Get existing channel or create one
    await page.goto('/en/channels');
    const firstChannel = page.locator('[data-testid="channel-item"]').first();
    if (await firstChannel.count() > 0) {
      await firstChannel.click();
      const url = page.url();
      channelId = url.split('/').pop() || '';
    } else {
      // Create test channel
      await page.goto('/en/channels/create');
      await page.fill('[data-testid="channel-name"]', 'Test Channel');
      await page.fill('[data-testid="channel-handle"]', `testchannel${Date.now()}`);
      await page.click('[data-testid="create-channel-button"]');
      await page.waitForURL(/\/en\/channels\/[a-zA-Z0-9-]+/);
      const url = page.url();
      channelId = url.split('/').pop() || '';
    }
    
    await page.goto(`/en/channels/${channelId}/edit`);
  });

  test('should upload and update channel avatar', async ({ page }) => {
    // Navigate to branding section
    await page.click('[data-testid="tab-branding"]');
    
    // Upload avatar
    const fileInput = page.locator('[data-testid="avatar-upload-input"]');
    await fileInput.setInputFiles('test/fixtures/test-avatar.png');
    
    // Wait for upload and preview
    await expect(page.locator('[data-testid="avatar-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="upload-progress"]')).not.toBeVisible();
    
    // Save changes
    await page.click('[data-testid="save-branding-button"]');
    
    // Verify avatar updated
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
    await page.goto(`/en/channels/${channelId}`);
    await expect(page.locator('[data-testid="channel-avatar"]')).toBeVisible();
  });

  test('should upload and update cover image', async ({ page }) => {
    // Navigate to cover section
    await page.click('[data-testid="tab-cover"]');
    
    // Upload cover image
    const fileInput = page.locator('[data-testid="cover-upload-input"]');
    await fileInput.setInputFiles('test/fixtures/test-cover.jpg');
    
    // Wait for upload and preview
    await expect(page.locator('[data-testid="cover-preview"]')).toBeVisible();
    
    // Test positioning controls
    await page.fill('[data-testid="cover-position-x"]', '50');
    await page.fill('[data-testid="cover-position-y"]', '30');
    await page.fill('[data-testid="cover-zoom"]', '110');
    
    // Save changes
    await page.click('[data-testid="save-cover-button"]');
    
    // Verify cover updated
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
    await page.goto(`/en/channels/${channelId}`);
    await expect(page.locator('[data-testid="channel-cover"]')).toBeVisible();
  });

  test('should customize branding colors', async ({ page }) => {
    // Navigate to branding colors
    await page.click('[data-testid="tab-branding-colors"]');
    
    // Set colors
    await page.fill('[data-testid="primary-color"]', '#1e40af');
    await page.fill('[data-testid="secondary-color"]', '#f59e0b');
    await page.fill('[data-testid="accent-color"]', '#10b981');
    
    // Check live preview
    await expect(page.locator('[data-testid="color-preview"]')).toBeVisible();
    
    // Test contrast validation
    await page.fill('[data-testid="primary-color"]', '#ffffff');
    await page.fill('[data-testid="secondary-color"]', '#ffffcc');
    await expect(page.locator('[data-testid="contrast-warning"]')).toBeVisible();
    
    // Reset to valid colors
    await page.fill('[data-testid="primary-color"]', '#1e40af');
    await page.fill('[data-testid="secondary-color"]', '#f59e0b');
    
    // Save changes
    await page.click('[data-testid="save-colors-button"]');
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
  });

  test('should configure layout preferences', async ({ page }) => {
    // Navigate to layout section
    await page.click('[data-testid="tab-layout"]');
    
    // Set theme to dark
    await page.selectOption('[data-testid="theme-select"]', 'dark');
    await expect(page.locator('body')).toHaveClass(/dark/);
    
    // Toggle compact mode
    await page.uncheck('[data-testid="compact-mode"]');
    await expect(page.locator('[data-testid="compact-mode"]')).not.toBeChecked();
    
    // Enable subscriber count
    await page.check('[data-testid="show-subscribers"]');
    await expect(page.locator('[data-testid="show-subscribers"]')).toBeChecked();
    
    // Reorder sections
    await page.dragAndDrop(
      '[data-testid="section-videos"]',
      '[data-testid="section-home"]'
    );
    
    // Save changes
    await page.click('[data-testid="save-layout-button"]');
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
    
    // Verify changes persist
    await page.reload();
    await expect(page.locator('[data-testid="theme-select"]')).toHaveValue('dark');
    await expect(page.locator('[data-testid="compact-mode"]')).not.toBeChecked();
  });

  test('should validate file uploads correctly', async ({ page }) => {
    await page.click('[data-testid="tab-branding"]');
    
    // Test oversized file
    const fileInput = page.locator('[data-testid="avatar-upload-input"]');
    await fileInput.setInputFiles('test/fixtures/avatar-10mb.png');
    await expect(page.locator('[data-testid="file-size-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-size-error"]')).toContainText('File size must be less than 5MB');
    
    // Test invalid format
    await fileInput.setInputFiles('test/fixtures/avatar.gif');
    await expect(page.locator('[data-testid="file-format-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-format-error"]')).toContainText('Only PNG, JPG, and WebP formats are supported');
    
    // Test corrupted file
    await fileInput.setInputFiles('test/fixtures/corrupted.jpg');
    await expect(page.locator('[data-testid="file-corrupted-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-corrupted-error"]')).toContainText('File appears to be corrupted');
  });

  test('should work in Arabic (RTL)', async ({ page }) => {
    await page.goto(`/ar/channels/${channelId}/edit`);
    
    // Verify RTL layout
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    // Test avatar upload in Arabic
    await page.click('[data-testid="tab-branding"]');
    const fileInput = page.locator('[data-testid="avatar-upload-input"]');
    await fileInput.setInputFiles('test/fixtures/test-avatar.png');
    
    await expect(page.locator('[data-testid="avatar-preview"]')).toBeVisible();
    await page.click('[data-testid="save-branding-button"]');
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
    
    // Verify Arabic success message
    await expect(page.locator('[data-testid="success-toast"]')).toContainText('تم تحديث');
  });
});
```

## API Endpoints Tested

- `PUT /api/channels/{id}/avatar` - Avatar upload
- `PUT /api/channels/{id}/cover` - Cover image upload
- `PUT /api/channels/{id}` - Channel settings update
- `GET /api/channels/{id}` - Channel data verification
- `POST /api/upload/avatar` - Avatar processing
- `POST /api/upload/cover` - Cover processing

## Success Criteria

- ✅ Avatar upload works with valid files
- ✅ Cover image upload and positioning works
- ✅ Branding colors are applied correctly
- ✅ Layout preferences are saved and applied
- ✅ File validation prevents invalid uploads
- ✅ Image optimization and processing works
- ✅ Responsive design works on all devices
- ✅ Bilingual support works (EN/AR)
- ✅ RTL layout is correct for Arabic
- ✅ Error handling provides clear feedback
- ✅ Loading states provide good UX
- ✅ Changes persist across sessions

## Failure Scenarios

1. **Upload Failure**: Display error message and retry option
2. **Image Processing Error**: Show processing error and fallback
3. **File Size Exceeded**: Clear size limit message with optimization tips
4. **Network Issues**: Handle upload interruption with resume capability
5. **Permission Denied**: Redirect with authorization error
6. **Storage Quota Exceeded**: Show quota management options

## Test Environment

- **Browser**: Chrome, Firefox, Safari, Mobile Chrome, Mobile Safari
- **Viewport**: Desktop (1920x1080), Tablet (768x1024), Mobile (375x667)
- **Network**: 3G, 4G, WiFi, Offline
- **Language**: English (en), Arabic (ar)
- **File Types**: PNG, JPG, WebP (valid), GIF, BMP (invalid)

## Related Test Cases

- [TC-CHAN-001](./TCCHAN001_channel-creation-setup.md) - Channel Creation
- [TC-CHAN-003](./TCCHAN003_channel-content-management.md) - Content Management
- [TC-BIL-003](../bilingual/TCBIL003_RTLLayoutConsistency.md) - RTL Layout Testing

## Test Execution History

| Date | Environment | Result | Notes |
|------|-------------|--------|-------|
| 2025-11-20 | Staging | ✅ Pass | Initial implementation |
| | | | |

## Test Maintenance

- Update file paths when test fixtures change
- Modify validation rules when requirements change
- Add new customization options as they're implemented
- Update API endpoints when backend changes
- Adjust color contrast thresholds when accessibility standards update