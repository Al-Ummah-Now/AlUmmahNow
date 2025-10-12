---
name: "[Phase 3.2] Watch Progress Tracking and Storage"
about: Track and store video watch progress
title: "[Phase 3.2] Add Watch Progress Tracking and Storage"
labels: phase-3, video-player, enhancement, feature
assignees: ''
---

## Overview
Implement watch progress tracking that saves playback position to allow users to resume videos from where they left off.

## Acceptance Criteria
- [ ] Save watch progress every 10 seconds
- [ ] Progress saved on pause and video end
- [ ] Progress includes video ID, user ID, timestamp, duration
- [ ] Completed flag when user watches >90%
- [ ] API endpoint `/api/profile/watch-history` integration
- [ ] LocalStorage fallback for unauthenticated users
- [ ] Progress synced on authentication
- [ ] Efficient debouncing (no API spam)
- [ ] Progress visible in video cards/thumbnails
- [ ] "Continue watching" section populated

## Implementation

**API Integration Service:**
```typescript
// apps/web/src/services/api/watch-history.ts
export interface WatchProgress {
  videoId: string;
  watchTime: number;
  totalDuration: number;
  completed: boolean;
  lastWatched: string;
}

export class WatchHistoryService {
  private apiUrl = process.env.NEXT_PUBLIC_API_URL;

  async saveProgress(progress: WatchProgress): Promise<void> {
    const token = getAuthToken();

    if (token) {
      // Authenticated: save to API
      await fetch(`${this.apiUrl}/api/profile/watch-history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(progress)
      });
    } else {
      // Unauthenticated: save to localStorage
      const stored = localStorage.getItem('watchHistory') || '{}';
      const history = JSON.parse(stored);
      history[progress.videoId] = progress;
      localStorage.setItem('watchHistory', JSON.stringify(history));
    }
  }

  async getProgress(videoId: string): Promise<WatchProgress | null> {
    const token = getAuthToken();

    if (token) {
      const response = await fetch(
        `${this.apiUrl}/api/profile/watch-history/${videoId}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      return response.ok ? response.json() : null;
    } else {
      const stored = localStorage.getItem('watchHistory') || '{}';
      const history = JSON.parse(stored);
      return history[videoId] || null;
    }
  }

  async syncLocalToServer(): Promise<void> {
    const token = getAuthToken();
    if (!token) return;

    const stored = localStorage.getItem('watchHistory');
    if (!stored) return;

    const history = JSON.parse(stored);
    const entries = Object.values(history) as WatchProgress[];

    await Promise.all(
      entries.map(progress => this.saveProgress(progress))
    );

    localStorage.removeItem('watchHistory');
  }
}
```

**Integration in CustomVideoPlayer:**
```typescript
const watchHistoryService = useRef(new WatchHistoryService());

// Load saved progress on mount
useEffect(() => {
  const loadProgress = async () => {
    const progress = await watchHistoryService.current.getProgress(videoId);
    if (progress && progress.watchTime > 10) {
      setStartTime(progress.watchTime);
    }
  };
  loadProgress();
}, [videoId]);

// Save progress periodically
useEffect(() => {
  const saveInterval = setInterval(() => {
    saveProgress();
  }, 10000);  // Every 10 seconds

  return () => clearInterval(saveInterval);
}, []);

// Save progress function
const saveProgress = async (completed = false) => {
  if (!playerRef.current) return;

  const currentTime = playerRef.current.currentTime();
  const duration = playerRef.current.duration();

  // Mark as completed if watched >90%
  const watchPercentage = (currentTime / duration) * 100;
  const isCompleted = completed || watchPercentage > 90;

  await watchHistoryService.current.saveProgress({
    videoId,
    watchTime: currentTime,
    totalDuration: duration,
    completed: isCompleted,
    lastWatched: new Date().toISOString()
  });
};

// Save on pause and end
player.on('pause', () => saveProgress());
player.on('ended', () => saveProgress(true));
```

## Testing
- [ ] Progress saves correctly
- [ ] Resume works accurately
- [ ] Completed flag set >90%
- [ ] LocalStorage fallback works
- [ ] Sync on login works
- [ ] No duplicate API calls
- [ ] Progress visible in UI

## Dependencies
- API endpoint `/api/profile/watch-history` (to be created)
- Phase 1.3: CustomVideoPlayer ✓

## Estimated Effort
**Medium** - 3-4 hours
