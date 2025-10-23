/**
 * HLS.js Configuration for optimized streaming
 *
 * Key settings for memory efficiency:
 * - maxBufferLength: 30s ahead buffer (standard for streaming)
 * - maxMaxBufferLength: 60s max buffer (was 600s/10min - excessive!)
 * - maxBufferSize: 10MB max buffer (was 60MB - way too high!)
 *
 * This configuration balances smooth playback with memory efficiency.
 * Video should stream, not load entirely into memory.
 */
export const hlsConfig = {
  // Buffer management - keep memory usage low
  maxBufferLength: 30,              // Buffer 30s ahead (standard)
  maxMaxBufferLength: 60,           // Max 60s buffer (reduced from 600s)
  maxBufferSize: 10 * 1000 * 1000,  // 10MB max buffer (reduced from 60MB)
  maxBufferHole: 0.5,               // 0.5s tolerance for buffer gaps

  // Live stream settings
  liveSyncDurationCount: 3,
  lowLatencyMode: true,

  // Performance optimization
  enableWorker: true,               // Use web workers for parallel processing
  maxFragLookUpTolerance: 0.25,
  capLevelToPlayerSize: true,       // Don't buffer higher quality than display size

  // Loading behavior
  autoStartLoad: true,

  // Network resilience
  fragLoadingTimeOut: 20000,        // 20s timeout
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 1000,
  manifestLoadingTimeOut: 10000,
  manifestLoadingMaxRetry: 6,

  // Debug logging (development only)
  debug: process.env.NODE_ENV === 'development'
};

export const getVideoJsOptions = (src: string, poster?: string) => ({
  controls: true,
  responsive: true,
  fluid: true,
  preload: 'metadata' as const,
  poster,
  html5: {
    hlsjsConfig: hlsConfig
  },
  sources: [{
    src,
    type: 'application/x-mpegURL'
  }],
  techOrder: ['html5'] as const,
  playbackRates: [0.5, 1, 1.25, 1.5, 2],
  plugins: {
    hotkeys: {
      volumeStep: 0.1,
      seekStep: 5,
      enableModifiersForNumbers: false
    }
  }
});
