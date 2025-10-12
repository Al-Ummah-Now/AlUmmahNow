# Frontend Implementation Guide: Watch History & Resume Playback

This document provides implementation guidance for integrating the watch history backend APIs into the Next.js frontend.

## Backend Completed ✅

The following backend components are fully implemented and ready for use:

### API Endpoints

All endpoints require JWT authentication (`Authorization: Bearer <token>`):

1. **POST `/api/watch-history`** - Record a video view
   ```typescript
   // Request
   {
     videoId: string;
     progress?: number;  // Initial progress (default: 0)
     duration: number;   // Total video duration in seconds
   }

   // Response: WatchHistoryEntry
   ```

2. **GET `/api/watch-history`** - List watch history
   ```typescript
   // Query params
   ?limit=20&cursor=<cursor>&completed=false&sort=newest

   // Response: WatchHistoryResponse
   ```

3. **DELETE `/api/watch-history`** - Clear all watch history
4. **DELETE `/api/watch-history/:videoId`** - Remove specific entry
5. **POST `/api/watch-history/:videoId/progress`** - Update playback progress
   ```typescript
   // Request
   {
     progress: number;  // Current position in seconds
     duration: number;  // Total duration
   }
   ```

6. **GET `/api/watch-history/:videoId/progress`** - Get saved progress

### TypeScript Types

All types are available from `@al-ummah/shared-types`:

```typescript
import {
  WatchHistoryEntry,
  WatchProgressUpdate,
  WatchHistoryResponse,
  ContinueWatchingItem,
  // ... more types
} from '@al-ummah/shared-types';
```

## Frontend Implementation Tasks

### 1. Create API Client

**File**: `apps/web/src/lib/api/watch-history.ts`

```typescript
import type {
  WatchHistoryEntry,
  WatchHistoryResponse,
  RecordWatchRequest,
  WatchProgressUpdate
} from '@al-ummah/shared-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function recordWatchHistory(
  videoId: string,
  duration: number,
  progress = 0,
  token: string
): Promise<WatchHistoryEntry> {
  const response = await fetch(`${API_URL}/api/watch-history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ videoId, duration, progress }),
  });

  if (!response.ok) throw new Error('Failed to record watch history');
  return response.json();
}

export async function getWatchHistory(
  token: string,
  limit = 20,
  cursor?: string
): Promise<WatchHistoryResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.append('cursor', cursor);

  const response = await fetch(
    `${API_URL}/api/watch-history?${params}`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );

  if (!response.ok) throw new Error('Failed to fetch watch history');
  return response.json();
}

export async function updateWatchProgress(
  videoId: string,
  progress: number,
  duration: number,
  token: string
): Promise<void> {
  await fetch(`${API_URL}/api/watch-history/${videoId}/progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ progress, duration }),
  });
}

export async function getWatchProgress(
  videoId: string,
  token: string
): Promise<{ progress: number; duration: number } | null> {
  const response = await fetch(
    `${API_URL}/api/watch-history/${videoId}/progress`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Failed to fetch progress');
  return response.json();
}

export async function deleteWatchHistoryEntry(
  videoId: string,
  token: string
): Promise<void> {
  await fetch(`${API_URL}/api/watch-history/${videoId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
}

export async function clearWatchHistory(token: string): Promise<void> {
  await fetch(`${API_URL}/api/watch-history`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
}
```

### 2. Update Video Player Component

**File**: `apps/web/src/components/video/VideoPlayer.tsx` (or equivalent)

Add progress tracking that updates every 10 seconds:

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { recordWatchHistory, updateWatchProgress, getWatchProgress } from '@/lib/api/watch-history';

export function VideoPlayer({ videoId, videoUrl }: { videoId: string; videoUrl: string }) {
  const { user, token } = useAuth();
  const playerRef = useRef<any>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout>();
  const recordedRef = useRef(false);

  useEffect(() => {
    if (!user || !token || !playerRef.current) return;

    const player = playerRef.current;

    // Load saved progress and resume playback
    getWatchProgress(videoId, token).then((savedProgress) => {
      if (savedProgress && savedProgress.progress > 30) {
        // Ask user if they want to resume
        if (confirm(`Resume from ${formatTime(savedProgress.progress)}?`)) {
          player.currentTime(savedProgress.progress);
        }
      }
    });

    // Record initial watch history entry on first play
    const handleFirstPlay = async () => {
      if (!recordedRef.current) {
        recordedRef.current = true;
        await recordWatchHistory(videoId, player.duration(), 0, token);
      }
    };

    // Update progress every 10 seconds during playback
    const handleTimeUpdate = () => {
      if (progressIntervalRef.current) return;

      progressIntervalRef.current = setInterval(async () => {
        if (player.paused()) return;

        const currentTime = player.currentTime();
        const duration = player.duration();

        await updateWatchProgress(videoId, currentTime, duration, token);
      }, 10000); // Every 10 seconds
    };

    // Cleanup interval when paused
    const handlePause = () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = undefined;
      }
    };

    player.on('play', handleFirstPlay);
    player.on('playing', handleTimeUpdate);
    player.on('pause', handlePause);
    player.on('ended', handlePause);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      player.off('play', handleFirstPlay);
      player.off('playing', handleTimeUpdate);
      player.off('pause', handlePause);
      player.off('ended', handlePause);
    };
  }, [videoId, user, token]);

  // ... rest of player implementation
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
```

### 3. Create Continue Watching Section

**File**: `apps/web/src/components/home/ContinueWatching.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { getWatchHistory } from '@/lib/api/watch-history';
import type { ContinueWatchingItem } from '@al-ummah/shared-types';
import { VideoCard } from '@/components/video/VideoCard';

export function ContinueWatching() {
  const { user, token } = useAuth();
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !token) return;

    getWatchHistory(token, 10)
      .then((response) => {
        // Filter for incomplete videos (< 95% watched)
        const incomplete = response.entries
          .filter((entry) => !entry.completed && entry.progress > 30)
          .map((entry) => ({
            id: entry.id,
            videoId: entry.videoId,
            title: entry.videoTitle,
            thumbnail: entry.videoThumbnail,
            channelName: entry.channelName,
            progress: entry.progress,
            duration: entry.videoDuration,
            percentageWatched: entry.percentageWatched,
            lastWatchedAt: entry.lastWatchedAt,
          }));

        setItems(incomplete);
      })
      .finally(() => setLoading(false));
  }, [user, token]);

  if (!user || loading || items.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-2xl font-bold mb-4">Continue Watching</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <div key={item.videoId} className="relative">
            <VideoCard
              videoId={item.videoId}
              title={item.title}
              thumbnail={item.thumbnail}
              channelName={item.channelName}
            />
            {/* Progress bar overlay */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200">
              <div
                className="h-full bg-red-600"
                style={{ width: `${item.percentageWatched}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

Add to homepage:
```typescript
// apps/web/src/app/en/page.tsx
import { ContinueWatching } from '@/components/home/ContinueWatching';

export default function HomePage() {
  return (
    <main>
      <ContinueWatching />
      {/* ... rest of homepage */}
    </main>
  );
}
```

### 4. Create Watch History Page

**Files**:
- `apps/web/src/app/en/history/page.tsx`
- `apps/web/src/app/ar/history/page.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { getWatchHistory, deleteWatchHistoryEntry, clearWatchHistory } from '@/lib/api/watch-history';
import type { WatchHistoryEntry } from '@al-ummah/shared-types';
import { VideoCard } from '@/components/video/VideoCard';

export default function WatchHistoryPage() {
  const { user, token } = useAuth();
  const [entries, setEntries] = useState<WatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string>();

  const loadHistory = async () => {
    if (!token) return;

    setLoading(true);
    const response = await getWatchHistory(token, 20, cursor);
    setEntries((prev) => [...prev, ...response.entries]);
    setCursor(response.cursor);
    setLoading(false);
  };

  useEffect(() => {
    loadHistory();
  }, [token]);

  const handleDelete = async (videoId: string) => {
    if (!token) return;
    await deleteWatchHistoryEntry(videoId, token);
    setEntries((prev) => prev.filter((e) => e.videoId !== videoId));
  };

  const handleClearAll = async () => {
    if (!token || !confirm('Clear all watch history?')) return;
    await clearWatchHistory(token);
    setEntries([]);
  };

  if (!user) {
    return <div>Please sign in to view watch history</div>;
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Watch History</h1>
        <button
          onClick={handleClearAll}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Clear All
        </button>
      </div>

      {loading && entries.length === 0 ? (
        <div>Loading...</div>
      ) : entries.length === 0 ? (
        <div>No watch history yet</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {entries.map((entry) => (
              <div key={entry.id} className="relative">
                <VideoCard
                  videoId={entry.videoId}
                  title={entry.videoTitle}
                  thumbnail={entry.videoThumbnail}
                  channelName={entry.channelName}
                />
                <button
                  onClick={() => handleDelete(entry.videoId)}
                  className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded"
                  aria-label="Remove from history"
                >
                  ✕
                </button>
                {entry.progress > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200">
                    <div
                      className="h-full bg-red-600"
                      style={{ width: `${entry.percentageWatched}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {cursor && (
            <button
              onClick={loadHistory}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
            >
              Load More
            </button>
          )}
        </>
      )}
    </main>
  );
}
```

## Testing Checklist

- [ ] Record watch history when video starts playing
- [ ] Progress updates every 10 seconds during playback
- [ ] Resume playback prompt appears for partially watched videos
- [ ] Continue Watching section shows on homepage
- [ ] Watch History page displays all watched videos
- [ ] Delete individual entries works
- [ ] Clear all history works
- [ ] Pagination (Load More) works
- [ ] Progress bars display correctly
- [ ] All features work for both English and Arabic routes

## Deployment Notes

### Required R2 Buckets (Cloudflare Dashboard)

Before deploying, create these R2 buckets:
- `watch-history` (production)
- `watch-history-preview` (development/preview)

### Environment Variables

Already configured in `wrangler.jsonc`, no changes needed.

## Future Enhancements

- Export watch history
- Watch statistics dashboard
- Privacy controls (pause/disable tracking)
- Search/filter watch history
- Watch time insights
