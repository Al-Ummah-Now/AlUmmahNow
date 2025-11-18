# Channel Sections - End-to-End Design

This document provides a complete end-to-end design for implementing YouTube-style channel sections in Al Ummah Now, exactly matching YouTube's implementation.

## Table of Contents

1. [Overview](#overview)
2. [YouTube's Implementation (Research)](#youtubes-implementation-research)
3. [Database Schema (R2 Storage)](#database-schema-r2-storage)
4. [API Endpoints](#api-endpoints)
5. [UI Components (Display)](#ui-components-display)
6. [Management UI (YouTube Studio)](#management-ui-youtube-studio)
7. [Implementation Phases](#implementation-phases)

---

## Overview

**IMPORTANT**: Channel sections **only appear in the Home tab** of a channel. YouTube channels have multiple tabs (Home, Videos, Shorts, Live, Playlists, Community, About), and sections are specific to the Home tab. See `CHANNEL_TABS_DESIGN.md` for the complete tabs implementation.

Channel sections allow channel owners to customize their channel's Home tab by organizing content into sections. This matches YouTube's exact implementation with:

- **10 section types** (copied exactly from YouTube Data API v3)
- **Maximum 10 sections per channel**
- **Drag-and-drop reordering** in management UI
- **Horizontal carousel layout** for video sections
- **Bilingual support** (English/Arabic with RTL)

---

## YouTube's Implementation (Research)

### YouTube Data API v3 Structure

YouTube's `channelSection` resource has this exact structure:

```json
{
  "kind": "youtube#channelSection",
  "etag": "string",
  "id": "string",
  "snippet": {
    "type": "string",
    "channelId": "string",
    "title": "string",
    "position": 0
  },
  "contentDetails": {
    "playlists": ["playlistId1", "playlistId2"],
    "channels": ["channelId1", "channelId2"]
  }
}
```

### Section Types (Exactly 10)

YouTube supports exactly 10 section types:

1. **allPlaylists** - Display all channel playlists
2. **completedEvents** - Finished live streams
3. **liveEvents** - Currently active live broadcasts
4. **multipleChannels** - Featured channels (requires `title` + `channels[]`)
5. **multiplePlaylists** - Featured playlists (requires `title` + `playlists[]`)
6. **popularUploads** - Most-viewed videos from channel
7. **recentUploads** - Latest uploaded videos
8. **singlePlaylist** - One featured playlist (requires `playlists[0]`)
9. **subscriptions** - Channel's public subscriptions
10. **upcomingEvents** - Scheduled future live streams

### YouTube's Constraints

- **Max 10 sections per channel**
- **Title required only for**: `multiplePlaylists`, `multipleChannels`
- **Title max length**: 100 characters (UTF-8, no `<` or `>`)
- **Position**: Zero-based ordering (0 = first section)
- **singlePlaylist**: Must have exactly 1 playlist ID
- **multiplePlaylists**: Can have multiple playlist IDs
- **multipleChannels**: Can have multiple channel IDs

### YouTube Studio UI Behavior

- **Drag-and-drop reordering**: Click and hold vertical bar, drag to new position
- **Default sections**: Short videos, Uploads, Created playlists, Subscriptions
- **Add section**: Scrollable list of section types
- **Publish button**: Changes aren't live until published

### YouTube Channel Page UI

- **Section layout**: Horizontal carousel with video cards
- **Section header**: Title + "See all" button (if more than ~4-6 videos)
- **Video cards**: Thumbnail, title, view count, upload date
- **Responsive**: 1-6 cards per row depending on screen width
- **Hover effects**: Card elevation, thumbnail overlay

---

## Database Schema (R2 Storage)

### TypeScript Types

#### Core Types (`packages/shared-types/src/channel-section.ts`)

```typescript
import { Timestamps } from './common';

/**
 * Channel Section - Matches YouTube Data API v3 structure
 */
export interface ChannelSection extends Timestamps {
  id: string;
  channelId: string;

  // Snippet (basic metadata)
  type: ChannelSectionType;
  title?: string; // Required only for multiplePlaylists, multipleChannels
  position: number; // Zero-based ordering

  // Content Details
  playlists?: string[]; // Playlist IDs (for singlePlaylist, multiplePlaylists)
  channels?: string[]; // Channel IDs (for multipleChannels)

  // Timestamps
  dateCreated: string;
  dateModified: string;
}

/**
 * YouTube's exact 10 section types
 */
export type ChannelSectionType =
  | 'allPlaylists'
  | 'completedEvents'
  | 'liveEvents'
  | 'multipleChannels'
  | 'multiplePlaylists'
  | 'popularUploads'
  | 'recentUploads'
  | 'singlePlaylist'
  | 'subscriptions'
  | 'upcomingEvents';

/**
 * Create channel section request
 */
export interface ChannelSectionCreateRequest {
  type: ChannelSectionType;
  title?: string; // Max 100 chars, required for multiplePlaylists/multipleChannels
  position?: number; // If omitted, add to end
  playlists?: string[]; // Required for singlePlaylist (exactly 1), multiplePlaylists (1+)
  channels?: string[]; // Required for multipleChannels (1+)
}

/**
 * Update channel section request
 */
export interface ChannelSectionUpdateRequest {
  title?: string;
  playlists?: string[];
  channels?: string[];
}

/**
 * Reorder sections request
 */
export interface ChannelSectionReorderRequest {
  sectionId: string;
  newPosition: number;
}

/**
 * List channel sections params
 */
export interface ChannelSectionListParams {
  channelId: string;
}
```

### R2 Storage Structure

#### Bucket: `channel-sections` / `channel-sections-preview`

**Key pattern**: `{channelId}/{sectionId}.json`

**Example**: `e6367c19-a759-423e-be12-b52b098bce38/section-abc123.json`

**Storage format**:
```json
{
  "id": "section-abc123",
  "channelId": "e6367c19-a759-423e-be12-b52b098bce38",
  "type": "multiplePlaylists",
  "title": "Islamic Lectures",
  "position": 0,
  "playlists": [
    "playlist-1",
    "playlist-2",
    "playlist-3"
  ],
  "dateCreated": "2025-11-18T10:00:00.000Z",
  "dateModified": "2025-11-18T10:00:00.000Z"
}
```

### Wrangler Configuration Addition

Add to `apps/api-videos/wrangler.jsonc`:

```jsonc
{
  "r2_buckets": [
    // ... existing buckets
    {
      "binding": "channel_sections",
      "bucket_name": "channel-sections",
      "preview_bucket_name": "channel-sections-preview",
      "remote": true
    }
  ]
}
```

### Validation Rules

Match YouTube's exact constraints:

```typescript
/**
 * Validation rules matching YouTube's constraints
 */
export const CHANNEL_SECTION_CONSTRAINTS = {
  MAX_SECTIONS_PER_CHANNEL: 10,
  MAX_TITLE_LENGTH: 100,
  TITLE_REQUIRED_FOR_TYPES: ['multiplePlaylists', 'multipleChannels'],
  PLAYLISTS_REQUIRED_FOR_TYPES: ['singlePlaylist', 'multiplePlaylists'],
  CHANNELS_REQUIRED_FOR_TYPES: ['multipleChannels'],
  SINGLE_PLAYLIST_EXACT_COUNT: 1, // singlePlaylist must have exactly 1 playlist
} as const;

/**
 * Validate section data
 */
function validateChannelSection(data: ChannelSectionCreateRequest): string[] {
  const errors: string[] = [];

  // Title validation
  if (CHANNEL_SECTION_CONSTRAINTS.TITLE_REQUIRED_FOR_TYPES.includes(data.type)) {
    if (!data.title) {
      errors.push(`Title is required for section type: ${data.type}`);
    } else if (data.title.length > CHANNEL_SECTION_CONSTRAINTS.MAX_TITLE_LENGTH) {
      errors.push(`Title exceeds ${CHANNEL_SECTION_CONSTRAINTS.MAX_TITLE_LENGTH} characters`);
    } else if (data.title.includes('<') || data.title.includes('>')) {
      errors.push('Title cannot contain < or > characters');
    }
  }

  // Playlist validation
  if (CHANNEL_SECTION_CONSTRAINTS.PLAYLISTS_REQUIRED_FOR_TYPES.includes(data.type)) {
    if (!data.playlists || data.playlists.length === 0) {
      errors.push(`Playlists are required for section type: ${data.type}`);
    }

    if (data.type === 'singlePlaylist' && data.playlists?.length !== 1) {
      errors.push('singlePlaylist must have exactly 1 playlist');
    }
  }

  // Channel validation
  if (CHANNEL_SECTION_CONSTRAINTS.CHANNELS_REQUIRED_FOR_TYPES.includes(data.type)) {
    if (!data.channels || data.channels.length === 0) {
      errors.push(`Channels are required for section type: ${data.type}`);
    }
  }

  return errors;
}
```

---

## API Endpoints

### Endpoint Summary

All endpoints follow RESTful patterns matching YouTube's API design:

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/channels/{channelId}/sections` | List all sections | Optional |
| GET | `/api/channels/{channelId}/sections/{sectionId}` | Get single section | Optional |
| POST | `/api/channels/{channelId}/sections` | Create section | Required |
| PUT | `/api/channels/{channelId}/sections/{sectionId}` | Update section | Required |
| DELETE | `/api/channels/{channelId}/sections/{sectionId}` | Delete section | Required |
| POST | `/api/channels/{channelId}/sections/reorder` | Reorder sections | Required |

### 1. List Channel Sections

**Endpoint**: `GET /api/channels/{channelId}/sections`

**Auth**: Optional (public can view, owner sees all including drafts if needed)

**Response**:
```json
{
  "success": true,
  "sections": [
    {
      "id": "section-1",
      "channelId": "channel-abc",
      "type": "recentUploads",
      "position": 0,
      "dateCreated": "2025-11-18T10:00:00.000Z",
      "dateModified": "2025-11-18T10:00:00.000Z"
    },
    {
      "id": "section-2",
      "channelId": "channel-abc",
      "type": "multiplePlaylists",
      "title": "Islamic Lectures",
      "position": 1,
      "playlists": ["playlist-1", "playlist-2"],
      "dateCreated": "2025-11-18T10:00:00.000Z",
      "dateModified": "2025-11-18T10:00:00.000Z"
    }
  ]
}
```

**Implementation** (`apps/api-videos/src/endpoints/channel/channelSectionsList.ts`):
```typescript
import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import R2Repository from '../../lib/r2Repo';
import { ChannelSection } from '@al-ummah/shared-types';
import { addAuthToSchema } from '../../lib/openapi-auth';

export class ChannelSectionsList extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'List channel sections',
    description: 'Get all sections for a channel, ordered by position',
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
      }),
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              sections: z.array(z.any()), // ChannelSection type
            }),
          },
        },
      },
      404: {
        description: 'Channel not found',
      },
    },
  }, 'optional');

  async handle(c: Context) {
    const { channelId } = c.req.param();

    // List all sections for this channel
    const repo = new R2Repository<ChannelSection>(c.env.channel_sections);
    const prefix = `${channelId}/`;

    const { objects } = await repo.listObjects(1000, undefined, prefix);

    // Sort by position
    objects.sort((a, b) => a.position - b.position);

    return c.json({
      success: true,
      sections: objects,
    });
  }
}
```

### 2. Get Single Section

**Endpoint**: `GET /api/channels/{channelId}/sections/{sectionId}`

**Auth**: Optional

**Response**:
```json
{
  "success": true,
  "section": {
    "id": "section-1",
    "channelId": "channel-abc",
    "type": "multiplePlaylists",
    "title": "Islamic Lectures",
    "position": 0,
    "playlists": ["playlist-1", "playlist-2"],
    "dateCreated": "2025-11-18T10:00:00.000Z",
    "dateModified": "2025-11-18T10:00:00.000Z"
  }
}
```

### 3. Create Channel Section

**Endpoint**: `POST /api/channels/{channelId}/sections`

**Auth**: Required (must be channel owner)

**Request**:
```json
{
  "type": "multiplePlaylists",
  "title": "Islamic Lectures",
  "playlists": ["playlist-1", "playlist-2"],
  "position": 0
}
```

**Response**:
```json
{
  "success": true,
  "section": {
    "id": "section-new",
    "channelId": "channel-abc",
    "type": "multiplePlaylists",
    "title": "Islamic Lectures",
    "position": 0,
    "playlists": ["playlist-1", "playlist-2"],
    "dateCreated": "2025-11-18T10:00:00.000Z",
    "dateModified": "2025-11-18T10:00:00.000Z"
  }
}
```

**Validation**:
- Check channel ownership (userId from JWT matches channel.userId)
- Check max 10 sections limit
- Validate section type constraints (title required, playlists/channels required)
- If position specified, shift other sections down
- If position omitted, add to end

**Implementation** (`apps/api-videos/src/endpoints/channel/channelSectionCreate.ts`):
```typescript
import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import R2Repository from '../../lib/r2Repo';
import { ChannelSection, ChannelSectionCreateRequest } from '@al-ummah/shared-types';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { CHANNEL_SECTION_CONSTRAINTS } from '../../lib/validation';

export class ChannelSectionCreate extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Create channel section',
    description: 'Add a new section to a channel (max 10 sections)',
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              type: z.enum([
                'allPlaylists',
                'completedEvents',
                'liveEvents',
                'multipleChannels',
                'multiplePlaylists',
                'popularUploads',
                'recentUploads',
                'singlePlaylist',
                'subscriptions',
                'upcomingEvents',
              ]),
              title: z.string().max(100).optional(),
              position: z.number().int().min(0).optional(),
              playlists: z.array(z.string()).optional(),
              channels: z.array(z.string()).optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Section created',
      },
      400: {
        description: 'Validation error',
      },
      401: {
        description: 'Unauthorized',
      },
      403: {
        description: 'Not channel owner',
      },
      409: {
        description: 'Max sections limit reached',
      },
    },
  }, 'required');

  async handle(c: Context) {
    const { channelId } = c.req.param();
    const data: ChannelSectionCreateRequest = await c.req.json();
    const auth = c.get('auth');

    // 1. Check channel ownership
    const channelRepo = new R2Repository(c.env.channels);
    const channel = await channelRepo.getObject(channelId);

    if (!channel) {
      return c.json({ success: false, error: 'Channel not found' }, 404);
    }

    if (channel.userId !== auth.userId) {
      return c.json({ success: false, error: 'Not channel owner' }, 403);
    }

    // 2. Check max sections limit
    const sectionRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    const { objects: existingSections } = await sectionRepo.listObjects(
      1000,
      undefined,
      `${channelId}/`
    );

    if (existingSections.length >= CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL) {
      return c.json({
        success: false,
        error: `Maximum ${CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL} sections allowed`,
      }, 409);
    }

    // 3. Validate section data
    const errors = validateChannelSection(data);
    if (errors.length > 0) {
      return c.json({ success: false, errors }, 400);
    }

    // 4. Calculate position
    const position = data.position ?? existingSections.length;

    // 5. Shift existing sections if inserting in middle
    if (position < existingSections.length) {
      for (const section of existingSections) {
        if (section.position >= position) {
          section.position += 1;
          await sectionRepo.putObject(`${channelId}/${section.id}`, section);
        }
      }
    }

    // 6. Create new section
    const sectionId = `section-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const newSection: ChannelSection = {
      id: sectionId,
      channelId,
      type: data.type,
      title: data.title,
      position,
      playlists: data.playlists,
      channels: data.channels,
      dateCreated: now,
      dateModified: now,
    };

    await sectionRepo.putObject(`${channelId}/${sectionId}`, newSection);

    return c.json({ success: true, section: newSection }, 201);
  }
}
```

### 4. Update Channel Section

**Endpoint**: `PUT /api/channels/{channelId}/sections/{sectionId}`

**Auth**: Required (must be channel owner)

**Request**:
```json
{
  "title": "Updated Title",
  "playlists": ["playlist-1", "playlist-2", "playlist-3"]
}
```

**Validation**:
- Check channel ownership
- Validate updated data
- Cannot change `type` (delete and recreate instead)

### 5. Delete Channel Section

**Endpoint**: `DELETE /api/channels/{channelId}/sections/{sectionId}`

**Auth**: Required (must be channel owner)

**Response**:
```json
{
  "success": true
}
```

**Implementation**:
- Check channel ownership
- Delete section from R2
- Reorder remaining sections to fill gap (adjust positions)

### 6. Reorder Sections

**Endpoint**: `POST /api/channels/{channelId}/sections/reorder`

**Auth**: Required (must be channel owner)

**Request**:
```json
{
  "sectionId": "section-2",
  "newPosition": 0
}
```

**Response**:
```json
{
  "success": true,
  "sections": [
    { "id": "section-2", "position": 0 },
    { "id": "section-1", "position": 1 },
    { "id": "section-3", "position": 2 }
  ]
}
```

**Implementation**:
- Move section from old position to new position
- Shift other sections up or down
- Update all affected section positions

---

## UI Components (Display)

### Component Hierarchy

```
ChannelPage (apps/web/src/app/[locale]/channels/[id]/page.tsx - HOME TAB ONLY)
└── ChannelSections (src/components/ChannelSections/index.tsx)
    ├── ChannelSectionHeader (title + "See all" link)
    └── ChannelSectionContent (different component per type)
        ├── RecentUploadsSection (horizontal video carousel)
        ├── PlaylistsSection (horizontal playlist carousel)
        ├── PopularUploadsSection (horizontal video carousel)
        ├── LiveEventsSection (horizontal live stream cards)
        ├── ChannelsSection (horizontal channel cards)
        └── ... (8 more section type components)
```

### Main Component: ChannelSections

**File**: `apps/web/src/components/ChannelSections/index.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';
import { ChannelSection } from '@al-ummah/shared-types';
import { ChannelSectionRenderer } from './ChannelSectionRenderer';

interface ChannelSectionsProps {
  channelId: string;
}

export function ChannelSections({ channelId }: ChannelSectionsProps) {
  const [sections, setSections] = useState<ChannelSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSections() {
      try {
        const response = await fetch(`/api/channels/${channelId}/sections`);
        const data = await response.json();

        if (data.success) {
          setSections(data.sections);
        } else {
          setError('Failed to load channel sections');
        }
      } catch (err) {
        setError('Network error loading sections');
      } finally {
        setLoading(false);
      }
    }

    fetchSections();
  }, [channelId]);

  if (loading) {
    return <ChannelSectionsSkeleton />;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (sections.length === 0) {
    return null; // No sections to display
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <ChannelSectionRenderer
          key={section.id}
          section={section}
          channelId={channelId}
        />
      ))}
    </div>
  );
}

function ChannelSectionsSkeleton() {
  return (
    <div className="space-y-8">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-48 mb-4"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="space-y-2">
                <div className="aspect-video bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Section Type Renderer

**File**: `apps/web/src/components/ChannelSections/ChannelSectionRenderer.tsx`

```tsx
import { ChannelSection } from '@al-ummah/shared-types';
import { RecentUploadsSection } from './types/RecentUploadsSection';
import { MultiplePlaylistsSection } from './types/MultiplePlaylistsSection';
import { PopularUploadsSection } from './types/PopularUploadsSection';
import { SinglePlaylistSection } from './types/SinglePlaylistSection';
import { AllPlaylistsSection } from './types/AllPlaylistsSection';
import { LiveEventsSection } from './types/LiveEventsSection';
import { CompletedEventsSection } from './types/CompletedEventsSection';
import { UpcomingEventsSection } from './types/UpcomingEventsSection';
import { MultipleChannelsSection } from './types/MultipleChannelsSection';
import { SubscriptionsSection } from './types/SubscriptionsSection';

interface ChannelSectionRendererProps {
  section: ChannelSection;
  channelId: string;
}

export function ChannelSectionRenderer({ section, channelId }: ChannelSectionRendererProps) {
  switch (section.type) {
    case 'recentUploads':
      return <RecentUploadsSection channelId={channelId} />;

    case 'popularUploads':
      return <PopularUploadsSection channelId={channelId} />;

    case 'multiplePlaylists':
      return (
        <MultiplePlaylistsSection
          title={section.title!}
          playlistIds={section.playlists!}
        />
      );

    case 'singlePlaylist':
      return <SinglePlaylistSection playlistId={section.playlists![0]} />;

    case 'allPlaylists':
      return <AllPlaylistsSection channelId={channelId} />;

    case 'liveEvents':
      return <LiveEventsSection channelId={channelId} />;

    case 'completedEvents':
      return <CompletedEventsSection channelId={channelId} />;

    case 'upcomingEvents':
      return <UpcomingEventsSection channelId={channelId} />;

    case 'multipleChannels':
      return (
        <MultipleChannelsSection
          title={section.title!}
          channelIds={section.channels!}
        />
      );

    case 'subscriptions':
      return <SubscriptionsSection channelId={channelId} />;

    default:
      return null;
  }
}
```

### Example Section Type: Recent Uploads

**File**: `apps/web/src/components/ChannelSections/types/RecentUploadsSection.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';
import { VideoObject } from '@al-ummah/shared-types';
import { VideoCard } from '../../VideoCard';
import { SectionHeader } from '../SectionHeader';

interface RecentUploadsSectionProps {
  channelId: string;
}

export function RecentUploadsSection({ channelId }: RecentUploadsSectionProps) {
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchVideos() {
      try {
        const response = await fetch(
          `/api/videos?channelId=${channelId}&limit=12&sortBy=dateCreated&sortOrder=desc`
        );
        const data = await response.json();

        if (data.success) {
          setVideos(data.videos);
        }
      } catch (err) {
        console.error('Failed to fetch recent uploads', err);
      } finally {
        setLoading(false);
      }
    }

    fetchVideos();
  }, [channelId]);

  if (loading) {
    return <SectionSkeleton />;
  }

  if (videos.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Recent uploads"
        viewAllHref={`/channels/${channelId}/videos`}
      />

      <div className="relative">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-4 pb-2">
            {videos.map((video) => (
              <div key={video.id} className="flex-shrink-0 w-64">
                <VideoCard video={video} />
              </div>
            ))}
          </div>
        </div>

        {videos.length > 5 && (
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white to-transparent pointer-events-none" />
        )}
      </div>
    </section>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-gray-200 rounded w-48"></div>
      <div className="flex gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex-shrink-0 w-64 space-y-2">
            <div className="aspect-video bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Section Header Component

**File**: `apps/web/src/components/ChannelSections/SectionHeader.tsx`

```tsx
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

interface SectionHeaderProps {
  title: string;
  viewAllHref?: string;
}

export function SectionHeader({ title, viewAllHref }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-xl font-semibold">{title}</h2>

      {viewAllHref && (
        <Link
          href={viewAllHref}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
        >
          See all
          <ChevronRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}
```

### RTL Variant

**File**: `apps/web/src/components/ChannelSections/rtl/index.tsx`

```tsx
// RTL version with reversed layout
'use client';

import { useEffect, useState } from 'react';
import { ChannelSection } from '@al-ummah/shared-types';
import { ChannelSectionRenderer } from './ChannelSectionRenderer';

interface ChannelSectionsProps {
  channelId: string;
}

export function ChannelSections({ channelId }: ChannelSectionsProps) {
  // Same logic as LTR version
  // ...

  return (
    <div className="space-y-8" dir="rtl">
      {sections.map((section) => (
        <ChannelSectionRenderer
          key={section.id}
          section={section}
          channelId={channelId}
        />
      ))}
    </div>
  );
}
```

### Responsive Design

**Breakpoints** (matching YouTube):
- Mobile (< 640px): 1-2 cards per row
- Tablet (640-1024px): 2-3 cards per row
- Desktop (1024-1536px): 4-5 cards per row
- Large desktop (> 1536px): 5-6 cards per row

**Horizontal scroll** on mobile, grid on desktop.

---

## Management UI (YouTube Studio)

### UI Location

Add to channel settings page: `apps/web/src/app/[locale]/channels/[id]/settings/sections/page.tsx`

### Component Hierarchy

```
ChannelSectionsManagement
├── SectionsHeader (title + "Publish" button)
├── SectionsList (drag-and-drop list)
│   └── SectionItem (individual section with drag handle)
│       ├── DragHandle (vertical bar icon)
│       ├── SectionInfo (type, title, content summary)
│       └── SectionActions (edit, delete buttons)
└── AddSectionDialog (modal to add new section)
    ├── SectionTypeSelector (10 section types)
    └── SectionForm (title, playlists/channels picker)
```

### Main Management Component

**File**: `apps/web/src/app/[locale]/channels/[id]/settings/sections/page.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChannelSection } from '@al-ummah/shared-types';
import { SortableSectionItem } from '@/components/ChannelSections/management/SortableSectionItem';
import { AddSectionDialog } from '@/components/ChannelSections/management/AddSectionDialog';
import { Button } from '@/components/ui/button';

interface ChannelSectionsManagementProps {
  params: { id: string };
}

export default function ChannelSectionsManagement({ params }: ChannelSectionsManagementProps) {
  const [sections, setSections] = useState<ChannelSection[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch sections
  useEffect(() => {
    async function fetchSections() {
      const response = await fetch(`/api/channels/${params.id}/sections`);
      const data = await response.json();

      if (data.success) {
        setSections(data.sections);
      }
    }

    fetchSections();
  }, [params.id]);

  // Handle drag and drop
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSections((sections) => {
        const oldIndex = sections.findIndex((s) => s.id === active.id);
        const newIndex = sections.findIndex((s) => s.id === over.id);

        const reordered = arrayMove(sections, oldIndex, newIndex);

        // Update positions
        return reordered.map((section, index) => ({
          ...section,
          position: index,
        }));
      });

      setHasChanges(true);
    }
  }

  // Publish changes
  async function handlePublish() {
    setSaving(true);

    try {
      // Send reorder requests
      for (const section of sections) {
        await fetch(`/api/channels/${params.id}/sections/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionId: section.id,
            newPosition: section.position,
          }),
        });
      }

      setHasChanges(false);
      // Show success toast
    } catch (error) {
      // Show error toast
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Channel sections</h1>
          <p className="text-gray-600">
            Customize your channel layout (max 10 sections)
          </p>
        </div>

        <Button
          onClick={handlePublish}
          disabled={!hasChanges || saving}
          variant={hasChanges ? 'default' : 'outline'}
        >
          {saving ? 'Publishing...' : 'Publish'}
        </Button>
      </div>

      {/* Sections count */}
      <div className="text-sm text-gray-600">
        {sections.length} of 10 sections used
      </div>

      {/* Drag-and-drop list */}
      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {sections.map((section) => (
              <SortableSectionItem
                key={section.id}
                section={section}
                onDelete={() => {
                  setSections(sections.filter((s) => s.id !== section.id));
                  setHasChanges(true);
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add section button */}
      {sections.length < 10 && (
        <AddSectionDialog
          channelId={params.id}
          onAdd={(newSection) => {
            setSections([...sections, newSection]);
            setHasChanges(true);
          }}
        />
      )}
    </div>
  );
}
```

### Sortable Section Item

**File**: `apps/web/src/components/ChannelSections/management/SortableSectionItem.tsx`

```tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChannelSection } from '@al-ummah/shared-types';
import { GripVertical, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SortableSectionItemProps {
  section: ChannelSection;
  onDelete: () => void;
}

export function SortableSectionItem({ section, onDelete }: SortableSectionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-4 p-4 bg-white border rounded-lg hover:shadow-md transition-shadow"
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
      >
        <GripVertical className="w-5 h-5" />
      </div>

      {/* Section info */}
      <div className="flex-1">
        <div className="font-medium">
          {section.title || getSectionTypeLabel(section.type)}
        </div>
        <div className="text-sm text-gray-600">
          {getSectionContentSummary(section)}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm">
          <Edit className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function getSectionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    recentUploads: 'Recent uploads',
    popularUploads: 'Popular uploads',
    allPlaylists: 'All playlists',
    multiplePlaylists: 'Featured playlists',
    singlePlaylist: 'Playlist',
    liveEvents: 'Live now',
    completedEvents: 'Past live streams',
    upcomingEvents: 'Upcoming live streams',
    multipleChannels: 'Featured channels',
    subscriptions: 'Subscriptions',
  };

  return labels[type] || type;
}

function getSectionContentSummary(section: ChannelSection): string {
  if (section.playlists && section.playlists.length > 0) {
    return `${section.playlists.length} playlist${section.playlists.length > 1 ? 's' : ''}`;
  }

  if (section.channels && section.channels.length > 0) {
    return `${section.channels.length} channel${section.channels.length > 1 ? 's' : ''}`;
  }

  return 'Automatic content';
}
```

### Add Section Dialog

**File**: `apps/web/src/components/ChannelSections/management/AddSectionDialog.tsx`

```tsx
'use client';

import { useState } from 'react';
import { ChannelSectionType } from '@al-ummah/shared-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

interface AddSectionDialogProps {
  channelId: string;
  onAdd: (section: any) => void;
}

export function AddSectionDialog({ channelId, onAdd }: AddSectionDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ChannelSectionType | null>(null);

  const sectionTypes: { type: ChannelSectionType; label: string; description: string }[] = [
    { type: 'recentUploads', label: 'Recent uploads', description: 'Your latest videos' },
    { type: 'popularUploads', label: 'Popular uploads', description: 'Your most-viewed videos' },
    { type: 'allPlaylists', label: 'All playlists', description: 'All your public playlists' },
    { type: 'multiplePlaylists', label: 'Featured playlists', description: 'Specific playlists' },
    { type: 'singlePlaylist', label: 'Single playlist', description: 'One playlist' },
    { type: 'liveEvents', label: 'Live now', description: 'Current live streams' },
    { type: 'completedEvents', label: 'Past live streams', description: 'Previous broadcasts' },
    { type: 'upcomingEvents', label: 'Upcoming', description: 'Scheduled live streams' },
    { type: 'multipleChannels', label: 'Featured channels', description: 'Channels you recommend' },
    { type: 'subscriptions', label: 'Subscriptions', description: 'Channels you subscribe to' },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <Plus className="w-4 h-4 mr-2" />
          Add section
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add channel section</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {sectionTypes.map((type) => (
            <button
              key={type.type}
              onClick={() => setSelectedType(type.type)}
              className="p-4 text-left border rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
            >
              <div className="font-medium">{type.label}</div>
              <div className="text-sm text-gray-600">{type.description}</div>
            </button>
          ))}
        </div>

        {/* Show form for selected type */}
        {selectedType && (
          <div className="mt-6 pt-6 border-t">
            {/* Different form based on selected type */}
            {/* This would include title input for multiplePlaylists/multipleChannels */}
            {/* And playlist/channel pickers */}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

### Drag and Drop Dependencies

Add to `apps/web/package.json`:

```json
{
  "dependencies": {
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@dnd-kit/utilities": "^3.2.2"
  }
}
```

---

## Implementation Phases

### Phase 1: Database & API (Backend)

**Tasks**:
1. Create TypeScript types in `packages/shared-types/src/channel-section.ts`
2. Add R2 bucket configuration to `wrangler.jsonc`
3. Create API endpoints:
   - List sections
   - Get single section
   - Create section (with validation)
   - Update section
   - Delete section
   - Reorder sections
4. Add validation logic matching YouTube's constraints
5. Test with Swagger UI

**Files to create**:
- `packages/shared-types/src/channel-section.ts`
- `apps/api-videos/src/endpoints/channel/channelSectionsList.ts`
- `apps/api-videos/src/endpoints/channel/channelSectionsGet.ts`
- `apps/api-videos/src/endpoints/channel/channelSectionCreate.ts`
- `apps/api-videos/src/endpoints/channel/channelSectionUpdate.ts`
- `apps/api-videos/src/endpoints/channel/channelSectionDelete.ts`
- `apps/api-videos/src/endpoints/channel/channelSectionsReorder.ts`
- `apps/api-videos/src/lib/validation/channel-section.ts`

**Estimated time**: 6-8 hours

### Phase 2: Display UI (Frontend)

**Tasks**:
1. Create base section components
2. Implement 10 section type components
3. Add section header with "See all" link
4. Implement horizontal carousel scroll
5. Add responsive breakpoints
6. Create RTL variants
7. Add loading skeletons

**Files to create**:
- `apps/web/src/components/ChannelSections/index.tsx`
- `apps/web/src/components/ChannelSections/ChannelSectionRenderer.tsx`
- `apps/web/src/components/ChannelSections/SectionHeader.tsx`
- `apps/web/src/components/ChannelSections/types/*.tsx` (10 files)
- `apps/web/src/components/ChannelSections/rtl/*.tsx` (RTL variants)

**Estimated time**: 8-10 hours

### Phase 3: Management UI (Studio)

**Tasks**:
1. Create management page in channel settings
2. Implement drag-and-drop with @dnd-kit
3. Add section dialog with type selector
4. Create forms for each section type
5. Implement publish workflow
6. Add RTL variant

**Files to create**:
- `apps/web/src/app/[locale]/channels/[id]/settings/sections/page.tsx`
- `apps/web/src/components/ChannelSections/management/SortableSectionItem.tsx`
- `apps/web/src/components/ChannelSections/management/AddSectionDialog.tsx`
- `apps/web/src/components/ChannelSections/management/SectionForm.tsx`

**Estimated time**: 6-8 hours

### Phase 4: Testing & Polish

**Tasks**:
1. Test all section types
2. Test validation (max 10 sections, required fields)
3. Test reordering
4. Test RTL layout
5. Test responsive design
6. Add error handling
7. Optimize performance

**Estimated time**: 4-6 hours

---

## Total Estimated Time

**Backend**: 6-8 hours
**Frontend Display**: 8-10 hours
**Management UI**: 6-8 hours
**Testing & Polish**: 4-6 hours

**Total**: 24-32 hours

---

## Success Criteria

- ✅ All 10 YouTube section types implemented exactly
- ✅ Maximum 10 sections per channel enforced
- ✅ Drag-and-drop reordering works smoothly
- ✅ Validation matches YouTube's constraints
- ✅ Horizontal carousel layout on channel page
- ✅ Responsive design (mobile to desktop)
- ✅ RTL support for Arabic
- ✅ "See all" links navigate correctly
- ✅ All section types fetch correct data
- ✅ API documented in Swagger UI

---

## References

- [YouTube Data API v3 - ChannelSections](https://developers.google.com/youtube/v3/docs/channelSections)
- [YouTube Help - Customize channel layout](https://support.google.com/youtube/answer/3219384)
- [@dnd-kit Documentation](https://docs.dnd-kit.com/)
- [Al Ummah Now CLAUDE.md](../CLAUDE.md)
