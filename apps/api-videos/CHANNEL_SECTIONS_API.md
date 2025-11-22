# Channel Sections API Documentation

## Table of Contents

- [Overview](#overview)
- [Data Models](#data-models)
- [Section Types](#section-types)
- [API Endpoints](#api-endpoints)
  - [List Channel Sections](#list-channel-sections)
  - [Get Single Section](#get-single-section)
  - [Create Section](#create-section)
  - [Update Section](#update-section)
  - [Delete Section](#delete-section)
  - [Reorder Sections](#reorder-sections)
- [Auto-Population Logic](#auto-population-logic)
- [Code Examples](#code-examples)
- [Error Responses](#error-responses)

---

## Overview

The Channel Sections API allows channel owners to organize their channel content into customizable sections. Sections can display different types of content such as featured videos, recent uploads, playlists, and subscribed channels.

**Base URL:** `https://videos.api.alummahnow.net` (Production) or `http://127.0.0.1:3086` (Development)

**Authentication:**
- **Public operations** (GET): No authentication required for public channels
- **Authenticated operations** (POST, PUT, PATCH, DELETE): Requires JWT Bearer token

**Storage:**
- Sections are stored in R2 bucket `channel_sections` with composite key: `{channelId}/{sectionId}`
- Maximum 50 sections per channel

---

## Data Models

### ChannelSectionView (Response Model)

```typescript
{
  id: string;                              // Section UUID
  channelId: string;                       // Parent channel ID
  type: ChannelSectionType;                // Section type (see below)
  title: string;                           // Section title
  titleLocalized?: Record<string, string>; // Multi-language titles (e.g., {"ar": "مقاطع مميزة"})
  position: number;                        // Zero-based display order
  style: DisplayStyle;                     // "horizontal_row" | "vertical_list"
  itemCount: number;                       // Max items to display (1-20, default: 12)
  showTimestamp: boolean;                  // Show video timestamps
  showChannelName: boolean;                // Show channel name for videos
  content: {
    videoIds?: string[];                   // For featured_videos
    playlistId?: string;                   // For single_playlist
    playlistIds?: string[];                // For multiple_playlists
    channelIds?: string[];                 // For subscribed_channels (future)
  };
  dateCreated: string;                     // ISO 8601 timestamp
  dateModified: string;                    // ISO 8601 timestamp
}
```

### ChannelSectionCreateInput (Request Model)

```typescript
{
  type: ChannelSectionType;                // Required: Section type
  title: string;                           // Required: 1-100 characters
  titleLocalized?: Record<string, string>; // Optional: Multi-language titles
  style?: DisplayStyle;                    // Optional: Default "horizontal_row"
  videoIds?: string[];                     // Required for featured_videos (max 20)
  playlistId?: string;                     // Required for single_playlist
  playlistIds?: string[];                  // Required for multiple_playlists (max 10)
  channelIds?: string[];                   // Reserved for future use (max 20)
  itemCount?: number;                      // Optional: 1-20, default 12
  showTimestamp?: boolean;                 // Optional: Default true
  showChannelName?: boolean;               // Optional: Default false
}
```

### ChannelSectionUpdateInput (Request Model)

```typescript
{
  // All fields optional (partial update)
  title?: string;                          // 1-100 characters
  titleLocalized?: Record<string, string>;
  style?: DisplayStyle;
  videoIds?: string[];                     // Max 20
  playlistId?: string;
  playlistIds?: string[];                  // Max 10
  channelIds?: string[];                   // Max 20
  itemCount?: number;                      // 1-20
  showTimestamp?: boolean;
  showChannelName?: boolean;
}
```

---

## Section Types

### Manual Section Types (Require Content)

| Type | Description | Required Fields | Max Items |
|------|-------------|----------------|-----------|
| `featured_videos` | Manually curated featured videos | `videoIds` (1-20) | 20 |
| `single_playlist` | Display a specific playlist | `playlistId` | 1 |
| `multiple_playlists` | Display multiple playlists | `playlistIds` (1-10) | 10 |

### Auto-Populated Section Types (No Manual Content)

| Type | Description | Auto-Population Logic |
|------|-------------|----------------------|
| `recent_uploads` | Latest videos from channel | Automatically fetches recent videos based on `dateCreated` |
| `popular_uploads` | Most viewed videos from channel | Automatically fetches videos sorted by `viewsCount` |
| `subscribed_channels` | Channels the user subscribes to | Automatically fetches user's subscriptions |
| `liked_videos` | Videos the user has liked | Automatically fetches user's liked videos |

**Important:** Auto-populated sections reject manual content (videoIds, playlistId, etc.) and return validation errors if provided.

---

## API Endpoints

### List Channel Sections

Retrieves all sections for a channel, ordered by position.

**Endpoint:** `GET /api/channels/{channelId}/sections`

**Authentication:** Optional (public channels visible to all)

**Path Parameters:**
- `channelId` (string, required): Channel ID

**Query Parameters:**
- `limit` (integer, optional): Maximum sections to return (1-50, default: 20)
- `cursor` (string, optional): Pagination cursor from previous response
- `type` (string, optional): Filter by section type

**Response (200 OK):**
```json
{
  "success": true,
  "result": {
    "sections": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "channelId": "channel_123",
        "type": "featured_videos",
        "title": "Featured Videos",
        "titleLocalized": {
          "ar": "مقاطع مميزة"
        },
        "position": 0,
        "style": "horizontal_row",
        "itemCount": 12,
        "showTimestamp": true,
        "showChannelName": false,
        "content": {
          "videoIds": ["video_1", "video_2", "video_3"]
        },
        "dateCreated": "2025-01-15T10:30:00.000Z",
        "dateModified": "2025-01-15T10:30:00.000Z"
      },
      {
        "id": "660e8400-e29b-41d4-a716-446655440001",
        "channelId": "channel_123",
        "type": "recent_uploads",
        "title": "Recent Uploads",
        "position": 1,
        "style": "horizontal_row",
        "itemCount": 12,
        "showTimestamp": true,
        "showChannelName": false,
        "content": {},
        "dateCreated": "2025-01-15T10:35:00.000Z",
        "dateModified": "2025-01-15T10:35:00.000Z"
      }
    ],
    "pagination": {
      "cursor": "next_cursor_token",
      "hasMore": false,
      "total": 2
    }
  }
}
```

**Error Responses:**
- `404 Not Found`: Channel does not exist

**cURL Example:**
```bash
# List all sections
curl "http://127.0.0.1:3086/api/channels/channel_123/sections"

# List with pagination
curl "http://127.0.0.1:3086/api/channels/channel_123/sections?limit=10&cursor=abc123"

# Filter by type
curl "http://127.0.0.1:3086/api/channels/channel_123/sections?type=featured_videos"
```

---

### Get Single Section

Retrieves details of a specific channel section.

**Endpoint:** `GET /api/channels/{channelId}/sections/{sectionId}`

**Authentication:** Optional (public channels visible to all)

**Path Parameters:**
- `channelId` (string, required): Channel ID
- `sectionId` (string, required): Section ID

**Response (200 OK):**
```json
{
  "success": true,
  "result": {
    "section": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "channelId": "channel_123",
      "type": "single_playlist",
      "title": "My Favorite Lectures",
      "position": 0,
      "style": "vertical_list",
      "itemCount": 20,
      "showTimestamp": true,
      "showChannelName": true,
      "content": {
        "playlistId": "playlist_456"
      },
      "dateCreated": "2025-01-15T10:30:00.000Z",
      "dateModified": "2025-01-15T10:30:00.000Z"
    }
  }
}
```

**Error Responses:**
- `404 Not Found`: Channel or section does not exist

**cURL Example:**
```bash
curl "http://127.0.0.1:3086/api/channels/channel_123/sections/550e8400-e29b-41d4-a716-446655440000"
```

---

### Create Section

Creates a new section for a channel.

**Endpoint:** `POST /api/channels/{channelId}/sections`

**Authentication:** Required (must be channel owner)

**Authorization Header:**
```
Authorization: Bearer {jwt_token}
```

**Path Parameters:**
- `channelId` (string, required): Channel ID

**Request Body:**
```json
{
  "type": "featured_videos",
  "title": "Featured Islamic Lectures",
  "titleLocalized": {
    "ar": "محاضرات إسلامية مميزة"
  },
  "style": "horizontal_row",
  "videoIds": ["video_1", "video_2", "video_3"],
  "itemCount": 12,
  "showTimestamp": true,
  "showChannelName": false
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "result": {
    "section": {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "channelId": "channel_123",
      "type": "featured_videos",
      "title": "Featured Islamic Lectures",
      "titleLocalized": {
        "ar": "محاضرات إسلامية مميزة"
      },
      "position": 2,
      "style": "horizontal_row",
      "itemCount": 12,
      "showTimestamp": true,
      "showChannelName": false,
      "content": {
        "videoIds": ["video_1", "video_2", "video_3"]
      },
      "dateCreated": "2025-01-15T11:00:00.000Z",
      "dateModified": "2025-01-15T11:00:00.000Z"
    }
  }
}
```

**Validation Rules:**
1. User must own the channel (403 if not)
2. Maximum 50 sections per channel (400 if exceeded)
3. Title must be 1-100 characters
4. Content must match section type requirements:
   - `featured_videos`: Requires 1-20 videoIds
   - `single_playlist`: Requires playlistId
   - `multiple_playlists`: Requires 1-10 playlistIds
   - Auto-populated types: Must NOT provide any content
5. Position automatically set to last position + 1

**Error Responses:**
- `400 Bad Request`: Validation errors, max sections exceeded
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: User does not own the channel
- `404 Not Found`: Channel does not exist

**cURL Examples:**

**Featured Videos Section:**
```bash
curl -X POST "http://127.0.0.1:3086/api/channels/channel_123/sections" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "featured_videos",
    "title": "Featured Videos",
    "videoIds": ["video_1", "video_2", "video_3"],
    "itemCount": 12
  }'
```

**Single Playlist Section:**
```bash
curl -X POST "http://127.0.0.1:3086/api/channels/channel_123/sections" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "single_playlist",
    "title": "My Playlist",
    "playlistId": "playlist_456",
    "style": "vertical_list"
  }'
```

**Auto-Populated Section:**
```bash
curl -X POST "http://127.0.0.1:3086/api/channels/channel_123/sections" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_uploads",
    "title": "Recent Videos",
    "itemCount": 20
  }'
```

---

### Update Section

Updates an existing section with partial data.

**Endpoint:** `PUT /api/channels/{channelId}/sections/{sectionId}`

**Authentication:** Required (must be channel owner)

**Authorization Header:**
```
Authorization: Bearer {jwt_token}
```

**Path Parameters:**
- `channelId` (string, required): Channel ID
- `sectionId` (string, required): Section ID

**Request Body (Partial Update):**
```json
{
  "title": "Updated Featured Videos",
  "titleLocalized": {
    "ar": "مقاطع محدثة مميزة"
  },
  "videoIds": ["video_4", "video_5", "video_6"],
  "itemCount": 15
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "result": {
    "section": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "channelId": "channel_123",
      "type": "featured_videos",
      "title": "Updated Featured Videos",
      "titleLocalized": {
        "ar": "مقاطع محدثة مميزة"
      },
      "position": 0,
      "style": "horizontal_row",
      "itemCount": 15,
      "showTimestamp": true,
      "showChannelName": false,
      "content": {
        "videoIds": ["video_4", "video_5", "video_6"]
      },
      "dateCreated": "2025-01-15T10:30:00.000Z",
      "dateModified": "2025-01-15T12:00:00.000Z"
    }
  }
}
```

**Important Notes:**
- Only provided fields are updated (partial update)
- Cannot change section `type` (delete and recreate instead)
- Cannot change `position` (use PATCH /sections/reorder)
- Content validation applies based on existing section type

**Error Responses:**
- `400 Bad Request`: Validation errors
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: User does not own the channel
- `404 Not Found`: Channel or section does not exist

**cURL Example:**
```bash
curl -X PUT "http://127.0.0.1:3086/api/channels/channel_123/sections/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "itemCount": 15
  }'
```

---

### Delete Section

Permanently deletes a channel section.

**Endpoint:** `DELETE /api/channels/{channelId}/sections/{sectionId}`

**Authentication:** Required (must be channel owner)

**Authorization Header:**
```
Authorization: Bearer {jwt_token}
```

**Path Parameters:**
- `channelId` (string, required): Channel ID
- `sectionId` (string, required): Section ID

**Response (200 OK):**
```json
{
  "success": true,
  "result": {
    "message": "Section deleted successfully"
  }
}
```

**Behavior:**
- Section is permanently removed from R2 storage
- Other sections' positions are automatically decremented
- Example: If deleting section at position 1, sections at positions 2, 3, 4 become 1, 2, 3
- Operation is irreversible

**Error Responses:**
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: User does not own the channel
- `404 Not Found`: Channel or section does not exist

**cURL Example:**
```bash
curl -X DELETE "http://127.0.0.1:3086/api/channels/channel_123/sections/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### Reorder Sections

Reorders all sections for a channel in a single atomic operation.

**Endpoint:** `PATCH /api/channels/{channelId}/sections/reorder`

**Authentication:** Required (must be channel owner)

**Authorization Header:**
```
Authorization: Bearer {jwt_token}
```

**Path Parameters:**
- `channelId` (string, required): Channel ID

**Request Body:**
```json
{
  "sectionIds": [
    "section_3",
    "section_1",
    "section_2"
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "result": {
    "message": "Sections reordered successfully",
    "sections": [
      {
        "id": "section_3",
        "position": 0,
        "title": "Recent Uploads",
        ...
      },
      {
        "id": "section_1",
        "position": 1,
        "title": "Featured Videos",
        ...
      },
      {
        "id": "section_2",
        "position": 2,
        "title": "Popular Videos",
        ...
      }
    ]
  }
}
```

**Validation Rules:**
1. Must include ALL existing section IDs (no partial reordering)
2. No duplicate IDs allowed
3. All IDs must exist and belong to the channel
4. Operation is atomic (all succeed or all fail)

**Error Responses:**
- `400 Bad Request`: Validation errors (missing IDs, duplicates, invalid IDs)
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: User does not own the channel
- `404 Not Found`: Channel does not exist

**cURL Example:**
```bash
curl -X PATCH "http://127.0.0.1:3086/api/channels/channel_123/sections/reorder" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sectionIds": [
      "550e8400-e29b-41d4-a716-446655440002",
      "550e8400-e29b-41d4-a716-446655440000",
      "550e8400-e29b-41d4-a716-446655440001"
    ]
  }'
```

---

## Auto-Population Logic

### Implementation Details

Auto-populated sections (`recent_uploads`, `popular_uploads`, `subscribed_channels`, `liked_videos`) have special behavior:

**1. Content Validation:**
```typescript
// Auto-populated types reject manual content
if (AUTO_POPULATED_TYPES.includes(type)) {
  // Validation errors if any content provided:
  // - videoIds must be empty
  // - playlistId must be undefined
  // - playlistIds must be empty
  // - channelIds must be empty
}
```

**2. Runtime Population:**

Auto-populated sections store no content IDs in R2. Content is dynamically fetched at runtime based on the section type:

| Section Type | Population Logic |
|--------------|------------------|
| `recent_uploads` | Fetch channel videos sorted by `dateCreated DESC`, limit by `itemCount` |
| `popular_uploads` | Fetch channel videos sorted by `viewsCount DESC`, limit by `itemCount` |
| `subscribed_channels` | Fetch user's subscriptions, limit by `itemCount` |
| `liked_videos` | Fetch user's liked videos sorted by `dateLiked DESC`, limit by `itemCount` |

**3. Display Behavior:**

Frontend applications should:
- Check section `type`
- If auto-populated type, fetch content from appropriate endpoint
- Apply `itemCount`, `style`, `showTimestamp`, and `showChannelName` settings
- Cache aggressively (content changes frequently)

**Example Frontend Logic:**
```typescript
async function fetchSectionContent(section: ChannelSectionView) {
  if (section.type === 'featured_videos') {
    // Use section.content.videoIds directly
    return fetchVideosByIds(section.content.videoIds);
  }

  if (section.type === 'recent_uploads') {
    // Dynamically fetch recent videos
    return fetchChannelVideos(section.channelId, {
      sortBy: 'dateCreated',
      sortOrder: 'desc',
      limit: section.itemCount
    });
  }

  if (section.type === 'popular_uploads') {
    // Dynamically fetch popular videos
    return fetchChannelVideos(section.channelId, {
      sortBy: 'viewsCount',
      sortOrder: 'desc',
      limit: section.itemCount
    });
  }

  // ... other types
}
```

---

## Code Examples

### JavaScript/TypeScript Example (fetch API)

```javascript
const API_BASE = 'http://127.0.0.1:3086';
const JWT_TOKEN = 'your_jwt_token_here';

// List all sections
async function listSections(channelId) {
  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/sections`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );

  const data = await response.json();
  return data.result.sections;
}

// Create featured videos section
async function createFeaturedSection(channelId) {
  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/sections`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JWT_TOKEN}`
      },
      body: JSON.stringify({
        type: 'featured_videos',
        title: 'Featured Islamic Lectures',
        titleLocalized: {
          ar: 'محاضرات إسلامية مميزة'
        },
        videoIds: ['video_1', 'video_2', 'video_3'],
        itemCount: 12,
        showTimestamp: true
      })
    }
  );

  const data = await response.json();
  return data.result.section;
}

// Update section
async function updateSection(channelId, sectionId, updates) {
  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/sections/${sectionId}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JWT_TOKEN}`
      },
      body: JSON.stringify(updates)
    }
  );

  const data = await response.json();
  return data.result.section;
}

// Reorder sections
async function reorderSections(channelId, sectionIds) {
  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/sections/reorder`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JWT_TOKEN}`
      },
      body: JSON.stringify({ sectionIds })
    }
  );

  const data = await response.json();
  return data.result.sections;
}

// Delete section
async function deleteSection(channelId, sectionId) {
  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/sections/${sectionId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`
      }
    }
  );

  const data = await response.json();
  return data.result.message;
}

// Usage examples
async function examples() {
  const channelId = 'channel_123';

  // List sections
  const sections = await listSections(channelId);
  console.log('Sections:', sections);

  // Create section
  const newSection = await createFeaturedSection(channelId);
  console.log('Created:', newSection);

  // Update section
  const updated = await updateSection(channelId, newSection.id, {
    title: 'Updated Title',
    itemCount: 15
  });
  console.log('Updated:', updated);

  // Reorder sections
  const sectionIds = sections.map(s => s.id);
  const reordered = await reorderSections(channelId, sectionIds.reverse());
  console.log('Reordered:', reordered);

  // Delete section
  const message = await deleteSection(channelId, newSection.id);
  console.log('Deleted:', message);
}
```

### Python Example (requests library)

```python
import requests

API_BASE = 'http://127.0.0.1:3086'
JWT_TOKEN = 'your_jwt_token_here'

def list_sections(channel_id):
    """List all sections for a channel"""
    response = requests.get(
        f'{API_BASE}/api/channels/{channel_id}/sections'
    )
    response.raise_for_status()
    return response.json()['result']['sections']

def create_section(channel_id, section_data):
    """Create a new section"""
    response = requests.post(
        f'{API_BASE}/api/channels/{channel_id}/sections',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {JWT_TOKEN}'
        },
        json=section_data
    )
    response.raise_for_status()
    return response.json()['result']['section']

def update_section(channel_id, section_id, updates):
    """Update an existing section"""
    response = requests.put(
        f'{API_BASE}/api/channels/{channel_id}/sections/{section_id}',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {JWT_TOKEN}'
        },
        json=updates
    )
    response.raise_for_status()
    return response.json()['result']['section']

def reorder_sections(channel_id, section_ids):
    """Reorder all sections"""
    response = requests.patch(
        f'{API_BASE}/api/channels/{channel_id}/sections/reorder',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {JWT_TOKEN}'
        },
        json={'sectionIds': section_ids}
    )
    response.raise_for_status()
    return response.json()['result']['sections']

def delete_section(channel_id, section_id):
    """Delete a section"""
    response = requests.delete(
        f'{API_BASE}/api/channels/{channel_id}/sections/{section_id}',
        headers={'Authorization': f'Bearer {JWT_TOKEN}'}
    )
    response.raise_for_status()
    return response.json()['result']['message']

# Usage example
if __name__ == '__main__':
    channel_id = 'channel_123'

    # Create featured videos section
    new_section = create_section(channel_id, {
        'type': 'featured_videos',
        'title': 'Featured Islamic Lectures',
        'titleLocalized': {'ar': 'محاضرات إسلامية مميزة'},
        'videoIds': ['video_1', 'video_2', 'video_3'],
        'itemCount': 12
    })
    print('Created:', new_section)

    # Create auto-populated section
    recent_section = create_section(channel_id, {
        'type': 'recent_uploads',
        'title': 'Recent Videos',
        'itemCount': 20
    })
    print('Created recent section:', recent_section)

    # List all sections
    sections = list_sections(channel_id)
    print(f'Total sections: {len(sections)}')

    # Reorder sections
    section_ids = [s['id'] for s in sections]
    reordered = reorder_sections(channel_id, section_ids[::-1])
    print('Reordered:', len(reordered))
```

---

## Error Responses

### Standard Error Format

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message description",
  "details": [
    {
      "field": "videoIds",
      "message": "featured_videos type requires at least one video ID"
    }
  ]
}
```

### Common Error Codes

**400 Bad Request - Validation Errors**

```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "content",
      "message": "featured_videos type requires at least one video ID"
    }
  ]
}
```

**400 Bad Request - Max Sections Exceeded**

```json
{
  "success": false,
  "error": "Maximum 50 sections allowed per channel"
}
```

**400 Bad Request - Auto-Populated Content Error**

```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "content",
      "message": "recent_uploads sections are auto-populated, remove videoIds"
    }
  ]
}
```

**400 Bad Request - Reorder Mismatch**

```json
{
  "success": false,
  "error": "Section count mismatch",
  "details": {
    "expected": 5,
    "provided": 3,
    "missing": ["section_1", "section_2"]
  }
}
```

**401 Unauthorized - Missing Token**

```json
{
  "success": false,
  "error": "Missing or invalid Authorization header. Expected: Bearer <token>"
}
```

**403 Forbidden - Not Channel Owner**

```json
{
  "success": false,
  "error": "You can only create sections for your own channel"
}
```

**404 Not Found - Channel Not Found**

```json
{
  "success": false,
  "error": "Channel not found"
}
```

**404 Not Found - Section Not Found**

```json
{
  "success": false,
  "error": "Section not found"
}
```

**500 Internal Server Error - Reorder Failed**

```json
{
  "success": false,
  "error": "Failed to reorder sections"
}
```

---

## Best Practices

### 1. Section Organization

- **Use position wisely**: Place most important content first (position 0)
- **Limit sections**: Avoid overwhelming users with too many sections (recommend 3-7)
- **Mix section types**: Combine manual (featured_videos) with auto-populated (recent_uploads)

### 2. Performance Optimization

- **Cache section lists**: Section metadata changes infrequently
- **Lazy load content**: Only fetch video/playlist data when section is visible
- **Batch requests**: Use auto-populated sections to reduce manual content management

### 3. Internationalization

- **Always provide titleLocalized**: Support both English and Arabic audiences
- **Example structure**:
  ```json
  {
    "title": "Featured Videos",
    "titleLocalized": {
      "ar": "مقاطع مميزة",
      "en": "Featured Videos"
    }
  }
  ```

### 4. Error Handling

```javascript
async function createSectionSafely(channelId, sectionData) {
  try {
    const response = await fetch(
      `${API_BASE}/api/channels/${channelId}/sections`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${JWT_TOKEN}`
        },
        body: JSON.stringify(sectionData)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      // Handle specific error codes
      if (response.status === 400) {
        console.error('Validation error:', data.details);
      } else if (response.status === 403) {
        console.error('Permission denied:', data.error);
      } else if (response.status === 404) {
        console.error('Channel not found:', data.error);
      }
      throw new Error(data.error);
    }

    return data.result.section;
  } catch (error) {
    console.error('Failed to create section:', error);
    throw error;
  }
}
```

### 5. Atomic Reordering

When reordering sections, always:
1. Fetch current section list
2. Reorder section IDs in memory
3. Send complete reordered list in single request
4. Handle errors and retry if needed

```javascript
async function moveSectionToTop(channelId, sectionId) {
  // Fetch current sections
  const sections = await listSections(channelId);

  // Find target section
  const targetIndex = sections.findIndex(s => s.id === sectionId);
  if (targetIndex === -1) throw new Error('Section not found');

  // Create new order with target at top
  const sectionIds = sections.map(s => s.id);
  sectionIds.splice(targetIndex, 1); // Remove from current position
  sectionIds.unshift(sectionId);     // Add to top

  // Apply reorder atomically
  return await reorderSections(channelId, sectionIds);
}
```

---

## Constraints and Limits

| Constraint | Value |
|------------|-------|
| Max sections per channel | 50 |
| Max title length | 100 characters |
| Max video IDs (featured_videos) | 20 |
| Max playlist IDs (multiple_playlists) | 10 |
| Max channel IDs (subscribed_channels) | 20 |
| Min item count | 1 |
| Max item count | 20 |
| Default item count | 12 |
| Max pagination limit | 50 |
| Default pagination limit | 20 |

---

## Analytics Events

All section operations trigger analytics events in Cloudflare Queue:

| Operation | Event Type | Payload |
|-----------|------------|---------|
| Create section | `ChannelSectionCreate` | `{ channelId, sectionId, userId, timestamp }` |
| Update section | `ChannelSectionUpdate` | `{ channelId, sectionId, userId, timestamp }` |
| Delete section | `ChannelSectionDelete` | `{ channelId, sectionId, userId, timestamp }` |
| Reorder sections | `ChannelSectionReorder` | `{ channelId, userId, sectionCount, timestamp }` |

These events are consumed by the `processor` app for analytics tracking.

---

## Related Documentation

- **Channel API**: See `CHANNEL_API.md` for channel management endpoints
- **Video API**: See `TECHNICAL_DOCUMENTATION.md` for video endpoints
- **Playlist API**: See `TECHNICAL_DOCUMENTATION.md` for playlist endpoints
- **Authentication**: See `AUTHENTICATION.md` for JWT token acquisition
- **Developer Guide**: See `DEVELOPER_AUTH_GUIDE.md` for implementing auth in endpoints

---

## Interactive API Documentation

Explore the Channel Sections API interactively using Swagger UI:

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
