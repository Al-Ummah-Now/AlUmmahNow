# Video Upload Integration Guide

## Quick Start

This guide helps developers integrate video upload functionality into Al Ummah Now platform applications.

## Prerequisites

- Authentication token (JWT) from OpenAuth
- Node.js 18+ (for development)
- pnpm package manager
- Access to Al Ummah Now API

## Installation

### Frontend (React/Next.js)

```bash
# Install required dependencies
pnpm add tus-js-client
pnpm add -D @types/tus-js-client
```

### Backend (If building custom integration)

```bash
# No additional dependencies needed - uses native fetch
```

## Configuration

### Environment Variables

```env
# Frontend (.env.local)
NEXT_PUBLIC_API_URL=https://api.alummahnow.net
NEXT_PUBLIC_BUNNY_CDN_URL=https://video.bunnycdn.com

# Backend (wrangler.toml)
[vars]
bunny_stream_library_id = "12345"

[secrets]
bunny-stream-key = "your-api-key"
```

### Constants Configuration

```typescript
// lib/constants/uploadConfig.ts
export const VIDEO_UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024, // 2GB
  ALLOWED_TYPES: ['video/mp4', 'video/mov', 'video/avi', 'video/webm'],
  MAX_DURATION: 60 * 60 * 2, // 2 hours
  POLLING: {
    MAX_POLLS: 6,
    INTERVAL_MS: 5000,
  },
};
```

## Basic Integration

### Step 1: Import the Upload Component

```tsx
import VideoUpload from '@/components/videoUpload';

function UploadPage() {
  const handleUploadComplete = (video: VideoObject) => {
    console.log('Video uploaded:', video);
    // Redirect or show success message
  };

  const handleProgress = (percentage: number) => {
    console.log('Upload progress:', percentage);
  };

  const handleError = (error: string) => {
    console.error('Upload error:', error);
  };

  return (
    <VideoUpload
      onUploadComplete={handleUploadComplete}
      onProgress={handleProgress}
      onError={handleError}
      className="max-w-2xl mx-auto"
    />
  );
}
```

### Step 2: Server Actions Setup

```typescript
// lib/actions/upload.ts
"use server";

import { cookies } from "next/headers";

export async function initiateVideoUpload(metadata: {
  title: string;
  description?: string;
  fileSize: number;
  mimeType: string;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return { success: false, error: "Authentication required" };
  }

  const response = await fetch(`${API_URL}/api/videos/upload/initiate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(metadata),
  });

  return response.json();
}
```

## Advanced Integration

### Custom Upload Handler with TUS

```typescript
import * as tus from 'tus-js-client';

class VideoUploadService {
  private upload: tus.Upload | null = null;

  async startUpload(
    file: File,
    metadata: VideoMetadata,
    onProgress: (percent: number) => void
  ): Promise<string> {
    // Step 1: Get TUS configuration from API
    const config = await this.getTUSConfig(metadata);

    // Step 2: Create TUS upload instance
    this.upload = new tus.Upload(file, {
      endpoint: config.tusEndpoint,
      headers: config.tusHeaders,
      chunkSize: config.chunkSize,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      metadata: {
        filename: file.name,
        filetype: file.type,
      },
      onError: (error) => {
        throw new Error(`Upload failed: ${error.message}`);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const percentage = (bytesUploaded / bytesTotal) * 100;
        onProgress(percentage);
      },
      onSuccess: () => {
        console.log('Upload completed successfully');
      },
    });

    // Step 3: Start the upload
    this.upload.start();

    return config.videoId;
  }

  pauseUpload(): void {
    this.upload?.abort();
  }

  resumeUpload(): void {
    this.upload?.start();
  }

  cancelUpload(): void {
    this.upload?.abort(true); // Remove fingerprint
    this.upload = null;
  }

  private async getTUSConfig(metadata: VideoMetadata) {
    const response = await fetch('/api/upload/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({
        title: metadata.title,
        fileSize: metadata.fileSize,
        mimeType: metadata.mimeType,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to initiate upload');
    }

    const data = await response.json();
    return data.result;
  }
}
```

### Implementing Rate Limit Handling

```typescript
class RateLimitedUploader {
  async upload(file: File): Promise<void> {
    try {
      const result = await initiateUpload(file);

      if (!result.success && result.error === 'Rate limit exceeded') {
        this.handleRateLimit(result);
        return;
      }

      // Proceed with upload
    } catch (error) {
      this.handleError(error);
    }
  }

  private handleRateLimit(result: any) {
    const retryAfter = new Date(result.retryAfter);
    const waitTime = retryAfter.getTime() - Date.now();

    alert(`Upload limit reached. Try again in ${Math.ceil(waitTime / 1000)} seconds.`);

    // Optional: Show upgrade prompt
    if (result.upgradeUrl) {
      this.showUpgradePrompt(result.upgradeUrl);
    }
  }
}
```

## API Reference

### POST /api/videos/upload/initiate

Initiate a video upload and get TUS configuration.

**Request:**
```typescript
{
  title: string;
  description?: string;
  fileSize: number;
  mimeType: string;
  isPublic?: boolean;
  tags?: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  result?: {
    videoId: string;
    tusEndpoint: string;
    tusHeaders: {
      AuthorizationSignature: string;
      AuthorizationExpire: string;
      LibraryId: string;
      VideoId: string;
    };
    expiresAt: string;
    chunkSize: number;
    resumable: boolean;
  };
  error?: string;
}
```

### POST /api/videos/upload/complete

Notify the API that upload has completed.

**Request:**
```typescript
{
  videoId: string;
  fileSize?: number;
  duration?: number;
}
```

### GET /api/videos/:id/upload-status

Check the processing status of an uploaded video.

**Response:**
```typescript
{
  videoId: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  progress: number; // 0-100
  message?: string;
}
```

## Error Handling

### Common Errors and Solutions

| Error Code | Description | Solution |
|------------|-------------|----------|
| 401 | Unauthorized | Ensure valid JWT token |
| 413 | File too large | Check file size limits |
| 429 | Rate limit exceeded | Wait and retry or upgrade |
| 400 | Invalid file type | Check allowed MIME types |
| 500 | Server error | Retry with exponential backoff |

### Error Recovery Example

```typescript
async function uploadWithRetry(
  file: File,
  maxRetries: number = 3
): Promise<void> {
  let attempt = 0;
  let lastError: Error;

  while (attempt < maxRetries) {
    try {
      await uploadVideo(file);
      return; // Success
    } catch (error) {
      lastError = error;
      attempt++;

      if (error.code === 429) {
        // Rate limited - wait longer
        await sleep(60000); // 1 minute
      } else if (error.code >= 500) {
        // Server error - exponential backoff
        await sleep(Math.pow(2, attempt) * 1000);
      } else {
        // Client error - don't retry
        throw error;
      }
    }
  }

  throw lastError;
}
```

## Testing

### Unit Testing Upload Logic

```typescript
import { describe, it, expect, vi } from 'vitest';
import { initiateVideoUpload } from '@/lib/actions/upload';

describe('Video Upload', () => {
  it('should initiate upload successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          videoId: 'test-123',
          tusEndpoint: 'https://tus.example.com',
        },
      }),
    });

    global.fetch = mockFetch;

    const result = await initiateVideoUpload({
      title: 'Test Video',
      fileSize: 1000000,
      mimeType: 'video/mp4',
    });

    expect(result.success).toBe(true);
    expect(result.result.videoId).toBe('test-123');
  });
});
```

### E2E Testing

```typescript
import { test, expect } from '@playwright/test';

test('should upload video successfully', async ({ page }) => {
  // Login first
  await page.goto('/login');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');

  // Navigate to upload
  await page.goto('/upload');

  // Select file
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles('test-video.mp4');

  // Fill metadata
  await page.fill('[name="title"]', 'Test Video');
  await page.fill('[name="description"]', 'Test description');

  // Start upload
  await page.click('button:has-text("Upload")');

  // Wait for completion
  await expect(page.locator('text=Upload Complete')).toBeVisible({
    timeout: 60000,
  });
});
```

## Troubleshooting

### Issue: Upload Fails Immediately

**Symptoms:** Upload fails before starting
**Possible Causes:**
- Invalid authentication token
- File type not allowed
- File size exceeds limit

**Solution:**
```typescript
// Check auth token
const token = localStorage.getItem('access_token');
if (!token || isTokenExpired(token)) {
  // Redirect to login
}

// Validate file before upload
if (!VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES.includes(file.type)) {
  showError('Invalid file type');
  return;
}
```

### Issue: Upload Stalls at X%

**Symptoms:** Progress stops at certain percentage
**Possible Causes:**
- Network interruption
- TUS chunk failure
- Server processing delay

**Solution:**
```typescript
// Implement timeout detection
const UPLOAD_TIMEOUT = 30000; // 30 seconds
let lastProgressTime = Date.now();

onProgress: (bytes, total) => {
  lastProgressTime = Date.now();
  // ... handle progress
};

// Check for stalls
setInterval(() => {
  if (Date.now() - lastProgressTime > UPLOAD_TIMEOUT) {
    // Attempt to resume
    upload.abort();
    setTimeout(() => upload.start(), 5000);
  }
}, 10000);
```

### Issue: Video Stuck in Processing

**Symptoms:** Upload completes but video not ready
**Possible Causes:**
- Encoding queue backed up
- Invalid video format
- Server processing error

**Solution:**
```typescript
// Implement maximum wait time
const MAX_PROCESSING_TIME = 10 * 60 * 1000; // 10 minutes
const startTime = Date.now();

while (status !== 'ready') {
  if (Date.now() - startTime > MAX_PROCESSING_TIME) {
    throw new Error('Processing timeout - contact support');
  }

  await sleep(5000);
  status = await checkUploadStatus(videoId);
}
```

## Best Practices

### 1. Validate Before Upload
Always validate file type and size on client before initiating upload.

### 2. Show Clear Progress
Provide detailed progress information including speed and time remaining.

### 3. Handle Network Issues
Implement automatic retry with exponential backoff.

### 4. Secure Your Uploads
Never expose API keys to client. Always use signed URLs.

### 5. Optimize for Mobile
Consider bandwidth and implement pause/resume for mobile users.

### 6. Monitor Upload Metrics
Track success rates, average times, and error patterns.

## Migration from Old Upload System

If migrating from a legacy upload system:

```typescript
// Feature flag approach
const USE_TUS_UPLOAD = process.env.NEXT_PUBLIC_USE_TUS === 'true';

function uploadVideo(file: File) {
  if (USE_TUS_UPLOAD) {
    return uploadWithTUS(file);
  } else {
    return legacyUpload(file);
  }
}
```

## Support

### Common Support Queries

**Q: Why is my upload slow?**
A: Upload speed depends on your internet connection. TUS protocol optimizes transfer but cannot exceed your bandwidth.

**Q: Can I upload multiple videos?**
A: Currently, only one video at a time. Batch upload is planned for future release.

**Q: What video formats are supported?**
A: MP4, MOV, AVI, and WebM. Maximum 2GB file size.

**Q: How do I increase my upload limit?**
A: Upgrade to Pro or Enterprise tier for higher limits.

### Getting Help

- **Documentation**: [https://docs.alummahnow.net](https://docs.alummahnow.net)
- **API Status**: [https://status.alummahnow.net](https://status.alummahnow.net)
- **Support Email**: support@alummahnow.net
- **GitHub Issues**: [https://github.com/meywd/AlUmmahNow/issues](https://github.com/meywd/AlUmmahNow/issues)

## Changelog

### Version 2.0.0 (2025-11-20)
- Added TUS protocol support
- Implemented resumable uploads
- Added rate limiting
- Improved error handling

### Version 1.0.0 (2025-10-01)
- Initial release
- Basic upload functionality

---

*Last Updated: 2025-11-20*