# Channel Sections Implementation Guide

## Overview
This guide provides step-by-step instructions for implementing the Channel Sections feature in Al Ummah Now.

## Prerequisites

1. **Update shared-types package:**
   ```bash
   cd packages/shared-types
   pnpm build
   ```

2. **Create R2 buckets (if not exists):**
   - `channel-sections` (production)
   - `channel-sections-preview` (development)

3. **Update wrangler.jsonc:**
   ```jsonc
   {
     "r2_buckets": [
       {
         "binding": "channel-sections",
         "bucket_name": "channel-sections-preview",
         "preview_bucket_name": "channel-sections-preview"
       }
     ]
   }
   ```

## Implementation Steps

### Step 1: Backend API Endpoints

#### 1.1 Core CRUD Operations

Create the following endpoints in `apps/api-videos/src/endpoints/channel/`:

```typescript
// sectionCreate.ts - Create a new section (✅ Done)
// sectionsList.ts - List all sections for a channel (✅ Done)
// sectionReorder.ts - Reorder sections (✅ Done)
// sectionUpdate.ts - Update section details
// sectionDelete.ts - Delete a section
// sectionContent.ts - Resolve section content
```

#### 1.2 Update Section Endpoint

```typescript
// apps/api-videos/src/endpoints/channel/sectionUpdate.ts
import { OpenAPIRoute, OpenAPIRouteSchema } from 'chanfana';
import { z } from 'zod';
import {
  ChannelSection,
  ChannelSectionUpdateRequest,
  CHANNEL_SECTION_CONSTRAINTS,
} from '@al-ummah/shared-types';
import R2Repository from '../../lib/r2Repo';
import { addAuthToSchema } from '../../lib/openapi-auth';

export class ChannelSectionUpdate extends OpenAPIRoute {
  schema: OpenAPIRouteSchema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Update a channel section',
    parameters: {
      channelId: { /* ... */ },
      sectionId: { /* ... */ },
    },
    requestBody: { /* UpdateRequest schema */ },
    responses: { /* ... */ },
  }, 'required');

  async handle(c: any) {
    // 1. Authenticate user
    // 2. Verify channel ownership
    // 3. Find and update section
    // 4. Save to R2
    // 5. Send analytics
  }
}
```

#### 1.3 Content Resolution Endpoint

```typescript
// apps/api-videos/src/endpoints/channel/sectionContent.ts
export class ChannelSectionContent extends OpenAPIRoute {
  async handle(c: any) {
    const { sectionId } = c.req.param();

    // Get section metadata
    const section = await this.getSection(sectionId);

    // Resolve content based on type
    const content = await this.resolveContent(section, c);

    return c.json({
      success: true,
      section,
      content,
    });
  }

  private async resolveContent(section: ChannelSection, c: any) {
    switch (section.type) {
      case 'recent_videos':
        return this.getRecentVideos(section, c);
      case 'popular_videos':
        return this.getPopularVideos(section, c);
      case 'single_playlist':
        return this.getPlaylist(section, c);
      case 'featured_channels':
        return this.getFeaturedChannels(section, c);
      // ... other types
    }
  }
}
```

### Step 2: Register Endpoints

Update `apps/api-videos/src/index.ts`:

```typescript
// Import new endpoints
import { ChannelSectionCreate } from './endpoints/channel/sectionCreate';
import { ChannelSectionsList } from './endpoints/channel/sectionsList';
import { ChannelSectionUpdate } from './endpoints/channel/sectionUpdate';
import { ChannelSectionDelete } from './endpoints/channel/sectionDelete';
import { ChannelSectionReorder } from './endpoints/channel/sectionReorder';
import { ChannelSectionContent } from './endpoints/channel/sectionContent';

// Register with OpenAPI router
openapi.post('/api/channels/:channelId/sections', ChannelSectionCreate);
openapi.get('/api/channels/:channelId/sections', ChannelSectionsList);
openapi.put('/api/channels/:channelId/sections/:sectionId', ChannelSectionUpdate);
openapi.delete('/api/channels/:channelId/sections/:sectionId', ChannelSectionDelete);
openapi.put('/api/channels/:channelId/sections/reorder', ChannelSectionReorder);
openapi.get('/api/sections/:sectionId/content', ChannelSectionContent);

// Add authentication middleware for protected endpoints
app.use('/api/channels/*/sections', authMiddleware);
app.use('/api/channels/*/sections/*', authMiddleware);
app.use('/api/channels/*/sections/reorder', authMiddleware);
```

### Step 3: Content Resolution Helpers

Create `apps/api-videos/src/lib/section-helpers.ts`:

```typescript
import { ChannelSection, VideoObject, Playlist, Channel } from '@al-ummah/shared-types';
import R2Repository from './r2Repo';

export class SectionContentResolver {
  private videoRepo: R2Repository<VideoObject>;
  private playlistRepo: R2Repository<Playlist>;
  private channelRepo: R2Repository<Channel>;

  constructor(env: any) {
    this.videoRepo = new R2Repository(env.videos);
    this.playlistRepo = new R2Repository(env.playlists);
    this.channelRepo = new R2Repository(env.channels);
  }

  async resolveRecentVideos(
    section: ChannelSection,
    channelId: string,
    limit: number = 12
  ): Promise<VideoObject[]> {
    // Get all channel videos
    const allVideos = await this.getChannelVideos(channelId);

    // Apply filters
    let filtered = this.applyFilters(allVideos, section.filter);

    // Sort by date
    filtered.sort((a, b) =>
      new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()
    );

    // Return limited results
    return filtered.slice(0, limit);
  }

  async resolvePopularVideos(
    section: ChannelSection,
    channelId: string,
    limit: number = 10
  ): Promise<VideoObject[]> {
    const allVideos = await this.getChannelVideos(channelId);
    let filtered = this.applyFilters(allVideos, section.filter);

    // Sort by views
    filtered.sort((a, b) => (b.views || 0) - (a.views || 0));

    return filtered.slice(0, limit);
  }

  async resolveStaticContent(
    section: ChannelSection
  ): Promise<(VideoObject | Playlist | Channel)[]> {
    if (!section.contentReferences) return [];

    const results = await Promise.all(
      section.contentReferences.map(async (ref) => {
        switch (ref.type) {
          case 'video':
            return this.videoRepo.getObject(ref.id);
          case 'playlist':
            return this.playlistRepo.getObject(ref.id);
          case 'channel':
            return this.channelRepo.getObject(ref.id);
          default:
            return null;
        }
      })
    );

    return results.filter(item => item !== null);
  }

  private applyFilters(videos: VideoObject[], filter?: any): VideoObject[] {
    if (!filter) return videos;

    return videos.filter(video => {
      // Category filter
      if (filter.category && video.category !== filter.category) {
        return false;
      }

      // Tags filter
      if (filter.tags && filter.tags.length > 0) {
        const hasTag = filter.tags.some((tag: string) =>
          video.tags?.includes(tag)
        );
        if (!hasTag) return false;
      }

      // Language filter
      if (filter.language && video.language !== filter.language) {
        return false;
      }

      // Date range filter
      if (filter.dateRange) {
        const videoDate = new Date(video.dateCreated);

        if (filter.dateRange.from) {
          const fromDate = this.parseRelativeDate(filter.dateRange.from);
          if (videoDate < fromDate) return false;
        }

        if (filter.dateRange.to) {
          const toDate = this.parseRelativeDate(filter.dateRange.to);
          if (videoDate > toDate) return false;
        }
      }

      // Duration filter
      if (filter.duration && video.duration) {
        if (filter.duration.min && video.duration < filter.duration.min) {
          return false;
        }
        if (filter.duration.max && video.duration > filter.duration.max) {
          return false;
        }
      }

      return true;
    });
  }

  private parseRelativeDate(dateStr: string): Date {
    if (dateStr === '30_days_ago') {
      const date = new Date();
      date.setDate(date.getDate() - 30);
      return date;
    }
    // Add more relative date parsing
    return new Date(dateStr);
  }

  private async getChannelVideos(channelId: string): Promise<VideoObject[]> {
    // In production, this would be optimized with indexes
    const result = await this.videoRepo.listObjects(1000);
    return result.items.filter(video => video.channelId === channelId);
  }
}
```

### Step 4: Frontend Components

#### 4.1 Channel Section Component

```typescript
// apps/web/src/components/channel/ChannelSection.tsx
'use client';

import { ChannelSection, VideoObject } from '@al-ummah/shared-types';
import { useState, useEffect } from 'react';
import VideoCard from '../video/VideoCard';
import PlaylistCard from '../playlist/PlaylistCard';

interface ChannelSectionProps {
  section: ChannelSection;
  locale: 'en' | 'ar';
}

export default function ChannelSectionComponent({
  section,
  locale
}: ChannelSectionProps) {
  const [content, setContent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadContent();
  }, [section.id]);

  const loadContent = async () => {
    try {
      const response = await fetch(
        `/api/sections/${section.id}/content`
      );
      const data = await response.json();
      setContent(data.content || []);
    } catch (error) {
      console.error('Failed to load section content:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTitle = () => {
    if (locale !== 'en' && section.titleLocalized?.[locale]) {
      return section.titleLocalized[locale];
    }
    return section.title;
  };

  const renderContent = () => {
    if (loading) {
      return <div>Loading...</div>;
    }

    switch (section.displaySettings?.layout) {
      case 'horizontal_list':
        return (
          <div className="flex gap-4 overflow-x-auto">
            {content.map(item => renderItem(item))}
          </div>
        );

      case 'grid':
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {content.map(item => renderItem(item))}
          </div>
        );

      case 'single':
        return content[0] ? renderItem(content[0]) : null;

      default:
        return (
          <div className="space-y-4">
            {content.map(item => renderItem(item))}
          </div>
        );
    }
  };

  const renderItem = (item: any) => {
    // Determine item type and render appropriate component
    if (item.videoUrl) {
      return <VideoCard key={item.id} video={item} />;
    }
    if (item.videosCount !== undefined) {
      return <PlaylistCard key={item.id} playlist={item} />;
    }
    // Add more type checks
    return null;
  };

  if (!section.isEnabled) {
    return null;
  }

  return (
    <section className="mb-8">
      <h2 className="text-2xl font-bold mb-4">
        {getTitle()}
      </h2>
      {section.description && (
        <p className="text-gray-600 mb-4">
          {section.descriptionLocalized?.[locale] || section.description}
        </p>
      )}
      {renderContent()}
    </section>
  );
}
```

#### 4.2 Channel Sections Manager

```typescript
// apps/web/src/components/channel/ChannelSectionsManager.tsx
'use client';

import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { ChannelSection } from '@al-ummah/shared-types';

interface SectionsManagerProps {
  channelId: string;
  sections: ChannelSection[];
  onUpdate: () => void;
}

export default function ChannelSectionsManager({
  channelId,
  sections: initialSections,
  onUpdate,
}: SectionsManagerProps) {
  const [sections, setSections] = useState(initialSections);

  const handleDragEnd = async (result: any) => {
    if (!result.destination) return;

    const items = Array.from(sections);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setSections(items);

    // Save new order
    const sectionIds = items.map(s => s.id);
    await fetch(`/api/channels/${channelId}/sections/reorder`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sectionIds }),
    });

    onUpdate();
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="sections">
        {(provided) => (
          <div {...provided.droppableProps} ref={provided.innerRef}>
            {sections.map((section, index) => (
              <Draggable
                key={section.id}
                draggableId={section.id}
                index={index}
              >
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className="bg-white p-4 mb-2 rounded shadow"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="font-bold">{section.title}</h3>
                        <p className="text-sm text-gray-600">
                          Type: {section.type} | Position: {section.position}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button className="text-blue-500">Edit</button>
                        <button className="text-red-500">Delete</button>
                      </div>
                    </div>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
```

### Step 5: Migration Script

Create `apps/api-videos/scripts/migrate-channels.ts`:

```typescript
import { ChannelSection, ChannelSectionType } from '@al-ummah/shared-types';

const DEFAULT_SECTIONS = [
  {
    type: ChannelSectionType.CHANNEL_TRAILER,
    title: 'Welcome to Our Channel',
    position: 1,
  },
  {
    type: ChannelSectionType.RECENT_VIDEOS,
    title: 'Recent Videos',
    position: 2,
  },
  {
    type: ChannelSectionType.POPULAR_VIDEOS,
    title: 'Popular Videos',
    position: 3,
  },
];

async function migrateChannels() {
  const channels = await getAllChannels();

  for (const channel of channels) {
    try {
      await createDefaultSections(channel.id);
      console.log(`✓ Migrated channel ${channel.id}`);
    } catch (error) {
      console.error(`✗ Failed to migrate ${channel.id}:`, error);
    }
  }
}

async function createDefaultSections(channelId: string) {
  const sections = DEFAULT_SECTIONS.map((template, index) => ({
    ...template,
    id: generateSectionId(),
    channelId,
    isEnabled: true,
    dateCreated: new Date().toISOString(),
    dateModified: new Date().toISOString(),
  }));

  await saveSections(channelId, sections);
}

// Run migration
migrateChannels().catch(console.error);
```

## Testing Plan

### Unit Tests

```typescript
// apps/api-videos/src/tests/sections.test.ts
describe('Channel Sections', () => {
  describe('Create Section', () => {
    it('should create a new section', async () => {
      // Test section creation
    });

    it('should enforce maximum sections limit', async () => {
      // Test constraint validation
    });

    it('should require authentication', async () => {
      // Test auth requirement
    });
  });

  describe('Reorder Sections', () => {
    it('should update positions correctly', async () => {
      // Test reordering logic
    });
  });

  describe('Content Resolution', () => {
    it('should resolve recent videos', async () => {
      // Test dynamic content
    });

    it('should apply filters correctly', async () => {
      // Test filtering logic
    });
  });
});
```

### Integration Tests

1. **End-to-end section management:**
   - Create channel
   - Add sections
   - Reorder sections
   - Delete sections
   - Verify final state

2. **Content resolution:**
   - Create videos with different properties
   - Create sections with filters
   - Verify correct content returned

3. **Localization:**
   - Create sections with multiple languages
   - Request with different locales
   - Verify correct translations

## Performance Optimization

### Caching Strategy

```typescript
// Use KV for caching resolved content
const CACHE_TTL = 300; // 5 minutes

async function getCachedContent(sectionId: string, env: any) {
  const cached = await env.KV.get(`section:${sectionId}`, 'json');

  if (cached && cached.expires > Date.now()) {
    return cached.content;
  }

  const content = await resolveContent(sectionId);

  await env.KV.put(
    `section:${sectionId}`,
    JSON.stringify({
      content,
      expires: Date.now() + CACHE_TTL * 1000,
    }),
    { expirationTtl: CACHE_TTL }
  );

  return content;
}
```

### Batch Operations

```typescript
// Batch load sections and content
async function loadChannelPage(channelId: string) {
  const [channel, sections] = await Promise.all([
    getChannel(channelId),
    getChannelSections(channelId),
  ]);

  // Batch resolve visible sections
  const visibleSections = sections.filter(s => s.isEnabled);
  const contentPromises = visibleSections.map(s =>
    resolveContent(s.id)
  );

  const contents = await Promise.all(contentPromises);

  return {
    channel,
    sections: visibleSections.map((section, i) => ({
      ...section,
      content: contents[i],
    })),
  };
}
```

## Deployment Checklist

- [ ] Build and test shared-types package
- [ ] Create R2 buckets for sections storage
- [ ] Deploy API endpoints
- [ ] Test all CRUD operations
- [ ] Implement content resolution
- [ ] Add caching layer
- [ ] Deploy frontend components
- [ ] Run migration for beta channels
- [ ] Monitor performance metrics
- [ ] Collect user feedback
- [ ] Gradual rollout to all channels

## Monitoring & Analytics

Track the following metrics:

1. **Adoption:**
   - Channels using sections
   - Average sections per channel
   - Most popular section types

2. **Performance:**
   - Section load time
   - Content resolution time
   - Cache hit rate

3. **Engagement:**
   - Click-through rate per section type
   - Time spent on channel pages
   - Video views from sections

4. **Errors:**
   - Failed section operations
   - Content resolution errors
   - Migration failures