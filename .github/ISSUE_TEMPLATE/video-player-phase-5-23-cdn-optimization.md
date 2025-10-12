---
name: "[Phase 5.2] CDN and Caching Optimization"
about: Optimize CDN configuration and caching strategies
title: "[Phase 5.2] Optimize CDN and Caching Strategies"
labels: phase-5, video-player, enhancement, performance, infrastructure
assignees: ''
---

## Overview
Optimize Bunny.net CDN configuration, implement intelligent caching strategies, and configure optimal HLS delivery settings for global performance.

## Acceptance Criteria
- [ ] Bunny.net CDN optimally configured
- [ ] Cache headers set correctly
- [ ] Preload hints for video metadata
- [ ] Resource hints (dns-prefetch, preconnect)
- [ ] Service Worker caching for offline
- [ ] Optimal HLS segment sizes
- [ ] CDN purge strategy documented
- [ ] Multi-CDN failover (future)
- [ ] Edge caching rules
- [ ] Performance metrics tracked

## Implementation

**Resource hints:**
```typescript
// apps/web/src/components/VideoPlayer/ResourceHints.tsx
export function VideoResourceHints({ bunnyPullZone }: { bunnyPullZone: string }) {
  return (
    <>
      <link rel="dns-prefetch" href={`https://${bunnyPullZone}`} />
      <link rel="preconnect" href={`https://${bunnyPullZone}`} crossOrigin="anonymous" />
    </>
  );
}
```

**Optimal HLS configuration:**
```typescript
const hlsConfig = {
  enableLowInitialPlaylist: true,
  maxBufferLength: 30,
  maxMaxBufferLength: 600,
  maxBufferSize: 60 * 1000 * 1000,
  maxBufferHole: 0.5,
  highBufferWatchdogPeriod: 2,
  nudgeOffset: 0.1,
  nudgeMaxRetry: 3,
  maxFragLookUpTolerance: 0.25,
  liveSyncDurationCount: 3,
  enableWorker: true,
  enableSoftwareAES: true,
  startLevel: -1  // Auto-select initial quality
};

player.tech(true).hls?.config(hlsConfig);
```

**Service Worker caching:**
```typescript
// apps/web/public/sw.js
const CACHE_NAME = 'video-player-v1';
const urlsToCache = [
  '/video-js.css',
  '/video.min.js'
];

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('.m3u8') || event.request.url.includes('.ts')) {
    // Cache HLS segments
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          return response || fetch(event.request).then((response) => {
            cache.put(event.request, response.clone());
            return response;
          });
        });
      })
    );
  }
});
```

**Preload critical resources:**
```typescript
export function preloadVideo(videoId: string) {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'fetch';
  link.href = bunnyService.getHLSUrl(videoId);
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}
```

## Testing
- [ ] HLS segments load quickly
- [ ] Cache headers correct
- [ ] Resource hints reduce latency
- [ ] Service Worker caches effectively
- [ ] Global CDN performance good
- [ ] Playback smooth worldwide

## Estimated Effort
**Small** - 2-3 hours
