# Feature Implementation Plan: Trim During Upload

**Feature ID**: #35
**Priority**: MEDIUM (Phase 3)
**Complexity**: MEDIUM (1-2 weeks)
**Status**: Planning

---

## Table of Contents

1. [Overview](#overview)
2. [Requirements Analysis](#requirements-analysis)
3. [Architecture Decision](#architecture-decision)
4. [Technical Design](#technical-design)
5. [Implementation Plan](#implementation-plan)
6. [Files to Create/Modify](#files-to-createmodify)
7. [Testing Strategy](#testing-strategy)
8. [Performance Considerations](#performance-considerations)
9. [Risks and Mitigations](#risks-and-mitigations)
10. [Future Enhancements](#future-enhancements)

---

## Overview

### What is Trim During Upload?

Allow creators to trim the beginning and/or end of their video **before** uploading to the server, reducing upload time, processing costs, and storage requirements.

**User Story:**
> As a content creator, I want to cut unwanted footage from the start and end of my video before uploading, so that I save time on upload and don't waste bandwidth on content I'll eventually delete anyway.

### Key Benefits

1. **Faster Uploads**: Smaller file size = faster transfer
2. **Cost Savings**: Less bandwidth, storage, and processing
3. **Better UX**: Users see exactly what will be published
4. **Workflow Efficiency**: No need for post-upload editing

### Scope

**IN SCOPE:**
- Client-side video preview with playback controls
- Visual timeline with trim handles (start/end markers)
- Preview trimmed result before upload
- Client-side trimming using browser APIs
- Integration with existing upload flow
- Bilingual UI (English/Arabic with RTL support)

**OUT OF SCOPE (Future Enhancements):**
- Multiple trim segments (only start/end trim in v1)
- Advanced editing (filters, transitions, etc.)
- Audio-only trimming
- Subtitle track preservation
- Frame-accurate editing (second-level precision is sufficient)

---

## Requirements Analysis

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1 | User can preview uploaded video before trimming | MUST |
| FR2 | User can set trim start point (remove beginning) | MUST |
| FR3 | User can set trim end point (remove ending) | MUST |
| FR4 | User can preview trimmed result before upload | MUST |
| FR5 | Trim controls are visible on timeline scrubber | MUST |
| FR6 | Display current trim start/end times (HH:MM:SS) | MUST |
| FR7 | Trim operation preserves video quality | MUST |
| FR8 | User can reset trim selection (restore full video) | SHOULD |
| FR9 | Display trimmed file size estimate | SHOULD |
| FR10 | Trim UI works on mobile and desktop | SHOULD |
| FR11 | Support all upload-compatible video formats | MUST |
| FR12 | Bilingual labels and instructions (EN/AR) | MUST |

### Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR1 | Trim operation completes in <30 seconds for 2GB file | MUST |
| NFR2 | Preview loads in <5 seconds | MUST |
| NFR3 | UI responsive on 4G mobile connections | SHOULD |
| NFR4 | Browser memory usage <500MB for 2GB file | SHOULD |
| NFR5 | Works on Chrome 100+, Safari 15+, Firefox 100+ | MUST |
| NFR6 | No server-side processing for trim operation | MUST |
| NFR7 | Trimmed video maintains original codec/format | MUST |

### User Workflow

```
1. User selects video file (existing flow)
   ↓
2. File validation passes (existing)
   ↓
3. [NEW] Video preview loads with timeline
   ↓
4. [NEW] User drags trim handles to set start/end
   ↓
5. [NEW] User previews trimmed result (optional)
   ↓
6. [NEW] User confirms trim or resets to full video
   ↓
7. [NEW] Client-side trim operation executes
   ↓
8. User fills metadata form (existing flow)
   ↓
9. Upload proceeds with trimmed file (existing TUS flow)
```

---

## Architecture Decision

### Decision: Client-Side Trimming with MediaRecorder API

After evaluating options, we will use **client-side trimming** with the browser's **MediaRecorder API** combined with **HTMLVideoElement** for preview.

### Options Considered

#### Option 1: Server-Side Trimming (REJECTED)
**How it works:**
- Upload full video to server
- Send trim timestamps
- Server uses FFmpeg to trim video
- Return trimmed video for final upload

**Pros:**
- Accurate frame-level trimming
- Works on all devices
- No client-side performance issues

**Cons:**
- ❌ Uploads full file twice (waste of bandwidth)
- ❌ Requires server-side FFmpeg (not available on Cloudflare Workers)
- ❌ Adds latency (upload → process → download → re-upload)
- ❌ Complex error handling (what if trim fails after upload?)
- ❌ Defeats purpose of feature (reduce upload time)

#### Option 2: WebCodecs API (REJECTED for v1)
**How it works:**
- Use experimental WebCodecs API
- Decode video, skip unwanted frames, re-encode

**Pros:**
- Frame-accurate editing
- Low memory usage
- High quality output

**Cons:**
- ❌ Experimental API (limited browser support)
- ❌ Chrome 94+ only (Safari/Firefox lack support)
- ❌ Complex implementation (learning curve)
- ❌ Re-encoding quality loss possible
- ✅ Good for future enhancement (v2)

#### Option 3: FFmpeg.wasm (REJECTED for v1)
**How it works:**
- Run FFmpeg compiled to WebAssembly in browser
- Full video editing capabilities

**Pros:**
- Professional-grade trimming
- Frame-accurate
- Preserves codecs perfectly

**Cons:**
- ❌ Large bundle size (20-30 MB)
- ❌ Slow loading time
- ❌ High memory usage (1-2GB for large videos)
- ❌ CPU-intensive (freezes browser)
- ❌ Mobile device performance issues
- ✅ Good for desktop-only future version

#### **Option 4: MediaRecorder API with Blob Slicing (SELECTED) ✅**

**How it works:**
1. Load video into HTMLVideoElement
2. Seek to trim start point
3. Use MediaRecorder to capture video stream from start → end
4. Save captured stream as new Blob
5. Upload trimmed Blob via existing TUS flow

**Pros:**
- ✅ Wide browser support (all modern browsers)
- ✅ No external libraries (native API)
- ✅ Reasonably fast (real-time playback speed)
- ✅ Low memory usage (streaming approach)
- ✅ Works on mobile devices
- ✅ No re-encoding (codec passthrough in most cases)
- ✅ Simple implementation

**Cons:**
- ⚠️ Not frame-accurate (1-2 second precision)
- ⚠️ May re-encode video (slight quality loss possible)
- ⚠️ Limited format support (browser-dependent)
- ⚠️ Trim time = (end - start) playback duration

**Mitigation for cons:**
- Second-level precision is acceptable for most use cases (removing intros/outros)
- Quality loss minimal with modern codecs
- We already validate video formats on upload
- Show progress indicator during trim operation

**Why This is Best for v1:**
- Balances functionality with implementation complexity
- Works cross-platform (mobile + desktop)
- No bundle bloat
- Fast enough for reasonable trim durations (<10 min trim = <10 min processing)
- Can upgrade to WebCodecs/FFmpeg.wasm in v2 if needed

---

## Technical Design

### Component Architecture

```
┌──────────────────────────────────────────────────────┐
│  VideoUpload Component (existing)                     │
│  - File selection                                     │
│  - Drag & drop                                        │
│  - File validation                                    │
└────────────────┬─────────────────────────────────────┘
                 │
                 │ File selected
                 ▼
┌──────────────────────────────────────────────────────┐
│  [NEW] VideoTrimmer Component                         │
│  ┌────────────────────────────────────────────────┐  │
│  │  Video Preview (HTMLVideoElement)              │  │
│  │  - Play/Pause controls                         │  │
│  │  - Seek bar                                    │  │
│  │  - Current time display                        │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  Trim Timeline (TrimTimeline Component)        │  │
│  │  ├── Start Handle (draggable)                  │  │
│  │  ├── Active Region (highlighted)               │  │
│  │  ├── End Handle (draggable)                    │  │
│  │  └── Time Labels (00:00 → duration)            │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  Trim Controls                                  │  │
│  │  - "Preview Trim" button                       │  │
│  │  - "Reset" button                              │  │
│  │  - "Confirm Trim" button                       │  │
│  │  - Trimmed size estimate                       │  │
│  └────────────────────────────────────────────────┘  │
└────────────────┬─────────────────────────────────────┘
                 │
                 │ User confirms trim
                 ▼
┌──────────────────────────────────────────────────────┐
│  [NEW] useTrimVideo Hook                              │
│  - trimVideo(file, startTime, endTime)                │
│  - Returns: trimmedBlob                               │
│  - Uses MediaRecorder API                             │
└────────────────┬─────────────────────────────────────┘
                 │
                 │ Trimmed Blob ready
                 ▼
┌──────────────────────────────────────────────────────┐
│  VideoUpload Metadata Form (existing)                 │
│  - Title, description, tags                           │
│  - Privacy settings                                   │
│  - Uses trimmed Blob for upload                       │
└────────────────┬─────────────────────────────────────┘
                 │
                 │ Upload starts
                 ▼
┌──────────────────────────────────────────────────────┐
│  TUS Upload Flow (existing - no changes)              │
│  - Initiates with trimmed file                        │
│  - Progress tracking                                  │
│  - Completion                                         │
└──────────────────────────────────────────────────────┘
```

### Data Flow

```typescript
// 1. File selection (existing)
const file: File = selectedFile;

// 2. Load video for preview
const videoUrl = URL.createObjectURL(file);
const videoElement = new HTMLVideoElement();
videoElement.src = videoUrl;

// 3. User sets trim points
const trimState = {
  startTime: 10,     // seconds
  endTime: 120,      // seconds
  duration: 110      // endTime - startTime
};

// 4. Trim operation (MediaRecorder API)
const trimmedBlob = await trimVideo(file, trimState.startTime, trimState.endTime);

// 5. Convert Blob to File for upload
const trimmedFile = new File([trimmedBlob], file.name, { type: file.type });

// 6. Proceed with existing upload flow
uploadVideo(trimmedFile, metadata);
```

### Core Algorithm: Video Trimming with MediaRecorder

```typescript
async function trimVideo(
  file: File,
  startTime: number,
  endTime: number,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  // 1. Create video element
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.muted = true; // Required for autoplay

  // 2. Wait for metadata to load
  await new Promise((resolve) => {
    video.onloadedmetadata = resolve;
  });

  // 3. Validate trim points
  if (startTime < 0 || endTime > video.duration || startTime >= endTime) {
    throw new Error('Invalid trim points');
  }

  // 4. Create canvas for capturing video frames
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');

  // 5. Create media stream from canvas
  const canvasStream = canvas.captureStream(30); // 30 FPS

  // 6. Get audio stream from video
  const audioContext = new AudioContext();
  const source = audioContext.createMediaElementSource(video);
  const destination = audioContext.createMediaStreamDestination();
  source.connect(destination);

  // 7. Combine video and audio streams
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks()
  ]);

  // 8. Create MediaRecorder
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType: 'video/webm;codecs=vp8,opus', // Widely supported
    videoBitsPerSecond: 5000000 // 5 Mbps
  });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // 9. Seek to start time and begin recording
  video.currentTime = startTime;

  await new Promise((resolve) => {
    video.onseeked = resolve;
  });

  recorder.start();
  video.play();

  // 10. Capture frames to canvas while playing
  const captureFrame = () => {
    if (video.currentTime >= endTime) {
      recorder.stop();
      video.pause();
      return;
    }

    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Report progress
    const progress = ((video.currentTime - startTime) / (endTime - startTime)) * 100;
    onProgress?.(progress);

    requestAnimationFrame(captureFrame);
  };

  requestAnimationFrame(captureFrame);

  // 11. Wait for recording to complete
  const trimmedBlob = await new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
  });

  // 12. Cleanup
  URL.revokeObjectURL(video.src);
  audioContext.close();

  return trimmedBlob;
}
```

### UI Component Structure

#### VideoTrimmer Component

```typescript
interface VideoTrimmerProps {
  file: File;
  onTrimComplete: (trimmedFile: File) => void;
  onCancel: () => void;
  locale: 'en' | 'ar';
}

interface TrimState {
  startTime: number;  // seconds
  endTime: number;    // seconds
  duration: number;   // video duration
  isTrimming: boolean;
  trimProgress: number; // 0-100
  previewMode: 'full' | 'trimmed'; // Toggle preview
}

const VideoTrimmer: React.FC<VideoTrimmerProps> = ({
  file,
  onTrimComplete,
  onCancel,
  locale
}) => {
  const [trimState, setTrimState] = useState<TrimState>({
    startTime: 0,
    endTime: 0,
    duration: 0,
    isTrimming: false,
    trimProgress: 0,
    previewMode: 'full'
  });

  const videoRef = useRef<HTMLVideoElement>(null);

  // Initialize video preview
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.src = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      setTrimState(prev => ({
        ...prev,
        duration: video.duration,
        endTime: video.duration
      }));
    };

    return () => {
      URL.revokeObjectURL(video.src);
    };
  }, [file]);

  const handleTrim = async () => {
    setTrimState(prev => ({ ...prev, isTrimming: true, trimProgress: 0 }));

    try {
      const trimmedBlob = await trimVideo(
        file,
        trimState.startTime,
        trimState.endTime,
        (progress) => {
          setTrimState(prev => ({ ...prev, trimProgress: progress }));
        }
      );

      const trimmedFile = new File([trimmedBlob], file.name, { type: trimmedBlob.type });
      onTrimComplete(trimmedFile);
    } catch (error) {
      console.error('Trim failed:', error);
      // Show error to user
    } finally {
      setTrimState(prev => ({ ...prev, isTrimming: false }));
    }
  };

  // Render timeline, controls, etc.
  return (
    <div>
      <VideoPreview videoRef={videoRef} />
      <TrimTimeline
        duration={trimState.duration}
        startTime={trimState.startTime}
        endTime={trimState.endTime}
        onStartChange={(time) => setTrimState(prev => ({ ...prev, startTime: time }))}
        onEndChange={(time) => setTrimState(prev => ({ ...prev, endTime: time }))}
      />
      <TrimControls
        onTrim={handleTrim}
        onReset={() => setTrimState(prev => ({ ...prev, startTime: 0, endTime: prev.duration }))}
        onCancel={onCancel}
        isTrimming={trimState.isTrimming}
        trimProgress={trimState.trimProgress}
        locale={locale}
      />
    </div>
  );
};
```

#### TrimTimeline Component

```typescript
interface TrimTimelineProps {
  duration: number;      // Video duration in seconds
  startTime: number;     // Current trim start
  endTime: number;       // Current trim end
  onStartChange: (time: number) => void;
  onEndChange: (time: number) => void;
}

const TrimTimeline: React.FC<TrimTimelineProps> = ({
  duration,
  startTime,
  endTime,
  onStartChange,
  onEndChange
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | null>(null);

  const handleMouseDown = (handle: 'start' | 'end') => {
    setIsDragging(handle);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    const time = percent * duration;

    if (isDragging === 'start') {
      onStartChange(Math.min(time, endTime - 1)); // Ensure start < end
    } else {
      onEndChange(Math.max(time, startTime + 1)); // Ensure end > start
    }
  };

  const handleMouseUp = () => {
    setIsDragging(null);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  const startPercent = (startTime / duration) * 100;
  const endPercent = (endTime / duration) * 100;

  return (
    <div ref={timelineRef} className="relative h-16 bg-gray-200 rounded">
      {/* Inactive regions */}
      <div className="absolute inset-y-0 left-0 bg-gray-400 opacity-50"
           style={{ width: `${startPercent}%` }} />
      <div className="absolute inset-y-0 right-0 bg-gray-400 opacity-50"
           style={{ width: `${100 - endPercent}%` }} />

      {/* Active region */}
      <div className="absolute inset-y-0 bg-blue-500"
           style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }} />

      {/* Start handle */}
      <div
        className="absolute top-0 bottom-0 w-2 bg-blue-700 cursor-ew-resize"
        style={{ left: `${startPercent}%` }}
        onMouseDown={() => handleMouseDown('start')}
      >
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 bg-blue-700 text-white text-xs px-1 rounded">
          {formatTime(startTime)}
        </div>
      </div>

      {/* End handle */}
      <div
        className="absolute top-0 bottom-0 w-2 bg-blue-700 cursor-ew-resize"
        style={{ left: `${endPercent}%` }}
        onMouseDown={() => handleMouseDown('end')}
      >
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 bg-blue-700 text-white text-xs px-1 rounded">
          {formatTime(endTime)}
        </div>
      </div>
    </div>
  );
};
```

---

## Implementation Plan

### Phase 1: Core Components (Week 1)

#### Task 1.1: Create useTrimVideo Hook
**File**: `apps/web/src/hooks/useTrimVideo.ts`

**Deliverables:**
- Implement MediaRecorder-based trimming function
- Handle audio/video stream capture
- Progress callback support
- Error handling (invalid times, unsupported formats)
- Cleanup on unmount

**Acceptance Criteria:**
- ✅ Trims video from startTime to endTime
- ✅ Returns Blob with correct MIME type
- ✅ Reports progress via callback
- ✅ Handles errors gracefully
- ✅ No memory leaks

---

#### Task 1.2: Create TrimTimeline Component
**File**: `apps/web/src/components/videoUpload/TrimTimeline.tsx`

**Deliverables:**
- Visual timeline with draggable handles
- Start/end time displays
- Active/inactive region highlighting
- Keyboard support (arrow keys to adjust)
- Touch support for mobile

**Acceptance Criteria:**
- ✅ Handles can be dragged smoothly
- ✅ Start handle cannot exceed end handle
- ✅ Time labels update in real-time
- ✅ Works on mobile (touch events)
- ✅ Bilingual time formatting

---

#### Task 1.3: Create VideoTrimmer Component
**File**: `apps/web/src/components/videoUpload/VideoTrimmer.tsx`

**Deliverables:**
- Video preview with HTMLVideoElement
- Play/pause controls
- Seek bar integration with trim points
- Preview mode toggle (full vs trimmed)
- Trim operation UI with progress

**Acceptance Criteria:**
- ✅ Video loads and plays correctly
- ✅ Playback respects trim boundaries in preview mode
- ✅ Controls are accessible (keyboard + screen reader)
- ✅ RTL layout support for Arabic
- ✅ Shows trim progress during operation

---

### Phase 2: Integration (Week 2)

#### Task 2.1: Integrate with VideoUpload Component
**File**: `apps/web/src/components/videoUpload/index.tsx`

**Changes:**
1. Add "Trim Video" step between file selection and metadata form
2. Show VideoTrimmer component when user opts to trim
3. Pass trimmed file to upload flow
4. Add "Skip Trimming" option for users who want full video
5. Update state management to handle trimmed vs original file

**Acceptance Criteria:**
- ✅ User can choose to trim or skip
- ✅ Trimmed file uploads correctly via TUS
- ✅ Original file preserved if user cancels trim
- ✅ Smooth transition between steps
- ✅ Progress indicators clear

---

#### Task 2.2: Add i18n Translations
**Files**:
- `apps/web/src/locales/en/upload.json`
- `apps/web/src/locales/ar/upload.json`

**New Translation Keys:**
```json
{
  "upload": {
    "trimVideo": "Trim Video",
    "skipTrimming": "Skip Trimming",
    "trimStart": "Trim Start",
    "trimEnd": "Trim End",
    "previewTrim": "Preview Trim",
    "confirmTrim": "Confirm Trim",
    "resetTrim": "Reset Trim",
    "trimming": "Trimming video...",
    "trimProgress": "Trim Progress",
    "trimmedSize": "Trimmed Size",
    "originalSize": "Original Size",
    "timeSaved": "Time Saved",
    "trimInstructions": "Drag the handles to select the portion of video you want to keep. Everything outside will be removed.",
    "trimCompleted": "Video trimmed successfully",
    "trimFailed": "Failed to trim video. Please try again."
  }
}
```

**Acceptance Criteria:**
- ✅ All UI text translated to English and Arabic
- ✅ RTL-appropriate labels for Arabic
- ✅ Error messages localized

---

#### Task 2.3: File Size Estimation
**File**: `apps/web/src/lib/utils/videoUtils.ts`

**Deliverables:**
- Calculate estimated trimmed file size
- Display size comparison (original vs trimmed)
- Show estimated upload time saved

**Algorithm:**
```typescript
function estimateTrimmedSize(
  originalSize: number,
  originalDuration: number,
  trimmedDuration: number
): number {
  // Assume linear bitrate (close enough for estimates)
  return Math.floor((originalSize / originalDuration) * trimmedDuration);
}
```

**Acceptance Criteria:**
- ✅ Estimation within 10% of actual trimmed size
- ✅ Updates in real-time as user adjusts handles
- ✅ Formatted in readable units (MB/GB)

---

### Phase 3: Polish & Testing (Week 2)

#### Task 3.1: Add Keyboard Shortcuts
**File**: `apps/web/src/components/videoUpload/VideoTrimmer.tsx`

**Shortcuts:**
- `Space` - Play/Pause preview
- `Left Arrow` - Move start handle -1 second
- `Right Arrow` - Move start handle +1 second
- `Shift + Left Arrow` - Move end handle -1 second
- `Shift + Right Arrow` - Move end handle +1 second
- `R` - Reset trim to full video
- `Enter` - Confirm trim

**Acceptance Criteria:**
- ✅ All shortcuts work as expected
- ✅ Shortcuts documented in UI (tooltip or help text)
- ✅ No conflicts with browser shortcuts

---

#### Task 3.2: Error Handling & Edge Cases
**File**: `apps/web/src/hooks/useTrimVideo.ts`

**Cases to Handle:**
1. Browser doesn't support MediaRecorder
2. Video format not supported
3. Trim duration too long (>30 min)
4. Out of memory during trim
5. User cancels mid-trim
6. Invalid trim points (start > end)

**Acceptance Criteria:**
- ✅ Graceful fallback messages
- ✅ User can retry or skip trimming
- ✅ No crashes or frozen UI

---

#### Task 3.3: Mobile Optimization
**Files**: All VideoTrimmer-related components

**Optimizations:**
1. Touch-friendly handle sizes (min 44x44px)
2. Prevent page scroll while dragging
3. Show mobile-specific instructions
4. Disable trim for very large files on mobile (>1GB)

**Acceptance Criteria:**
- ✅ Timeline handles easy to drag on mobile
- ✅ No accidental page scrolls
- ✅ Clear mobile UI guidance

---

## Files to Create/Modify

### New Files to Create

```
apps/web/src/
├── components/
│   └── videoUpload/
│       ├── VideoTrimmer.tsx           # Main trimmer component (300 lines)
│       ├── TrimTimeline.tsx           # Timeline with draggable handles (200 lines)
│       └── TrimControls.tsx           # Buttons and progress (100 lines)
├── hooks/
│   └── useTrimVideo.ts                # MediaRecorder trimming logic (250 lines)
└── lib/
    └── utils/
        └── videoUtils.ts              # Helper functions (size estimation, etc.) (100 lines)
```

### Files to Modify

```
apps/web/src/
├── components/
│   └── videoUpload/
│       └── index.tsx                  # Add trimming step (+150 lines)
├── locales/
│   ├── en/
│   │   └── upload.json               # Add trim-related translations (+20 keys)
│   └── ar/
│       └── upload.json               # Add Arabic translations (+20 keys)
└── lib/
    └── constants/
        └── uploadConfig.ts           # Add trim-related config (+10 lines)
```

### Configuration Changes

**apps/web/src/lib/constants/uploadConfig.ts**
```typescript
export const VIDEO_TRIM_CONFIG = {
  MAX_TRIM_DURATION: 30 * 60, // 30 minutes max trim length
  MIN_TRIM_DURATION: 1,        // 1 second minimum
  PREVIEW_FPS: 30,             // Preview capture frame rate
  OUTPUT_BITRATE: 5000000,     // 5 Mbps
  SUPPORTED_FORMATS: [
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ],
  MOBILE_MAX_FILE_SIZE: 1024 * 1024 * 1024 // 1GB trim limit on mobile
};
```

---

## Testing Strategy

### Unit Tests

**File**: `apps/web/src/hooks/__tests__/useTrimVideo.test.ts`

```typescript
describe('useTrimVideo', () => {
  it('should trim video from 10s to 30s', async () => {
    const mockFile = createMockVideoFile(60); // 60 second video
    const trimmedBlob = await trimVideo(mockFile, 10, 30);

    expect(trimmedBlob.size).toBeGreaterThan(0);
    expect(trimmedBlob.type).toBe('video/webm');
  });

  it('should throw error for invalid trim points', async () => {
    const mockFile = createMockVideoFile(60);
    await expect(trimVideo(mockFile, 50, 30)).rejects.toThrow('Invalid trim points');
  });

  it('should report progress during trim', async () => {
    const mockFile = createMockVideoFile(60);
    const progressCallback = jest.fn();

    await trimVideo(mockFile, 0, 10, progressCallback);

    expect(progressCallback).toHaveBeenCalled();
    expect(progressCallback.mock.calls[progressCallback.mock.calls.length - 1][0]).toBeGreaterThan(90);
  });
});
```

### Component Tests

**File**: `apps/web/src/components/videoUpload/__tests__/TrimTimeline.test.tsx`

```typescript
describe('TrimTimeline', () => {
  it('should render start and end handles', () => {
    render(<TrimTimeline duration={100} startTime={0} endTime={100} />);
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('01:40')).toBeInTheDocument();
  });

  it('should update start time when start handle is dragged', () => {
    const onStartChange = jest.fn();
    render(<TrimTimeline onStartChange={onStartChange} />);

    // Simulate drag event
    const startHandle = screen.getByTestId('start-handle');
    fireEvent.mouseDown(startHandle);
    fireEvent.mouseMove(window, { clientX: 100 });
    fireEvent.mouseUp(window);

    expect(onStartChange).toHaveBeenCalled();
  });
});
```

### Integration Tests

**File**: `apps/web/src/components/videoUpload/__tests__/VideoUpload.integration.test.tsx`

```typescript
describe('VideoUpload with Trim', () => {
  it('should allow user to trim video before upload', async () => {
    const mockFile = createMockVideoFile(60);
    const onUploadComplete = jest.fn();

    render(<VideoUpload onUploadComplete={onUploadComplete} />);

    // Select file
    const fileInput = screen.getByLabelText('Select video file');
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // Wait for trim UI to appear
    await waitFor(() => {
      expect(screen.getByText('Trim Video')).toBeInTheDocument();
    });

    // Set trim points
    const timeline = screen.getByTestId('trim-timeline');
    // ... simulate trim handle drag ...

    // Confirm trim
    const confirmButton = screen.getByText('Confirm Trim');
    fireEvent.click(confirmButton);

    // Wait for trim to complete
    await waitFor(() => {
      expect(screen.getByText('Trimmed successfully')).toBeInTheDocument();
    });

    // Proceed to upload
    const uploadButton = screen.getByText('Upload');
    fireEvent.click(uploadButton);

    // Verify upload called with trimmed file
    await waitFor(() => {
      expect(onUploadComplete).toHaveBeenCalled();
    });
  });
});
```

### Manual Testing Checklist

#### Desktop (Chrome/Firefox/Safari)

- [ ] Video preview loads correctly
- [ ] Timeline handles drag smoothly
- [ ] Trim start/end times update in real-time
- [ ] Preview mode shows only trimmed portion
- [ ] Trim operation completes without errors
- [ ] Progress indicator accurate
- [ ] Trimmed file uploads successfully
- [ ] File size estimate within 10% of actual
- [ ] Keyboard shortcuts work
- [ ] Reset button restores full video
- [ ] Cancel returns to file selection
- [ ] Dark mode displays correctly
- [ ] Arabic (RTL) layout correct

#### Mobile (iOS Safari, Android Chrome)

- [ ] Touch handles are large enough (44x44px)
- [ ] Timeline dragging doesn't scroll page
- [ ] Video preview plays on mobile
- [ ] Trim operation doesn't crash on large files
- [ ] Mobile-specific warnings shown
- [ ] Upload proceeds correctly after trim
- [ ] Performance acceptable on 4G connection

#### Edge Cases

- [ ] Very short video (<10 seconds)
- [ ] Very long video (>1 hour)
- [ ] Large file (1.9 GB)
- [ ] Trim entire video (start=0, end=duration) → should show warning
- [ ] Trim 1 second → should work
- [ ] Browser refresh during trim → should recover gracefully
- [ ] Out of memory → should show error

---

## Performance Considerations

### Benchmarks (Target)

| Scenario | Target | Method |
|----------|--------|--------|
| Load 2GB video for preview | <5s | Use blob URL, not decode entire file |
| Trim 1-minute segment | <90s | Real-time playback + encoding overhead |
| Trim 10-minute segment | <12min | Real-time playback + encoding overhead |
| Memory usage during trim | <500MB | Streaming approach, not in-memory buffer |

### Optimizations

1. **Lazy Video Loading**
   - Don't decode entire video upfront
   - Use blob URL for preview
   - Load only necessary metadata

2. **Canvas Optimization**
   - Match canvas resolution to video resolution
   - Don't upscale if video is small

3. **Stream Processing**
   - Use MediaRecorder's streaming mode
   - Avoid buffering entire trimmed video in memory
   - Write chunks to Blob incrementally

4. **Mobile Throttling**
   - Limit trim duration on mobile (<10 minutes)
   - Reduce output bitrate on mobile
   - Show warning for large files

5. **Worker Thread (Future Enhancement)**
   - Offload trimming to Web Worker
   - Keep UI responsive during long trims

---

## Risks and Mitigations

### Risk 1: Browser Compatibility

**Issue**: MediaRecorder API not supported in older browsers

**Impact**: HIGH
**Probability**: MEDIUM (Safari <14, Chrome <47)

**Mitigation**:
- Feature detection: Check `if (typeof MediaRecorder === 'undefined')`
- Show friendly message: "Trim feature requires modern browser"
- Fallback: Allow user to skip trimming and upload full video
- Display browser upgrade prompt

---

### Risk 2: Quality Loss from Re-encoding

**Issue**: MediaRecorder may re-encode video, causing quality degradation

**Impact**: MEDIUM
**Probability**: HIGH (depends on codec support)

**Mitigation**:
- Use high bitrate (5 Mbps default)
- Allow user to preview trimmed result before upload
- Document expected quality in help text
- Future: Upgrade to WebCodecs for lossless trimming

---

### Risk 3: Long Trim Times

**Issue**: Trimming 30-minute segment takes 30+ minutes (real-time playback)

**Impact**: MEDIUM
**Probability**: HIGH

**Mitigation**:
- Show clear progress indicator with time estimate
- Allow user to cancel mid-trim
- Suggest trimming shorter segments
- Future: Use FFmpeg.wasm for faster processing (5x real-time)

---

### Risk 4: Memory Issues on Mobile

**Issue**: Large video files cause out-of-memory errors on mobile

**Impact**: HIGH
**Probability**: MEDIUM

**Mitigation**:
- Limit trim duration on mobile (10 minutes max)
- Disable trim for files >1GB on mobile
- Show device-specific warnings
- Monitor memory usage during development

---

### Risk 5: Format Compatibility

**Issue**: Some video formats not supported by MediaRecorder

**Impact**: MEDIUM
**Probability**: LOW (most uploads are MP4/MOV)

**Mitigation**:
- Check format before showing trim UI
- Fallback to full video upload if format unsupported
- Document supported formats in help text
- Future: Add format conversion step

---

## Future Enhancements

### v2 Features (Post-MVP)

1. **Multiple Trim Segments**
   - Remove multiple sections (intro, outro, mid-roll ads)
   - Visual timeline with multi-segment support
   - Complexity: HIGH

2. **WebCodecs API Integration**
   - Frame-accurate trimming
   - Faster processing (5x real-time)
   - No quality loss
   - Requires Chrome 94+ (no Safari/Firefox)

3. **FFmpeg.wasm for Desktop**
   - Professional-grade editing
   - Desktop-only (too slow on mobile)
   - Large bundle size (30MB)
   - Frame-accurate, lossless

4. **Thumbnail Preview Strips**
   - Show thumbnail preview on timeline
   - Generate thumbnails at 10-second intervals
   - Helps users find exact trim points

5. **Saved Trim Presets**
   - "Remove first 10 seconds" preset
   - "Remove last 5 seconds" preset
   - User-defined presets

6. **Audio-Only Trimming**
   - Trim audio tracks separately
   - Useful for podcasts/lectures

7. **Subtitle Track Preservation**
   - Parse and adjust subtitle timestamps
   - Re-sync subtitles to trimmed video

8. **Server-Side Fallback**
   - If client-side fails, upload full video
   - Server trims using FFmpeg
   - Slower but more reliable

---

## Appendix

### Browser API Documentation

- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [HTMLVideoElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement)
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Blob API](https://developer.mozilla.org/en-US/docs/Web/API/Blob)

### Related YouTube Features

From `docs/YOUTUBE_FEATURE_COMPARISON.md`:

> **30. Trim During Upload**: Cut start/end before processing
> - Impact: MEDIUM
> - What YouTube Has:
>   - Trim video during upload flow
>   - Preview trimmed result
>   - Save processing time and costs
>   - Simple timeline editor
> - What Al Ummah Now Has: None

### Dependencies

**New Dependencies**: NONE (uses browser APIs only)

**Existing Dependencies Used**:
- `react` - UI framework
- `lucide-react` - Icons (scissors icon for trim button)
- `tus-js-client` - Upload trimmed file (existing)

### Success Metrics

After deployment, track:

1. **Adoption Rate**
   - % of uploads that use trim feature
   - Target: 30% within 3 months

2. **Bandwidth Savings**
   - Average % file size reduction
   - Total GB saved per month
   - Target: 15% average reduction

3. **User Satisfaction**
   - Survey: "Did trim feature save you time?"
   - Target: 80% positive responses

4. **Technical Metrics**
   - Average trim operation time
   - Error rate (failed trims)
   - Browser compatibility issues

---

## Changelog

**Version 1.0** (2025-01-20):
- Initial implementation plan created
- Architecture decision: MediaRecorder API
- Detailed technical design
- 2-week implementation timeline
- Testing strategy defined

---

## Approval

**Created by**: System Architect
**Date**: 2025-01-20
**Status**: Awaiting Review

**Reviewers**:
- [ ] Lead Developer (Implementation feasibility)
- [ ] UX Designer (User experience review)
- [ ] Product Manager (Feature priority confirmation)
- [ ] DevOps (Performance/deployment impact)

**Next Steps**:
1. Review this plan with development team
2. Confirm 2-week timeline is acceptable
3. Prioritize against other Phase 3 features
4. Approve for implementation or request changes

---

**End of Document**
