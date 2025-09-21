# OpenAPI Implementation

This directory contains the complete implementation of the OpenAPI specification for the Al Ummah Now video platform API.

## Structure

```
src/lib/api/
├── index.ts          # Main API client exports and factory
├── types.ts          # TypeScript type definitions from OpenAPI spec
├── videos.ts         # Videos API endpoints
├── channels.ts       # Channels and Profiles API endpoints
└── playlists.ts      # Playlists API endpoints
```

## Usage

### Basic Usage

```typescript
import { VideosAPI, ProfilesAPI, ChannelsAPI, PlaylistsAPI } from '@/lib/api';

// List videos
const videos = await VideosAPI.list({ limit: 10 });

// Get a specific video
const video = await VideosAPI.getById('video-id');

// Get current user profile (requires authentication headers)
const profile = await ProfilesAPI.getCurrent('user-id', {
  channelId: 'channel-id',
  userId: 'user-id'
});
```

### Using the API Client Factory

```typescript
import { APIClient, createAuthenticatedClient } from '@/lib/api';

// Create authenticated client
const client = createAuthenticatedClient('channel-id', 'user-id');

// Use the client
const videos = await client.videos.list({ limit: 10 });
const profile = await client.profiles.getCurrent();
```

## API Endpoints Implemented

### Videos API (`VideosAPI`)

- **GET** `/api/videos` - List videos with pagination
- **GET** `/api/videos/{id}` - Get video by ID
- **POST** `/api/videos` - Create new video (authenticated)
- **DELETE** `/api/videos/{id}` - Delete video (authenticated)
- **POST** `/api/videos/{id}/comments` - Create comment (authenticated)
- **PUT** `/api/videos/{id}/comments/{cid}` - Update comment (authenticated)
- **DELETE** `/api/videos/{id}/comments/{cid}` - Delete comment (authenticated)
- **POST** `/api/videos/{id}/likes` - Like video (authenticated)
- **DELETE** `/api/videos/{id}/likes` - Unlike video (authenticated)
- **POST** `/api/videos/{id}/dislikes` - Dislike video (authenticated)
- **DELETE** `/api/videos/{id}/dislikes` - Remove dislike (authenticated)
- **POST** `/api/videos/{id}/comments/{cid}/likes` - Like comment (authenticated)
- **DELETE** `/api/videos/{id}/comments/{cid}/likes` - Unlike comment (authenticated)
- **POST** `/api/videos/{id}/comments/{cid}/dislikes` - Dislike comment (authenticated)
- **DELETE** `/api/videos/{id}/comments/{cid}/dislikes` - Remove comment dislike (authenticated)

### Profiles API (`ProfilesAPI`)

- **GET** `/api/profile` - Get current user profile (authenticated)
- **PUT** `/api/profile` - Update current user profile (authenticated)
- **DELETE** `/api/profile` - Delete current user profile (authenticated)

### Channels API (`ChannelsAPI`)

- **GET** `/api/channels` - List channels with pagination
- **GET** `/api/channels/{id}` - Get channel by ID
- **POST** `/api/channels` - Create new channel (authenticated)
- **PUT** `/api/channels/{id}` - Update channel (authenticated)
- **DELETE** `/api/channels/{id}` - Delete channel (authenticated)
- **POST** `/api/channels/{id}/subscribe` - Subscribe to channel (authenticated)
- **DELETE** `/api/channels/{id}/subscribe` - Unsubscribe from channel (authenticated)

### Playlists API (`PlaylistsAPI`)

- **GET** `/api/playlists` - List playlists with pagination
- **GET** `/api/playlists/{id}` - Get playlist by ID
- **POST** `/api/playlists` - Create new playlist (authenticated)
- **PUT** `/api/playlists/{id}` - Update playlist (authenticated)
- **DELETE** `/api/playlists/{id}` - Delete playlist (authenticated)
- **POST** `/api/playlists/{id}/videos` - Add video to playlist (authenticated)
- **DELETE** `/api/playlists/{id}/videos/{vid}` - Remove video from playlist (authenticated)

## Authentication

Most endpoints require authentication headers:

```typescript
const headers = {
  channelId: 'your-channel-id',
  userId: 'your-user-id'
};

await VideosAPI.create(videoData, headers);
```

## Error Handling

All API functions return `null` on error and log errors to the console. For production use, consider implementing more robust error handling:

```typescript
const video = await VideosAPI.getById('video-id');
if (!video) {
  // Handle error case
  console.log('Failed to fetch video');
  return;
}

// Use video data
console.log(video.title);
```

## Type Safety

All API functions use TypeScript interfaces that match the OpenAPI specification exactly:

```typescript
import { VideoCreateRequest, VideoObject } from '@/lib/api/types';

const newVideo: VideoCreateRequest = {
  title: 'My Video',
  description: 'Video description',
  // ... other required fields
};

const result = await VideosAPI.create(newVideo, headers);
```

## Environment Variables

The API client uses the following environment variables:

- `NEXT_PUBLIC_API_URL` - Public API base URL (for client-side)
- `API_URL` - API base URL (fallback for server-side)

Default: `https://videos.api.alummahnow.net`

## Backward Compatibility

The existing client files in `src/lib/clients/` have been updated to use the new API while maintaining backward compatibility for existing components.