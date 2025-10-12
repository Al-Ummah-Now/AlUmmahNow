# BunnyStreamService

Service for generating Bunny.net Stream URLs with clean abstraction over Bunny.net's URL structure.

## Features

- ✅ HLS playlist URL generation for adaptive streaming
- ✅ MP4 direct URLs for all quality levels (240p-1080p)
- ✅ Thumbnail URL generation with optional timestamp and dimensions
- ✅ Preview animation URL generation
- ✅ Captions/subtitles URL generation
- ✅ Token authentication support (placeholder for future)
- ✅ Configuration via environment variables
- ✅ Full TypeScript type safety
- ✅ 100% test coverage

## Installation

The service is already included in this project. No additional installation needed.

## Configuration

### Environment Variables

Add these to your `.env.local` file (see `.env.example` for reference):

```bash
NEXT_PUBLIC_BUNNY_PULL_ZONE_URL=vz-xxxxx.b-cdn.net
NEXT_PUBLIC_BUNNY_LIBRARY_ID=12345
NEXT_PUBLIC_BUNNY_API_KEY=your-api-key-here # Optional
NEXT_PUBLIC_BUNNY_TOKEN_AUTH=false # Optional
```

## Usage

### Basic Usage

```typescript
import { BunnyStreamService } from '@/services/bunny';

// Create service instance with manual configuration
const service = new BunnyStreamService({
  pullZoneUrl: 'vz-xxxxx.b-cdn.net',
  libraryId: '12345',
});

// Generate HLS URL for adaptive streaming
const hlsUrl = service.getHlsUrl('video-guid-123');
// Returns: https://vz-xxxxx.b-cdn.net/video-guid-123/playlist.m3u8
```

### Using Environment Variables

```typescript
import { createBunnyStreamService } from '@/services/bunny';

// Create service from environment variables
const service = createBunnyStreamService();
const hlsUrl = service.getHlsUrl('video-guid-123');
```

### Generate MP4 URLs

```typescript
// Single quality level
const mp4Url = service.getMp4Url('video-guid-123', '720p');
// Returns: https://vz-xxxxx.b-cdn.net/video-guid-123/play_720p.mp4

// All quality levels
const mp4Urls = service.getAllMp4Urls('video-guid-123');
// Returns: {
//   '240p': 'https://vz-xxxxx.b-cdn.net/video-guid-123/play_240p.mp4',
//   '360p': 'https://vz-xxxxx.b-cdn.net/video-guid-123/play_360p.mp4',
//   '480p': 'https://vz-xxxxx.b-cdn.net/video-guid-123/play_480p.mp4',
//   '720p': 'https://vz-xxxxx.b-cdn.net/video-guid-123/play_720p.mp4',
//   '1080p': 'https://vz-xxxxx.b-cdn.net/video-guid-123/play_1080p.mp4',
// }
```

### Generate Thumbnail URLs

```typescript
// Default thumbnail
const thumbUrl = service.getThumbnailUrl('video-guid-123');
// Returns: https://vz-xxxxx.b-cdn.net/video-guid-123/thumbnail.jpg

// Thumbnail at specific timestamp
const thumbUrl = service.getThumbnailUrl('video-guid-123', { timestamp: 30 });
// Returns: https://vz-xxxxx.b-cdn.net/video-guid-123/thumbnail_30s.jpg

// Thumbnail with custom dimensions
const thumbUrl = service.getThumbnailUrl('video-guid-123', {
  width: 640,
  height: 360,
});
// Returns: https://vz-xxxxx.b-cdn.net/video-guid-123/thumbnail.jpg?width=640&height=360

// Combined: timestamp and dimensions
const thumbUrl = service.getThumbnailUrl('video-guid-123', {
  timestamp: 15,
  width: 320,
  height: 180,
});
// Returns: https://vz-xxxxx.b-cdn.net/video-guid-123/thumbnail_15s.jpg?width=320&height=180
```

### Generate Preview Animation URL

```typescript
const previewUrl = service.getPreviewUrl('video-guid-123');
// Returns: https://vz-xxxxx.b-cdn.net/video-guid-123/preview.webp
```

### Generate Caption URLs

```typescript
// Single caption
const captionUrl = service.getCaptionUrl('video-guid-123', 'en');
// Returns: https://vz-xxxxx.b-cdn.net/video-guid-123/captions/en.vtt

// Multiple captions with metadata
const captions = service.getCaptionUrls('video-guid-123', [
  { srclang: 'en', label: 'English' },
  { srclang: 'ar', label: 'Arabic' },
]);
// Returns: [
//   {
//     srclang: 'en',
//     label: 'English',
//     url: 'https://vz-xxxxx.b-cdn.net/video-guid-123/captions/en.vtt'
//   },
//   {
//     srclang: 'ar',
//     label: 'Arabic',
//     url: 'https://vz-xxxxx.b-cdn.net/video-guid-123/captions/ar.vtt'
//   }
// ]
```

### Generate All URLs at Once

```typescript
const allUrls = service.getAllUrls('video-guid-123', [
  { srclang: 'en', label: 'English' },
  { srclang: 'ar', label: 'Arabic' },
]);

// Returns: {
//   hls: 'https://vz-xxxxx.b-cdn.net/video-guid-123/playlist.m3u8',
//   mp4: {
//     '240p': 'https://...',
//     '360p': 'https://...',
//     '480p': 'https://...',
//     '720p': 'https://...',
//     '1080p': 'https://...',
//   },
//   thumbnail: 'https://vz-xxxxx.b-cdn.net/video-guid-123/thumbnail.jpg',
//   preview: 'https://vz-xxxxx.b-cdn.net/video-guid-123/preview.webp',
//   captions: [
//     { srclang: 'en', label: 'English', url: 'https://...' },
//     { srclang: 'ar', label: 'Arabic', url: 'https://...' }
//   ]
// }
```

## API Reference

### Types

```typescript
interface BunnyConfig {
  pullZoneUrl: string;
  libraryId: string;
  apiKey?: string;
  tokenAuthEnabled?: boolean;
}

type VideoQuality = '240p' | '360p' | '480p' | '720p' | '1080p';

interface ThumbnailOptions {
  timestamp?: number;
  width?: number;
  height?: number;
}

interface CaptionUrl {
  srclang: string;
  label: string;
  url: string;
}

interface BunnyVideoUrls {
  hls: string;
  mp4: Record<VideoQuality, string>;
  thumbnail: string;
  preview: string;
  captions?: CaptionUrl[];
}
```

### Methods

#### `getHlsUrl(videoId: string): string`

Generate HLS playlist URL for adaptive streaming.

#### `getMp4Url(videoId: string, quality: VideoQuality): string`

Generate MP4 direct URL for a specific quality level.

#### `getAllMp4Urls(videoId: string): Record<VideoQuality, string>`

Generate MP4 URLs for all available quality levels.

#### `getThumbnailUrl(videoId: string, options?: ThumbnailOptions): string`

Generate thumbnail URL with optional timestamp and dimensions.

#### `getPreviewUrl(videoId: string): string`

Generate preview animation URL.

#### `getCaptionUrl(videoId: string, languageCode: string): string`

Generate caption/subtitle URL for a specific language.

#### `getCaptionUrls(videoId: string, captions: Array<{srclang: string, label: string}>): CaptionUrl[]`

Generate URLs for multiple captions with metadata.

#### `getAllUrls(videoId: string, captions?, tokenOptions?): BunnyVideoUrls`

Generate all video URLs in a single object.

#### `getConfig(): Omit<BunnyConfig, 'apiKey'>`

Get current service configuration (without sensitive data).

## Integration with Video.js

Example integration with Video.js player:

```typescript
import { createBunnyStreamService } from '@/services/bunny';
import videojs from 'video.js';

const service = createBunnyStreamService();
const videoId = 'abc123-def456';

// Get all URLs
const urls = service.getAllUrls(videoId, [
  { srclang: 'en', label: 'English' },
  { srclang: 'ar', label: 'Arabic' },
]);

// Initialize Video.js player
const player = videojs('my-video', {
  sources: [
    {
      src: urls.hls,
      type: 'application/x-mpegURL',
    },
  ],
  poster: urls.thumbnail,
  tracks: urls.captions?.map(caption => ({
    kind: 'captions',
    src: caption.url,
    srclang: caption.srclang,
    label: caption.label,
  })),
});
```

## Testing

Run tests:

```bash
pnpm test src/services/bunny/__tests__/stream.service.test.ts
```

Test coverage:

```bash
pnpm test:coverage
```

Current test coverage: **100%** (41/41 tests passing)

## Future Enhancements

- [ ] Implement token-based URL authentication
- [ ] Add URL signing for security
- [ ] Support for custom CDN domains
- [ ] Add retry logic for URL generation
- [ ] Support for additional video formats

## License

Part of Al Ummah Now project.
