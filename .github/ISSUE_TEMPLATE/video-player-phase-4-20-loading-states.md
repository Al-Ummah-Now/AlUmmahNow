---
name: "[Phase 4.4] Loading States and Skeleton Screens"
about: Implement loading states and skeleton UI
title: "[Phase 4.4] Create Loading States and Skeleton Screens"
labels: phase-4, video-player, enhancement, ux
assignees: ''
---

## Overview
Create polished loading states, skeleton screens, and buffering indicators to provide visual feedback during all loading operations.

## Acceptance Criteria
- [ ] Skeleton screen while player initializes
- [ ] Buffering spinner with progress
- [ ] Loading states for quality changes
- [ ] Smooth transitions between states
- [ ] Loading percentage indicator
- [ ] Animated placeholder content
- [ ] Error state with retry option
- [ ] Accessible loading announcements
- [ ] No layout shift during loading
- [ ] Matches design system

## Implementation

```typescript
// apps/web/src/components/VideoPlayer/LoadingStates.tsx
export function VideoPlayerSkeleton() {
  return (
    <div className="video-skeleton">
      <div className="skeleton-video">
        <div className="skeleton-play-icon" />
      </div>
      <div className="skeleton-controls">
        <div className="skeleton-progress" />
        <div className="skeleton-buttons" />
      </div>
    </div>
  );
}

export function BufferingIndicator({ progress }: { progress?: number }) {
  return (
    <div className="buffering-overlay">
      <div className="buffering-spinner" />
      {progress !== undefined && (
        <div className="buffering-text">
          Loading... {Math.round(progress)}%
        </div>
      )}
    </div>
  );
}

export function QualityChangeIndicator({ from, to }: { from: string; to: string }) {
  return (
    <div className="quality-change-indicator">
      <div className="quality-change-text">
        Switching quality: {from} → {to}
      </div>
    </div>
  );
}
```

**CSS:**
```css
.video-skeleton {
  width: 100%;
  aspect-ratio: 16/9;
  background: linear-gradient(
    90deg,
    #1a1a1a 25%,
    #2a2a2a 50%,
    #1a1a1a 75%
  );
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s infinite;
  border-radius: 8px;
  overflow: hidden;
}

@keyframes skeleton-loading {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.buffering-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.buffering-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

**Integration:**
```typescript
export function CustomVideoPlayer(props: CustomVideoPlayerProps) {
  const [loadingState, setLoadingState] = useState<'loading' | 'buffering' | 'ready'>('loading');
  const [bufferProgress, setBufferProgress] = useState(0);

  useEffect(() => {
    if (!playerRef.current) return;

    const player = playerRef.current;

    player.on('loadstart', () => setLoadingState('loading'));
    player.on('ready', () => setLoadingState('ready'));
    player.on('waiting', () => setLoadingState('buffering'));
    player.on('playing', () => setLoadingState('ready'));

    player.on('progress', () => {
      const buffered = player.buffered();
      if (buffered.length > 0) {
        const percent = (buffered.end(0) / player.duration()) * 100;
        setBufferProgress(percent);
      }
    });
  }, []);

  return (
    <div className="video-player-wrapper">
      {loadingState === 'loading' && <VideoPlayerSkeleton />}
      {loadingState === 'buffering' && <BufferingIndicator progress={bufferProgress} />}
      {/* player */}
    </div>
  );
}
```

## Testing
- [ ] Skeleton shows on mount
- [ ] Buffering indicator appears
- [ ] Progress updates smoothly
- [ ] No layout shift
- [ ] Accessible announcements
- [ ] Error states work

## Estimated Effort
**Small** - 2-3 hours
