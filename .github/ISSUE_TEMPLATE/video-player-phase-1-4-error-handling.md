---
name: "[Phase 1.4] Error Handling and Fallback Mechanisms"
about: Implement comprehensive error handling with fallback options
title: "[Phase 1.4] Add Error Handling and Fallback Mechanisms"
labels: phase-1, video-player, enhancement, high-priority, reliability
assignees: ''
---

## Overview
Implement robust error handling, fallback mechanisms, and user-friendly error messages for the video player. Handle network failures, unsupported formats, HLS errors, and provide graceful degradation options.

## Acceptance Criteria
- [ ] Error boundary component wrapping video player
- [ ] HLS stream failure fallback to MP4 direct URL
- [ ] Network error detection and retry logic
- [ ] User-friendly error messages (bilingual)
- [ ] Error reporting to analytics/monitoring
- [ ] Manual retry functionality
- [ ] Browser compatibility detection
- [ ] Unsupported format warnings
- [ ] Timeout handling for slow networks
- [ ] Error state persisted in component state

## Technical Details

### Files to Create/Modify
- `apps/web/src/components/VideoPlayer/VideoPlayerErrorBoundary.tsx`
- `apps/web/src/components/VideoPlayer/ErrorDisplay.tsx`
- `apps/web/src/components/VideoPlayer/FallbackPlayer.tsx`
- `apps/web/src/lib/video/error-handler.ts`
- `apps/web/src/lib/video/fallback-strategy.ts`
- Update `CustomVideoPlayer.tsx` with error handling

### Implementation

```typescript
// apps/web/src/lib/video/error-handler.ts
export enum VideoErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  FORMAT_ERROR = 'FORMAT_ERROR',
  DECODE_ERROR = 'DECODE_ERROR',
  HLS_ERROR = 'HLS_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface VideoError {
  code: VideoErrorCode;
  message: string;
  originalError?: any;
  canRetry: boolean;
  fallbackAvailable: boolean;
}

export class VideoErrorHandler {
  private retryCount = 0;
  private maxRetries = 3;

  handlePlayerError(error: any): VideoError {
    const errorCode = this.categorizeError(error);

    return {
      code: errorCode,
      message: this.getUserFriendlyMessage(errorCode),
      originalError: error,
      canRetry: this.retryCount < this.maxRetries,
      fallbackAvailable: errorCode === VideoErrorCode.HLS_ERROR
    };
  }

  private categorizeError(error: any): VideoErrorCode {
    if (!navigator.onLine) return VideoErrorCode.NETWORK_ERROR;

    if (error?.code === 2) return VideoErrorCode.NETWORK_ERROR;
    if (error?.code === 3) return VideoErrorCode.DECODE_ERROR;
    if (error?.code === 4) return VideoErrorCode.FORMAT_ERROR;

    return VideoErrorCode.UNKNOWN_ERROR;
  }

  private getUserFriendlyMessage(code: VideoErrorCode): string {
    const messages = {
      [VideoErrorCode.NETWORK_ERROR]: 'Network connection failed. Please check your internet.',
      [VideoErrorCode.FORMAT_ERROR]: 'Video format not supported by your browser.',
      [VideoErrorCode.DECODE_ERROR]: 'Failed to decode video. Try refreshing.',
      [VideoErrorCode.HLS_ERROR]: 'Streaming failed. Trying alternative format...',
      [VideoErrorCode.TIMEOUT_ERROR]: 'Video loading timed out. Please try again.',
      [VideoErrorCode.UNKNOWN_ERROR]: 'An unexpected error occurred.'
    };
    return messages[code];
  }

  async retry(): Promise<boolean> {
    if (this.retryCount >= this.maxRetries) return false;
    this.retryCount++;
    await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount));
    return true;
  }

  reset() {
    this.retryCount = 0;
  }
}
```

```typescript
// apps/web/src/components/VideoPlayer/ErrorDisplay.tsx
interface ErrorDisplayProps {
  error: VideoError;
  onRetry: () => void;
  onFallback: () => void;
  rtl?: boolean;
}

export function ErrorDisplay({ error, onRetry, onFallback, rtl }: ErrorDisplayProps) {
  return (
    <div className="video-error-display" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="error-icon">⚠️</div>
      <h3>{rtl ? 'خطأ في التشغيل' : 'Playback Error'}</h3>
      <p>{error.message}</p>

      <div className="error-actions">
        {error.canRetry && (
          <button onClick={onRetry} className="btn-retry">
            {rtl ? 'إعادة المحاولة' : 'Retry'}
          </button>
        )}
        {error.fallbackAvailable && (
          <button onClick={onFallback} className="btn-fallback">
            {rtl ? 'جرب تنسيق بديل' : 'Try Alternative Format'}
          </button>
        )}
      </div>

      <details className="error-details">
        <summary>{rtl ? 'التفاصيل التقنية' : 'Technical Details'}</summary>
        <pre>{JSON.stringify(error.originalError, null, 2)}</pre>
      </details>
    </div>
  );
}
```

```typescript
// Update CustomVideoPlayer.tsx with error handling
export function CustomVideoPlayer(props: CustomVideoPlayerProps) {
  const [error, setError] = useState<VideoError | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const errorHandler = useRef(new VideoErrorHandler());

  useEffect(() => {
    // ... player setup

    player.on('error', () => {
      const playerError = player.error();
      const handledError = errorHandler.current.handlePlayerError(playerError);
      setError(handledError);

      // Auto-fallback for HLS errors
      if (handledError.fallbackAvailable && !useFallback) {
        setTimeout(() => setUseFallback(true), 1000);
      }

      // Report to analytics
      trackError(handledError);
    });

    // Fallback to MP4 if HLS fails
    if (useFallback) {
      const mp4Url = bunnyService.getMP4Url(bunnyVideoId, '720p');
      player.src({ src: mp4Url, type: 'video/mp4' });
    }
  }, [useFallback]);

  const handleRetry = async () => {
    const canRetry = await errorHandler.current.retry();
    if (canRetry) {
      setError(null);
      window.location.reload();
    }
  };

  const handleFallback = () => {
    setError(null);
    setUseFallback(true);
  };

  if (error) {
    return (
      <ErrorDisplay
        error={error}
        onRetry={handleRetry}
        onFallback={handleFallback}
        rtl={props.rtl}
      />
    );
  }

  // ... rest of component
}
```

### Dependencies
- **Prerequisites**: Phase 1.1, 1.2, 1.3
- **npm packages**: None (uses built-in APIs)

### Testing Requirements
- [ ] Unit test: Error categorization logic
- [ ] Unit test: Retry mechanism with backoff
- [ ] Unit test: Fallback strategy selection
- [ ] Integration test: HLS failure triggers MP4 fallback
- [ ] Integration test: Network error shows retry button
- [ ] E2E test: Simulate network failure
- [ ] E2E test: Verify error messages in both languages
- [ ] Manual test: Unplug network during playback
- [ ] Manual test: Test in browsers without HLS support

## Design Considerations

### User Experience
- Clear, actionable error messages
- Automatic fallback for common errors
- Manual retry for transient failures
- Technical details hidden by default
- Loading state during retry/fallback

### Reliability
- Exponential backoff for retries
- Maximum retry limit to prevent loops
- Fallback chain: HLS → MP4 720p → MP4 480p
- Graceful degradation for older browsers

### Monitoring
- All errors logged to console
- Critical errors sent to analytics
- Error patterns tracked for debugging
- Fallback usage metrics collected

## Success Metrics
- Error recovery rate > 80%
- User-initiated retries < 10%
- Automatic fallbacks > 90% success
- Zero unhandled exceptions
- Clear error messages in both languages

## References
- Video.js Error Handling: https://docs.videojs.com/tutorial-errors.html
- HLS.js Error Events: https://github.com/video-dev/hls.js/blob/master/docs/API.md#errors
- Implementation Guide: `/docs/architecture/video-player-implementation-guide.md`

## Estimated Effort
**Medium** - 4-5 hours
