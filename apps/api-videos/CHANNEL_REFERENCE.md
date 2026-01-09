# Channel Sections & Tabs API Reference

**Complete reference for managing channel sections and tabs in Al Ummah Now video platform.**

**Version:** 1.0.0
**Last Updated:** 2025-01-25
**Status:** ✅ Implemented (See [Implementation Status](#implementation-status))

---

## Table of Contents

1. [Overview](#overview)
2. [Channel Tabs](#channel-tabs)
3. [Channel Sections](#channel-sections)
4. [API Endpoints](#api-endpoints)
5. [Data Models](#data-models)
6. [Implementation Status](#implementation-status)
7. [Testing](#testing)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)

---

## Overview

### What Are Channel Tabs?

YouTube-style channel tabs provide navigation between different types of channel content:
- **Home** - Default tab, shows customizable sections
- **Videos** - All long-form videos
- **Shorts** - Short-form videos (<60 seconds)
- **Live** - Live streams (past, current, upcoming)
- **Playlists** - All public playlists
- **Community** - Posts and polls (requires 1K+ subscribers)
- **About** - Channel description and stats

### What Are Channel Sections?

Channel sections allow content creators to organize their **Home tab** with curated collections:
- Featured videos (manual curation)
- Recent uploads (auto-populated)
- Popular uploads (auto-populated)
- Playlists showcase
- Subscribed channels
- Liked videos

**Key Constraints:**
- Sections only appear in the **Home tab**
- Maximum 5 sections per channel (reduced from YouTube's 10 for better UX)
- 7 section types supported
- Drag-and-drop reordering in management UI

---

## Channel Tabs

### Tab Visibility Rules

Tabs are dynamically shown based on channel content:

| Tab | Visibility Condition | Always Visible |
|-----|---------------------|----------------|
| Home | Always | ✅ |
| Videos | `videosCount > 0` | ❌ |
| Shorts | `shortsCount > 0` | ❌ |
| Live | `liveStreamsCount > 0` | ❌ |
| Playlists | `playlistsCount > 0` | ❌ |
| Community | `subscribersCount >= 1000` | ❌ |
| About | Always | ✅ |

### Tab API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/channels/{id}/videos` | GET | List all videos for channel |
| `/api/channels/{id}/shorts` | GET | List all shorts for channel |
| `/api/channels/{id}/live` | GET | List live streams |
| `/api/channels/{id}/playlists` | GET | List playlists |

**Note:** Home and About tabs are UI-only (no dedicated API endpoints).

**See:** [CHANNEL_TABS_API.md](./CHANNEL_TABS_API.md) for complete tab API documentation.

---

## Channel Sections

### Section Types

| Type | Description | Content Source | Max Items |
|------|-------------|----------------|-----------|
| `featured_videos` | Manually curated videos | Requires `videoIds` (1-20) | 20 |
| `recent_uploads` | Latest channel videos | Auto-populated from channel | Auto |
| `popular_uploads` | Most viewed videos | Auto-populated from channel | Auto |
| `single_playlist` | Single playlist display | Requires `playlistId` | - |
| `multiple_playlists` | Multiple playlists | Requires `playlistIds` (1-10) | 10 |
| `subscribed_channels` | Channels user subscribes to | Auto-populated (placeholder) | Auto |
| `liked_videos` | User's liked videos | Auto-populated (placeholder) | Auto |

### Display Styles

| Style | Description | Use Case |
|-------|-------------|----------|
| `horizontal_row` | Single row with horizontal scroll | Featured content, playlists (default) |
| `vertical_list` | Vertical list with details | Long lists, detailed information |

### Section Constraints

| Constraint | Value |
|------------|-------|
| Max sections per channel | 5 (reduced from 50) |
| Max title length | 100 characters |
| Max video IDs (featured_videos) | 20 |
| Max playlist IDs (multiple_playlists) | 10 |
| Max channel IDs (subscribed_channels) | 20 |
| Min item count | 1 |
| Max item count | 20 |
| Default item count | 12 |

---

## API Endpoints

### Base URL

- **Development:** `http://127.0.0.1:3086`
- **Production:** `https://videos.api.alummahnow.net`

### Channel Sections Endpoints

| Endpoint | Method | Auth | Description | Status |
|----------|--------|------|-------------|--------|
| `/api/channels/:channelId/sections` | GET | Optional | List all sections | ✅ Working |
| `/api/channels/:channelId/sections/populated` | GET | Optional | List sections with content | ✅ Working |
| `/api/channels/:channelId/sections/:sectionId` | GET | Optional | Get single section | ✅ Working |
| `/api/channels/:channelId/sections` | POST | Required | Create section | ✅ Working* |
| `/api/channels/:channelId/sections/:sectionId` | PUT | Required | Update section | ✅ Working* |
| `/api/channels/:channelId/sections/:sectionId` | DELETE | Required | Delete section | ✅ Working* |
| `/api/channels/:channelId/sections/reorder` | PATCH | Required | Reorder sections | ✅ Working* |

*Requires valid JWT token for production use

### Quick Examples

#### List Sections (Public)
```bash
curl "http://127.0.0.1:3086/api/channels/{channelId}/sections"
```

#### Get Populated Sections
```bash
# With auto-population (default)
curl "http://127.0.0.1:3086/api/channels/{channelId}/sections/populated"

# Without population
curl "http://127.0.0.1:3086/api/channels/{channelId}/sections/populated?populate=false"

# Filter by type
curl "http://127.0.0.1:3086/api/channels/{channelId}/sections/populated?type=recent_uploads"
```

#### Create Section (Auth Required)
```bash
# Featured videos section
curl -X POST "http://127.0.0.1:3086/api/channels/{channelId}/sections" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "featured_videos",
    "title": "Featured Content",
    "videoIds": ["video-1", "video-2"],
    "style": "horizontal_row"
  }'

# Recent uploads section (auto-populated)
curl -X POST "http://127.0.0.1:3086/api/channels/{channelId}/sections" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_uploads",
    "title": "Latest Videos",
    "itemCount": 12
  }'
```

#### Reorder Sections
```bash
curl -X PATCH "http://127.0.0.1:3086/api/channels/{channelId}/sections/reorder" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "sectionIds": ["section-2", "section-1", "section-3"]
  }'
```

---

## Data Models

### ChannelSection (Storage Model)

```typescript
interface ChannelSection {
  // Identity
  id: string;                              // Section UUID
  channelId: string;                       // Parent channel ID
  userId: string;                          // Owner user ID

  // Metadata
  type: ChannelSectionType;                // Section type
  title: string;                           // Section title
  titleLocalized?: Record<string, string>; // Multi-language titles
  position: number;                        // Zero-based display order
  style: 'horizontal_row' | 'vertical_list'; // Display style

  // Content references
  videoIds?: string[];                     // For featured_videos
  playlistId?: string;                     // For single_playlist
  playlistIds?: string[];                  // For multiple_playlists
  channelIds?: string[];                   // For subscribed_channels

  // Display settings
  itemCount: number;                       // Max items to display (1-20)
  showTimestamp: boolean;                  // Show video timestamps
  showChannelName: boolean;                // Show channel name

  // Timestamps
  dateCreated: string;                     // ISO 8601
  dateModified: string;                    // ISO 8601
}

type ChannelSectionType =
  | 'featured_videos'
  | 'recent_uploads'
  | 'popular_uploads'
  | 'single_playlist'
  | 'multiple_playlists'
  | 'subscribed_channels'
  | 'liked_videos';
```

### ChannelSectionView (API Response)

```typescript
interface ChannelSectionView {
  id: string;
  channelId: string;
  type: ChannelSectionType;
  title: string;
  titleLocalized?: Record<string, string>;
  position: number;
  style: string;
  itemCount: number;
  showTimestamp: boolean;
  showChannelName: boolean;
  content: {
    videoIds?: string[];
    playlistId?: string;
    playlistIds?: string[];
    channelIds?: string[];
  };
  dateCreated: string;
  dateModified: string;
}
```

### Request Models

#### Create Section
```typescript
interface ChannelSectionCreateInput {
  type: ChannelSectionType;                // Required
  title: string;                           // Required: 1-100 characters
  titleLocalized?: Record<string, string>; // Optional
  style?: 'horizontal_row' | 'vertical_list'; // Optional
  videoIds?: string[];                     // Required for featured_videos (max 20)
  playlistId?: string;                     // Required for single_playlist
  playlistIds?: string[];                  // Required for multiple_playlists (max 10)
  channelIds?: string[];                   // Reserved for future use (max 20)
  itemCount?: number;                      // Optional: 1-20, default 12
  showTimestamp?: boolean;                 // Optional: default true
  showChannelName?: boolean;               // Optional: default false
}
```

#### Update Section
```typescript
interface ChannelSectionUpdateInput {
  // All fields optional (partial update)
  title?: string;                          // 1-100 characters
  titleLocalized?: Record<string, string>;
  style?: 'horizontal_row' | 'vertical_list';
  videoIds?: string[];                     // Max 20
  playlistId?: string;
  playlistIds?: string[];                  // Max 10
  channelIds?: string[];                   // Max 20
  itemCount?: number;                      // 1-20
  showTimestamp?: boolean;
  showChannelName?: boolean;
}
```

#### Reorder Sections
```typescript
interface ChannelSectionReorderInput {
  sectionIds: string[];                    // All section IDs in new order (1-50)
}
```

---

## Implementation Status

### ✅ Completed Features

| Feature | Status | Notes |
|---------|--------|-------|
| List sections | ✅ Working | Basic listing with pagination |
| List populated sections | ✅ Working | Auto-populates dynamic content |
| Get single section | ✅ Working | Fetch section by ID |
| Create section | ✅ Working | Requires auth |
| Update section | ✅ Working | Requires auth |
| Delete section | ✅ Working | Requires auth |
| Reorder sections | ✅ Working | Requires auth |
| Auto-population | ✅ Working | recent_uploads, popular_uploads |
| R2 storage | ✅ Working | Production & preview buckets |
| OpenAPI docs | ✅ Working | Swagger UI integration |

### ⚠️ Placeholder Features

| Feature | Status | Notes |
|---------|--------|-------|
| `liked_videos` section | ⚠️ Placeholder | Returns empty array (needs likes tracking) |
| `subscribed_channels` | ⚠️ Placeholder | Returns empty array (needs subscription tracking) |

### 🚧 Pending Implementation

| Feature | Priority | Notes |
|---------|----------|-------|
| Frontend UI components | High | React components for displaying sections |
| Management UI | High | Drag-and-drop reordering interface |
| Queue analytics | Medium | Event tracking for section operations |
| Rate limiting | Medium | 100 req/min per user |

---

## Testing

### Test Script

Run comprehensive test suite:
```bash
./test-channel-sections.sh
```

### Manual Testing Scenarios

#### Scenario 1: Create and List Sections
```bash
# 1. Create featured videos section
curl -X POST "http://127.0.0.1:3086/api/channels/channel-123/sections" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "featured_videos", "title": "Featured", "videoIds": ["v1", "v2"]}'
# Expected: 201 Created

# 2. Create recent uploads section
curl -X POST "http://127.0.0.1:3086/api/channels/channel-123/sections" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "recent_uploads", "title": "Recent"}'
# Expected: 201 Created

# 3. List sections
curl "http://127.0.0.1:3086/api/channels/channel-123/sections"
# Expected: 200 OK, 2 sections ordered by position
```

#### Scenario 2: Auto-Population
```bash
# Get sections with populated content
curl "http://127.0.0.1:3086/api/channels/channel-123/sections/populated"
# Expected: recent_uploads section includes actual video data
```

#### Scenario 3: Reorder Sections
```bash
# Reorder sections
curl -X PATCH "http://127.0.0.1:3086/api/channels/channel-123/sections/reorder" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sectionIds": ["section-2", "section-1"]}'
# Expected: 200 OK, positions updated
```

### Error Testing

```bash
# Create featured_videos without videoIds (should fail)
curl -X POST "http://127.0.0.1:3086/api/channels/channel-123/sections" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "featured_videos", "title": "Featured"}'
# Expected: 400 Bad Request, validation error

# Reorder with wrong count (should fail)
curl -X PATCH "http://127.0.0.1:3086/api/channels/channel-123/sections/reorder" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sectionIds": ["section-1"]}'
# Expected: 400 Bad Request, count mismatch
```

---

## Code Examples

### JavaScript/TypeScript

```typescript
const API_BASE = 'http://127.0.0.1:3086';
const JWT_TOKEN = 'your_jwt_token_here';

// List sections
async function listSections(channelId: string) {
  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/sections`
  );
  const data = await response.json();
  return data.result.sections;
}

// Get populated sections
async function getPopulatedSections(channelId: string) {
  const response = await fetch(
    `${API_BASE}/api/channels/${channelId}/sections/populated`
  );
  const data = await response.json();
  return data.result.sections;
}

// Create section
async function createSection(channelId: string, sectionData: any) {
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
  return data.result.section;
}

// Update section
async function updateSection(
  channelId: string,
  sectionId: string,
  updates: any
) {
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
async function reorderSections(channelId: string, sectionIds: string[]) {
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
async function deleteSection(channelId: string, sectionId: string) {
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
  const channelId = 'channel-123';

  // Create featured videos section
  const section = await createSection(channelId, {
    type: 'featured_videos',
    title: 'Featured Lectures',
    titleLocalized: { ar: 'المحاضرات المميزة' },
    videoIds: ['video-1', 'video-2', 'video-3'],
    itemCount: 12
  });

  // Get all sections with populated content
  const sections = await getPopulatedSections(channelId);
  console.log('Sections:', sections);

  // Reorder sections
  const sectionIds = sections.map(s => s.id);
  const reordered = await reorderSections(channelId, sectionIds.reverse());
  console.log('Reordered:', reordered);
}
```

### Python

```python
import requests

API_BASE = 'http://127.0.0.1:3086'
JWT_TOKEN = 'your_jwt_token_here'

def list_sections(channel_id):
    """List all sections for a channel"""
    response = requests.get(f'{API_BASE}/api/channels/{channel_id}/sections')
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
    channel_id = 'channel-123'

    # Create section
    section = create_section(channel_id, {
        'type': 'featured_videos',
        'title': 'Featured Lectures',
        'titleLocalized': {'ar': 'المحاضرات المميزة'},
        'videoIds': ['video-1', 'video-2', 'video-3'],
        'itemCount': 12
    })
    print('Created:', section)

    # List sections
    sections = list_sections(channel_id)
    print(f'Total sections: {len(sections)}')

    # Reorder sections
    section_ids = [s['id'] for s in sections]
    reordered = reorder_sections(channel_id, section_ids[::-1])
    print('Reordered:', len(reordered))
```

---

## Error Handling

### Standard Error Format

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

### HTTP Status Codes

| Code | Meaning | When |
|------|---------|------|
| 200 | OK | Successful GET, PUT, PATCH |
| 201 | Created | Successful POST |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid input, validation errors |
| 401 | Unauthorized | Missing/invalid JWT token |
| 403 | Forbidden | Not channel owner |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate resource |
| 422 | Unprocessable | Semantic validation errors |
| 500 | Internal Error | Server error |

### Common Errors

#### Missing Required Field
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "videoIds",
      "message": "featured_videos type requires at least one video ID"
    }
  ]
}
```

#### Not Channel Owner
```json
{
  "success": false,
  "error": "You can only create sections for your own channel"
}
```

#### Section Count Mismatch (Reorder)
```json
{
  "success": false,
  "error": "Section count mismatch",
  "details": {
    "expected": 3,
    "provided": 2,
    "missing": ["section-id-3"]
  }
}
```

#### Max Sections Exceeded
```json
{
  "success": false,
  "error": "Maximum 5 sections allowed per channel"
}
```

---

## R2 Storage

### Bucket Structure

```
Bucket: channel-sections (or channel-sections-preview)

Key format: {channelId}/{sectionId}

Examples:
  550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440001
  550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440002

List by channel:
  Prefix: {channelId}/
  Example: 550e8400-e29b-41d4-a716-446655440000/
```

### Wrangler Configuration

```jsonc
{
  "r2_buckets": [
    {
      "binding": "channel_sections",
      "bucket_name": "channel-sections",
      "preview_bucket_name": "channel-sections-preview"
    }
  ]
}
```

---

## Related Documentation

- **Channel Tabs API:** [CHANNEL_TABS_API.md](./CHANNEL_TABS_API.md)
- **API Design:** [CHANNEL_SECTIONS_API_DESIGN.md](./CHANNEL_SECTIONS_API_DESIGN.md)
- **Quick Reference:** [CHANNEL_SECTIONS_QUICK_REFERENCE.md](./CHANNEL_SECTIONS_QUICK_REFERENCE.md)
- **Implementation Summary:** [CHANNEL_SECTIONS_SUMMARY.md](./CHANNEL_SECTIONS_SUMMARY.md)
- **Authentication:** [AUTHENTICATION.md](./AUTHENTICATION.md)
- **Developer Guide:** [DEVELOPER_AUTH_GUIDE.md](./DEVELOPER_AUTH_GUIDE.md)

---

## Interactive API Documentation

**Swagger UI:**
- Development: http://127.0.0.1:3086/
- Production: https://videos.api.alummahnow.net/

**Features:**
- Live API testing with authentication
- Request/response schemas
- Example payloads
- OAuth2 authorization flow

---

## Design Decisions

### Why Limit to 5 Sections?

**Decision:** Reduced from YouTube's 10 sections to 5 sections per channel.

**Rationale:**
- Improved user experience (less overwhelming)
- Better mobile performance (fewer API calls)
- Encourages curators to focus on quality over quantity
- Reduces server load and storage costs

### Why Auto-Population?

**Decision:** Dynamic sections (recent_uploads, popular_uploads) fetch content at runtime.

**Rationale:**
- Always up-to-date content (no stale data)
- Reduced storage (no content IDs stored)
- Simpler management (no manual updates required)

### Why R2 Over Database?

**Decision:** Use R2 object storage instead of traditional database.

**Rationale:**
- Consistent with existing architecture (all data in R2)
- Scalable and cost-effective
- Simplified deployment (no database setup)
- Native Cloudflare Workers integration

---

## Best Practices

### 1. Section Organization
- Place most important content first (position 0)
- Limit sections to 3-5 for better UX
- Mix manual (featured_videos) with auto-populated (recent_uploads)

### 2. Performance
- Cache section lists (metadata changes infrequently)
- Lazy load section content (only fetch when visible)
- Use auto-populated sections to reduce manual updates

### 3. Internationalization
- Always provide `titleLocalized` for bilingual support
- Support both English and Arabic audiences

### 4. Error Handling
```javascript
async function createSectionSafely(channelId, sectionData) {
  try {
    const response = await fetch(`${API_BASE}/api/channels/${channelId}/sections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JWT_TOKEN}`
      },
      body: JSON.stringify(sectionData)
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 400) {
        console.error('Validation error:', data.details);
      } else if (response.status === 403) {
        console.error('Permission denied:', data.error);
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

---

## Summary

The Channel Sections & Tabs API provides comprehensive functionality for organizing channel content:

✅ **7 REST endpoints** - All CRUD operations implemented
✅ **7 section types** - Manual and auto-populated content
✅ **Auto-population** - Dynamic content for recent/popular videos
✅ **Bilingual support** - English/Arabic localization
✅ **OpenAPI 3.1** - Complete Swagger UI integration
✅ **R2 storage** - Production and preview buckets working
⚠️ **Some features pending** - Likes tracking, subscription tracking

The API is **fully functional and ready for production use** with proper authentication!

---

**For questions or feedback:**
- GitHub: https://github.com/meywd/AlUmmahNow
- API Documentation: https://videos.api.alummahnow.net/
