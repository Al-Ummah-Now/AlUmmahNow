# E2E Test Suite - Video Upload System

Comprehensive end-to-end testing for Al Ummah Now's video upload, management, and thumbnail functionality.

## Overview

This directory contains **5 comprehensive test suites** covering all aspects of video upload, TUS resumable uploads, video management, editing, and thumbnail management.

## Test Files

### 1. Video Upload Flow (`12-video-upload.spec.ts`)

**Coverage**:
- ✅ Complete upload flow with bilingual metadata (EN/AR)
- ✅ Progress tracking and stage transitions
- ✅ File validation (type and size)
- ✅ Pause, resume, and cancel operations
- ✅ RTL (Arabic) interface support
- ✅ Drag-and-drop upload
- ✅ Mobile viewport compatibility
- ✅ Error handling (network, authentication)
- ✅ Accessibility (keyboard navigation, ARIA labels)

**Test Count**: 15+ tests

**Key Scenarios**:
```typescript
// Upload with complete metadata
await helpers.uploadTestVideo(page, {
  videoPath,
  titleEn: 'Islamic Lecture',
  titleAr: 'محاضرة إسلامية',
  descriptionEn: 'Test description',
  descriptionAr: 'وصف تجريبي',
  isPublic: true
});
```

### 2. TUS Resumable Upload (`13-video-upload-tus-resume.spec.ts`)

**Coverage**:
- ✅ Network interruption handling
- ✅ Page reload and resume
- ✅ Automatic retry on transient failures
- ✅ Chunk upload with intermittent failures
- ✅ Timeout handling
- ✅ Browser tab visibility changes
- ✅ Recovery from server errors
- ✅ Progress persistence validation

**Test Count**: 12+ tests

**Key Scenarios**:
```typescript
// Simulate network offline/online
await helpers.setNetworkCondition(page, true); // Offline
await page.waitForTimeout(2000);
await helpers.setNetworkCondition(page, false); // Online
```

### 3. Video Management (`14-video-management.spec.ts`)

**Coverage**:
- ✅ Video dashboard display
- ✅ Video metadata cards (title, views, status, date)
- ✅ Thumbnail display
- ✅ Filtering by status (ready, processing)
- ✅ Filtering by privacy (public, private)
- ✅ Search by title
- ✅ Single video deletion with confirmation
- ✅ Bulk selection and deletion
- ✅ Select all functionality
- ✅ Mobile responsive layout
- ✅ Empty state handling

**Test Count**: 18+ tests

**Key Scenarios**:
```typescript
// Filter videos by status
await page.click('text=/ready/i');
await expect(page.locator('text=Ready Public Video')).toBeVisible();
await expect(page.locator('text=Processing Video')).not.toBeVisible();
```

### 4. Video Editing (`15-video-edit.spec.ts`)

**Coverage**:
- ✅ Load video edit page
- ✅ Edit title (English and Arabic)
- ✅ Edit description (bilingual)
- ✅ Toggle privacy settings
- ✅ Add/edit tags
- ✅ Switch between language tabs
- ✅ Preserve changes when switching tabs
- ✅ Form validation (required fields)
- ✅ Unsaved changes warning
- ✅ Error handling (save errors, network errors)
- ✅ Mobile viewport compatibility
- ✅ Navigation after save

**Test Count**: 15+ tests

**Key Scenarios**:
```typescript
// Edit bilingual content
await page.click('button:has-text("English")');
await page.fill('input[placeholder*="Title in English"]', 'New Title');

await page.click('button:has-text("العربية")');
await page.fill('input[placeholder*="العنوان بالعربية"]', 'عنوان جديد');
```

### 5. Thumbnail Management (`16-thumbnail-management.spec.ts`)

**Coverage**:
- ✅ Display thumbnail selector
- ✅ Show 5 auto-generated thumbnails
- ✅ Select thumbnail from generated options
- ✅ Save selected thumbnail
- ✅ Upload custom thumbnail
- ✅ Thumbnail preview before upload
- ✅ Cancel custom upload
- ✅ File validation (image type, size, dimensions)
- ✅ Mobile viewport compatibility
- ✅ Touch interactions
- ✅ Accessibility (keyboard navigation, ARIA labels)

**Test Count**: 16+ tests

**Key Scenarios**:
```typescript
// Upload custom thumbnail
const thumbnailPath = await helpers.createTestVideo('custom-thumb.jpg', 50);
await fileInput.setInputFiles(thumbnailPath);
await page.click('button:has-text("Save")');
```

## Test Fixtures

### Helper Functions (`fixtures.ts`)

```typescript
// Authentication and navigation
await helpers.loginAndNavigateToUpload(page, 'en');

// Create test video
const videoPath = await helpers.createTestVideo('test.mp4', 1024); // 1MB

// Upload video with metadata
await helpers.uploadTestVideo(page, {
  videoPath,
  titleEn: 'Test Video',
  titleAr: 'فيديو تجريبي',
  isPublic: true
});

// Wait for upload complete
await helpers.waitForUploadComplete(page);

// Mock video upload API
const videoId = await helpers.mockVideoUploadAPI(page);

// Network conditions
await helpers.setNetworkCondition(page, true); // Offline

// Viewport helpers
await helpers.setMobileViewport(page);
await helpers.setTabletViewport(page);
await helpers.setDesktopViewport(page);
```

### Test Fixtures Directory (`test-fixtures/`)

- **Dynamically generated** test files (videos, images)
- **Not committed to git** (see `.gitignore`)
- Created on-the-fly during test execution
- Automatically cleaned up after tests

## Running Tests

### Run All E2E Tests
```bash
cd apps/web
pnpm exec playwright test
```

### Run Video Upload Tests Only
```bash
pnpm exec playwright test 12-video-upload
pnpm exec playwright test 13-video-upload-tus-resume
pnpm exec playwright test 14-video-management
pnpm exec playwright test 15-video-edit
pnpm exec playwright test 16-thumbnail-management
```

### Run Specific Browser
```bash
pnpm exec playwright test --project=chromium
pnpm exec playwright test --project=firefox
pnpm exec playwright test --project=webkit
```

### Run Mobile Tests
```bash
pnpm exec playwright test --project="Mobile Chrome"
pnpm exec playwright test --project="Mobile Safari"
```

### Debug Mode
```bash
pnpm exec playwright test --debug
pnpm exec playwright test 12-video-upload --debug
```

### Headed Mode (See Browser)
```bash
pnpm exec playwright test --headed
```

### UI Mode (Interactive)
```bash
pnpm exec playwright test --ui
```

## Test Reports

### View HTML Report
```bash
pnpm exec playwright show-report
```

### Generate Reports
- **HTML Report**: `playwright-report/index.html`
- **JUnit Report**: `test-results/junit.xml`
- **JSON Report**: `test-results/test-results.json`

## CI/CD Integration

Tests run automatically on:
- ✅ Pull requests to `main` or `develop`
- ✅ Pushes to `main` or `develop`
- ✅ Manual workflow dispatch

### GitHub Actions Workflow (`.github/workflows/e2e-tests.yml`)

**Jobs**:
1. **e2e-tests**: Video upload tests across browsers (Chromium, Firefox, WebKit)
2. **e2e-tests-full**: Complete E2E suite
3. **e2e-mobile**: Mobile viewport tests (Pixel 5, iPhone 12)

**Artifacts**:
- Playwright HTML reports (30 days retention)
- Test videos on failure (7 days retention)
- JUnit reports (30 days retention)

## Configuration

### Playwright Config (`playwright.config.ts`)

```typescript
{
  timeout: 180000,              // 3 minutes (video uploads)
  expect: { timeout: 30000 },   // 30 seconds for assertions
  workers: 2,                   // Limit concurrent uploads
  retries: 2,                   // Retry on CI
  reporter: ['html', 'junit', 'json']
}
```

### Supported Browsers
- ✅ Chromium (Desktop & Mobile)
- ✅ Firefox
- ✅ WebKit (Safari)
- ✅ Mobile Chrome (Pixel 5)
- ✅ Mobile Safari (iPhone 12)

## Best Practices

### 1. Test Isolation
- Each test creates its own test data
- Tests don't depend on execution order
- Mock APIs for deterministic behavior

### 2. Assertions
- Use specific selectors (data-testid when available)
- Wait for elements explicitly (`waitForSelector`)
- Avoid hard-coded waits except for animations

### 3. Mocking
- Mock authentication for all tests
- Mock video upload API responses
- Mock external services (Bunny.net)

### 4. Error Handling
- Tests handle missing elements gracefully
- Validate error messages are shown
- Test retry and recovery flows

### 5. Accessibility
- Test keyboard navigation
- Verify ARIA labels and roles
- Test screen reader announcements

## Test Coverage

### Feature Coverage Matrix

| Feature                    | Tests | Status |
|----------------------------|-------|--------|
| Video Upload (Complete)    | 15    | ✅     |
| TUS Resumable Upload       | 12    | ✅     |
| Video Management Dashboard | 18    | ✅     |
| Video Editing              | 15    | ✅     |
| Thumbnail Management       | 16    | ✅     |
| **Total**                  | **76**| ✅     |

### Scenario Coverage

- ✅ **Happy Paths**: Complete upload, edit, delete flows
- ✅ **Error Handling**: Network errors, validation errors, timeouts
- ✅ **Edge Cases**: Large files, network interruptions, concurrent operations
- ✅ **Accessibility**: Keyboard navigation, screen readers, ARIA
- ✅ **Mobile**: Responsive layouts, touch interactions
- ✅ **Internationalization**: English/Arabic, RTL support

## Troubleshooting

### Tests Failing Locally

**Issue**: Tests fail with timeout errors
```bash
# Increase timeout
pnpm exec playwright test --timeout=300000
```

**Issue**: Browser not installed
```bash
# Install browsers
pnpm exec playwright install --with-deps
```

### Tests Failing in CI

**Check**:
1. Build logs for errors
2. Playwright report artifacts
3. Test video recordings
4. Network connectivity issues

### Common Issues

**File upload not working**:
- Check file paths are absolute
- Verify test fixtures directory exists
- Ensure file input is visible

**Authentication errors**:
- Verify mock authentication is set up
- Check localStorage/cookies are set
- Ensure API routes are mocked

**API mocking not working**:
- Check route patterns match
- Verify mock responses are valid JSON
- Use `page.route()` before navigation

## Future Enhancements

- [ ] Visual regression testing (Percy, Applitools)
- [ ] Performance testing (Lighthouse integration)
- [ ] Cross-browser accessibility testing (axe-core)
- [ ] API contract testing (Pact integration)
- [ ] Load testing for upload endpoints
- [ ] WebSocket testing for real-time features

## Resources

- **Playwright Docs**: https://playwright.dev
- **Project CLAUDE.md**: `/home/meywd/AlUmmahNow/CLAUDE.md`
- **Test Fixtures**: `/home/meywd/AlUmmahNow/apps/web/e2e/test-fixtures/`
- **GitHub Actions**: `/home/meywd/AlUmmahNow/.github/workflows/e2e-tests.yml`

## Support

For questions or issues with E2E tests:
1. Check test output and reports
2. Review Playwright documentation
3. Check GitHub Actions logs
4. Open an issue with test reproduction steps
