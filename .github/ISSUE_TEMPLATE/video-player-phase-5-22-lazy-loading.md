---
name: "[Phase 5.1] Lazy Loading and Code Splitting"
about: Optimize bundle size with lazy loading
title: "[Phase 5.1] Implement Lazy Loading and Code Splitting"
labels: phase-5, video-player, enhancement, performance
assignees: ''
---

## Overview
Optimize video player bundle size through lazy loading, code splitting, and dynamic imports to improve initial page load performance.

## Acceptance Criteria
- [ ] Video.js loaded only when needed
- [ ] Player components code-split
- [ ] Plugins loaded on-demand
- [ ] Intersection Observer for below-fold videos
- [ ] Reduced initial bundle size by >200KB
- [ ] No impact on user experience
- [ ] Preloading for critical paths
- [ ] Service Worker caching strategy
- [ ] Metrics for load performance
- [ ] A/B test lazy vs eager loading

## Implementation

```typescript
// apps/web/src/components/VideoPlayer/index.ts
import dynamic from 'next/dynamic';

// Lazy load player
export const CustomVideoPlayer = dynamic(
  () => import('./CustomVideoPlayer').then(mod => ({ default: mod.CustomVideoPlayer })),
  {
    ssr: false,
    loading: () => <VideoPlayerSkeleton />
  }
);

// Lazy load plugins
export const loadQualitySelector = () => 
  import('videojs-hls-quality-selector');

export const loadSpriteThumbnails = () =>
  import('videojs-sprite-thumbnails');
```

**Intersection Observer for below-fold:**
```typescript
// apps/web/src/hooks/useLazyVideo.ts
export function useLazyVideo(videoRef: RefObject<HTMLElement>) {
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    observer.observe(videoRef.current);

    return () => observer.disconnect();
  }, [videoRef]);

  return shouldLoad;
}

// Usage
export function VideoCard({ video }: { video: Video }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldLoad = useLazyVideo(containerRef);

  return (
    <div ref={containerRef}>
      {shouldLoad ? (
        <CustomVideoPlayer videoId={video.id} />
      ) : (
        <VideoPlaceholder thumbnail={video.thumbnail} />
      )}
    </div>
  );
}
```

## Testing
- [ ] Bundle size reduced
- [ ] Player loads on-demand
- [ ] Below-fold videos don't load immediately
- [ ] No visual glitches
- [ ] Metrics tracked
- [ ] Performance improved

## Estimated Effort
**Small** - 2-3 hours
