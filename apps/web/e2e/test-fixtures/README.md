# Test Fixtures Directory

This directory contains test media files generated dynamically during E2E tests.

## Overview

Test files are **NOT committed to git** due to their size. They are created on-the-fly by test helpers in `/home/meywd/AlUmmahNow/apps/web/e2e/fixtures.ts`.

## File Generation

The `createTestVideo()` helper function generates test files:

```typescript
const videoPath = await helpers.createTestVideo('test-video.mp4', 1024); // 1MB file
```

## Test File Types

### Video Files
- **Small videos (100-500 KB)**: Quick upload tests
- **Medium videos (1-5 MB)**: Progress tracking tests
- **Large videos (10-50 MB)**: Resume and retry tests

### Image Files
- **Thumbnails (50-500 KB)**: Thumbnail upload tests
- **Invalid files (.txt, .pdf)**: Validation tests

## Manual Test Files (Optional)

For more realistic tests, you can manually add:

1. **Real video files**:
   - `sample-video-small.mp4` (< 10MB)
   - `sample-video-large.mp4` (50-100MB)

2. **Real thumbnail images**:
   - `sample-thumbnail-1280x720.jpg`
   - `sample-thumbnail-1920x1080.png`

3. **Invalid files for validation**:
   - `invalid-file.txt`
   - `invalid-file.pdf`

## Important Notes

- All files in this directory are ignored by git (see `.gitignore`)
- Tests create temporary files automatically
- Files are cleaned up after test runs
- Never commit large binary files to the repository

## Cleanup

To manually clean up test files:

```bash
cd apps/web/e2e/test-fixtures
rm -f *.mp4 *.mov *.avi *.webm *.jpg *.jpeg *.png
```
