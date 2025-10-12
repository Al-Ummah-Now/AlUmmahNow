# ADR-001: Custom Video Player Architecture

## Status
**Proposed**

## Executive Summary
Design and implement a custom HTML5 video player to replace the current Bunny.net iframe player, addressing SSL certificate issues while providing enhanced features, better analytics integration, and full control over the playback experience.

## Context

### Current Issues
- **SSL Certificate Problem**: The stream.alummahnow.net SSL certificate is expired, causing video playback failures
- **Limited Control**: iframe player restricts customization and feature implementation
- **Analytics Limitations**: Cannot track detailed engagement metrics with iframe
- **User Experience**: No control over player UI/UX, keyboard shortcuts, or advanced features

### Business Requirements
- YouTube-like video playback experience
- Real-time analytics and engagement tracking
- Bilingual support (English/Arabic with RTL)
- Mobile-responsive design
- Integration with existing watch history and progress tracking

### Technical Context
- **Video Delivery**: Bunny.net Stream provides HLS/DASH streaming
- **Infrastructure**: Cloudflare Workers edge runtime
- **Analytics**: WebSocket server for real-time updates, R2 for storage
- **Authentication**: JWT via OpenAuth

## Decision

Implement a custom video player using **Video.js** as the foundation, directly consuming Bunny.net's HLS streams, with custom controls and analytics integration.

### Technology Choices

#### Video Player Library: Video.js
**Rationale:**
- Mature, battle-tested library (used by Twitter, LinkedIn, The Guardian)
- Excellent HLS/DASH support via plugins
- Extensive plugin ecosystem
- Built-in accessibility features
- Customizable UI/controls
- Mobile-friendly with touch controls
- Good TypeScript support

**Alternatives Considered:**
1. **Plyr** - Simpler but less extensible, limited plugin ecosystem
2. **Native HTML5** - Too much work for advanced features
3. **Shaka Player** - Excellent for DASH but overkill for our needs
4. **React Player** - Too abstracted, less control over internals

#### Streaming Protocol: HLS (Primary) + MP4 Fallback
**Rationale:**
- HLS supported natively on iOS/Safari
- Wide browser support with Video.js
- Adaptive bitrate streaming
- Bunny.net provides HLS manifests out-of-box

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Web Application                        │
│                    (Next.js 15 / React 19)                   │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │            CustomVideoPlayer Component              │     │
│  ├─────────────────────────────────────────────────────┤     │
│  │                                                     │     │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │     │
│  │  │  Video.js    │  │  Analytics   │  │ Controls │ │     │
│  │  │   Core       │  │   Manager    │  │   Layer  │ │     │
│  │  └──────┬───────┘  └──────┬───────┘  └────┬─────┘ │     │
│  │         │                  │                │       │     │
│  │  ┌──────▼──────────────────▼────────────────▼────┐ │     │
│  │  │           Event Bus & State Manager           │ │     │
│  │  └────────────────────┬───────────────────────────┘ │     │
│  └───────────────────────┼─────────────────────────────┘     │
│                          │                                   │
├──────────────────────────┼───────────────────────────────────┤
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐     │
│  │              Service Layer                          │     │
│  ├─────────────────────────────────────────────────────┤     │
│  │                                                     │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │     │
│  │  │   Bunny     │  │  Analytics  │  │  WebSocket │ │     │
│  │  │   Client    │  │   Service   │  │   Client   │ │     │
│  │  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘ │     │
│  └─────────┼────────────────┼────────────────┼────────┘     │
└────────────┼────────────────┼────────────────┼──────────────┘
             │                │                │
             ▼                ▼                ▼
    ┌────────────────┐ ┌────────────┐ ┌────────────────┐
    │  Bunny.net    │ │  API Videos │ │  WebSocket     │
    │  Stream CDN   │ │   Worker    │ │    Server      │
    └────────────────┘ └────────────┘ └────────────────┘
```

## Component Architecture

### 1. CustomVideoPlayer Component
Main React component orchestrating the player:

```typescript
interface CustomVideoPlayerProps {
  videoId: string;
  videoTitle: string;
  videoUrl: string;        // HLS manifest URL
  thumbnailUrl?: string;
  channelId?: string;
  userId?: string;
  autoPlay?: boolean;
  startTime?: number;      // Resume from saved position
  onProgress?: (progress: VideoProgress) => void;
  onEnded?: () => void;
  className?: string;
  rtl?: boolean;           // RTL support
}
```

### 2. Video Service Layer

```typescript
// services/video/BunnyStreamService.ts
class BunnyStreamService {
  async getVideoManifest(videoId: string): Promise<VideoManifest>
  async getVideoMetadata(videoId: string): Promise<VideoMetadata>
  async getAvailableQualities(videoId: string): Promise<Quality[]>
  generateHLSUrl(videoId: string): string
  generateThumbnailUrl(videoId: string, time?: number): string
  generateMP4Url(videoId: string, quality: string): string
}

// services/video/VideoAnalytics.ts
class VideoAnalyticsService {
  trackView(videoId: string, userId?: string): void
  trackProgress(videoId: string, progress: number, duration: number): void
  trackEngagement(videoId: string, action: EngagementAction): void
  trackQualityChange(videoId: string, from: string, to: string): void
  trackBuffering(videoId: string, duration: number): void
  trackError(videoId: string, error: VideoError): void
}
```

### 3. Player Controls Architecture

```typescript
// components/video/controls/
├── PlaybackControls.tsx     // Play, pause, seek
├── VolumeControl.tsx        // Volume slider, mute
├── ProgressBar.tsx          // Seekbar with preview
├── QualitySelector.tsx      // Resolution picker
├── SpeedControl.tsx         // Playback rate
├── FullscreenToggle.tsx     // Fullscreen mode
├── PictureInPicture.tsx     // PiP mode
├── SubtitlesMenu.tsx        // Captions/subtitles
├── ChapterMarkers.tsx       // Chapter navigation
└── KeyboardShortcuts.tsx    // Keyboard controls
```

### 4. Analytics Event Schema

```typescript
enum VideoEventType {
  // Playback Events
  PLAY = 'play',
  PAUSE = 'pause',
  SEEK = 'seek',
  ENDED = 'ended',

  // Progress Events
  PROGRESS = 'progress',
  TIMEUPDATE = 'timeupdate',

  // Quality Events
  QUALITY_CHANGE = 'quality_change',

  // Engagement Events
  LIKE = 'like',
  DISLIKE = 'dislike',
  SHARE = 'share',
  COMMENT = 'comment',

  // Performance Events
  BUFFER_START = 'buffer_start',
  BUFFER_END = 'buffer_end',
  ERROR = 'error',

  // Milestone Events
  QUARTILE_25 = 'quartile_25',
  QUARTILE_50 = 'quartile_50',
  QUARTILE_75 = 'quartile_75',
  COMPLETE = 'complete'
}

interface VideoAnalyticsEvent {
  eventType: VideoEventType;
  videoId: string;
  userId?: string;
  sessionId: string;
  timestamp: string;
  data: {
    currentTime?: number;
    duration?: number;
    quality?: string;
    speed?: number;
    volume?: number;
    fullscreen?: boolean;
    errorCode?: string;
    errorMessage?: string;
    [key: string]: any;
  };
}
```

## Implementation Plan

### Phase 1: Core Player (Week 1-2)
- [ ] Set up Video.js with TypeScript
- [ ] Implement basic playback controls
- [ ] HLS stream integration
- [ ] Error handling and fallbacks
- [ ] Basic analytics tracking

### Phase 2: Advanced Features (Week 2-3)
- [ ] Quality selector with adaptive bitrate
- [ ] Playback speed control
- [ ] Keyboard shortcuts
- [ ] Progress bar with hover preview
- [ ] Volume persistence
- [ ] Fullscreen and PiP modes

### Phase 3: Analytics & Watch History (Week 3-4)
- [ ] Detailed analytics events
- [ ] Watch progress tracking
- [ ] Resume playback feature
- [ ] Real-time metrics via WebSocket
- [ ] Engagement tracking (likes, views)

### Phase 4: UI/UX Polish (Week 4-5)
- [ ] Custom control skin
- [ ] RTL support
- [ ] Mobile touch controls
- [ ] Loading states and skeletons
- [ ] Accessibility (ARIA labels, keyboard nav)

### Phase 5: Performance & Testing (Week 5-6)
- [ ] Lazy loading and code splitting
- [ ] CDN optimization
- [ ] E2E testing
- [ ] Performance monitoring
- [ ] A/B testing framework

## Required NPM Packages

```json
{
  "dependencies": {
    "video.js": "^8.12.0",
    "@videojs/http-streaming": "^3.12.0",
    "videojs-contrib-quality-levels": "^4.1.0",
    "videojs-hls-quality-selector": "^2.0.0",
    "videojs-hotkeys": "^0.2.28",
    "videojs-sprite-thumbnails": "^2.2.1",
    "@types/video.js": "^7.3.58"
  }
}
```

## API Integration Patterns

### 1. Video Metadata Fetching
```typescript
// Get video details from API
GET /api/videos/{videoId}
Response: {
  id: string,
  title: string,
  bunnyVideoId: string,
  duration: number,
  qualities: string[],
  thumbnailUrl: string,
  hlsUrl: string
}
```

### 2. Progress Tracking
```typescript
// Save watch progress
POST /api/profile/watch-history
Body: {
  videoId: string,
  watchTime: number,
  totalDuration: number,
  completed: boolean
}
```

### 3. Real-time Updates
```typescript
// WebSocket events
ws.send({
  type: 'video_progress',
  videoId: string,
  currentTime: number,
  duration: number
})
```

## Consequences

### Positive
- **Full Control**: Complete customization of player UI/UX
- **Better Analytics**: Detailed engagement and performance metrics
- **Enhanced Features**: Keyboard shortcuts, quality selection, speed control
- **Performance**: Direct HLS streaming without iframe overhead
- **Maintenance**: No dependency on third-party player updates
- **Cost Savings**: Potential to optimize bandwidth usage

### Negative
- **Development Time**: 4-6 weeks for full implementation
- **Maintenance Burden**: We own the player code and bugs
- **Browser Compatibility**: Must test across all browsers/devices
- **Complexity**: More moving parts than iframe solution

### Mitigation Strategies
- Use battle-tested Video.js to reduce bugs
- Implement comprehensive error tracking
- Progressive enhancement approach
- Fallback to native HTML5 player if needed

## Alternatives Considered

### 1. Fix SSL Certificate Only
**Rejected because:**
- Doesn't address feature limitations
- Still dependent on Bunny.net's player updates
- No analytics improvement

### 2. Use YouTube Embed
**Rejected because:**
- Requires uploading to YouTube
- YouTube branding and ads
- Limited customization
- Privacy concerns

### 3. Self-Host Video Files
**Rejected because:**
- Massive bandwidth costs
- No CDN optimization
- Complex transcoding pipeline
- Poor global performance

## Testing Strategy

### Unit Tests
- Player control components
- Analytics event tracking
- State management
- Utility functions

### Integration Tests
- HLS stream loading
- API interactions
- WebSocket connectivity
- Browser compatibility

### E2E Tests
- Full playback flow
- Quality switching
- Keyboard shortcuts
- Mobile interactions

### Performance Tests
- Initial load time
- Time to first frame
- Rebuffering ratio
- Memory usage

## Monitoring & Observability

### Key Metrics
- **Video Start Time**: Time from click to first frame
- **Rebuffer Rate**: Buffering events per hour of video
- **Error Rate**: Failed playbacks / total attempts
- **Engagement Rate**: Average watch time / video duration
- **Quality Distribution**: % of time at each quality level

### Error Tracking
- Sentry integration for JavaScript errors
- Custom error boundaries for React
- Detailed error logging with context

## Migration Plan

### Rollout Strategy
1. **Canary Release**: 5% of users
2. **Gradual Rollout**: 25% → 50% → 100%
3. **Feature Flag**: Easy rollback to iframe
4. **A/B Testing**: Compare metrics

### Backwards Compatibility
- Keep iframe code as fallback
- Feature detection for HLS support
- Progressive enhancement approach

## Security Considerations

- **Token-Protected Streams**: Implement Bunny.net token authentication
- **DRM Support**: Future consideration for premium content
- **XSS Prevention**: Sanitize all user inputs
- **CORS Policy**: Proper headers for CDN access

## Conclusion

The custom video player will provide significant improvements in user experience, analytics capabilities, and feature richness. While requiring initial development investment, it positions the platform for long-term growth and differentiation.

## References

- [Bunny.net Stream Documentation](https://docs.bunny.net/docs/stream-overview)
- [Video.js Documentation](https://videojs.com/guides/)
- [HLS Specification](https://datatracker.ietf.org/doc/html/rfc8216)
- [Web Video Playback Best Practices](https://web.dev/media/)