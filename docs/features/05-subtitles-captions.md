# Subtitle/Closed Captions Implementation Plan

**Document Version**: 1.0
**Last Updated**: 2025-01-20
**Priority**: CRITICAL ⭐⭐⭐⭐⭐
**Estimated Effort**: 4 weeks (2 developers)
**Impact**: Accessibility + SEO + International reach

---

## Executive Summary

This document provides a comprehensive implementation plan for adding subtitle/closed caption support to Al Ummah Now. The feature will enable content creators to upload subtitle files, support multiple languages, provide manual caption editing, and integrate seamlessly with the video player for accessibility and international reach.

**Key Benefits**:
- **Accessibility**: Support for deaf/hard-of-hearing Muslims
- **International Reach**: Enable non-native speakers to follow Arabic content
- **SEO Enhancement**: Searchable transcript text improves discovery
- **Compliance**: Meet accessibility standards (WCAG 2.1 AA)
- **Engagement**: Viewers watch videos longer with captions

---

## Table of Contents

1. [Feature Requirements](#feature-requirements)
2. [Architecture Overview](#architecture-overview)
3. [Storage Architecture](#storage-architecture)
4. [Subtitle Parser Design](#subtitle-parser-design)
5. [API Endpoints](#api-endpoints)
6. [Video Player Integration](#video-player-integration)
7. [Multi-Language Support](#multi-language-support)
8. [Technical Implementation](#technical-implementation)
9. [Files to Create/Modify](#files-to-createmodify)
10. [Testing Strategy](#testing-strategy)
11. [Third-Party Integration Options](#third-party-integration-options)
12. [Migration Plan](#migration-plan)
13. [Success Metrics](#success-metrics)

---

## Feature Requirements

### Core Requirements (Phase 1)

1. **File Upload Support**
   - Accept .srt, .vtt, .sbv subtitle files
   - Maximum file size: 1MB per subtitle file
   - Validation of subtitle format
   - Multiple subtitle tracks per video

2. **Format Support**
   - WebVTT (.vtt) - Primary format for web
   - SubRip (.srt) - Most common format
   - YouTube SubViewer (.sbv) - YouTube compatibility
   - Convert all formats to WebVTT for playback

3. **Language Support**
   - Multiple language tracks per video
   - Primary languages: Arabic, English, Urdu, French, Indonesian
   - Language codes (ISO 639-1): ar, en, ur, fr, id
   - RTL support for Arabic/Urdu subtitles

4. **Player Integration**
   - Display subtitles in Video.js player
   - Subtitle track selector UI
   - On/off toggle
   - Keyboard shortcuts (C key)

### Advanced Requirements (Phase 2)

5. **Manual Caption Editor**
   - Web-based editor UI
   - Edit timing (start/end timestamps)
   - Edit text content
   - Add/remove caption blocks
   - Preview with video playback
   - Auto-save drafts

6. **Download Capabilities**
   - Export in original format
   - Convert between formats
   - Batch download for all languages

7. **Styling Options**
   - Font size (small, medium, large)
   - Background opacity (0%, 50%, 100%)
   - Text color (white, yellow)
   - Position (bottom, top)
   - Store user preferences

### Future Enhancements (Phase 3)

8. **Auto-Generation**
   - Speech-to-text integration
   - Automatic timing generation
   - AI-powered translation

9. **Community Contributions**
   - Crowd-sourced translations
   - Review and approval workflow
   - Contributor credits

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Web Frontend                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │          Subtitle Upload Component              │   │
│  │  - File picker (.srt/.vtt/.sbv)                │   │
│  │  - Language selector                           │   │
│  │  - Upload progress                             │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Video Player (Video.js)               │   │
│  │  - TextTrack API integration                   │   │
│  │  - Subtitle menu selector                      │   │
│  │  - Styling controls                            │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │          Caption Editor (Phase 2)               │   │
│  │  - Timeline editor                             │   │
│  │  - Text editor                                 │   │
│  │  - Preview player                              │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                   API Layer (Hono)                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │         Subtitle Upload Endpoints               │   │
│  │  POST   /api/videos/{id}/subtitles             │   │
│  │  GET    /api/videos/{id}/subtitles             │   │
│  │  GET    /api/videos/{id}/subtitles/{lang}      │   │
│  │  PUT    /api/videos/{id}/subtitles/{lang}      │   │
│  │  DELETE /api/videos/{id}/subtitles/{lang}      │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Subtitle Parser Service                │   │
│  │  - Format detection                            │   │
│  │  - Validation                                  │   │
│  │  - Conversion to WebVTT                        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                    Storage Layer                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │              R2 Buckets                         │   │
│  │  - subtitles (production)                      │   │
│  │  - subtitles-preview (development)             │   │
│  │  Structure: {videoId}/{lang}.vtt               │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Metadata Storage (R2)                 │   │
│  │  - Video object: subtitles[] array             │   │
│  │  - Track metadata per subtitle                 │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│              Optional: Third-Party Services             │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Bunny.net Captions API               │   │
│  │  - Storage and delivery                        │   │
│  │  - CDN distribution                            │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │          AWS Transcribe (Future)                │   │
│  │  - Auto-generation                             │   │
│  │  - Multi-language transcription                │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Storage Architecture

### R2 Bucket Structure

**Bucket Name**: `subtitles` (production), `subtitles-preview` (development)

**Key Structure**:
```
{videoId}/
├── metadata.json         # Subtitle metadata for all tracks
├── en.vtt               # English WebVTT
├── ar.vtt               # Arabic WebVTT
├── ur.vtt               # Urdu WebVTT
├── fr.vtt               # French WebVTT
├── id.vtt               # Indonesian WebVTT
└── original/            # Original uploaded files (backup)
    ├── en.srt          # Original SRT
    ├── ar.sbv          # Original SBV
    └── ...
```

### Metadata Schema

**metadata.json**:
```typescript
interface SubtitleMetadata {
  videoId: string;
  tracks: SubtitleTrack[];
  dateCreated: string;
  dateModified: string;
}

interface SubtitleTrack {
  id: string;                    // UUID
  language: string;               // ISO 639-1 code (en, ar, ur, etc.)
  label: string;                  // Display name ("English", "العربية")
  kind: 'subtitles' | 'captions'; // subtitles vs closed captions
  isDefault?: boolean;            // Default track to show
  isAutoGenerated?: boolean;      // AI-generated flag
  uploadedBy: string;             // User ID who uploaded
  uploadedAt: string;             // ISO timestamp
  fileSize: number;               // Size in bytes
  format: 'vtt' | 'srt' | 'sbv'; // Original format
  url: string;                    // CDN URL to WebVTT file
  status: 'processing' | 'ready' | 'error';
  error?: string;                 // Error message if failed
}
```

### Video Model Extension

Update `packages/shared-types/src/video.ts`:
```typescript
export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // Subtitle support
  subtitles?: SubtitleTrack[];
  hasSubtitles?: boolean;
  subtitleLanguages?: string[]; // Quick lookup: ['en', 'ar', 'ur']
}
```

---

## Subtitle Parser Design

### Parser Service Architecture

**Location**: `apps/api-videos/src/lib/subtitles/`

```typescript
// parser.ts - Main parser interface
export interface SubtitleParser {
  parse(content: string): SubtitleData;
  validate(data: SubtitleData): ValidationResult;
  toWebVTT(data: SubtitleData): string;
}

export interface SubtitleData {
  cues: SubtitleCue[];
  metadata?: Record<string, string>;
}

export interface SubtitleCue {
  id?: string;
  startTime: number; // seconds
  endTime: number;   // seconds
  text: string;
  position?: { x: number; y: number };
  align?: 'start' | 'middle' | 'end';
  line?: number;
  size?: number;
}

// format-detector.ts
export function detectFormat(content: string): 'vtt' | 'srt' | 'sbv' | 'unknown';

// srt-parser.ts
export class SRTParser implements SubtitleParser { ... }

// vtt-parser.ts
export class VTTParser implements SubtitleParser { ... }

// sbv-parser.ts
export class SBVParser implements SubtitleParser { ... }

// converter.ts
export class SubtitleConverter {
  constructor(private parsers: Map<string, SubtitleParser>);

  convert(content: string, fromFormat: string, toFormat: string): string;
  toWebVTT(content: string, format?: string): string;
}

// validator.ts
export class SubtitleValidator {
  validateTiming(cues: SubtitleCue[]): ValidationError[];
  validateContent(cues: SubtitleCue[]): ValidationError[];
  validateFileSize(content: string): boolean;
  sanitizeText(text: string): string; // Remove harmful content
}
```

### Format Examples

**WebVTT (.vtt)**:
```vtt
WEBVTT

00:00:00.000 --> 00:00:05.000
بسم الله الرحمن الرحيم

00:00:05.000 --> 00:00:10.000
In the name of Allah, the Most Gracious, the Most Merciful
```

**SubRip (.srt)**:
```srt
1
00:00:00,000 --> 00:00:05,000
بسم الله الرحمن الرحيم

2
00:00:05,000 --> 00:00:10,000
In the name of Allah, the Most Gracious, the Most Merciful
```

**SubViewer (.sbv)**:
```sbv
0:00:00.000,0:00:05.000
بسم الله الرحمن الرحيم

0:00:05.000,0:00:10.000
In the name of Allah, the Most Gracious, the Most Merciful
```

---

## API Endpoints

### 1. Upload Subtitle Track

**POST** `/api/videos/{videoId}/subtitles`

```typescript
// Request
{
  language: string;      // ISO 639-1 code
  label?: string;        // Display name (optional)
  file: File;           // .srt, .vtt, or .sbv file
  isDefault?: boolean;  // Set as default track
}

// Response
{
  success: true,
  data: {
    track: SubtitleTrack,
    video: VideoObject // Updated with new subtitle
  }
}
```

### 2. List Subtitle Tracks

**GET** `/api/videos/{videoId}/subtitles`

```typescript
// Response
{
  success: true,
  data: {
    tracks: SubtitleTrack[],
    defaultLanguage?: string
  }
}
```

### 3. Get Specific Subtitle Track

**GET** `/api/videos/{videoId}/subtitles/{language}`

```typescript
// Query params
{
  format?: 'vtt' | 'srt' | 'sbv'; // Default: vtt
}

// Response: Raw subtitle file content
// Content-Type: text/vtt or text/plain
```

### 4. Update Subtitle Track

**PUT** `/api/videos/{videoId}/subtitles/{language}`

```typescript
// Request (for editing)
{
  cues?: SubtitleCue[];  // Updated cues
  label?: string;        // Update display name
  isDefault?: boolean;   // Update default status
}

// Response
{
  success: true,
  data: {
    track: SubtitleTrack
  }
}
```

### 5. Delete Subtitle Track

**DELETE** `/api/videos/{videoId}/subtitles/{language}`

```typescript
// Response
{
  success: true,
  message: "Subtitle track deleted"
}
```

### 6. Bulk Operations

**POST** `/api/videos/{videoId}/subtitles/bulk`

```typescript
// Request - Upload multiple subtitle files at once
{
  files: Array<{
    language: string;
    file: File;
  }>
}

// Response
{
  success: true,
  data: {
    uploaded: SubtitleTrack[],
    failed: Array<{ language: string; error: string }>
  }
}
```

---

## Video Player Integration

### Video.js TextTrack API

**Location**: `apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx`

```typescript
// Add subtitle tracks to player initialization
function initializeSubtitles(
  player: Player,
  subtitles: SubtitleTrack[]
): void {
  // Remove existing text tracks
  const tracks = player.textTracks();
  for (let i = tracks.length - 1; i >= 0; i--) {
    if (tracks[i].kind === 'subtitles' || tracks[i].kind === 'captions') {
      player.removeRemoteTextTrack(tracks[i]);
    }
  }

  // Add new subtitle tracks
  subtitles.forEach((track) => {
    player.addRemoteTextTrack({
      kind: track.kind || 'subtitles',
      src: track.url,
      srclang: track.language,
      label: track.label,
      default: track.isDefault,
    }, false); // false = don't remove on source change
  });
}

// Track subtitle usage for analytics
player.textTracks().addEventListener('change', () => {
  const tracks = player.textTracks();
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i].mode === 'showing') {
      analytics.trackSubtitleEnabled(tracks[i].language);
      break;
    }
  }
});
```

### Subtitle Menu UI

**Location**: `apps/web/src/components/VideoPlayer/SubtitleMenu.tsx`

```typescript
export function SubtitleMenu({
  tracks,
  currentTrack,
  onTrackChange,
  onStyleChange
}: SubtitleMenuProps) {
  return (
    <div className="subtitle-menu">
      {/* Language selector */}
      <select onChange={(e) => onTrackChange(e.target.value)}>
        <option value="">Off</option>
        {tracks.map(track => (
          <option key={track.language} value={track.language}>
            {track.label}
          </option>
        ))}
      </select>

      {/* Style options (Phase 2) */}
      <button onClick={() => onStyleChange('fontSize', 'large')}>
        Font Size
      </button>
      <button onClick={() => onStyleChange('background', 0.5)}>
        Background
      </button>
    </div>
  );
}
```

### Keyboard Shortcuts

Update `apps/web/src/lib/video/keyboard-shortcuts.ts`:
```typescript
// Add subtitle toggle (C key)
case 'c':
case 'C':
  toggleSubtitles(player);
  showFeedback('Subtitles: ' + (subtitlesEnabled ? 'On' : 'Off'));
  break;
```

---

## Multi-Language Support

### Language Configuration

**Supported Languages**:
```typescript
export const SUPPORTED_SUBTITLE_LANGUAGES = [
  { code: 'ar', label: 'العربية', dir: 'rtl' },
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ur', label: 'اردو', dir: 'rtl' },
  { code: 'fr', label: 'Français', dir: 'ltr' },
  { code: 'id', label: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'tr', label: 'Türkçe', dir: 'ltr' },
  { code: 'ms', label: 'Bahasa Melayu', dir: 'ltr' },
  { code: 'bn', label: 'বাংলা', dir: 'ltr' },
  { code: 'de', label: 'Deutsch', dir: 'ltr' },
  { code: 'es', label: 'Español', dir: 'ltr' },
];
```

### RTL Support for Arabic/Urdu

```css
/* Subtitle RTL styling */
.video-js .vjs-text-track-display {
  /* RTL languages */
  &[lang="ar"],
  &[lang="ur"] {
    direction: rtl;
    text-align: right;
  }
}

/* Custom RTL positioning */
.vjs-text-track-cue-rtl {
  direction: rtl;
  unicode-bidi: plaintext;
}
```

### Language Detection

```typescript
// Auto-detect subtitle language from video metadata
function getDefaultSubtitleLanguage(
  video: VideoObject,
  userPreference?: string
): string {
  // Priority order:
  // 1. User's saved preference
  if (userPreference && hasSubtitleTrack(video, userPreference)) {
    return userPreference;
  }

  // 2. Video's primary language
  if (video.language && hasSubtitleTrack(video, video.language)) {
    return video.language;
  }

  // 3. User's browser language
  const browserLang = navigator.language.split('-')[0];
  if (hasSubtitleTrack(video, browserLang)) {
    return browserLang;
  }

  // 4. First available subtitle
  return video.subtitles?.[0]?.language || '';
}
```

---

## Technical Implementation

### Phase 1: Core Subtitle Support (Week 1-2)

**Sprint 1.1: Storage and Parser (3 days)**
- [ ] Create R2 bucket configuration in wrangler.jsonc
- [ ] Implement subtitle parser service
- [ ] Add format detection and validation
- [ ] Create WebVTT converter

**Sprint 1.2: API Endpoints (3 days)**
- [ ] Implement upload endpoint with validation
- [ ] Add list/get endpoints
- [ ] Create update/delete endpoints
- [ ] Add subtitle metadata to video model

**Sprint 1.3: Player Integration (2 days)**
- [ ] Integrate TextTrack API in Video.js
- [ ] Add subtitle menu UI component
- [ ] Implement keyboard shortcuts
- [ ] Test with multiple languages

**Sprint 1.4: Upload UI (2 days)**
- [ ] Create subtitle upload component
- [ ] Add language selector
- [ ] Implement progress tracking
- [ ] Add validation feedback

### Phase 2: Advanced Features (Week 3-4)

**Sprint 2.1: Caption Editor (5 days)**
- [ ] Build timeline editor UI
- [ ] Implement cue editing (text + timing)
- [ ] Add preview player integration
- [ ] Create auto-save functionality

**Sprint 2.2: Styling Controls (2 days)**
- [ ] Add font size controls
- [ ] Implement background opacity
- [ ] Add color options
- [ ] Save user preferences

**Sprint 2.3: Download & Export (2 days)**
- [ ] Add download endpoints
- [ ] Implement format conversion
- [ ] Create batch download
- [ ] Add export UI

**Sprint 2.4: Testing & Polish (1 day)**
- [ ] End-to-end testing
- [ ] Performance optimization
- [ ] Accessibility testing
- [ ] Documentation

---

## Files to Create/Modify

### New Files to Create

**API Layer**:
```
apps/api-videos/src/
├── endpoints/
│   └── video/
│       ├── uploadSubtitles.ts      # POST endpoint
│       ├── getSubtitles.ts         # GET endpoints
│       ├── updateSubtitles.ts      # PUT endpoint
│       └── deleteSubtitles.ts      # DELETE endpoint
├── lib/
│   └── subtitles/
│       ├── parser.ts               # Main parser interface
│       ├── format-detector.ts      # Format detection
│       ├── srt-parser.ts          # SRT parser
│       ├── vtt-parser.ts          # VTT parser
│       ├── sbv-parser.ts          # SBV parser
│       ├── converter.ts           # Format converter
│       └── validator.ts           # Validation logic
```

**Frontend**:
```
apps/web/src/
├── components/
│   ├── VideoPlayer/
│   │   ├── SubtitleMenu.tsx       # Subtitle selector UI
│   │   └── SubtitleStyles.tsx     # Style controls
│   ├── SubtitleUpload/
│   │   ├── index.tsx              # Upload component
│   │   └── LanguageSelector.tsx   # Language picker
│   └── SubtitleEditor/            # Phase 2
│       ├── index.tsx              # Editor main
│       ├── Timeline.tsx           # Timeline UI
│       └── CueEditor.tsx          # Cue editing
├── lib/
│   └── api/
│       └── subtitles.ts           # API client functions
└── hooks/
    └── useSubtitles.ts            # Subtitle state management
```

### Files to Modify

**Shared Types**:
- `packages/shared-types/src/video.ts` - Add SubtitleTrack interface
- `packages/shared-types/src/index.ts` - Export subtitle types

**API Configuration**:
- `apps/api-videos/wrangler.jsonc` - Add subtitles R2 bucket
- `apps/api-videos/src/index.ts` - Register subtitle endpoints

**Video Player**:
- `apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx` - Add subtitle support
- `apps/web/src/lib/video/keyboard-shortcuts.ts` - Add C key for subtitles

**Video Upload Flow**:
- `apps/web/src/components/videoUpload/index.tsx` - Add subtitle upload section
- `apps/web/src/app/[locale]/watch/[id]/page.tsx` - Load subtitles with video

---

## Testing Strategy

### Unit Testing

**Parser Tests** (`apps/api-videos/src/lib/subtitles/__tests__/`):
```typescript
describe('SubtitleParser', () => {
  test('should parse valid SRT file', () => {
    const srt = '1\n00:00:00,000 --> 00:00:05,000\nHello World';
    const result = parser.parse(srt);
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0].text).toBe('Hello World');
  });

  test('should detect format correctly', () => {
    expect(detectFormat('WEBVTT\n\n')).toBe('vtt');
    expect(detectFormat('1\n00:00:00,000')).toBe('srt');
  });

  test('should validate timing conflicts', () => {
    const cues = [
      { startTime: 0, endTime: 5, text: 'First' },
      { startTime: 3, endTime: 7, text: 'Overlap' }
    ];
    const errors = validator.validateTiming(cues);
    expect(errors).toHaveLength(1);
  });
});
```

### Integration Testing

**API Endpoints**:
```typescript
describe('Subtitle API', () => {
  test('POST /api/videos/:id/subtitles', async () => {
    const formData = new FormData();
    formData.append('file', subtitleFile);
    formData.append('language', 'en');

    const response = await request(app)
      .post('/api/videos/123/subtitles')
      .send(formData);

    expect(response.status).toBe(200);
    expect(response.body.data.track.language).toBe('en');
  });
});
```

### E2E Testing

**Player Integration**:
```typescript
describe('Video Player Subtitles', () => {
  test('should display subtitle menu', async () => {
    await page.goto('/watch/test-video');
    await page.click('.vjs-subtitles-button');

    const menu = await page.$('.vjs-subtitles-menu');
    expect(menu).toBeTruthy();
  });

  test('should toggle subtitles with C key', async () => {
    await page.keyboard.press('c');
    const track = await page.$('.vjs-text-track-display');
    expect(track).toHaveClass('vjs-text-track-showing');
  });
});
```

### Accessibility Testing

- **WCAG 2.1 AA Compliance**
- Screen reader compatibility
- Keyboard navigation
- Color contrast (4.5:1 minimum)
- Focus indicators

### Performance Testing

**Metrics to Monitor**:
- Subtitle file parse time (< 100ms)
- WebVTT conversion time (< 200ms)
- Player initialization with subtitles (< 500ms)
- Memory usage with multiple tracks

---

## Third-Party Integration Options

### Option 1: Bunny.net Captions API

**Advantages**:
- Integrated with existing video streaming
- CDN delivery for subtitle files
- Automatic transcoding
- Global edge caching

**Implementation**:
```typescript
// Using Bunny.net API
async function uploadToBunnyNet(
  videoId: string,
  language: string,
  content: string
): Promise<string> {
  const response = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}/captions/${language}`,
    {
      method: 'POST',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/vtt'
      },
      body: content
    }
  );

  return response.json();
}
```

**Cost**: ~$0.005 per GB bandwidth

### Option 2: AWS Transcribe (Auto-Generation)

**Advantages**:
- Automatic speech-to-text
- Multi-language support
- Speaker identification
- Custom vocabulary

**Implementation**:
```typescript
// AWS Transcribe integration
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';

async function generateSubtitles(videoUrl: string, language: string) {
  const client = new TranscribeClient({ region: 'us-east-1' });

  const command = new StartTranscriptionJobCommand({
    TranscriptionJobName: `subtitle-${videoId}-${language}`,
    Media: { MediaFileUri: videoUrl },
    MediaFormat: 'mp4',
    LanguageCode: language,
    OutputBucketName: 'subtitles-output',
    Subtitles: {
      Formats: ['vtt', 'srt'],
    }
  });

  return client.send(command);
}
```

**Cost**: $0.024 per minute of audio

### Option 3: AssemblyAI

**Advantages**:
- High accuracy
- Real-time transcription
- Chapter detection
- Sentiment analysis

**Cost**: $0.015 per minute

### Recommendation

**Phase 1**: Use R2 storage with manual upload (no external dependency)
**Phase 2**: Integrate Bunny.net for CDN delivery
**Phase 3**: Add AWS Transcribe for auto-generation

---

## Migration Plan

### Database Migration

No database migration needed (R2-based architecture).

### Existing Videos

**Backfill Strategy**:
1. Add `subtitles: []` to all existing video objects
2. Set `hasSubtitles: false` flag
3. Update when first subtitle uploaded

### API Versioning

Maintain backward compatibility:
- Old endpoints continue working
- New subtitle fields are optional
- Gradual client migration

---

## Success Metrics

### Usage Metrics

**Target after 3 months**:
- 50% of new uploads include subtitles
- 30% of videos have multiple language tracks
- 70% of viewers enable subtitles when available

### Engagement Metrics

- **Watch time increase**: +25% for videos with subtitles
- **International views**: +40% from non-Arabic speakers
- **Completion rate**: +15% for subtitled videos

### Technical Metrics

- **Upload success rate**: > 99%
- **Parser accuracy**: > 99.5%
- **Player load time**: < 500ms with subtitles
- **CDN cache hit rate**: > 95%

### Accessibility Metrics

- **WCAG compliance**: AA rating
- **Screen reader compatibility**: 100%
- **Keyboard navigation**: Full support

---

## Risk Mitigation

### Technical Risks

1. **Large subtitle files**
   - Mitigation: 1MB file size limit
   - Streaming parse for large files

2. **Malformed files**
   - Mitigation: Robust validation
   - Error recovery in parser

3. **Performance impact**
   - Mitigation: Lazy loading
   - CDN caching

### Security Risks

1. **XSS in subtitles**
   - Mitigation: HTML sanitization
   - Content Security Policy

2. **File upload attacks**
   - Mitigation: File type validation
   - Virus scanning

---

## Implementation Timeline

### Week 1: Foundation
- Day 1-2: Storage setup, parser implementation
- Day 3-4: API endpoints
- Day 5: Player integration basics

### Week 2: Core Features
- Day 1-2: Upload UI
- Day 3-4: Subtitle menu in player
- Day 5: Testing and bug fixes

### Week 3: Advanced Features
- Day 1-3: Caption editor UI
- Day 4-5: Styling controls

### Week 4: Polish & Launch
- Day 1-2: Download/export features
- Day 3: Performance optimization
- Day 4: Documentation
- Day 5: Production deployment

---

## Conclusion

This comprehensive plan provides a clear roadmap for implementing subtitle/closed caption support in Al Ummah Now. The phased approach allows for incremental delivery while maintaining system stability.

**Next Steps**:
1. Review and approve implementation plan
2. Set up R2 buckets for subtitle storage
3. Begin Phase 1 development (parser and API)
4. Create UI mockups for upload and player integration
5. Plan user testing with accessibility community

The subtitle feature will significantly enhance the platform's accessibility, reach, and engagement, making Islamic content accessible to a global audience regardless of language or hearing ability.

---

**Document Maintained By**: Architecture Team
**Review Schedule**: Weekly during implementation
**Dependencies**: Video.js 8.x, R2 storage setup, WebVTT spec compliance