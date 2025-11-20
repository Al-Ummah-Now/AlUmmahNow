# Video Editor (Post-Upload) - Implementation Plan

**Document Version**: 1.0
**Created Date**: 2025-11-20
**Priority**: LOW ⭐ (Basic editing convenience)
**Estimated Effort**: 6 weeks (2-3 developers)
**Architecture Pattern**: Cloudflare Workers + Bunny.net Stream API + Client-Side Editor

---

## Executive Summary

The Post-Upload Video Editor feature enables content creators to perform basic video editing operations after upload without re-uploading the entire video. This includes trimming (cut start/end), blurring sensitive areas (faces, private information), adding audio tracks, and removing middle segments. The feature prioritizes Islamic content use cases such as blurring faces in videos (Islamic modesty), removing unintended segments from lectures, and adding nasheed (Islamic music) overlays.

## Key Requirements from YouTube Comparison

### Functional Requirements (from docs/YOUTUBE_FEATURE_COMPARISON.md #34)
1. **Trim video** - Cut start and end points without re-uploading
2. **Blur specific areas** - Blur faces, license plates, sensitive information (frame-by-frame or tracked)
3. **Add audio tracks** - Replace or overlay audio (e.g., add nasheed, remove background music)
4. **Cut segments** - Remove middle sections (e.g., cut out mistakes in lectures)
5. **Real-time preview** - See changes before applying
6. **Non-destructive editing** - Original video preserved, can revert changes
7. **No re-upload required** - Edits processed server-side

### Non-Functional Requirements
1. **Performance**: Preview generation < 5 seconds for 10-minute videos
2. **Reliability**: 99% success rate for edit processing
3. **Quality**: Minimal quality loss during re-encoding (same bitrate)
4. **Scalability**: Handle 1,000+ concurrent edit sessions
5. **Cost**: Minimize re-encoding costs (Bunny.net transcoding fees)
6. **UX**: Intuitive timeline-based editor similar to YouTube Studio

## Islamic Content Use Cases

### High Priority Use Cases
1. **Face Blurring for Modesty**
   - Blur faces of women in mixed-gender events
   - Blur children's faces for privacy
   - Blur faces of scholars who prefer anonymity

2. **Lecture Editing**
   - Remove mistakes or technical issues from recorded lectures
   - Trim long pauses or distractions
   - Remove off-topic tangents

3. **Audio Replacement**
   - Replace copyrighted background music with halal nasheed
   - Remove haram music from reused clips
   - Add bilingual voice-over narration

4. **Privacy Protection**
   - Blur personal information (phone numbers, addresses)
   - Blur license plates in Hajj/Umrah travel videos
   - Blur sensitive documents shown on screen

### Medium Priority Use Cases
5. **Conference Editing**
   - Remove breaks between sessions
   - Trim opening/closing logistics
   - Remove inappropriate Q&A segments

6. **Educational Content**
   - Remove errors in Quran recitation tutorials
   - Edit out technical difficulties
   - Trim video length to fit platform limits

## Technical Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Frontend (Next.js Web App)                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Video Editor UI Component                         │  │
│  │  - Timeline editor with playback controls                      │  │
│  │  - Trim handles (drag to adjust start/end)                    │  │
│  │  - Segment selection (mark regions to remove)                 │  │
│  │  - Blur tool (draw rectangles, auto-track faces)             │  │
│  │  - Audio track upload/selection                               │  │
│  │  - Real-time preview player (with edit markers)              │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    API (Hono - api-videos)                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  POST /api/videos/{id}/edit/preview   - Generate preview      │  │
│  │  POST /api/videos/{id}/edit/apply     - Apply edits           │  │
│  │  GET  /api/videos/{id}/edit/status    - Check processing      │  │
│  │  POST /api/videos/{id}/edit/revert    - Revert to original    │  │
│  │  POST /api/videos/{id}/edit/audio     - Upload audio track    │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Storage Layer (R2)                           │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────────┐   │
│  │ videos bucket│    │ edits bucket │    │ audio-tracks bucket│   │
│  │ (main store) │    │ (edit data)  │    │ (uploaded audio)   │   │
│  └──────────────┘    └──────────────┘    └────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Video Processing Service (Processor Worker)          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Queue Consumer - Processes video edit jobs                   │  │
│  │  - Download original from Bunny.net Stream                    │  │
│  │  - Apply edits using FFmpeg (WASM or external service)        │  │
│  │  - Upload edited video back to Bunny.net                      │  │
│  │  - Update video metadata in R2                                │  │
│  │  - Send completion notification                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Bunny.net Stream API                              │
│  - Original video storage                                           │
│  - Re-encoded video upload                                          │
│  - Thumbnail generation                                             │
│  - Multi-resolution transcoding                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User initiates edit** → Frontend loads video in editor UI
2. **User makes edits** → Edit operations stored in local state (JSON format)
3. **User requests preview** → API generates low-res preview with edits applied
4. **User applies edits** → Edit data sent to API, queued for processing
5. **Processor worker** → Downloads video, applies edits with FFmpeg, re-uploads
6. **Video updated** → Metadata updated, user notified of completion
7. **Original preserved** → Original video backed up in case of revert

## Database Schema Changes

### 1. Video Model Extensions (`packages/shared-types/src/video.ts`)

```typescript
export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // Video editing fields
  isEdited?: boolean;                    // True if video has been edited post-upload
  editHistory?: VideoEditHistory[];       // Array of edit operations applied
  originalVideoId?: string;              // Bunny.net ID of original (pre-edit) video
  originalVideoBackupUrl?: string;       // R2 URL of original video backup
  editStatus?: VideoEditStatus;          // Current edit processing status
  editJobId?: string;                    // Queue job ID for current edit
  lastEditedAt?: string;                 // Timestamp of last edit
  lastEditedBy?: string;                 // User ID who last edited
}

export type VideoEditStatus =
  | 'none'           // No edits applied
  | 'pending'        // Edit job queued
  | 'processing'     // Edit job in progress
  | 'completed'      // Edit successfully applied
  | 'failed'         // Edit failed
  | 'reverted';      // Reverted to original

export interface VideoEditHistory {
  id: string;                            // Edit operation ID
  timestamp: string;                     // When edit was applied
  userId: string;                        // Who applied edit
  editType: VideoEditType;               // Type of edit
  parameters: VideoEditParameters;       // Edit-specific parameters
  status: 'completed' | 'failed';        // Result status
  processingTimeMs?: number;             // Time taken to process
}

export type VideoEditType =
  | 'trim'           // Cut start/end
  | 'cut'            // Remove middle segment
  | 'blur'           // Blur specific area
  | 'audio-replace'  // Replace entire audio track
  | 'audio-overlay'  // Add audio overlay
  | 'audio-remove'   // Remove audio track
  | 'revert';        // Revert to original

export interface VideoEditParameters {
  // Trim parameters
  trimStart?: number;                    // Start time in seconds
  trimEnd?: number;                      // End time in seconds

  // Cut parameters
  cutSegments?: Array<{
    start: number;                       // Segment start (seconds)
    end: number;                         // Segment end (seconds)
  }>;

  // Blur parameters
  blurRegions?: Array<{
    x: number;                           // X coordinate (0-1, relative)
    y: number;                           // Y coordinate (0-1, relative)
    width: number;                       // Width (0-1, relative)
    height: number;                      // Height (0-1, relative)
    startTime: number;                   // When blur starts (seconds)
    endTime: number;                     // When blur ends (seconds)
    trackFaces?: boolean;                // Auto-track faces (future)
    blurIntensity?: number;              // Blur strength (1-100)
  }>;

  // Audio parameters
  audioTrackId?: string;                 // R2 key for uploaded audio file
  audioStartTime?: number;               // When audio starts (seconds)
  audioVolume?: number;                  // Audio volume (0-100)
  mixWithOriginal?: boolean;             // Mix or replace original audio
  originalAudioVolume?: number;          // Original audio volume if mixing
}

export interface VideoEditRequest {
  videoId: string;
  editType: VideoEditType;
  parameters: VideoEditParameters;
  generatePreview?: boolean;             // If true, only generate preview
  quality?: 'low' | 'medium' | 'high';   // Preview quality
}

export interface VideoEditResponse {
  success: boolean;
  jobId?: string;                        // Queue job ID
  previewUrl?: string;                   // Preview video URL (if requested)
  estimatedProcessingTime?: number;      // Seconds (based on video length)
  message?: string;
  error?: string;
}

export interface VideoEditStatus {
  videoId: string;
  jobId: string;
  status: VideoEditStatus;
  progress?: number;                     // 0-100%
  message?: string;
  error?: string;
  estimatedCompletion?: string;          // ISO 8601 timestamp
}
```

### 2. New R2 Buckets

**Bucket Name**: `video-edits` (preview: `video-edits-preview`)
- Stores edit operation metadata
- Key format: `{videoId}/edits/{editId}.json`

**Bucket Name**: `audio-tracks` (preview: `audio-tracks-preview`)
- Stores uploaded audio files for replacement/overlay
- Key format: `{userId}/{audioTrackId}.mp3` (or .wav, .ogg)

**Bucket Name**: `video-backups` (preview: `video-backups-preview`)
- Stores original videos before editing (for revert capability)
- Key format: `{videoId}/original-{timestamp}.mp4`
- Lifecycle policy: Delete after 90 days

### 3. Queue Message Types

**New Message Type**: `VIDEO_EDIT_JOB`
```typescript
export interface VideoEditJobMessage {
  type: 'VIDEO_EDIT_JOB';
  jobId: string;
  videoId: string;
  userId: string;
  channelId: string;
  editType: VideoEditType;
  parameters: VideoEditParameters;
  originalVideoUrl: string;             // Bunny.net Stream URL
  bunnyVideoId: string;                 // Bunny.net video ID
  timestamp: string;
  priority?: 'low' | 'normal' | 'high'; // Priority queue
}
```

## API Endpoint Specifications

### 1. Preview Edit (Generate Preview)

```typescript
POST /api/videos/{videoId}/edit/preview
Authorization: Bearer {token}

Request Body:
{
  "editType": "trim",
  "parameters": {
    "trimStart": 10,      // Remove first 10 seconds
    "trimEnd": 120        // Remove after 2 minutes
  },
  "quality": "low"        // Low quality for fast preview
}

Response:
{
  "success": true,
  "result": {
    "previewUrl": "https://preview.alummahnow.net/edits/abc123-preview.mp4",
    "previewThumbnail": "https://preview.alummahnow.net/edits/abc123-thumb.jpg",
    "expiresAt": "2025-11-20T12:00:00Z",  // Preview expires in 1 hour
    "duration": 110,                       // New duration after trim
    "message": "Preview generated successfully"
  }
}

Validations:
- User must own the video
- Video must be fully processed (not still uploading)
- Preview generation limited to 5 per video per day (rate limit)
```

### 2. Apply Edit (Queue for Processing)

```typescript
POST /api/videos/{videoId}/edit/apply
Authorization: Bearer {token}

Request Body:
{
  "editType": "blur",
  "parameters": {
    "blurRegions": [
      {
        "x": 0.3,
        "y": 0.2,
        "width": 0.15,
        "height": 0.2,
        "startTime": 30,
        "endTime": 45,
        "blurIntensity": 80
      }
    ]
  }
}

Response:
{
  "success": true,
  "result": {
    "jobId": "edit-abc123-xyz789",
    "status": "queued",
    "estimatedProcessingTime": 300,     // 5 minutes
    "message": "Edit queued for processing. You'll be notified when complete."
  }
}

Validations:
- User must own the video
- Video cannot be currently processing another edit
- Maximum 10 edit operations per video per day
- Video must be under 2 hours duration (limit for MVP)
```

### 3. Check Edit Status

```typescript
GET /api/videos/{videoId}/edit/status?jobId=edit-abc123-xyz789
Authorization: Bearer {token}

Response:
{
  "success": true,
  "result": {
    "videoId": "abc123",
    "jobId": "edit-abc123-xyz789",
    "status": "processing",
    "progress": 65,                     // 65% complete
    "message": "Applying blur effects...",
    "estimatedCompletion": "2025-11-20T11:10:00Z"
  }
}

Status Values:
- "queued" - Waiting in queue
- "processing" - Currently processing
- "completed" - Edit applied successfully
- "failed" - Edit failed (see error field)
```

### 4. Revert to Original

```typescript
POST /api/videos/{videoId}/edit/revert
Authorization: Bearer {token}

Response:
{
  "success": true,
  "result": {
    "videoId": "abc123",
    "status": "reverted",
    "message": "Video reverted to original successfully",
    "editHistory": []                   // Edit history cleared
  }
}

Validations:
- User must own the video
- Original video backup must exist
- Cannot revert if video is currently being edited
```

### 5. Upload Audio Track

```typescript
POST /api/videos/{videoId}/edit/audio
Authorization: Bearer {token}
Content-Type: multipart/form-data

Request Body:
{
  "audioFile": <binary data>,
  "title": "Nasheed Background Track",
  "replaceOriginal": true,            // true = replace, false = overlay
  "volume": 80                        // Volume 0-100
}

Response:
{
  "success": true,
  "result": {
    "audioTrackId": "audio-xyz789",
    "url": "https://r2.alummahnow.net/audio-tracks/user123/audio-xyz789.mp3",
    "duration": 180,                  // 3 minutes
    "format": "mp3",
    "sizeBytes": 4567890,
    "message": "Audio track uploaded successfully. Apply edit to use it."
  }
}

Validations:
- Audio file must be under 100MB
- Supported formats: MP3, WAV, OGG, AAC
- Audio duration must not exceed video duration + 10%
- User must own the video
```

### 6. Get Edit History

```typescript
GET /api/videos/{videoId}/edit/history
Authorization: Bearer {token}

Response:
{
  "success": true,
  "result": {
    "videoId": "abc123",
    "isEdited": true,
    "editCount": 3,
    "lastEditedAt": "2025-11-20T10:30:00Z",
    "history": [
      {
        "id": "edit-1",
        "timestamp": "2025-11-19T14:20:00Z",
        "userId": "user123",
        "editType": "trim",
        "parameters": { "trimStart": 0, "trimEnd": 600 },
        "status": "completed",
        "processingTimeMs": 45000
      },
      {
        "id": "edit-2",
        "timestamp": "2025-11-20T09:15:00Z",
        "userId": "user123",
        "editType": "blur",
        "parameters": { "blurRegions": [...] },
        "status": "completed",
        "processingTimeMs": 180000
      }
    ]
  }
}
```

## Frontend UI Components

### 1. Video Editor UI Component

**File**: `apps/web/src/components/VideoEditor/index.tsx`

```typescript
interface VideoEditorProps {
  videoId: string;
  videoUrl: string;            // Bunny.net playback URL
  duration: number;            // Video duration in seconds
  onSave: (edits: VideoEditRequest) => Promise<void>;
  onCancel: () => void;
}

// Component features:
// - Video player with timeline scrubber
// - Trim handles at start/end of timeline
// - Segment selection tool (mark regions to cut)
// - Blur tool (draw rectangles on video frame)
// - Audio upload/selection panel
// - Preview button (generates preview)
// - Apply button (queues edit job)
// - Undo/redo support
// - Real-time preview of edits
```

**Subcomponents**:

```typescript
// Timeline component with trim handles
VideoTimeline.tsx
- Displays video duration as horizontal timeline
- Draggable handles for trim start/end
- Visual markers for cut segments
- Zoom in/out on timeline
- Keyboard shortcuts (Left/Right arrows, Space to play/pause)

// Blur tool component
BlurTool.tsx
- Draw blur rectangles on video frame
- Adjust blur intensity slider
- Set start/end time for blur
- Preview blur effect in real-time
- Face detection toggle (future: auto-track faces)

// Audio manager component
AudioManager.tsx
- Upload audio file
- Select from uploaded audio tracks library
- Volume sliders for original + new audio
- Waveform visualization
- Preview audio mix

// Edit history sidebar
EditHistoryPanel.tsx
- List of applied edits
- Undo/redo buttons
- Revert to original button
- Edit details (type, parameters, timestamp)
```

### 2. Video Management Page Enhancement

**File**: `apps/web/src/app/[locale]/video/[id]/page.tsx`

```typescript
// Add "Edit Video" button in video actions menu
// Button opens video editor modal or navigates to editor page
// Show edit status badge if video is currently being edited
// Display edit history in video details
```

### 3. Processing Status Modal

**File**: `apps/web/src/components/VideoEditor/ProcessingStatus.tsx`

```typescript
interface ProcessingStatusProps {
  jobId: string;
  videoId: string;
  onComplete: () => void;
  onError: (error: string) => void;
}

// Component features:
// - Real-time progress bar (polls status endpoint)
// - Estimated time remaining
// - Current processing step (e.g., "Applying blur effects...")
// - Cancel button (optional, if supported)
// - Success/error notifications
// - Auto-close on completion
```

### 4. Editor Page (Full-Screen)

**File**: `apps/web/src/app/[locale]/video/[id]/edit/page.tsx`

```typescript
// Dedicated full-screen editor page
// Video player takes most of screen
// Toolbar at bottom with edit tools
// Sidebar with edit history and settings
// Save/Discard changes buttons
// Auto-save draft edits to localStorage
```

## Processor Worker Implementation

### File Structure Enhancement

```
apps/processor/
├── src/
│   ├── index.ts                    # Main queue consumer
│   ├── handlers/
│   │   ├── videoEditHandler.ts    # NEW: Handles VIDEO_EDIT_JOB messages
│   │   └── ... (existing handlers)
│   ├── services/
│   │   ├── ffmpegService.ts       # NEW: FFmpeg wrapper for video editing
│   │   ├── bunnyService.ts        # NEW: Bunny.net API client
│   │   └── previewService.ts      # NEW: Generate low-res previews
│   └── utils/
│       ├── videoDownload.ts       # NEW: Download video from Bunny.net
│       └── videoUpload.ts         # NEW: Upload edited video to Bunny.net
├── wrangler.toml                   # Add R2 bindings for audio-tracks, video-backups
└── package.json                    # Add FFmpeg.wasm dependency
```

### FFmpeg Service Implementation Options

**Option 1: FFmpeg.wasm (In-Worker Processing)**
```typescript
// Run FFmpeg in WebAssembly inside Cloudflare Worker
// Pros: No external dependencies, serverless
// Cons: Limited CPU time (30s max for paid plan), WASM overhead

import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';

export class FFmpegService {
  private ffmpeg: any;

  async initialize() {
    this.ffmpeg = createFFmpeg({ log: true });
    await this.ffmpeg.load();
  }

  async trimVideo(
    inputUrl: string,
    startTime: number,
    endTime: number
  ): Promise<Uint8Array> {
    // Download video
    this.ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(inputUrl));

    // Run FFmpeg command
    await this.ffmpeg.run(
      '-i', 'input.mp4',
      '-ss', startTime.toString(),
      '-to', endTime.toString(),
      '-c', 'copy',  // Copy codec (fast, no re-encode)
      'output.mp4'
    );

    // Get output
    const data = this.ffmpeg.FS('readFile', 'output.mp4');
    return data;
  }

  async blurRegion(
    inputUrl: string,
    blurRegions: BlurRegion[]
  ): Promise<Uint8Array> {
    // Download video
    this.ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(inputUrl));

    // Build FFmpeg filter for blur
    const filters = blurRegions.map(region => {
      const x = Math.floor(region.x * 1920);  // Assuming 1080p
      const y = Math.floor(region.y * 1080);
      const w = Math.floor(region.width * 1920);
      const h = Math.floor(region.height * 1080);
      const intensity = region.blurIntensity / 10;

      return `boxblur=${intensity}:enable='between(t,${region.startTime},${region.endTime})'`;
    });

    // Run FFmpeg with complex filter
    await this.ffmpeg.run(
      '-i', 'input.mp4',
      '-vf', filters.join(','),
      '-c:a', 'copy',  // Keep audio unchanged
      'output.mp4'
    );

    const data = this.ffmpeg.FS('readFile', 'output.mp4');
    return data;
  }

  async replaceAudio(
    inputUrl: string,
    audioUrl: string,
    mixVolume?: { video: number; audio: number }
  ): Promise<Uint8Array> {
    // Download video and audio
    this.ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(inputUrl));
    this.ffmpeg.FS('writeFile', 'audio.mp3', await fetchFile(audioUrl));

    if (mixVolume) {
      // Mix original and new audio
      await this.ffmpeg.run(
        '-i', 'input.mp4',
        '-i', 'audio.mp3',
        '-filter_complex',
        `[0:a]volume=${mixVolume.video / 100}[a1];[1:a]volume=${mixVolume.audio / 100}[a2];[a1][a2]amix=inputs=2[aout]`,
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        'output.mp4'
      );
    } else {
      // Replace audio entirely
      await this.ffmpeg.run(
        '-i', 'input.mp4',
        '-i', 'audio.mp3',
        '-c:v', 'copy',
        '-map', '0:v:0',
        '-map', '1:a:0',
        'output.mp4'
      );
    }

    const data = this.ffmpeg.FS('readFile', 'output.mp4');
    return data;
  }
}
```

**Option 2: External FFmpeg Service (Recommended for MVP)**
```typescript
// Use external service like Coconut.co, Zencoder, or custom EC2 instance
// Pros: No CPU time limits, professional-grade encoding
// Cons: External dependency, additional cost

export class ExternalFFmpegService {
  private apiKey: string;
  private apiUrl: string;

  constructor(apiKey: string, apiUrl: string) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
  }

  async submitJob(
    inputUrl: string,
    editType: VideoEditType,
    parameters: VideoEditParameters
  ): Promise<string> {
    // Convert edit parameters to FFmpeg command
    const ffmpegCommand = this.buildFFmpegCommand(editType, parameters);

    // Submit to external service
    const response = await fetch(`${this.apiUrl}/jobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: inputUrl,
        outputs: {
          'mp4': {
            path: 'output.mp4',
            video_codec: 'h264',
            audio_codec: 'aac',
            command: ffmpegCommand,
          },
        },
        webhook: 'https://api.alummahnow.net/webhooks/video-edit-complete',
      }),
    });

    const result = await response.json();
    return result.jobId;
  }

  private buildFFmpegCommand(
    editType: VideoEditType,
    parameters: VideoEditParameters
  ): string {
    // Build FFmpeg command based on edit type
    // Returns command string like: "-ss 10 -to 120 -c copy"
    // ...implementation details
  }
}
```

**Recommendation**: Start with **Option 2 (External Service)** for MVP, migrate to Option 1 if cost becomes prohibitive.

### Video Edit Handler

**File**: `apps/processor/src/handlers/videoEditHandler.ts`

```typescript
import { logger } from '@/lib/logger';
import { FFmpegService } from '@/services/ffmpegService';
import { BunnyStreamClient } from '@/services/bunnyService';

export async function handleVideoEditJob(
  message: VideoEditJobMessage,
  env: Env
): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('[VIDEO_EDIT] Starting edit job', {
      jobId: message.jobId,
      videoId: message.videoId,
      editType: message.editType,
    });

    // 1. Update video status to processing
    await updateVideoEditStatus(env.videos, message.videoId, {
      jobId: message.jobId,
      status: 'processing',
      progress: 0,
    });

    // 2. Backup original video (if first edit)
    const video = await getVideo(env.videos, message.videoId);
    if (!video.originalVideoBackupUrl) {
      logger.info('[VIDEO_EDIT] Backing up original video', {
        videoId: message.videoId,
      });
      await backupOriginalVideo(
        env,
        message.videoId,
        message.originalVideoUrl,
        message.bunnyVideoId
      );
    }

    // 3. Download video from Bunny.net
    logger.info('[VIDEO_EDIT] Downloading video', {
      videoId: message.videoId,
    });
    const videoFile = await downloadVideo(message.originalVideoUrl);

    await updateVideoEditStatus(env.videos, message.videoId, {
      progress: 20,
      message: 'Video downloaded, applying edits...',
    });

    // 4. Apply edit based on type
    logger.info('[VIDEO_EDIT] Applying edit', {
      editType: message.editType,
    });

    const ffmpeg = new FFmpegService();
    await ffmpeg.initialize();

    let editedVideo: Uint8Array;

    switch (message.editType) {
      case 'trim':
        editedVideo = await ffmpeg.trimVideo(
          message.originalVideoUrl,
          message.parameters.trimStart || 0,
          message.parameters.trimEnd || 999999
        );
        break;

      case 'cut':
        editedVideo = await ffmpeg.cutSegments(
          message.originalVideoUrl,
          message.parameters.cutSegments || []
        );
        break;

      case 'blur':
        editedVideo = await ffmpeg.blurRegions(
          message.originalVideoUrl,
          message.parameters.blurRegions || []
        );
        break;

      case 'audio-replace':
        const audioUrl = await getAudioTrackUrl(
          env.audioTracks,
          message.parameters.audioTrackId!
        );
        editedVideo = await ffmpeg.replaceAudio(
          message.originalVideoUrl,
          audioUrl,
          message.parameters.mixWithOriginal
            ? {
                video: message.parameters.originalAudioVolume || 50,
                audio: message.parameters.audioVolume || 100,
              }
            : undefined
        );
        break;

      default:
        throw new Error(`Unknown edit type: ${message.editType}`);
    }

    await updateVideoEditStatus(env.videos, message.videoId, {
      progress: 60,
      message: 'Edit applied, uploading to Bunny.net...',
    });

    // 5. Upload edited video to Bunny.net
    logger.info('[VIDEO_EDIT] Uploading edited video', {
      videoId: message.videoId,
      size: editedVideo.length,
    });

    const bunnyClient = new BunnyStreamClient(
      await env['bunny-stream-key'].text()
    );

    const libraryId = parseInt(
      await env['bunny_stream_library_id'].text()
    );

    // Upload as new video to Bunny.net
    const uploadResult = await bunnyClient.uploadVideo(
      libraryId,
      message.bunnyVideoId,
      new Blob([editedVideo], { type: 'video/mp4' })
    );

    await updateVideoEditStatus(env.videos, message.videoId, {
      progress: 90,
      message: 'Video uploaded, updating metadata...',
    });

    // 6. Update video metadata in R2
    await updateVideoAfterEdit(env.videos, message.videoId, {
      isEdited: true,
      editStatus: 'completed',
      lastEditedAt: new Date().toISOString(),
      lastEditedBy: message.userId,
      editHistory: [
        ...(video.editHistory || []),
        {
          id: message.jobId,
          timestamp: new Date().toISOString(),
          userId: message.userId,
          editType: message.editType,
          parameters: message.parameters,
          status: 'completed',
          processingTimeMs: Date.now() - startTime,
        },
      ],
    });

    // 7. Send completion notification
    await sendEditCompleteNotification(
      env,
      message.userId,
      message.videoId,
      message.editType
    );

    logger.info('[VIDEO_EDIT] Edit job completed successfully', {
      jobId: message.jobId,
      videoId: message.videoId,
      duration: Date.now() - startTime,
    });

    await updateVideoEditStatus(env.videos, message.videoId, {
      progress: 100,
      status: 'completed',
      message: 'Edit applied successfully',
    });
  } catch (error) {
    logger.error('[VIDEO_EDIT] Edit job failed', {
      jobId: message.jobId,
      videoId: message.videoId,
      error: error.message,
    });

    // Update video status to failed
    await updateVideoEditStatus(env.videos, message.videoId, {
      status: 'failed',
      message: `Edit failed: ${error.message}`,
    });

    // Send failure notification
    await sendEditFailureNotification(
      env,
      message.userId,
      message.videoId,
      error.message
    );

    throw error;
  }
}
```

## Preview Generation Service

**File**: `apps/processor/src/services/previewService.ts`

```typescript
export class PreviewService {
  private ffmpeg: FFmpegService;

  constructor() {
    this.ffmpeg = new FFmpegService();
  }

  async generatePreview(
    videoUrl: string,
    editType: VideoEditType,
    parameters: VideoEditParameters
  ): Promise<{ url: string; thumbnail: string }> {
    // Generate low-resolution preview (480p) for fast processing
    await this.ffmpeg.initialize();

    // Apply same edit operations but to low-res version
    let previewVideo: Uint8Array;

    switch (editType) {
      case 'trim':
        previewVideo = await this.ffmpeg.trimVideo(
          videoUrl,
          parameters.trimStart || 0,
          parameters.trimEnd || 999999
        );
        break;

      case 'blur':
        previewVideo = await this.ffmpeg.blurRegions(
          videoUrl,
          parameters.blurRegions || []
        );
        break;

      // ... other edit types
    }

    // Upload preview to R2 with short TTL (1 hour)
    const previewKey = `previews/${Date.now()}-preview.mp4`;
    await env.videoEdits.put(previewKey, previewVideo, {
      httpMetadata: {
        contentType: 'video/mp4',
      },
    });

    // Generate thumbnail
    const thumbnail = await this.ffmpeg.extractFrame(videoUrl, 1);
    const thumbnailKey = `previews/${Date.now()}-thumb.jpg`;
    await env.videoEdits.put(thumbnailKey, thumbnail);

    return {
      url: `https://preview.alummahnow.net/${previewKey}`,
      thumbnail: `https://preview.alummahnow.net/${thumbnailKey}`,
    };
  }
}
```

## Re-encoding Strategy

### Quality Preservation

To minimize quality loss during re-encoding:

1. **Copy Codec When Possible** (Trim/Cut operations)
   ```bash
   ffmpeg -i input.mp4 -ss 10 -to 120 -c copy output.mp4
   # No re-encoding, just copies frames (fast, lossless)
   ```

2. **Match Original Bitrate** (Blur/Audio operations)
   ```bash
   ffmpeg -i input.mp4 -b:v 4000k -b:a 192k output.mp4
   # Match original bitrate to minimize quality loss
   ```

3. **Use High-Quality Presets**
   ```bash
   ffmpeg -i input.mp4 -vcodec libx264 -preset slow -crf 18 output.mp4
   # CRF 18 = visually lossless quality
   ```

### Performance Optimization

1. **Hardware Acceleration** (if using external service)
   - Use GPU-accelerated encoding (NVENC, QuickSync)
   - 5-10x faster than software encoding

2. **Parallel Processing**
   - Process multiple segments in parallel
   - Combine at the end

3. **Progressive Preview**
   - Generate low-res preview first (480p)
   - Process full video in background

### Cost Optimization

**Bunny.net Stream Encoding Costs**:
- Transcoding: $0.01 per minute
- Storage: $0.01 per GB/month

**Estimated Costs per Edit**:
- 10-minute video trim: $0.10 (minimal re-encoding)
- 10-minute video blur: $0.50 (full re-encoding)
- Audio replacement: $0.30 (video copy + audio encode)

**Monthly Cost Estimate** (1,000 edits/month):
- Trim (50%): 500 × $0.10 = $50
- Blur (30%): 300 × $0.50 = $150
- Audio (20%): 200 × $0.30 = $60
- **Total**: ~$260/month

## Testing Strategy

### 1. Unit Tests

**Test Files**:
```typescript
// FFmpeg service tests
apps/processor/src/services/__tests__/ffmpegService.test.ts
- Test trim with various start/end times
- Test blur with single and multiple regions
- Test audio replacement and mixing
- Test cut segments
- Test error handling

// API endpoint tests
apps/api-videos/src/endpoints/video/__tests__/edit.test.ts
- Test edit request validation
- Test preview generation
- Test edit status polling
- Test revert functionality
- Test unauthorized access
```

**Test Cases**:
```typescript
describe('Video Editor', () => {
  describe('Trim Operation', () => {
    test('should trim video start and end');
    test('should handle trim beyond video duration');
    test('should reject negative trim values');
    test('should preserve video quality with codec copy');
  });

  describe('Blur Operation', () => {
    test('should blur single region');
    test('should blur multiple regions simultaneously');
    test('should handle overlapping blur regions');
    test('should apply blur only during specified time range');
    test('should adjust blur intensity correctly');
  });

  describe('Audio Replacement', () => {
    test('should replace audio track entirely');
    test('should mix original and new audio');
    test('should handle audio shorter than video');
    test('should handle audio longer than video');
    test('should adjust volume levels correctly');
  });

  describe('Edit Preview', () => {
    test('should generate low-res preview quickly');
    test('should expire preview after 1 hour');
    test('should rate limit preview generation');
  });

  describe('Edit History', () => {
    test('should track all edits in history');
    test('should allow reverting to original');
    test('should preserve original video backup');
  });
});
```

### 2. Integration Tests

**Scenarios**:
1. **End-to-End Edit**: Upload video → Apply edit → Verify result
2. **Multiple Edits**: Apply trim → Apply blur → Apply audio replacement
3. **Concurrent Edits**: Multiple users editing different videos
4. **Large Video**: Edit 1-hour video (test performance)
5. **Failure Recovery**: Simulate FFmpeg failure → Verify rollback
6. **Revert**: Apply edits → Revert to original → Verify restoration

### 3. Manual Testing Checklist

**UI Testing**:
- [ ] Video player loads correctly in editor
- [ ] Timeline scrubbing works smoothly
- [ ] Trim handles drag correctly
- [ ] Blur rectangles draw accurately
- [ ] Audio upload accepts valid formats
- [ ] Preview generation works
- [ ] Apply edit queues job successfully
- [ ] Status polling updates in real-time
- [ ] Edit history displays correctly
- [ ] Revert button works

**Edge Cases**:
- [ ] Video < 10 seconds (minimum trim)
- [ ] Video > 2 hours (maximum for MVP)
- [ ] Multiple blur regions overlapping
- [ ] Audio file larger than video
- [ ] Network interruption during upload
- [ ] Browser refresh during edit
- [ ] Concurrent edits by same user

### 4. Performance Testing

**Target Metrics**:
- Preview generation: < 5 seconds for 10-minute video
- Edit processing: < 5 minutes for 10-minute video
- UI responsiveness: < 100ms for interactions
- Concurrent edits: Support 100+ simultaneous jobs

**Load Testing**:
```bash
# Test with k6 or Artillery
k6 run load-tests/video-editor.js
```

## Implementation Steps

### Phase 1: Foundation (Weeks 1-2)

**1. Database & API Foundation**
- [ ] Update `VideoObject` interface with editing fields
- [ ] Create `VideoEditRequest` and related types
- [ ] Set up R2 buckets (`video-edits`, `audio-tracks`, `video-backups`)
- [ ] Create queue message type `VIDEO_EDIT_JOB`

**2. Basic API Endpoints**
- [ ] `POST /api/videos/{id}/edit/preview` - Generate preview
- [ ] `POST /api/videos/{id}/edit/apply` - Queue edit job
- [ ] `GET /api/videos/{id}/edit/status` - Poll status
- [ ] Add OpenAPI documentation for all endpoints

**3. FFmpeg Service Setup**
- [ ] Choose between FFmpeg.wasm or external service
- [ ] Implement `FFmpegService` class with basic operations
- [ ] Test trim and cut operations

### Phase 2: Core Editing Features (Weeks 3-4)

**4. Processor Worker Enhancement**
- [ ] Create `videoEditHandler.ts` in processor app
- [ ] Implement video download from Bunny.net
- [ ] Implement video upload to Bunny.net
- [ ] Add edit status tracking
- [ ] Implement backup/restore functionality

**5. Trim & Cut Operations**
- [ ] Implement trim (start/end)
- [ ] Implement cut segments (remove middle)
- [ ] Test with various video formats and lengths
- [ ] Optimize for performance (codec copy)

**6. Frontend Editor UI (Phase 1)**
- [ ] Create `VideoEditor` component with basic player
- [ ] Implement timeline with scrubber
- [ ] Add trim handles (draggable)
- [ ] Implement segment selection for cuts
- [ ] Add preview button and status display

### Phase 3: Advanced Features (Weeks 5-6)

**7. Blur Tool**
- [ ] Implement blur region drawing UI
- [ ] Add blur intensity slider
- [ ] Implement time-range selection for blur
- [ ] Implement FFmpeg blur filter
- [ ] Test with multiple blur regions

**8. Audio Replacement**
- [ ] Create audio upload endpoint
- [ ] Implement audio track storage in R2
- [ ] Create audio manager UI component
- [ ] Implement audio replacement in FFmpeg
- [ ] Implement audio mixing (overlay)
- [ ] Add volume controls

**9. Preview System**
- [ ] Implement low-res preview generation
- [ ] Add preview player in UI
- [ ] Implement preview expiration (1 hour TTL)
- [ ] Add rate limiting for previews

### Phase 4: Testing & Polish (Week 6)

**10. Testing**
- [ ] Write unit tests for all FFmpeg operations
- [ ] Write integration tests for API endpoints
- [ ] Perform manual UI testing
- [ ] Conduct load testing
- [ ] Test edge cases (large videos, multiple edits)

**11. Edit History & Revert**
- [ ] Implement `POST /api/videos/{id}/edit/revert`
- [ ] Create edit history UI panel
- [ ] Test backup/restore functionality
- [ ] Add confirmation dialogs for destructive actions

**12. Documentation & Deployment**
- [ ] API documentation for all endpoints
- [ ] User guide for video editor
- [ ] Developer guide for FFmpeg operations
- [ ] Deploy to staging environment
- [ ] Monitor initial usage

## Migration Plan

### For Existing Videos
No migration required. Video editor is opt-in per video.

### For New Videos
- Video editor available immediately after upload completes
- Original video automatically backed up on first edit
- Edit history tracked from first edit onward

## Performance Considerations

### Client-Side Performance

**Video Player Optimization**:
- Use Video.js or similar optimized player
- Lazy load editor UI until user clicks "Edit"
- Debounce timeline interactions (prevent excessive re-renders)
- Use Web Workers for timeline calculations

**Preview Generation**:
- Generate preview on server (not client)
- Use adaptive bitrate for preview playback
- Cache preview in browser for repeated views

### Server-Side Performance

**Queue Management**:
- Priority queue: High-priority edits (< 5 min videos) first
- Batch processing: Process multiple small edits in parallel
- Resource limits: Max 10 concurrent FFmpeg processes

**FFmpeg Optimization**:
- Use hardware acceleration if available
- Use `-c copy` when possible (no re-encoding)
- Parallel processing for segmented operations
- Stream processing (don't load entire video in memory)

**Bunny.net Integration**:
- Use direct upload (not multi-part for edits)
- Enable fast-start for edited videos
- Generate multiple resolutions in parallel

### Cost Optimization

**R2 Storage**:
- Lifecycle policy: Delete video backups after 90 days
- Lifecycle policy: Delete previews after 1 day
- Compress audio tracks before storage

**Bunny.net Encoding**:
- Minimize re-encoding (use codec copy when possible)
- Batch similar edit operations
- Use lower bitrate for preview generation

**Processor Worker**:
- Auto-scale based on queue depth
- Use spot instances for external FFmpeg service (if applicable)

## Security Considerations

### Authentication & Authorization
- Only video owner can edit their videos
- JWT validation on all edit endpoints
- Rate limiting: Max 10 edits per video per day
- Rate limiting: Max 5 preview generations per video per day

### Data Protection
- Encrypt video backups at rest in R2
- Secure audio track uploads (virus scanning)
- Validate edit parameters (prevent injection attacks)
- Audit log for all edit operations

### Attack Vectors & Mitigations

| Attack Vector | Risk | Mitigation |
|---------------|------|------------|
| Malicious audio file upload | High | File type validation, size limits, virus scanning |
| FFmpeg command injection | Critical | Parameterized FFmpeg commands, no user input in commands |
| Resource exhaustion (large edits) | Medium | Video length limits, queue rate limiting |
| Preview bombing | Low | Rate limiting, preview expiration |
| Backup manipulation | Medium | Immutable backups (write-once), access control |

## Cost Analysis

### Monthly Cost Estimate (1,000 edits/month)

**Cloudflare Workers**:
- Processor worker CPU time: ~$50/month (5 min avg per edit)
- Queue messages: Included
- R2 operations: ~$5/month

**R2 Storage**:
- Video backups: 1,000 videos × 500MB × $0.015/GB = $7.50/month
- Audio tracks: 200 tracks × 5MB × $0.015/GB = $0.015/month
- Edit previews: 100 GB × $0.015/GB = $1.50/month (auto-deleted daily)

**Bunny.net**:
- Video transcoding: ~$260/month (see Re-encoding Strategy)
- Storage: ~$15/month (edited videos)

**External Services** (if using external FFmpeg):
- FFmpeg service (Coconut/Zencoder): ~$100-200/month

**Total Monthly Cost**: **$440-540/month** (1,000 edits)

**Cost per Edit**: **$0.44-0.54**

### Cost Optimization Strategies
1. Use FFmpeg.wasm for simple operations (trim/cut)
2. Reserve external service for complex operations (blur/audio)
3. Implement tiered editing (free users: 3 edits/month, paid: unlimited)
4. Compress video backups (reduce storage by 50%)
5. Auto-delete old backups (> 90 days)

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| FFmpeg processing timeout | Medium | High | Use external service with no timeout |
| Quality degradation from re-encoding | High | Medium | Use codec copy when possible, high CRF values |
| High processing costs | Medium | High | Implement cost caps, tiered editing limits |
| Bunny.net API rate limits | Low | Medium | Implement retry logic, queue throttling |
| Large video memory issues | Medium | Medium | Stream processing, chunk-based editing |
| User overwrites good edit with bad | Low | Low | Versioning, multiple undo levels |

## Future Enhancements

### Phase 2 Features (Post-MVP)
1. **Face Detection & Auto-Blur**
   - Use AI model to detect faces automatically
   - Track faces across frames (blur follows face)
   - Toggle faces on/off individually

2. **Advanced Blur Tracking**
   - Object tracking (blur follows moving objects)
   - License plate detection and auto-blur
   - Text detection and auto-blur (phone numbers, addresses)

3. **Multi-Track Audio Editor**
   - Multiple audio tracks (background music + voice-over)
   - Audio effects (fade in/out, equalization)
   - Audio waveform visualization with editing

4. **Text Overlays & Captions**
   - Add text overlays at specific timestamps
   - Subtitle editor (create/edit subtitles in editor)
   - Lower-thirds for speaker names

5. **Transition Effects**
   - Fade in/out at start/end
   - Dissolve transitions between cut segments
   - Custom transition library

### Phase 3 Features (Advanced)
6. **Collaborative Editing**
   - Multiple users can suggest edits
   - Approval workflow for edit requests
   - Real-time collaboration (like Google Docs)

7. **AI-Powered Features**
   - Auto-detect and remove filler words ("um", "uh")
   - Auto-detect and remove silence/pauses
   - Auto-generate video chapters from content
   - Smart crop (auto-detect important areas)

8. **Template Library**
   - Intro/outro templates
   - Lower-thirds templates
   - Custom transitions
   - Islamic-themed overlays (Bismillah, Alhamdulillah)

9. **Batch Editing**
   - Apply same edit to multiple videos
   - Bulk trim/blur operations
   - Series-wide consistency (same intro/outro)

10. **Advanced Export Options**
    - Export to different formats (MP4, WebM, MKV)
    - Export specific segments only
    - Export with custom resolution/bitrate
    - Export for social media (Instagram, TikTok formats)

## Appendix

### A. FFmpeg Command Reference

**Trim Video (No Re-encoding)**:
```bash
ffmpeg -i input.mp4 -ss 00:00:10 -to 00:02:00 -c copy output.mp4
# Trim from 10 seconds to 2 minutes
```

**Cut Middle Segment**:
```bash
# Create two segments and concatenate
ffmpeg -i input.mp4 -t 30 -c copy part1.mp4
ffmpeg -i input.mp4 -ss 60 -c copy part2.mp4
ffmpeg -f concat -i filelist.txt -c copy output.mp4
```

**Blur Region (Stationary)**:
```bash
ffmpeg -i input.mp4 -vf "boxblur=10:1:enable='between(t,10,20)'" -c:a copy output.mp4
# Blur entire frame from 10-20 seconds
```

**Blur Specific Region**:
```bash
ffmpeg -i input.mp4 -filter_complex \
  "[0:v]crop=100:100:50:50,boxblur=10[blurred]; \
   [0:v][blurred]overlay=50:50:enable='between(t,10,20)'" \
  output.mp4
# Blur 100x100 region at position (50,50) from 10-20 seconds
```

**Replace Audio**:
```bash
ffmpeg -i video.mp4 -i audio.mp3 -c:v copy -map 0:v:0 -map 1:a:0 output.mp4
```

**Mix Audio Tracks**:
```bash
ffmpeg -i video.mp4 -i music.mp3 \
  -filter_complex "[0:a]volume=0.5[a1];[1:a]volume=1.0[a2];[a1][a2]amix=inputs=2[aout]" \
  -map 0:v -map "[aout]" output.mp4
# Mix video audio (50%) with music (100%)
```

### B. Bunny.net Stream API Reference

**Get Video Info**:
```bash
GET https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}
Authorization: AccessKey {api_key}
```

**Upload Video (Direct)**:
```bash
PUT https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}
Authorization: AccessKey {api_key}
Content-Type: application/octet-stream

<binary video data>
```

**Create Video**:
```bash
POST https://video.bunnycdn.com/library/{libraryId}/videos
Authorization: AccessKey {api_key}
Content-Type: application/json

{
  "title": "Edited Video"
}
```

### C. Error Codes

| Code | Description | User Action |
|------|-------------|------------|
| VE001 | Invalid edit parameters | Check edit parameters format |
| VE002 | Video not found | Verify video exists |
| VE003 | Unauthorized | Must be video owner |
| VE004 | Video currently processing | Wait for current edit to complete |
| VE005 | FFmpeg processing failed | Try again or contact support |
| VE006 | Video too long for editing | Videos > 2 hours not supported |
| VE007 | Preview generation limit reached | Max 5 previews per day |
| VE008 | Edit limit reached | Max 10 edits per day |
| VE009 | Audio file too large | Max 100MB audio files |
| VE010 | Original video backup not found | Cannot revert without backup |

### D. Sample API Requests

```bash
# Generate preview for trim edit
curl -X POST https://api.alummahnow.net/api/videos/abc123/edit/preview \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "editType": "trim",
    "parameters": {
      "trimStart": 10,
      "trimEnd": 120
    },
    "quality": "low"
  }'

# Apply blur edit
curl -X POST https://api.alummahnow.net/api/videos/abc123/edit/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "editType": "blur",
    "parameters": {
      "blurRegions": [
        {
          "x": 0.3,
          "y": 0.2,
          "width": 0.15,
          "height": 0.2,
          "startTime": 30,
          "endTime": 45,
          "blurIntensity": 80
        }
      ]
    }
  }'

# Check edit status
curl https://api.alummahnow.net/api/videos/abc123/edit/status?jobId=edit-xyz789 \
  -H "Authorization: Bearer $TOKEN"

# Revert to original
curl -X POST https://api.alummahnow.net/api/videos/abc123/edit/revert \
  -H "Authorization: Bearer $TOKEN"
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-20 | System Architect | Initial implementation plan |

---

## Sign-off

- [ ] Technical Lead Approval
- [ ] Product Manager Approval
- [ ] Security Review
- [ ] DevOps Review
- [ ] Cost Analysis Review

**Next Steps**: Review plan → Evaluate FFmpeg service options → Create implementation tasks → Begin Phase 1

---

## References

- YouTube Feature Comparison: `docs/YOUTUBE_FEATURE_COMPARISON.md` (#34)
- Existing Implementation Pattern: `docs/features/01-scheduled-publishing.md`
- Bunny.net Stream API: `apps/api-videos/src/lib/bunny/stream.ts`
- Processor Worker: `apps/processor/README.md`
- Video Types: `packages/shared-types/src/video.ts`
