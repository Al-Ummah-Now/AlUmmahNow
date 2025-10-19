export const hlsConfig = {
  maxBufferLength: 30,
  maxMaxBufferLength: 600,
  maxBufferSize: 60 * 1000 * 1000,
  maxBufferHole: 0.5,
  liveSyncDurationCount: 3,
  enableWorker: true,
  maxFragLookUpTolerance: 0.25,
  lowLatencyMode: true,
  fragLoadingTimeOut: 20000,
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 1000,
  manifestLoadingTimeOut: 10000,
  manifestLoadingMaxRetry: 6,
  capLevelToPlayerSize: true,
  autoStartLoad: true,
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
