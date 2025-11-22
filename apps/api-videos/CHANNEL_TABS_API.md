# Channel Tabs API Documentation

## Table of Contents

- [Overview](#overview)
- [API Endpoints](#api-endpoints)
  - [List Channel Videos](#list-channel-videos)
  - [List Channel Shorts](#list-channel-shorts)
  - [List Channel Live Streams](#list-channel-live-streams)
  - [List Channel Playlists](#list-channel-playlists)
- [Data Models](#data-models)
- [Code Examples](#code-examples)
- [Error Responses](#error-responses)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Channel Tabs API provides endpoints to fetch content for each tab on a channel page. These endpoints allow filtering videos, shorts, live streams, and playlists by channel ID.

**Base URL:** `https://videos.api.alummahnow.net` (Production) or `http://127.0.0.1:3086` (Development)

**Authentication:**
- **Public operations** (GET): No authentication required for public channels
- **Private content**: Requires JWT Bearer token to view private videos/playlists owned by authenticated user

**Key Features:**
- Cursor-based pagination for efficient data fetching
- Privacy-aware filtering (private content only visible to owners)
- Sorting options (by date, views, title, likes)
- Category filtering for videos
- Status filtering for live streams

---

## API Endpoints

### List Channel Videos

Retrieves all videos (standard and long-form content, excluding shorts and live streams) for a specific channel.

**Endpoint:** `GET /api/channels/{id}/videos`

**Authentication:** Optional (private videos require JWT token)

**Path Parameters:**
- `id` (string, **required**): Channel ID

**Query Parameters:**
- `limit` (integer, optional): Maximum videos to return (default: 12, range: 1-100)
- `cursor` (string, optional): Pagination cursor from previous response
- `sort` (enum, optional): Sort order - `latest`, `popular`, `oldest` (default: `latest`)

**Request Headers (Optional):**
- `Authorization: Bearer {jwt_token}` - For viewing private videos
- `userId: {user_id}` - Automatically extracted from JWT if authenticated

**Response (200 OK):**
```json
{
  "cursor": "next_cursor_token",
  "limit": 9,
  "data": [
    {
      "id": "video_123",
      "title": "Understanding Tawheed",
      "titleLocalized": {
        "ar": "فهم التوحيد"
      },
      "description": "A comprehensive explanation of Islamic monotheism",
      "descriptionLocalized": {
        "ar": "شرح شامل للتوحيد الإسلامي"
      },
      "thumbnailUrl": "https://cdn.example.com/thumb.jpg",
      "thumbnailType": "custom",
      "thumbnailSizes": {
        "hd": "https://cdn.example.com/thumb_1280x720.jpg",
        "sd": "https://cdn.example.com/thumb_640x360.jpg",
        "mobile": "https://cdn.example.com/thumb_320x180.jpg",
        "thumb": "https://cdn.example.com/thumb_120x90.jpg"
      },
      "videoUrl": "https://stream.example.com/video_123.mp4",
      "userId": "user_456",
      "channelId": "channel_789",
      "channelName": "Islamic Knowledge",
      "channelAvatarUrl": "https://cdn.example.com/avatar.jpg",
      "duration": 1800,
      "width": 1920,
      "height": 1080,
      "availableResolutions": ["1080p", "720p", "480p", "360p"],
      "format": "mp4",
      "fileSize": 524288000,
      "views": 15420,
      "likesCount": 892,
      "dislikesCount": 23,
      "commentsCount": 156,
      "sharesCount": 45,
      "isPublic": true,
      "isLive": false,
      "isFeatured": true,
      "processingStatus": "completed",
      "tags": ["tawheed", "aqeedah", "islam"],
      "category": "islamic_education",
      "language": "en",
      "hasChapters": true,
      "hasSubtitles": true,
      "subtitleLanguages": ["en", "ar", "ur"],
      "dateCreated": "2025-01-15T10:30:00.000Z",
      "dateModified": "2025-01-16T14:20:00.000Z",
      "publishedAt": "2025-01-15T12:00:00.000Z"
    }
  ]
}
```

**Error Responses:**
- `400 Bad Request`: Invalid query parameters
- `500 Internal Server Error`: Server error

**cURL Examples:**

```bash
# List all public videos for a channel (default sort by latest)
curl "http://127.0.0.1:3086/api/channels/channel_789/videos"

# List videos sorted by popularity
curl "http://127.0.0.1:3086/api/channels/channel_789/videos?sort=popular&limit=20"

# List videos sorted by oldest first
curl "http://127.0.0.1:3086/api/channels/channel_789/videos?sort=oldest"

# List private videos (requires authentication)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://127.0.0.1:3086/api/channels/channel_789/videos"

# Paginated request
curl "http://127.0.0.1:3086/api/channels/channel_789/videos?cursor=abc123&limit=12"
```

---

### List Channel Shorts

Retrieves all short-form videos for a specific channel.

**Endpoint:** `GET /api/channels/{id}/shorts`

**Authentication:** Optional (private shorts require JWT token)

**Path Parameters:**
- `id` (string, **required**): Channel ID

**Query Parameters:**
- `limit` (integer, optional): Maximum shorts to return (default: 20, range: 1-100)
- `cursor` (string, optional): Pagination cursor from previous response

**Note:** Shorts are detected based on the `isShort` flag on videos. Only public shorts are returned unless authenticated as the channel owner.

**Response (200 OK):**
```json
{
  "cursor": "next_cursor_token",
  "limit": 9,
  "data": [
    {
      "id": "short_456",
      "title": "Daily Reminder",
      "titleLocalized": {
        "ar": "تذكير يومي"
      },
      "description": "Remember Allah in all your actions",
      "thumbnailUrl": "https://cdn.example.com/short_thumb.jpg",
      "videoUrl": "https://stream.example.com/short_456.mp4",
      "userId": "user_456",
      "channelId": "channel_789",
      "channelName": "Islamic Knowledge",
      "channelAvatarUrl": "https://cdn.example.com/avatar.jpg",
      "duration": 45,
      "width": 1080,
      "height": 1920,
      "views": 5234,
      "likesCount": 342,
      "dislikesCount": 8,
      "commentsCount": 67,
      "isPublic": true,
      "isLive": false,
      "tags": ["reminder", "dhikr"],
      "category": "islamic_reminders",
      "language": "en",
      "dateCreated": "2025-01-20T08:15:00.000Z",
      "publishedAt": "2025-01-20T09:00:00.000Z"
    }
  ]
}
```

**cURL Examples:**

```bash
# List all shorts for a channel (default sort by latest)
curl "http://127.0.0.1:3086/api/channels/channel_789/shorts"

# List shorts sorted by popularity
curl "http://127.0.0.1:3086/api/channels/channel_789/shorts?sort=popular"

# List shorts sorted by oldest first
curl "http://127.0.0.1:3086/api/channels/channel_789/shorts?sort=oldest"

# List private shorts (requires authentication)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://127.0.0.1:3086/api/channels/channel_789/shorts"

# Paginated request
curl "http://127.0.0.1:3086/api/channels/channel_789/shorts?cursor=xyz456&limit=20"
```

---

### List Channel Live Streams

Retrieves all live streams (past, current, and scheduled) for a specific channel.

**Endpoint:** `GET /api/channels/{id}/live`

**Authentication:** Optional (private streams require JWT token)

**Path Parameters:**
- `id` (string, **required**): Channel ID

**Query Parameters:**
- `limit` (integer, optional): Maximum streams to return (default: 20, range: 1-100)
- `cursor` (string, optional): Pagination cursor from previous response
- `active` (boolean, optional): If true, only return currently active live streams

**Response (200 OK):**
```json
{
  "success": true,
  "result": {
    "cursor": "next_cursor_token",
    "limit": 9,
    "data": [
      {
        "id": "livestream:stream_789",
        "title": "Live Quran Recitation",
        "titleLocalized": {
          "ar": "تلاوة القرآن المباشرة"
        },
        "description": "Join us for a beautiful Quran recitation session",
        "thumbnailUrl": "https://cdn.example.com/live_thumb.jpg",
        "userId": "user_456",
        "channelId": "channel_789",
        "channelName": "Islamic Knowledge",
        "channelAvatarUrl": "https://cdn.example.com/avatar.jpg",
        "status": "live",
        "isPrivate": false,
        "scheduledStartTime": "2025-01-22T18:00:00.000Z",
        "actualStartTime": "2025-01-22T18:02:00.000Z",
        "actualEndTime": null,
        "duration": null,
        "currentViewers": 523,
        "peakViewers": 678,
        "likesCount": 245,
        "dislikesCount": 5,
        "commentsCount": 89,
        "rtmpUrl": null,
        "streamKey": null,
        "tags": ["quran", "recitation", "live"],
        "category": "quran_recitation",
        "language": "ar",
        "dateCreated": "2025-01-20T10:00:00.000Z",
        "dateModified": "2025-01-22T18:02:00.000Z"
      },
      {
        "id": "livestream:stream_456",
        "title": "Islamic Q&A Session",
        "description": "Ask your questions about Islam",
        "thumbnailUrl": "https://cdn.example.com/qa_thumb.jpg",
        "userId": "user_456",
        "channelId": "channel_789",
        "channelName": "Islamic Knowledge",
        "status": "ended",
        "isPrivate": false,
        "scheduledStartTime": "2025-01-15T20:00:00.000Z",
        "actualStartTime": "2025-01-15T20:05:00.000Z",
        "actualEndTime": "2025-01-15T21:30:00.000Z",
        "duration": 5100,
        "peakViewers": 892,
        "likesCount": 456,
        "dislikesCount": 12,
        "commentsCount": 234,
        "tags": ["qa", "questions", "answers"],
        "category": "islamic_education",
        "language": "en",
        "dateCreated": "2025-01-14T15:00:00.000Z",
        "dateModified": "2025-01-15T21:30:00.000Z"
      }
    ]
  }
}
```

**Status Values:**
- `scheduled`: Stream is scheduled for future broadcast
- `live`: Stream is currently broadcasting
- `ended`: Stream has finished broadcasting
- `cancelled`: Scheduled stream was cancelled

**Privacy Notes:**
- `rtmpUrl` and `streamKey` are only visible to stream owner (authenticated user)
- Private streams only visible to channel owner

**Error Responses:**
- `400 Bad Request`: Invalid query parameters
- `500 Internal Server Error`: Server error

**cURL Examples:**

```bash
# List all live streams for a channel
curl "http://127.0.0.1:3086/api/channels/channel_789/live"

# List only currently active live streams
curl "http://127.0.0.1:3086/api/channels/channel_789/live?active=true"

# List with authentication (to see private streams)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://127.0.0.1:3086/api/channels/channel_789/live"

# Paginated request
curl "http://127.0.0.1:3086/api/channels/channel_789/live?cursor=xyz789&limit=20"
```

---

### List Channel Playlists

Retrieves all playlists created by a specific channel.

**Endpoint:** `GET /api/channels/{id}/playlists`

**Authentication:** Optional (private playlists require JWT token)

**Path Parameters:**
- `id` (string, **required**): Channel ID

**Query Parameters:**
- `limit` (integer, optional): Maximum playlists to return (default: 20, range: 1-100)
- `cursor` (string, optional): Pagination cursor from previous response

**Request Headers (Optional):**
- `Authorization: Bearer {jwt_token}` - For viewing private playlists

**Response (200 OK):**
```json
{
  "cursor": "next_cursor_token",
  "limit": 10,
  "data": [
    {
      "id": "playlist_123",
      "title": "Tafsir Series",
      "titleLocalized": {
        "ar": "سلسلة التفسير"
      },
      "description": "Complete Quran tafsir lecture series",
      "descriptionLocalized": {
        "ar": "سلسلة محاضرات تفسير القرآن الكاملة"
      },
      "thumbnailUrl": "https://cdn.example.com/playlist_thumb.jpg",
      "userId": "user_456",
      "channelId": "channel_789",
      "videoIds": ["video_1", "video_2", "video_3", "video_4"],
      "videoCount": 4,
      "isPublic": true,
      "viewsCount": 8920,
      "totalDuration": 14400,
      "dateCreated": "2025-01-10T09:00:00.000Z",
      "dateModified": "2025-01-20T16:30:00.000Z",
      "lastVideoAddedAt": "2025-01-20T16:30:00.000Z"
    },
    {
      "id": "playlist_456",
      "title": "Islamic History",
      "description": "Lectures on important events in Islamic history",
      "thumbnailUrl": "https://cdn.example.com/history_thumb.jpg",
      "userId": "user_456",
      "channelId": "channel_789",
      "videoIds": ["video_5", "video_6", "video_7"],
      "videoCount": 3,
      "isPublic": true,
      "viewsCount": 5430,
      "totalDuration": 10800,
      "dateCreated": "2025-01-12T14:00:00.000Z",
      "dateModified": "2025-01-18T11:15:00.000Z"
    }
  ]
}
```

**Privacy Filtering:**
- Public playlists (`isPublic: true`): Visible to all users
- Private playlists (`isPublic: false`): Only visible to owner (requires authentication)
- Unauthenticated users: Only see public playlists
- Authenticated users: See public playlists + their own private playlists

**Error Responses:**
- `400 Bad Request`: Invalid query parameters or missing channelId header
- `500 Internal Server Error`: Server error

**cURL Examples:**

```bash
# List all public playlists for a channel
curl "http://127.0.0.1:3086/api/channels/channel_789/playlists"

# List playlists with authentication (to see private playlists)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://127.0.0.1:3086/api/channels/channel_789/playlists"

# Paginated request
curl "http://127.0.0.1:3086/api/channels/channel_789/playlists?cursor=def456&limit=20"
```

---

## Data Models

### VideoView (Standard and Shorts)

```typescript
interface VideoView {
  // Core fields
  id: string;
  title: string;
  titleLocalized?: Record<string, string>;
  description: string | null;
  descriptionLocalized?: Record<string, string>;
  thumbnailUrl: string;
  thumbnailType?: 'auto' | 'custom';
  thumbnailSizes?: {
    hd?: string;      // 1280x720
    sd?: string;      // 640x360
    mobile?: string;  // 320x180
    thumb?: string;   // 120x90
  };
  videoUrl: string;

  // Ownership
  userId: string;
  channelId: string | null;
  channelName: string;
  channelAvatarUrl: string;

  // Metadata
  duration?: number;              // Duration in seconds
  width?: number;                 // Video width in pixels
  height?: number;                // Video height in pixels
  availableResolutions?: string[]; // e.g., ["1080p", "720p", "480p"]
  format?: string;                // e.g., "mp4"
  fileSize?: number;              // File size in bytes

  // Engagement
  views?: number;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;
  sharesCount?: number;

  // Status
  isPublic?: boolean;
  isLive?: boolean;
  isFeatured?: boolean;
  processingStatus?: VideoProcessingStatus;

  // Categorization
  tags?: string[];
  category?: VideoCategory;
  language?: string;

  // Features
  hasChapters?: boolean;
  hasSubtitles?: boolean;
  subtitleLanguages?: string[];

  // Timestamps
  dateCreated: string;            // ISO 8601
  dateModified: string;           // ISO 8601
  publishedAt?: string;           // ISO 8601

  // Scheduling
  scheduledPublishDate?: string;
  scheduledPublishStatus?: ScheduledPublishStatus;
}

type VideoProcessingStatus =
  | 'pending'
  | 'processing'
  | 'transcoding'
  | 'completed'
  | 'failed'
  | 'archived';

type ScheduledPublishStatus =
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

type VideoCategory =
  | 'quran_recitation'
  | 'islamic_education'
  | 'islamic_history'
  | 'hadith_studies'
  | 'islamic_reminders'
  | 'dawah'
  | 'islamic_lectures'
  | 'quranic_reflections'
  | 'other';
```

### LiveStreamView

```typescript
interface LiveStreamView {
  // Core fields
  id: string;                     // Prefixed with "livestream:"
  title: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  thumbnailUrl: string;

  // Ownership
  userId: string;
  channelId: string;
  channelName: string;
  channelAvatarUrl: string;

  // Stream status
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  isPrivate: boolean;

  // Timing
  scheduledStartTime: string;     // ISO 8601
  actualStartTime?: string;       // ISO 8601
  actualEndTime?: string;         // ISO 8601
  duration?: number;              // Duration in seconds (calculated for ended streams)

  // Engagement
  currentViewers?: number;        // For live streams
  peakViewers?: number;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;

  // Streaming URLs (owner only)
  rtmpUrl?: string;               // Only visible to owner
  streamKey?: string;             // Only visible to owner

  // Categorization
  tags?: string[];
  category?: VideoCategory;
  language?: string;

  // Timestamps
  dateCreated: string;            // ISO 8601
  dateModified: string;           // ISO 8601
}
```

### PlaylistView

```typescript
interface PlaylistView {
  // Core fields
  id: string;
  title: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  thumbnailUrl: string;

  // Ownership
  userId: string;
  channelId: string;

  // Content
  videoIds: string[];
  videoCount: number;

  // Status
  isPublic: boolean;

  // Metrics
  viewsCount?: number;
  totalDuration?: number;         // Total duration of all videos in seconds

  // Timestamps
  dateCreated: string;            // ISO 8601
  dateModified: string;           // ISO 8601
  lastVideoAddedAt?: string;      // ISO 8601
}
```

### PaginationResponse

```typescript
interface PaginationResponse<T> {
  cursor: string;                 // Next page cursor (empty if last page)
  limit: number;                  // Items per page
  data: T[];                      // Array of items
}
```

---

## Code Examples

### JavaScript/TypeScript Example (fetch API)

```javascript
const API_BASE = 'http://127.0.0.1:3086';
const JWT_TOKEN = 'your_jwt_token_here';

// Fetch channel videos
async function fetchChannelVideos(channelId, options = {}) {
  const {
    limit = 12,
    cursor = '',
    sort = 'latest',
    includePrivate = false
  } = options;

  const params = new URLSearchParams({
    limit: limit.toString(),
    sort,
    ...(cursor && { cursor })
  });

  const headers = {
    'Content-Type': 'application/json',
    ...(includePrivate && { 'Authorization': `Bearer ${JWT_TOKEN}` })
  };

  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/videos?${params}`,
    { method: 'GET', headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch videos: ${response.statusText}`);
  }

  return await response.json();
}

// Fetch channel shorts
async function fetchChannelShorts(channelId, options = {}) {
  const {
    limit = 12,
    cursor = '',
    sort = 'latest',
    includePrivate = false
  } = options;

  const params = new URLSearchParams({
    limit: limit.toString(),
    sort,
    ...(cursor && { cursor })
  });

  const headers = {
    'Content-Type': 'application/json',
    ...(includePrivate && { 'Authorization': `Bearer ${JWT_TOKEN}` })
  };

  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/shorts?${params}`,
    { method: 'GET', headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch shorts: ${response.statusText}`);
  }

  return await response.json();
}

// Fetch channel live streams
async function fetchChannelLiveStreams(channelId, options = {}) {
  const {
    limit = 20,
    cursor = '',
    active = null,
    includePrivate = false
  } = options;

  const params = new URLSearchParams({
    limit: limit.toString(),
    ...(cursor && { cursor }),
    ...(active !== null && { active: active.toString() })
  });

  const headers = {
    'Content-Type': 'application/json',
    ...(includePrivate && { 'Authorization': `Bearer ${JWT_TOKEN}` })
  };

  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/live?${params}`,
    { method: 'GET', headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch live streams: ${response.statusText}`);
  }

  return await response.json(); // Direct response format
}

// Fetch channel playlists
async function fetchChannelPlaylists(channelId, options = {}) {
  const {
    limit = 20,
    cursor = '',
    includePrivate = false
  } = options;

  const params = new URLSearchParams({
    limit: limit.toString(),
    ...(cursor && { cursor })
  });

  const headers = {
    'Content-Type': 'application/json',
    ...(includePrivate && { 'Authorization': `Bearer ${JWT_TOKEN}` })
  };

  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/playlists?${params}`,
    { method: 'GET', headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch playlists: ${response.statusText}`);
  }

  return await response.json();
}

// Usage examples
async function exampleUsage() {
  const channelId = 'channel_789';

  try {
    // Fetch videos sorted by views
    const videos = await fetchChannelVideos(channelId, {
      sort: 'views',
      limit: 20
    });
    console.log('Videos:', videos.data);

    // Fetch shorts
    const shorts = await fetchChannelShorts(channelId);
    console.log('Shorts:', shorts.data);

    // Fetch live streams (only currently active)
    const liveStreams = await fetchChannelLiveStreams(channelId, {
      active: true
    });
    console.log('Live Streams:', liveStreams.data);

    // Fetch playlists (including private ones if authenticated)
    const playlists = await fetchChannelPlaylists(channelId, {
      includePrivate: true
    });
    console.log('Playlists:', playlists.data);

    // Pagination example
    let allVideos = [];
    let cursor = '';
    do {
      const page = await fetchChannelVideos(channelId, { cursor, limit: 9 });
      allVideos = allVideos.concat(page.data);
      cursor = page.cursor;
    } while (cursor);
    console.log('All videos:', allVideos);

  } catch (error) {
    console.error('Error:', error);
  }
}
```

### Python Example (requests library)

```python
import requests
from typing import Optional, Dict, List

API_BASE = 'http://127.0.0.1:3086'
JWT_TOKEN = 'your_jwt_token_here'

def fetch_channel_videos(
    channel_id: str,
    limit: int = 12,
    cursor: str = '',
    sort: str = 'latest',
    include_private: bool = False
) -> Dict:
    """Fetch videos for a channel"""
    params = {
        'limit': limit,
        'sort': sort
    }
    if cursor:
        params['cursor'] = cursor

    headers = {}
    if include_private:
        headers['Authorization'] = f'Bearer {JWT_TOKEN}'

    response = requests.get(
        f'{API_BASE}/api/channels/{channel_id}/videos',
        params=params,
        headers=headers
    )
    response.raise_for_status()
    return response.json()

def fetch_channel_shorts(
    channel_id: str,
    limit: int = 12,
    cursor: str = '',
    sort: str = 'latest',
    include_private: bool = False
) -> Dict:
    """Fetch shorts for a channel"""
    params = {
        'limit': limit,
        'sort': sort
    }
    if cursor:
        params['cursor'] = cursor

    headers = {}
    if include_private:
        headers['Authorization'] = f'Bearer {JWT_TOKEN}'

    response = requests.get(
        f'{API_BASE}/api/channels/{channel_id}/shorts',
        params=params,
        headers=headers
    )
    response.raise_for_status()
    return response.json()

def fetch_channel_live_streams(
    channel_id: str,
    limit: int = 20,
    cursor: str = '',
    active: Optional[bool] = None,
    include_private: bool = False
) -> Dict:
    """Fetch live streams for a channel"""
    params = {'limit': limit}
    if cursor:
        params['cursor'] = cursor
    if active is not None:
        params['active'] = str(active).lower()

    headers = {}
    if include_private:
        headers['Authorization'] = f'Bearer {JWT_TOKEN}'

    response = requests.get(
        f'{API_BASE}/api/channels/{channel_id}/live',
        params=params,
        headers=headers
    )
    response.raise_for_status()
    return response.json()  # Direct response format

def fetch_channel_playlists(
    channel_id: str,
    limit: int = 20,
    cursor: str = '',
    include_private: bool = False
) -> Dict:
    """Fetch playlists for a channel"""
    params = {'limit': limit}
    if cursor:
        params['cursor'] = cursor

    headers = {}
    if include_private:
        headers['Authorization'] = f'Bearer {JWT_TOKEN}'

    response = requests.get(
        f'{API_BASE}/api/channels/{channel_id}/playlists',
        params=params,
        headers=headers
    )
    response.raise_for_status()
    return response.json()

def fetch_all_channel_videos(channel_id: str) -> List[Dict]:
    """Fetch all videos for a channel using pagination"""
    all_videos = []
    cursor = ''

    while True:
        page = fetch_channel_videos(channel_id, cursor=cursor)
        all_videos.extend(page['data'])
        cursor = page.get('cursor', '')
        if not cursor:
            break

    return all_videos

# Usage example
if __name__ == '__main__':
    channel_id = 'channel_789'

    # Fetch videos sorted by popularity
    videos = fetch_channel_videos(
        channel_id,
        sort='popular',
        limit=20
    )
    print(f'Videos: {len(videos["data"])} items')

    # Fetch shorts
    shorts = fetch_channel_shorts(channel_id)
    print(f'Shorts: {len(shorts["data"])} items')

    # Fetch live streams (only active)
    live_streams = fetch_channel_live_streams(
        channel_id,
        active=True
    )
    print(f'Live Streams: {len(live_streams["data"])} items')

    # Fetch playlists
    playlists = fetch_channel_playlists(
        channel_id,
        include_private=True
    )
    print(f'Playlists: {len(playlists["data"])} items')

    # Fetch all videos with pagination
    all_videos = fetch_all_channel_videos(channel_id)
    print(f'Total videos: {len(all_videos)}')
```

### React Component Example

```typescript
import { useState, useEffect } from 'react';

interface ChannelTabsProps {
  channelId: string;
  activeTab: 'videos' | 'shorts' | 'live' | 'playlists';
}

function ChannelTabs({ channelId, activeTab }: ChannelTabsProps) {
  const [content, setContent] = useState<any[]>([]);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    setContent([]);
    setCursor('');
    setHasMore(true);
    loadContent();
  }, [channelId, activeTab]);

  const loadContent = async () => {
    if (loading || !hasMore) return;
    setLoading(true);

    try {
      let response;

      switch (activeTab) {
        case 'videos':
          response = await fetch(
            `/api/channels/${channelId}/videos?cursor=${cursor}&limit=12`
          );
          break;

        case 'shorts':
          response = await fetch(
            `/api/channels/${channelId}/shorts?cursor=${cursor}&limit=12`
          );
          break;

        case 'live':
          response = await fetch(
            `/api/channels/${channelId}/live?cursor=${cursor}&limit=12`
          );
          break;

        case 'playlists':
          response = await fetch(
            `/api/channels/${channelId}/playlists?cursor=${cursor}&limit=12`
          );
          break;
      }

      const data = await response.json();
      const items = data.data;
      const nextCursor = data.cursor;

      setContent(prev => [...prev, ...items]);
      setCursor(nextCursor);
      setHasMore(!!nextCursor);
    } catch (error) {
      console.error('Failed to load content:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-4">
        {content.map(item => (
          <div key={item.id} className="card">
            <img src={item.thumbnailUrl} alt={item.title} />
            <h3>{item.title}</h3>
            {item.duration && <span>{formatDuration(item.duration)}</span>}
            {item.likesCount && <span>{item.likesCount} likes</span>}
          </div>
        ))}
      </div>

      {hasMore && (
        <button onClick={loadContent} disabled={loading}>
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
```

---

## Error Responses

### Standard Error Format

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

### Common Error Codes

**400 Bad Request - Invalid Parameters**

```json
{
  "success": false,
  "error": "Invalid sort parameter. Must be one of: date, views, title, likes"
}
```

```json
{
  "success": false,
  "error": "Invalid category. Must be a valid VideoCategory enum value"
}
```

**401 Unauthorized - Missing Authentication**

```json
{
  "success": false,
  "error": "Missing or invalid Authorization header. Expected: Bearer <token>"
}
```

**403 Forbidden - Invalid Token**

```json
{
  "success": false,
  "error": "Authentication failed"
}
```

**500 Internal Server Error**

```json
{
  "success": false,
  "error": "Failed to fetch videos"
}
```

```json
{
  "success": false,
  "error": "Failed to fetch live streams"
}
```

---

## Troubleshooting

### Videos Not Showing

**Issue:** No videos returned for a channel that should have content

**Solutions:**
1. **Check channelId**: Verify the channelId is correct
   ```bash
   curl "http://127.0.0.1:3086/api/channels/{channelId}"
   ```

2. **Check privacy settings**: Private videos require authentication
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     "http://127.0.0.1:3086/api/channels/{channelId}/videos"
   ```

3. **Check channel exists**: Verify the channel ID is valid
   ```bash
   # Verify channel exists
   curl "http://127.0.0.1:3086/api/channels/{channelId}"
   ```

### Playlists Endpoint Returns Empty

**Issue:** Playlists endpoint returns empty array despite channel having playlists

**Solutions:**
1. **Check channel ID**: Ensure you're using the correct channel ID in the path
   ```bash
   # Correct way (channel ID in path)
   curl "http://127.0.0.1:3086/api/channels/channel_789/playlists"
   ```

2. **Private playlists**: Add authentication to see private playlists
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     "http://127.0.0.1:3086/api/channels/channel_789/playlists"
   ```

### Response Format is Consistent

**Note:** All channel tabs endpoints now use the same response format:

```javascript
// All endpoints use the same format
const response = await fetch('/api/channels/channel_789/videos');
const data = await response.json();
const items = data.data; // Direct access to data array
const nextCursor = data.cursor; // Cursor for next page
const limit = data.limit; // Items per page
```

### Pagination Not Working

**Issue:** Cursor pagination returns duplicate or missing items

**Solutions:**
1. **Store cursor correctly**: Use the cursor from the response
   ```javascript
   const page1 = await fetch('/api/channels/channel_789/videos');
   const data1 = await page1.json();
   const cursor = data1.cursor; // Store this cursor

   const page2 = await fetch(`/api/channels/channel_789/videos?cursor=${cursor}`);
   ```

2. **Check hasMore logic**: Empty cursor means last page
   ```javascript
   const hasMore = !!response.cursor && response.cursor !== '';
   if (!hasMore) {
     // Last page reached
   }
   ```

3. **Don't modify limit mid-pagination**: Keep limit consistent across requests
   ```javascript
   // Good
   const limit = 9;
   fetch(`/api/videos?limit=${limit}&cursor=...`);

   // Bad (changing limit mid-pagination)
   fetch('/api/videos?limit=9');
   fetch('/api/videos?limit=20&cursor=...'); // Wrong!
   ```

### Shorts Detection

**Note:** Shorts are detected based on video duration (< 60 seconds) automatically by the server.

The `/api/channels/{id}/shorts` endpoint filters videos where:
- Video belongs to the channel
- `duration < 60` seconds
- `isLive` is false (excludes live streams)
- Respects privacy settings (public unless authenticated as owner)

**Important:** Videos must have a `duration` field set. Videos without duration metadata will not appear in shorts results.

### CORS Errors in Browser

**Issue:** Browser blocks requests due to CORS policy

**Solutions:**
1. **Development**: API allows all origins with `Access-Control-Allow-Origin: *`
2. **Check headers**: Ensure you're sending allowed headers only
   ```javascript
   // Allowed headers
   fetch('/api/videos', {
     headers: {
       'Content-Type': 'application/json',
       'Authorization': 'Bearer ...',
       'channelId': '...',
       'userId': '...'
     }
   });
   ```

3. **OPTIONS preflight**: API handles OPTIONS requests automatically

### Authentication Token Expired

**Issue:** 401 errors when accessing private content

**Solutions:**
1. **Check token expiration**: JWT tokens have expiration times
   ```javascript
   // Decode JWT to check expiration
   const payload = JSON.parse(atob(token.split('.')[1]));
   const expiresAt = new Date(payload.exp * 1000);
   console.log('Token expires:', expiresAt);
   ```

2. **Refresh token**: Obtain new token from OpenAuth provider
3. **Verify token format**: Must be `Bearer {token}` format
   ```bash
   # Correct
   curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

   # Wrong
   curl -H "Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   ```

---

## Best Practices

### 1. Efficient Pagination

Load content in batches and cache results:

```javascript
class ChannelContentLoader {
  constructor(channelId) {
    this.channelId = channelId;
    this.cache = new Map();
  }

  async loadVideos(cursor = '', limit = 9) {
    const cacheKey = `videos:${cursor}:${limit}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const response = await fetch(
      `/api/videos?channelId=${this.channelId}&cursor=${cursor}&limit=${limit}`
    );
    const data = await response.json();

    // Cache for 5 minutes
    this.cache.set(cacheKey, data);
    setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);

    return data;
  }
}
```

### 2. Error Handling

Always handle errors gracefully:

```javascript
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || response.statusText);
      }

      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      // Exponential backoff
      await new Promise(resolve =>
        setTimeout(resolve, Math.pow(2, i) * 1000)
      );
    }
  }
}
```

### 3. Optimize Network Requests

Batch requests and use appropriate limits:

```javascript
// Good: Fetch appropriate amount
async function loadChannelTabs(channelId) {
  const [videos, shorts, live, playlists] = await Promise.all([
    fetch(`/api/channels/${channelId}/videos?limit=6`),
    fetch(`/api/channels/${channelId}/shorts?limit=6`),
    fetch(`/api/channels/${channelId}/live?limit=3`),
    fetch(`/api/channels/${channelId}/playlists?limit=4`)
  ]);

  return {
    videos: await videos.json(),
    shorts: await shorts.json(),
    live: await live.json(),
    playlists: await playlists.json()
  };
}

// Bad: Fetch too much data
async function loadChannelTabsBad(channelId) {
  // Don't fetch 100 items if you only show 6
  const videos = await fetch(
    `/api/channels/${channelId}/videos?limit=100`
  );
}
```

### 4. Handle Private Content

Check authentication status before making requests:

```javascript
function getAuthHeaders(includePrivate = false) {
  if (!includePrivate) return {};

  const token = localStorage.getItem('authToken');
  if (!token) {
    console.warn('Private content requested but no auth token available');
    return {};
  }

  return {
    'Authorization': `Bearer ${token}`
  };
}

async function fetchChannelContent(channelId, includePrivate) {
  const headers = getAuthHeaders(includePrivate);

  const response = await fetch(
    `/api/channels/${channelId}/videos`,
    { headers }
  );

  return await response.json();
}
```

---

## Related Documentation

- **Channel Sections API**: See `CHANNEL_SECTIONS_API.md` for customizable channel sections
- **Video API**: See `TECHNICAL_DOCUMENTATION.md` for video management endpoints
- **Playlist API**: See `TECHNICAL_DOCUMENTATION.md` for playlist management endpoints
- **Live Streaming API**: See `TECHNICAL_DOCUMENTATION.md` for live stream management
- **Authentication**: See `AUTHENTICATION.md` for JWT token acquisition
- **Developer Guide**: See `DEVELOPER_AUTH_GUIDE.md` for implementing auth in endpoints

---

## Interactive API Documentation

Explore the Channel Tabs API interactively using Swagger UI:

- **Development**: http://127.0.0.1:3086/
- **Production**: https://videos.api.alummahnow.net/

The Swagger UI provides:
- Live API testing with authentication
- Request/response schemas
- Example payloads
- OAuth2 authorization flow

---

**Last Updated:** 2025-01-22
**API Version:** 1.0.0
**OpenAPI Version:** 3.1.0
