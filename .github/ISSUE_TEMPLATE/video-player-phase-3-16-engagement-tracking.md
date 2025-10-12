---
name: "[Phase 3.5] Engagement Tracking (Likes, Views, Shares)"
about: Track user engagement actions
title: "[Phase 3.5] Add Engagement Tracking"
labels: phase-3, video-player, enhancement, analytics
assignees: ''
---

## Overview
Integrate video engagement tracking for likes, views, shares, and comments, connecting to existing API endpoints and analytics.

## Acceptance Criteria
- [ ] View count incremented on playback start
- [ ] Like/dislike actions tracked
- [ ] Share button with tracking
- [ ] Comment action tracked
- [ ] Subscribe action tracked
- [ ] Unique view detection (one per session)
- [ ] Engagement events sent to analytics
- [ ] API integration with existing endpoints
- [ ] Optimistic UI updates
- [ ] Debounced API calls

## Implementation

```typescript
// apps/web/src/services/api/engagement.service.ts
export class VideoEngagementService {
  private apiUrl = process.env.NEXT_PUBLIC_API_URL;
  private viewTracked = new Set<string>();

  async trackView(videoId: string): Promise<void> {
    // Only track once per session
    if (this.viewTracked.has(videoId)) return;

    try {
      await fetch(`${this.apiUrl}/api/videos/${videoId}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      this.viewTracked.add(videoId);
    } catch (error) {
      console.error('Failed to track view:', error);
    }
  }

  async toggleLike(videoId: string): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/api/videos/${videoId}/like`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.ok;
  }

  async shareVideo(videoId: string, method: 'link' | 'social'): Promise<void> {
    await fetch(`${this.apiUrl}/api/videos/${videoId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method })
    });
  }
}
```

**Integration:**
```typescript
export function CustomVideoPlayer(props: CustomVideoPlayerProps) {
  const engagementService = useRef(new VideoEngagementService());
  const [viewTracked, setViewTracked] = useState(false);

  useEffect(() => {
    if (!playerRef.current) return;

    // Track view on first play
    playerRef.current.one('play', async () => {
      if (!viewTracked) {
        await engagementService.current.trackView(props.videoId);
        setViewTracked(true);
        analyticsRef.current?.trackEngagement('view');
      }
    });
  }, []);

  return (
    <div className="video-player-wrapper">
      {/* Engagement buttons */}
      <div className="engagement-controls">
        <button onClick={handleLike}>
          👍 Like
        </button>
        <button onClick={handleShare}>
          🔗 Share
        </button>
      </div>

      {/* ... rest of player */}
    </div>
  );
}
```

## Testing
- [ ] View tracked once per session
- [ ] Like/dislike toggle works
- [ ] Share tracking works
- [ ] API calls successful
- [ ] Optimistic UI updates
- [ ] Works without authentication

## Dependencies
- API endpoints: `/api/videos/{id}/view`, `/api/videos/{id}/like`, `/api/videos/{id}/share`
- Phase 3.1: Analytics tracking ✓

## Estimated Effort
**Small** - 2 hours
