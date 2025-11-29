# Al Ummah Now - Revised Video Upload Implementation Plan

**Date:** 2025-11-20
**Status:** Ready for Implementation
**Architecture:** Client → API (Streaming) → Bunny.net

---

## Executive Summary

This document outlines a comprehensive revision of the video upload system with:
- ✅ **Streaming Architecture**: Client uploads to API, API streams to Bunny.net (resumable)
- ✅ **Security First**: No client-side API keys, all uploads authenticated through API
- ✅ **Enhanced UI**: Upload buttons, video management, edit interface, preview, thumbnails
- ✅ **E2E Testing**: Comprehensive test coverage with Playwright
- ✅ **Production Ready**: Rate limiting, quotas, error recovery, monitoring

---

## Table of Contents

1. [New Architecture](#new-architecture)
2. [Security Improvements](#security-improvements)
3. [API Implementation](#api-implementation)
4. [UI Components & Placement](#ui-components--placement)
5. [Thumbnail Management](#thumbnail-management)
6. [E2E Testing Strategy](#e2e-testing-strategy)
7. [Implementation Phases](#implementation-phases)
8. [Migration Strategy](#migration-strategy)

---

## New Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Web App)                            │
│                                                                     │
│  1. User selects video file                                        │
│  2. Validates file (type, size, duration)                          │
│  3. Fills bilingual metadata                                       │
│  4. Initiates chunked upload to API                                │
│  5. Streams chunks with progress tracking                          │
│  6. Receives real-time status via WebSocket                        │
│                                                                     │
└────────────┬────────────────────────────────────────────────────────┘
             │ HTTPS (multipart/form-data or chunked)
             │ JWT Authentication
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         API (Cloudflare Worker)                     │
│                                                                     │
│  1. Authenticates request (JWT validation)                         │
│  2. Applies rate limiting (per-user quotas)                        │
│  3. Validates chunk/file metadata                                  │
│  4. Streams data to Bunny.net Stream API                           │
│  5. Tracks upload progress in KV                                   │
│  6. Queues events for analytics                                    │
│  7. Sends WebSocket notifications                                  │
│                                                                     │
└────────────┬────────────────────────────────────────────────────────┘
             │ HTTPS (PUT with streaming)
             │ Bunny.net AccessKey (server-side only)
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         BUNNY.NET STREAM                            │
│                                                                     │
│  1. Receives video stream                                          │
│  2. Stores original file                                           │
│  3. Transcodes to multiple resolutions                             │
│  4. Generates thumbnails                                           │
│  5. Updates status via webhooks                                    │
│  6. Provides CDN URLs for playback                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PROCESSOR (Queue Worker)                       │
│                                                                     │
│  1. Consumes upload events from queue                              │
│  2. Updates analytics (upload started/completed/failed)            │
│  3. Triggers post-processing (thumbnails, previews)                │
│  4. Sends notifications                                            │
│  5. Updates search index                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Architecture Changes

| **Aspect** | **Old (Current)** | **New (Revised)** |
|------------|-------------------|-------------------|
| **Upload Path** | Client → Bunny.net (direct) | Client → API → Bunny.net (proxied) |
| **Authentication** | Bunny key exposed to client | JWT-only, key server-side |
| **Streaming** | Single PUT request | Chunked upload with resume |
| **Progress** | XMLHttpRequest events | WebSocket real-time updates |
| **Rate Limiting** | None | Per-user quotas in KV |
| **Error Recovery** | Manual restart | Automatic retry with exponential backoff |
| **File Size** | 2GB limit (browser memory) | Unlimited (streamed, not buffered) |
| **Resumption** | Not supported | Resume from last chunk |
| **Status Updates** | Polling (5s interval) | WebSocket push notifications |

---

## Security Improvements

### 1. Remove Client-Side API Key Exposure

**CRITICAL FIX** - Remove this function entirely:

```typescript
// ❌ REMOVE: apps/web/src/lib/actions/upload.ts:164-170
export async function getBunnyAccessKey() {
  return process.env.BUNNY_STREAM_ACCESS_KEY; // SECURITY RISK!
}
```

**✅ NEW APPROACH**: API handles all Bunny.net communication server-side.

### 2. Enhanced File Validation

**Server-Side Validation** (apps/api-videos/src/endpoints/video/uploadStream.ts):

```typescript
import { z } from 'zod';

const uploadSchema = z.object({
  fileSize: z.number().min(1).max(5_000_000_000), // 5GB max
  mimeType: z.enum(['video/mp4', 'video/webm', 'video/mov', 'video/avi', 'video/quicktime']),
  duration: z.number().min(1).max(7200).optional(), // 2 hours max
  fileName: z.string().min(1).max(255).regex(/^[a-zA-Z0-9._-]+$/), // Sanitized
});

async function validateFile(chunk: ReadableStream) {
  // Magic byte validation
  const reader = chunk.getReader();
  const { value } = await reader.read();

  const magicBytes = new Uint8Array(value).slice(0, 12);
  const isValidVideo = validateMagicBytes(magicBytes);

  if (!isValidVideo) {
    throw new Error('Invalid video file format');
  }
}

function validateMagicBytes(bytes: Uint8Array): boolean {
  // MP4: 0x66747970 (ftyp)
  // WebM: 0x1A45DFA3
  // MOV: 0x66747970 (ftyp)
  // AVI: 0x52494646 (RIFF)
  const signatures = [
    [0x66, 0x74, 0x79, 0x70], // MP4/MOV
    [0x1A, 0x45, 0xDF, 0xA3], // WebM
    [0x52, 0x49, 0x46, 0x46], // AVI
  ];

  return signatures.some(sig =>
    sig.every((byte, i) => bytes[i] === byte)
  );
}
```

### 3. Rate Limiting Implementation

**Rate Limiter** (apps/api-videos/src/middleware/rate-limit.ts):

```typescript
export interface RateLimitConfig {
  perMinute: number;
  perHour: number;
  perDay: number;
  concurrentUploads: number;
}

export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  free: {
    perMinute: 2,
    perHour: 10,
    perDay: 50,
    concurrentUploads: 1,
  },
  pro: {
    perMinute: 5,
    perHour: 50,
    perDay: 500,
    concurrentUploads: 3,
  },
  enterprise: {
    perMinute: 20,
    perHour: 200,
    perDay: 5000,
    concurrentUploads: 10,
  },
};

export class RateLimiter {
  constructor(
    private kv: KVNamespace,
    private config: RateLimitConfig
  ) {}

  async check(userId: string, action: string): Promise<RateLimitResult> {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const hour = Math.floor(now / 3600000);
    const day = Math.floor(now / 86400000);

    const keys = [
      `rl:${userId}:${action}:m:${minute}`,
      `rl:${userId}:${action}:h:${hour}`,
      `rl:${userId}:${action}:d:${day}`,
      `rl:${userId}:${action}:concurrent`,
    ];

    const [minuteCount, hourCount, dayCount, concurrentCount] = await Promise.all(
      keys.map(key => this.kv.get(key, 'json'))
    );

    // Check limits
    if ((minuteCount || 0) >= this.config.perMinute) {
      return { allowed: false, reason: 'Minute limit exceeded', resetAt: new Date((minute + 1) * 60000) };
    }
    if ((hourCount || 0) >= this.config.perHour) {
      return { allowed: false, reason: 'Hourly limit exceeded', resetAt: new Date((hour + 1) * 3600000) };
    }
    if ((dayCount || 0) >= this.config.perDay) {
      return { allowed: false, reason: 'Daily limit exceeded', resetAt: new Date((day + 1) * 86400000) };
    }
    if ((concurrentCount || 0) >= this.config.concurrentUploads) {
      return { allowed: false, reason: 'Too many concurrent uploads', resetAt: new Date(now + 60000) };
    }

    // Increment counters
    await Promise.all([
      this.kv.put(keys[0], String((minuteCount || 0) + 1), { expirationTtl: 60 }),
      this.kv.put(keys[1], String((hourCount || 0) + 1), { expirationTtl: 3600 }),
      this.kv.put(keys[2], String((dayCount || 0) + 1), { expirationTtl: 86400 }),
      this.kv.put(keys[3], String((concurrentCount || 0) + 1), { expirationTtl: 3600 }),
    ]);

    return {
      allowed: true,
      remaining: {
        perMinute: this.config.perMinute - (minuteCount || 0) - 1,
        perHour: this.config.perHour - (hourCount || 0) - 1,
        perDay: this.config.perDay - (dayCount || 0) - 1,
      },
    };
  }

  async release(userId: string, action: string): Promise<void> {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const key = `rl:${userId}:${action}:concurrent`;

    const current = await this.kv.get(key, 'json') || 0;
    if (current > 0) {
      await this.kv.put(key, String(current - 1), { expirationTtl: 3600 });
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  resetAt?: Date;
  remaining?: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
}
```

---

## API Implementation

### New Endpoints

#### 1. POST /api/videos/upload/stream (New)

**Purpose**: Receive chunked video upload from client, stream to Bunny.net

**Location**: `apps/api-videos/src/endpoints/video/uploadStream.ts`

```typescript
import { OpenAPIRoute, Str, Num } from 'chanfana';
import { z } from 'zod';
import { BunnyStreamClient } from '../../lib/bunny/stream';
import { RateLimiter, DEFAULT_RATE_LIMITS } from '../../middleware/rate-limit';
import R2Repository from '../../lib/r2Repo';

export class UploadStreamEndpoint extends OpenAPIRoute {
  schema = {
    tags: ['Video Upload'],
    summary: 'Upload video stream (chunked upload)',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'content-type': z.literal('application/octet-stream'),
        'x-chunk-index': z.string().regex(/^\d+$/),
        'x-total-chunks': z.string().regex(/^\d+$/),
        'x-chunk-size': z.string().regex(/^\d+$/),
        'x-total-size': z.string().regex(/^\d+$/),
        'x-file-name': z.string().min(1).max(255),
        'x-video-id': z.string().uuid(),
      }),
    },
    responses: {
      200: {
        description: 'Chunk uploaded successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              result: z.object({
                chunkIndex: z.number(),
                totalChunks: z.number(),
                uploadedBytes: z.number(),
                totalBytes: z.number(),
                progress: z.number(), // 0-100
                status: z.enum(['uploading', 'assembling', 'processing', 'complete']),
              }),
            }),
          },
        },
      },
      429: {
        description: 'Rate limit exceeded',
      },
    },
  };

  async handle(c) {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Rate limiting
    const userTier = await getUserTier(c.env, auth.userId); // 'free' | 'pro' | 'enterprise'
    const limiter = new RateLimiter(c.env.RATE_LIMIT_KV, DEFAULT_RATE_LIMITS[userTier]);
    const rateLimitResult = await limiter.check(auth.userId, 'upload:chunk');

    if (!rateLimitResult.allowed) {
      return c.json({
        error: rateLimitResult.reason,
        retryAfter: rateLimitResult.resetAt?.toISOString(),
      }, 429);
    }

    try {
      // Parse headers
      const chunkIndex = parseInt(c.req.header('x-chunk-index') || '0');
      const totalChunks = parseInt(c.req.header('x-total-chunks') || '1');
      const chunkSize = parseInt(c.req.header('x-chunk-size') || '0');
      const totalSize = parseInt(c.req.header('x-total-size') || '0');
      const fileName = c.req.header('x-file-name') || '';
      const videoId = c.req.header('x-video-id') || '';

      // Validate video exists and user owns it
      const videoRepo = new R2Repository(c.env.videos);
      const video = await videoRepo.getObject(videoId);

      if (!video) {
        return c.json({ error: 'Video not found' }, 404);
      }

      if (video.userId !== auth.userId) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      // Get chunk data as stream
      const chunkStream = c.req.raw.body;

      if (!chunkStream) {
        return c.json({ error: 'No chunk data provided' }, 400);
      }

      // Store chunk in R2 temporary storage
      const chunkKey = `upload-chunks/${videoId}/${chunkIndex}`;
      await c.env.UPLOAD_CHUNKS.put(chunkKey, chunkStream);

      // Update progress in KV
      const progressKey = `upload:progress:${videoId}`;
      const uploadedBytes = (chunkIndex + 1) * chunkSize;
      const progress = Math.min(Math.round((uploadedBytes / totalSize) * 100), 100);

      await c.env.UPLOAD_PROGRESS_KV.put(
        progressKey,
        JSON.stringify({
          videoId,
          userId: auth.userId,
          chunkIndex,
          totalChunks,
          uploadedBytes,
          totalBytes: totalSize,
          progress,
          status: chunkIndex === totalChunks - 1 ? 'assembling' : 'uploading',
          lastUpdated: new Date().toISOString(),
        }),
        { expirationTtl: 3600 } // 1 hour
      );

      // Send WebSocket notification
      await sendUploadProgress(c.env.WS_URL, auth.userId, {
        videoId,
        progress,
        status: chunkIndex === totalChunks - 1 ? 'assembling' : 'uploading',
        uploadedBytes,
        totalBytes: totalSize,
      });

      // If last chunk, trigger assembly and Bunny.net upload
      if (chunkIndex === totalChunks - 1) {
        await c.env.UPLOAD_QUEUE.send({
          type: 'ASSEMBLE_AND_UPLOAD',
          videoId,
          totalChunks,
          fileName,
          userId: auth.userId,
        });
      }

      return c.json({
        success: true,
        result: {
          chunkIndex,
          totalChunks,
          uploadedBytes,
          totalBytes: totalSize,
          progress,
          status: chunkIndex === totalChunks - 1 ? 'assembling' : 'uploading',
        },
      });
    } catch (error) {
      await limiter.release(auth.userId, 'upload:chunk');
      throw error;
    }
  }
}

async function sendUploadProgress(wsUrl: string, userId: string, data: any) {
  await fetch(`${wsUrl}/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: `user:${userId}`,
      message: {
        type: 'upload_progress',
        ...data,
        timestamp: new Date().toISOString(),
      },
    }),
  });
}
```

#### 2. POST /api/videos/upload/initiate (Enhanced)

**Changes**: Add chunk metadata, remove Bunny URL return

```typescript
// Enhanced metadata with resumption support
const initiateResponse = {
  success: true,
  result: {
    videoId: uuid(),
    uploadEndpoint: `${API_URL}/api/videos/upload/stream`,
    chunkSize: 5 * 1024 * 1024, // 5MB chunks
    resumable: true,
    expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
  },
};
```

#### 3. GET /api/videos/upload/resume/:videoId (New)

**Purpose**: Resume interrupted upload

```typescript
export class ResumeUploadEndpoint extends OpenAPIRoute {
  async handle(c) {
    const videoId = c.req.param('videoId');
    const auth = c.get('auth');

    // Get upload progress from KV
    const progressKey = `upload:progress:${videoId}`;
    const progressData = await c.env.UPLOAD_PROGRESS_KV.get(progressKey, 'json');

    if (!progressData || progressData.userId !== auth.userId) {
      return c.json({ error: 'Upload not found or expired' }, 404);
    }

    // Return last successful chunk index
    return c.json({
      success: true,
      result: {
        videoId,
        lastChunkIndex: progressData.chunkIndex,
        totalChunks: progressData.totalChunks,
        uploadedBytes: progressData.uploadedBytes,
        totalBytes: progressData.totalBytes,
        progress: progressData.progress,
        resumeFrom: progressData.chunkIndex + 1,
      },
    });
  }
}
```

### Queue Consumer Enhancement

**Location**: `apps/processor/src/handlers/assembleAndUpload.ts` (New)

```typescript
import { BunnyStreamClient } from '../lib/bunny/stream';

export async function handleAssembleAndUpload(env: Env, message: AssembleAndUploadMessage) {
  const { videoId, totalChunks, fileName, userId } = message;

  try {
    // Step 1: Assemble chunks from R2
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const chunkKey = `upload-chunks/${videoId}/${i}`;
      const chunk = await env.UPLOAD_CHUNKS.get(chunkKey, 'arrayBuffer');

      if (!chunk) {
        throw new Error(`Missing chunk ${i}`);
      }

      chunks.push(new Uint8Array(chunk));
    }

    // Step 2: Concatenate chunks into single blob
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const videoBlob = new Uint8Array(totalSize);
    let offset = 0;

    for (const chunk of chunks) {
      videoBlob.set(chunk, offset);
      offset += chunk.length;
    }

    // Step 3: Upload to Bunny.net as stream
    const bunnyClient = new BunnyStreamClient(await env['bunny-stream-key'].text());
    const libraryId = parseInt(await env['bunny_stream_library_id'].text());

    const bunnyVideo = await bunnyClient.uploadVideo(
      libraryId,
      videoId,
      new Blob([videoBlob], { type: 'application/octet-stream' })
    );

    // Step 4: Update video metadata in R2
    const videoRepo = new R2Repository(env.videos);
    const video = await videoRepo.getObject(videoId);

    await videoRepo.putObject(videoId, {
      ...video,
      status: 'processing',
      bunnyVideoId: bunnyVideo.guid,
      bunnyLibraryId: libraryId,
      uploadCompletedAt: new Date().toISOString(),
    });

    // Step 5: Clean up chunks
    for (let i = 0; i < totalChunks; i++) {
      await env.UPLOAD_CHUNKS.delete(`upload-chunks/${videoId}/${i}`);
    }

    // Step 6: Send WebSocket notification
    await sendUploadProgress(env.WS_URL, userId, {
      videoId,
      progress: 100,
      status: 'processing',
    });

    // Step 7: Queue analytics event
    await env.queue.send({
      type: 'VideoUploadCompleted',
      videoId,
      userId,
      fileSize: totalSize,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Handle failure
    await env.queue.send({
      type: 'VideoUploadFailed',
      videoId,
      userId,
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    throw error;
  }
}
```

---

## UI Components & Placement

### 1. Upload Button Placements

#### A. Channel Header (Primary Location)

**File**: `apps/web/src/components/Channel/ChannelHeader.tsx` (line ~45)

```tsx
import { Upload, Settings, Share2 } from 'lucide-react';
import Link from 'next/link';

export default function ChannelHeader({ channel, isOwner }: ChannelHeaderProps) {
  return (
    <div className="channel-header">
      {/* Existing header content */}

      {isOwner && (
        <div className="flex gap-2 mt-4">
          {/* Primary Upload Button */}
          <Link
            href={`/${locale}/channel/${channel.id}/upload`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Upload size={20} />
            <span>{t('channel.uploadVideo')}</span>
          </Link>

          {/* Channel Settings */}
          <Link
            href={`/${locale}/channel/${channel.id}/settings`}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Settings size={20} />
            <span>{t('channel.settings')}</span>
          </Link>
        </div>
      )}
    </div>
  );
}
```

#### B. Main Navigation (Global Access)

**File**: `apps/web/src/components/Header/index.tsx`

```tsx
import { Upload } from 'lucide-react';

export default function Header() {
  const { user } = useAuth();

  return (
    <header className="header">
      {/* Existing navigation */}

      {user && (
        <button
          onClick={() => router.push(`/${locale}/upload`)}
          className="flex items-center gap-2 px-3 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          title={t('upload.uploadVideo')}
        >
          <Upload size={20} />
          <span className="hidden md:inline">{t('upload.uploadVideo')}</span>
        </button>
      )}
    </header>
  );
}
```

#### C. Video Management Dashboard

**New File**: `apps/web/src/app/[locale]/dashboard/videos/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { Upload, Video, Edit, Trash2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider/authContext';
import VideoUpload from '@/components/videoUpload';

export default function VideosManagementPage() {
  const [showUpload, setShowUpload] = useState(false);
  const { user } = useAuth();

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('dashboard.myVideos')}</h1>

        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Upload size={20} />
          <span>{t('upload.uploadVideo')}</span>
        </button>
      </div>

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4">
            <VideoUpload
              onUploadComplete={(video) => {
                setShowUpload(false);
                // Refresh video list
              }}
              onProgress={(progress) => console.log('Progress:', progress)}
              onError={(error) => console.error('Upload error:', error)}
            />
          </div>
        </div>
      )}

      {/* Video List with Management Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {videos.map((video) => (
          <VideoManagementCard key={video.id} video={video} />
        ))}
      </div>
    </div>
  );
}
```

### 2. Video Edit UI

**New File**: `apps/web/src/components/videoEdit/index.tsx`

```tsx
'use client';

import { useState } from 'react';
import { Save, X, Upload, Image as ImageIcon } from 'lucide-react';
import ThumbnailSelector from './ThumbnailSelector';

interface VideoEditProps {
  video: VideoObject;
  onSave: (updated: Partial<VideoObject>) => Promise<void>;
  onCancel: () => void;
}

export default function VideoEdit({ video, onSave, onCancel }: VideoEditProps) {
  const [formData, setFormData] = useState({
    titleEn: video.titleLocalized?.en || video.title,
    titleAr: video.titleLocalized?.ar || '',
    descriptionEn: video.descriptionLocalized?.en || video.description || '',
    descriptionAr: video.descriptionLocalized?.ar || '',
    isPublic: video.isPublic,
    tags: video.tags || [],
  });
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');
  const [customThumbnail, setCustomThumbnail] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        titleLocalized: {
          en: formData.titleEn,
          ar: formData.titleAr,
        },
        descriptionLocalized: {
          en: formData.descriptionEn,
          ar: formData.descriptionAr,
        },
        isPublic: formData.isPublic,
        tags: formData.tags,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">{t('video.editVideo')}</h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X size={24} />
        </button>
      </div>

      {/* Video Preview */}
      <div className="mb-6">
        <video
          src={video.videoUrl}
          poster={video.thumbnailUrl}
          controls
          className="w-full rounded-lg"
        />
      </div>

      {/* Language Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('en')}
          className={`px-4 py-2 rounded-t-lg ${
            activeTab === 'en'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          English
        </button>
        <button
          onClick={() => setActiveTab('ar')}
          className={`px-4 py-2 rounded-t-lg ${
            activeTab === 'ar'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          العربية
        </button>
      </div>

      {/* Title Field */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          {t('video.title')} *
        </label>
        {activeTab === 'en' ? (
          <input
            type="text"
            value={formData.titleEn}
            onChange={(e) => setFormData({ ...formData, titleEn: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="Title in English"
          />
        ) : (
          <input
            type="text"
            value={formData.titleAr}
            onChange={(e) => setFormData({ ...formData, titleAr: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="العنوان بالعربية"
            dir="rtl"
          />
        )}
      </div>

      {/* Description Field */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          {t('video.description')}
        </label>
        {activeTab === 'en' ? (
          <textarea
            value={formData.descriptionEn}
            onChange={(e) => setFormData({ ...formData, descriptionEn: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="Description in English"
          />
        ) : (
          <textarea
            value={formData.descriptionAr}
            onChange={(e) => setFormData({ ...formData, descriptionAr: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="الوصف بالعربية"
            dir="rtl"
          />
        )}
      </div>

      {/* Thumbnail Selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          {t('video.thumbnail')}
        </label>
        <ThumbnailSelector
          videoId={video.id}
          currentThumbnail={video.thumbnailUrl}
          onSelect={(thumbnail) => console.log('Thumbnail selected:', thumbnail)}
        />
      </div>

      {/* Privacy Toggle */}
      <div className="mb-6">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.isPublic}
            onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">{t('video.makePublic')}</span>
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !formData.titleEn.trim()}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={20} />
          <span>{saving ? t('common.saving') : t('common.save')}</span>
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
```

### 3. Video Preview Component

**New File**: `apps/web/src/components/videoPreview/index.tsx`

```tsx
'use client';

import { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Clock } from 'lucide-react';

interface VideoPreviewProps {
  videoUrl: string;
  thumbnailUrl?: string;
  title: string;
  duration?: number;
  autoplay?: boolean;
  muted?: boolean;
  className?: string;
}

export default function VideoPreview({
  videoUrl,
  thumbnailUrl,
  title,
  duration,
  autoplay = false,
  muted = true,
  className = '',
}: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(muted);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`relative group ${className}`}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        poster={thumbnailUrl}
        autoPlay={autoplay}
        muted={muted}
        className="w-full h-full object-cover rounded-lg"
      />

      {/* Play/Pause Overlay */}
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
          <button
            onClick={togglePlay}
            className="w-16 h-16 flex items-center justify-center bg-white/90 rounded-full hover:bg-white transition-colors"
          >
            <Play size={32} className="text-gray-900 ml-1" />
          </button>
        </div>
      )}

      {/* Controls */}
      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-b-lg">
          <div className="flex items-center gap-4">
            <button onClick={togglePlay} className="text-white hover:text-gray-300">
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>

            <button onClick={toggleMute} className="text-white hover:text-gray-300">
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>

            <div className="flex items-center gap-2 text-white text-sm">
              <Clock size={16} />
              <span>{formatTime(currentTime)}</span>
              {duration && <span>/ {formatTime(duration)}</span>}
            </div>

            <button className="ml-auto text-white hover:text-gray-300">
              <Maximize size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Thumbnail Management

### Bunny.net Thumbnail Integration

**Bunny.net automatically generates thumbnails** at various timestamps. We can leverage this and add custom upload support.

### 1. Thumbnail Selector Component

**New File**: `apps/web/src/components/videoEdit/ThumbnailSelector.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Upload, Check } from 'lucide-react';
import Image from 'next/image';

interface ThumbnailSelectorProps {
  videoId: string;
  currentThumbnail?: string;
  onSelect: (thumbnailUrl: string) => void;
}

export default function ThumbnailSelector({
  videoId,
  currentThumbnail,
  onSelect,
}: ThumbnailSelectorProps) {
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
  const [selectedThumbnail, setSelectedThumbnail] = useState(currentThumbnail);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    // Fetch generated thumbnails from Bunny.net
    fetchGeneratedThumbnails();
  }, [videoId]);

  const fetchGeneratedThumbnails = async () => {
    // Bunny.net provides thumbnails at different timestamps
    // Format: https://vz-xxxxxxxx-xxx.b-cdn.net/{videoId}/thumbnail_0.jpg
    const timestamps = [0, 25, 50, 75, 100]; // Percentage of video duration
    const thumbnails = timestamps.map(
      (ts) => `https://vz-xxxxxxxx-xxx.b-cdn.net/${videoId}/thumbnail_${ts}.jpg`
    );
    setGeneratedThumbnails(thumbnails);
  };

  const handleCustomUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('thumbnail', file);
      formData.append('videoId', videoId);

      const response = await fetch('/api/videos/upload/thumbnail', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (result.success) {
        setSelectedThumbnail(result.thumbnailUrl);
        onSelect(result.thumbnailUrl);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Generated Thumbnails */}
      <div>
        <h4 className="text-sm font-medium mb-2">Generated Thumbnails</h4>
        <div className="grid grid-cols-5 gap-2">
          {generatedThumbnails.map((thumbnail, index) => (
            <button
              key={index}
              onClick={() => {
                setSelectedThumbnail(thumbnail);
                onSelect(thumbnail);
              }}
              className={`relative aspect-video rounded-lg overflow-hidden border-2 ${
                selectedThumbnail === thumbnail
                  ? 'border-blue-600'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <Image
                src={thumbnail}
                alt={`Thumbnail ${index + 1}`}
                fill
                className="object-cover"
              />
              {selectedThumbnail === thumbnail && (
                <div className="absolute top-1 right-1 bg-blue-600 rounded-full p-1">
                  <Check size={12} className="text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Upload */}
      <div>
        <h4 className="text-sm font-medium mb-2">Custom Thumbnail</h4>
        <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 transition-colors">
          <Upload size={20} />
          <span>Upload Custom Thumbnail</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCustomUpload(file);
            }}
            className="hidden"
            disabled={uploading}
          />
        </label>
        <p className="text-xs text-gray-500 mt-1">
          Recommended: 1280x720px (16:9), max 2MB
        </p>
      </div>
    </div>
  );
}
```

### 2. Thumbnail Upload API Endpoint

**New File**: `apps/api-videos/src/endpoints/video/uploadThumbnail.ts`

```typescript
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { BunnyStorageClient } from '../../lib/bunny/storage';

export class UploadThumbnailEndpoint extends OpenAPIRoute {
  schema = {
    tags: ['Video'],
    summary: 'Upload custom thumbnail for video',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              thumbnail: z.instanceof(File),
              videoId: z.string().uuid(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Thumbnail uploaded successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              thumbnailUrl: z.string().url(),
            }),
          },
        },
      },
    },
  };

  async handle(c) {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const formData = await c.req.formData();
    const thumbnail = formData.get('thumbnail') as File;
    const videoId = formData.get('videoId') as string;

    // Validate ownership
    const videoRepo = new R2Repository(c.env.videos);
    const video = await videoRepo.getObject(videoId);

    if (!video || video.userId !== auth.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Validate image
    if (!thumbnail.type.startsWith('image/')) {
      return c.json({ error: 'Invalid file type' }, 400);
    }

    if (thumbnail.size > 2 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 2MB)' }, 400);
    }

    // Upload to Bunny.net Storage
    const storageKey = await c.env['image_storage_key'].text();
    const zone = c.env.ZONE;
    const bunnyStorage = new BunnyStorageClient(storageKey, zone);

    const fileName = `thumbnails/${videoId}/custom_${Date.now()}.jpg`;
    const thumbnailBuffer = await thumbnail.arrayBuffer();

    await bunnyStorage.upload(fileName, new Uint8Array(thumbnailBuffer));

    const thumbnailUrl = `https://${zone}.b-cdn.net/${fileName}`;

    // Update video metadata
    await videoRepo.putObject(videoId, {
      ...video,
      thumbnailUrl,
      customThumbnail: true,
    });

    return c.json({
      success: true,
      thumbnailUrl,
    });
  }
}
```

---

## E2E Testing Strategy

### Test Organization

```
apps/web/e2e/
├── 12-video-upload.spec.ts           # Video upload flow
├── 13-video-upload-resume.spec.ts    # Resume interrupted upload
├── 14-video-edit.spec.ts             # Video editing
├── 15-thumbnail-management.spec.ts   # Thumbnail selection/upload
├── 16-video-management.spec.ts       # Video list and actions
└── fixtures/
    ├── test-video.mp4                # 10MB test video
    ├── test-video-large.mp4          # 100MB test video
    └── test-thumbnail.jpg            # Test thumbnail image
```

### Test Implementation

**File**: `apps/web/e2e/12-video-upload.spec.ts`

```typescript
import { test, expect } from './fixtures';
import path from 'path';

test.describe('Video Upload', () => {
  test.beforeEach(async ({ page }) => {
    // Login as authenticated user
    await page.goto('/en/auth/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/en/dashboard');
  });

  test('should upload video with metadata', async ({ page }) => {
    // Navigate to upload page
    await page.goto('/en/upload');

    // Select video file
    const videoPath = path.join(__dirname, 'fixtures', 'test-video.mp4');
    await page.setInputFiles('input[type="file"]', videoPath);

    // Fill metadata
    await page.fill('[name="titleEn"]', 'Test Video Upload');
    await page.fill('[name="titleAr"]', 'تحميل فيديو تجريبي');
    await page.fill('[name="descriptionEn"]', 'This is a test video');

    // Toggle to Arabic tab
    await page.click('button:has-text("العربية")');
    await page.fill('[name="descriptionAr"]', 'هذا فيديو تجريبي');

    // Set visibility
    await page.check('input[name="isPublic"]');

    // Start upload
    await page.click('button:has-text("Upload")');

    // Wait for upload to complete (with progress tracking)
    await expect(page.locator('text=Upload Complete')).toBeVisible({ timeout: 60000 });

    // Verify redirect to video page
    await expect(page).toHaveURL(/\/en\/video\/.+/);

    // Verify video is playable
    const video = page.locator('video');
    await expect(video).toBeVisible();
  });

  test('should show upload progress', async ({ page }) => {
    await page.goto('/en/upload');

    const videoPath = path.join(__dirname, 'fixtures', 'test-video.mp4');
    await page.setInputFiles('input[type="file"]', videoPath);

    await page.fill('[name="titleEn"]', 'Progress Test Video');
    await page.click('button:has-text("Upload")');

    // Check progress bar appears
    const progressBar = page.locator('[role="progressbar"], .progress-bar');
    await expect(progressBar).toBeVisible();

    // Check progress updates
    await expect(progressBar).toHaveAttribute('aria-valuenow', /[0-9]+/, {
      timeout: 5000,
    });

    // Check progress stages
    await expect(page.locator('text=/Preparing|Uploading|Processing/')).toBeVisible();
  });

  test('should validate file type', async ({ page }) => {
    await page.goto('/en/upload');

    // Try uploading non-video file
    const invalidPath = path.join(__dirname, 'fixtures', 'test-thumbnail.jpg');
    await page.setInputFiles('input[type="file"]', invalidPath);

    // Should show error
    await expect(page.locator('text=/Invalid file type|Only video files/')).toBeVisible();
  });

  test('should validate file size', async ({ page }) => {
    await page.goto('/en/upload');

    // Try uploading file > 2GB (simulated)
    // Note: Actual large file test would be separate
    await expect(page.locator('text=/max.*2GB/i')).toBeVisible();
  });

  test('should allow canceling upload', async ({ page }) => {
    await page.goto('/en/upload');

    const videoPath = path.join(__dirname, 'fixtures', 'test-video-large.mp4');
    await page.setInputFiles('input[type="file"]', videoPath);

    await page.fill('[name="titleEn"]', 'Cancel Test Video');
    await page.click('button:has-text("Upload")');

    // Wait for upload to start
    await expect(page.locator('[role="progressbar"]')).toBeVisible();

    // Cancel upload
    await page.click('button:has-text("Cancel")');

    // Verify upload stopped
    await expect(page.locator('[role="progressbar"]')).not.toBeVisible();
  });
});

test.describe('Video Upload - RTL', () => {
  test('should upload video in Arabic interface', async ({ page }) => {
    await page.goto('/ar/auth/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    await page.goto('/ar/upload');

    // Verify RTL layout
    await expect(page.locator('body')).toHaveAttribute('dir', 'rtl');

    const videoPath = path.join(__dirname, 'fixtures', 'test-video.mp4');
    await page.setInputFiles('input[type="file"]', videoPath);

    // Fill Arabic metadata
    await page.click('button:has-text("العربية")');
    await page.fill('[name="titleAr"]', 'فيديو تجريبي');
    await page.fill('[name="descriptionAr"]', 'وصف الفيديو');

    await page.click('button:has-text("رفع")'); // "Upload" in Arabic

    await expect(page.locator('text=اكتمل الرفع')).toBeVisible({ timeout: 60000 });
  });
});
```

**File**: `apps/web/e2e/13-video-upload-resume.spec.ts`

```typescript
import { test, expect } from './fixtures';
import path from 'path';

test.describe('Video Upload Resumption', () => {
  test('should resume interrupted upload', async ({ page, context }) => {
    await page.goto('/en/auth/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    await page.goto('/en/upload');

    const videoPath = path.join(__dirname, 'fixtures', 'test-video-large.mp4');
    await page.setInputFiles('input[type="file"]', videoPath);

    await page.fill('[name="titleEn"]', 'Resume Test Video');
    await page.click('button:has-text("Upload")');

    // Wait for some progress
    await page.waitForTimeout(5000);

    // Simulate network interruption by closing page
    const uploadUrl = page.url();
    await page.close();

    // Reopen page (simulates page refresh)
    const newPage = await context.newPage();
    await newPage.goto(uploadUrl);

    // Should detect incomplete upload
    await expect(newPage.locator('text=/Resume upload|Continue uploading/')).toBeVisible();

    // Resume upload
    await newPage.click('button:has-text("Resume")');

    // Should continue from last chunk
    await expect(newPage.locator('[role="progressbar"]')).toBeVisible();

    // Should complete
    await expect(newPage.locator('text=Upload Complete')).toBeVisible({ timeout: 120000 });
  });

  test('should show resume option on page reload', async ({ page }) => {
    await page.goto('/en/auth/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    await page.goto('/en/upload');

    const videoPath = path.join(__dirname, 'fixtures', 'test-video.mp4');
    await page.setInputFiles('input[type="file"]', videoPath);

    await page.fill('[name="titleEn"]', 'Reload Test Video');
    await page.click('button:has-text("Upload")');

    // Wait for upload to start
    await page.waitForTimeout(2000);

    // Reload page
    await page.reload();

    // Should show resume prompt
    await expect(page.locator('text=/Resume|Continue/')).toBeVisible();
  });
});
```

### Test Configuration

**File**: `apps/web/playwright.config.ts` (Enhanced)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120000, // 2 minutes per test (for large uploads)
  expect: {
    timeout: 30000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: {
    command: 'pnpm web:dev',
    port: 3001,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
});
```

---

## Implementation Phases

### Phase 1: Critical Security Fixes (Week 1)

**Priority**: CRITICAL

| Task | File | Lines | Est. Time |
|------|------|-------|-----------|
| Remove `getBunnyAccessKey` function | `apps/web/src/lib/actions/upload.ts` | 164-170 | 10 min |
| Remove direct Bunny upload logic | `apps/web/src/components/videoUpload/index.tsx` | 166-219 | 30 min |
| Add magic byte validation | `apps/api-videos/src/endpoints/video/videoUpload.ts` | New | 2 hours |
| Sanitize filenames | `apps/api-videos/src/endpoints/community/upload-images.ts` | 134 | 1 hour |
| Implement rate limiting middleware | `apps/api-videos/src/middleware/rate-limit.ts` | New | 4 hours |
| Add KV namespace for rate limiting | `apps/api-videos/wrangler.jsonc` | Bindings | 30 min |

**Testing**: Manual testing with curl, Swagger UI

**Deliverable**: Secure API with no client-side key exposure

---

### Phase 2: Streaming Upload Architecture (Week 2-3)

**Priority**: HIGH

| Task | File | Est. Time |
|------|------|-----------|
| Create chunked upload endpoint | `apps/api-videos/src/endpoints/video/uploadStream.ts` | 8 hours |
| Add upload resume endpoint | `apps/api-videos/src/endpoints/video/uploadResume.ts` | 4 hours |
| Create chunk assembly queue handler | `apps/processor/src/handlers/assembleAndUpload.ts` | 6 hours |
| Add R2 bucket for upload chunks | `wrangler.jsonc` | 30 min |
| Implement progress tracking in KV | `apps/api-videos/src/lib/upload-progress.ts` | 3 hours |
| Update client upload logic | `apps/web/src/components/videoUpload/index.tsx` | 8 hours |
| Add chunked upload helper | `apps/web/src/lib/upload/chunkedUpload.ts` | 6 hours |
| WebSocket progress notifications | `apps/websocket-server/` integration | 4 hours |

**Testing**: E2E tests (12-video-upload.spec.ts, 13-video-upload-resume.spec.ts)

**Deliverable**: Working chunked upload with resume capability

---

### Phase 3: Enhanced UI Components (Week 4)

**Priority**: MEDIUM

| Task | File | Est. Time |
|------|------|-----------|
| Add upload button to channel header | `apps/web/src/components/Channel/ChannelHeader.tsx` | 2 hours |
| Add upload button to main navigation | `apps/web/src/components/Header/index.tsx` | 2 hours |
| Create video management dashboard | `apps/web/src/app/[locale]/dashboard/videos/page.tsx` | 8 hours |
| Create video edit component | `apps/web/src/components/videoEdit/index.tsx` | 10 hours |
| Create video preview component | `apps/web/src/components/videoPreview/index.tsx` | 6 hours |
| Create thumbnail selector component | `apps/web/src/components/videoEdit/ThumbnailSelector.tsx` | 6 hours |
| Add thumbnail upload endpoint | `apps/api-videos/src/endpoints/video/uploadThumbnail.ts` | 4 hours |
| Add RTL variants for all components | `apps/web/src/components/*/rtl/` | 6 hours |

**Testing**: E2E tests (14-video-edit.spec.ts, 15-thumbnail-management.spec.ts)

**Deliverable**: Complete video management UI

---

### Phase 4: E2E Testing & Polish (Week 5)

**Priority**: HIGH

| Task | Est. Time |
|------|-----------|
| Write video upload tests | 4 hours |
| Write upload resume tests | 4 hours |
| Write video edit tests | 4 hours |
| Write thumbnail management tests | 3 hours |
| Write video management tests | 4 hours |
| Set up CI pipeline for E2E tests | 4 hours |
| Performance testing (large files) | 4 hours |
| Cross-browser testing | 4 hours |
| Mobile responsiveness testing | 4 hours |

**Deliverable**: 90%+ test coverage for upload flow

---

### Phase 5: Production Optimization (Week 6)

**Priority**: MEDIUM

| Task | Est. Time |
|------|-----------|
| Implement upload quotas per user | 6 hours |
| Add virus scanning integration | 8 hours |
| Set up monitoring and alerting | 4 hours |
| Add analytics dashboard | 8 hours |
| Optimize chunk size based on network | 4 hours |
| Add error recovery strategies | 6 hours |
| Performance profiling and optimization | 8 hours |
| Documentation and API guides | 6 hours |

**Deliverable**: Production-ready upload system

---

## Migration Strategy

### Backward Compatibility

**Phase 1-2 Transition** (Parallel Upload Methods):

```typescript
// Support both old and new upload methods
if (ENABLE_CHUNKED_UPLOAD) {
  // New: Chunked upload via API
  await uploadChunked(file, metadata);
} else {
  // Old: Direct upload (deprecated)
  await uploadDirect(file, metadata);
}
```

### Feature Flag Configuration

**File**: `apps/web/src/lib/constants/uploadConfig.ts`

```typescript
export const UPLOAD_FEATURES = {
  CHUNKED_UPLOAD: process.env.NEXT_PUBLIC_ENABLE_CHUNKED_UPLOAD === 'true',
  UPLOAD_RESUME: process.env.NEXT_PUBLIC_ENABLE_UPLOAD_RESUME === 'true',
  CUSTOM_THUMBNAILS: process.env.NEXT_PUBLIC_ENABLE_CUSTOM_THUMBNAILS === 'true',
  WEBSOCKET_PROGRESS: process.env.NEXT_PUBLIC_ENABLE_WS_PROGRESS === 'true',
};
```

### Rollout Plan

1. **Week 1**: Deploy security fixes to production (no user-facing changes)
2. **Week 2-3**: Deploy streaming upload behind feature flag (beta users only)
3. **Week 4**: Enable for 25% of users, monitor error rates
4. **Week 5**: Enable for 50% of users, continue monitoring
5. **Week 6**: Enable for 100% of users, deprecate old upload method

### Rollback Plan

If issues arise:
1. Disable feature flag (`CHUNKED_UPLOAD=false`)
2. Revert to direct upload method
3. Fix issues in development
4. Re-enable with additional testing

---

## Success Metrics

### Performance Metrics

- **Upload Success Rate**: Target >99.5% (currently ~95%)
- **Average Upload Time**: Reduce by 30% for files >100MB
- **Resume Success Rate**: >95% of interrupted uploads resume successfully
- **Time to First Byte**: <500ms for chunk uploads

### Cost Metrics

- **Bandwidth Costs**: Reduce by 40% (less failed upload retries)
- **R2 API Calls**: Reduce by 60% (caching, efficient pagination)
- **Bunny.net Bandwidth**: Monitor (should remain similar)

### User Experience Metrics

- **Upload NPS**: Target >8
- **Feature Adoption**: 80% of users use new upload within 1 month
- **Error Recovery**: 70% of failed uploads auto-retry successfully
- **Mobile Upload Success**: >95% success rate on mobile

---

## Monitoring & Observability

### Key Metrics to Track

```typescript
// apps/api-videos/src/lib/metrics.ts
export const UPLOAD_METRICS = {
  // Upload lifecycle
  'upload.initiated': 'counter',
  'upload.chunk.received': 'counter',
  'upload.assembled': 'counter',
  'upload.completed': 'counter',
  'upload.failed': 'counter',

  // Performance
  'upload.duration': 'histogram', // milliseconds
  'upload.chunk.size': 'histogram', // bytes
  'upload.file.size': 'histogram', // bytes

  // Errors
  'upload.error.validation': 'counter',
  'upload.error.rate_limit': 'counter',
  'upload.error.network': 'counter',
  'upload.error.storage': 'counter',

  // Resume
  'upload.resume.attempted': 'counter',
  'upload.resume.succeeded': 'counter',
  'upload.resume.failed': 'counter',
};
```

### Alerting Rules

```yaml
# .github/workflows/monitoring.yml
alerts:
  - name: High Upload Failure Rate
    condition: upload.failed / upload.initiated > 0.05
    severity: critical
    notify: slack, pagerduty

  - name: Slow Upload Performance
    condition: p95(upload.duration) > 60000 # 1 minute
    severity: warning
    notify: slack

  - name: Rate Limit Exceeded
    condition: upload.error.rate_limit > 100
    severity: warning
    notify: slack
```

---

## Summary

This revised plan transforms the video upload system from a simple direct-upload pattern to a **production-grade, secure, resumable streaming upload architecture** with:

✅ **Zero client-side secrets**
✅ **Chunked uploads with resume**
✅ **Real-time progress via WebSocket**
✅ **Comprehensive E2E testing**
✅ **Rate limiting and quotas**
✅ **Enhanced UI with video management**
✅ **Thumbnail selection and upload**
✅ **Bilingual support (EN/AR)**
✅ **Mobile-first responsive design**

**Estimated Total Implementation Time**: 5-6 weeks (1 developer)
**Risk Level**: Medium (architecture change, but backward compatible)
**Impact**: High (improved security, UX, and scalability)

---

**Next Steps**:
1. Review and approve this plan
2. Set up feature flags in environment
3. Create GitHub project board with tasks
4. Begin Phase 1 (Critical Security Fixes)
5. Schedule weekly progress reviews
