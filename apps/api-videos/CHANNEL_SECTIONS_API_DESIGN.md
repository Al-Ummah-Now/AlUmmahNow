# Channel Sections API Design

**Version:** 1.0
**Date:** 2025-01-18
**Status:** Design Specification

## Table of Contents

1. [Overview](#overview)
2. [Data Models](#data-models)
3. [API Endpoints](#api-endpoints)
4. [Implementation Guide](#implementation-guide)
5. [Error Handling](#error-handling)
6. [Examples](#examples)

---

## Overview

This document specifies the REST API design for managing channel sections in Al Ummah Now video platform. Channel sections allow content creators to organize their channel homepage with curated collections of videos, playlists, and channels.

### Design Principles

- **RESTful conventions**: Resource-based URLs, appropriate HTTP methods
- **Consistency**: Follows existing Al Ummah Now API patterns
- **OpenAPI 3.1**: Fully documented with chanfana integration
- **Bilingual support**: Content supports English/Arabic localization
- **Authorization**: Channel owners only (no public write access)
- **Idempotency**: PUT/PATCH operations are idempotent

### YouTube API Reference

This design is inspired by YouTube's channelSections API:
- `channelSections.list` - List all sections for a channel
- `channelSections.insert` - Create a new section
- `channelSections.update` - Update section details
- `channelSections.delete` - Remove a section

---

## Data Models

### ChannelSection Type

```typescript
// Business model (stored in R2)
export const ChannelSection = z.object({
  id: Str(),                              // Unique section ID
  channelId: Str(),                       // Parent channel ID
  userId: Str(),                          // Owner user ID

  // Section metadata
  type: z.enum([
    'featured_videos',                    // Manually selected videos
    'recent_uploads',                     // Latest videos from channel
    'popular_uploads',                    // Most viewed videos
    'single_playlist',                    // Videos from one playlist
    'multiple_playlists',                 // Multiple playlists showcase
    'subscribed_channels',                // Channels user subscribes to
    'liked_videos',                       // User's liked videos
  ]),

  // Localized content
  title: Str(),                           // Section title (default language)
  titleLocalized: z.record(z.string()).optional(), // { "ar": "عنوان", "en": "Title" }

  // Section configuration
  position: z.number().int().min(0),     // Display order (0 = first)
  style: z.enum([
    'horizontal_row',                     // Single row of thumbnails
    'vertical_list',                      // Vertical list with details
  ]).default('horizontal_row'),

  // Content references
  videoIds: z.array(Str()).default([]),           // For featured_videos
  playlistId: Str().optional(),                    // For single_playlist
  playlistIds: z.array(Str()).default([]),        // For multiple_playlists
  channelIds: z.array(Str()).default([]),         // For subscribed_channels

  // Display settings
  itemCount: z.number().int().min(1).max(20).default(12), // Items to show
  showTimestamp: z.boolean().default(true),        // Show upload time
  showChannelName: z.boolean().default(false),     // Show channel attribution

  // Timestamps
  dateCreated: DateTime(),
  dateModified: DateTime(),
});

export type ChannelSection = z.infer<typeof ChannelSection>;
```

### View Models

```typescript
// View model for API responses
export const ChannelSectionView = z.object({
  id: Str(),
  channelId: Str(),
  type: z.string(),
  title: Str(),
  titleLocalized: z.record(z.string()).optional(),
  position: z.number(),
  style: z.string(),
  itemCount: z.number(),
  showTimestamp: z.boolean(),
  showChannelName: z.boolean(),

  // Content references (sanitized)
  content: z.object({
    videoIds: z.array(Str()).optional(),
    playlistId: Str().optional(),
    playlistIds: z.array(Str()).optional(),
    channelIds: z.array(Str()).optional(),
  }),

  dateCreated: z.string(),
  dateModified: z.string(),
});

export type ChannelSectionView = z.infer<typeof ChannelSectionView>;
```

### Input Models

```typescript
// Create section request
export const ChannelSectionCreateInput = z.object({
  type: z.enum([
    'featured_videos',
    'recent_uploads',
    'popular_uploads',
    'single_playlist',
    'multiple_playlists',
    'subscribed_channels',
    'liked_videos',
  ]),
  title: Str().min(1).max(100),
  titleLocalized: z.record(z.string()).optional(),
  style: z.enum(['horizontal_row', 'vertical_list']).optional(),

  // Content (type-specific, validated based on section type)
  videoIds: z.array(Str()).max(20).optional(),
  playlistId: Str().optional(),
  playlistIds: z.array(Str()).max(10).optional(),
  channelIds: z.array(Str()).max(20).optional(),

  // Display settings
  itemCount: z.number().int().min(1).max(20).optional(),
  showTimestamp: z.boolean().optional(),
  showChannelName: z.boolean().optional(),
});

// Update section request (partial)
export const ChannelSectionUpdateInput = z.object({
  title: Str().min(1).max(100).optional(),
  titleLocalized: z.record(z.string()).optional(),
  style: z.enum(['horizontal_row', 'vertical_list']).optional(),
  videoIds: z.array(Str()).max(20).optional(),
  playlistId: Str().optional(),
  playlistIds: z.array(Str()).max(10).optional(),
  channelIds: z.array(Str()).max(20).optional(),
  itemCount: z.number().int().min(1).max(20).optional(),
  showTimestamp: z.boolean().optional(),
  showChannelName: z.boolean().optional(),
});

// Reorder sections request
export const ChannelSectionReorderInput = z.object({
  sectionIds: z.array(Str()).min(1).max(50),
});
```

---

## API Endpoints

### 1. List Channel Sections

**Endpoint:** `GET /api/channels/:channelId/sections`

**Description:** Retrieves all sections for a channel, ordered by position.

**Authentication:** Optional (public channels visible without auth)

**OpenAPI Schema:**

```typescript
export class ChannelSectionsList extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'List all sections for a channel',
    description: `
      Retrieves all channel sections ordered by position (ascending).

      **Public Access:**
      - Public channels: All sections visible
      - Private channels: Only visible to channel owner (requires auth)

      **Response:**
      - Sections include type, title, position, and content references
      - Localized titles included when available
    `,
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
      }),
      query: z.object({
        limit: z.number().int().min(1).max(50).default(20)
          .describe('Maximum sections to return'),
        cursor: z.string().optional()
          .describe('Pagination cursor from previous response'),
        type: z.enum([
          'featured_videos',
          'recent_uploads',
          'popular_uploads',
          'single_playlist',
          'multiple_playlists',
          'subscribed_channels',
          'liked_videos',
        ]).optional()
          .describe('Filter by section type'),
      }),
    },
    responses: {
      '200': {
        description: 'Successfully retrieved channel sections',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                sections: z.array(ChannelSectionView),
                pagination: z.object({
                  cursor: z.string(),
                  hasMore: z.boolean(),
                  total: z.number(),
                }),
              }),
            }),
            example: {
              success: true,
              result: {
                sections: [
                  {
                    id: '550e8400-e29b-41d4-a716-446655440001',
                    channelId: '550e8400-e29b-41d4-a716-446655440000',
                    type: 'featured_videos',
                    title: 'Featured Videos',
                    titleLocalized: {
                      en: 'Featured Videos',
                      ar: 'الفيديوهات المميزة'
                    },
                    position: 0,
                    style: 'horizontal_row',
                    itemCount: 12,
                    showTimestamp: true,
                    showChannelName: false,
                    content: {
                      videoIds: [
                        'video-id-1',
                        'video-id-2',
                        'video-id-3'
                      ]
                    },
                    dateCreated: '2025-01-18T12:00:00.000Z',
                    dateModified: '2025-01-18T12:00:00.000Z'
                  },
                  {
                    id: '550e8400-e29b-41d4-a716-446655440002',
                    channelId: '550e8400-e29b-41d4-a716-446655440000',
                    type: 'recent_uploads',
                    title: 'Recent Uploads',
                    titleLocalized: {
                      en: 'Recent Uploads',
                      ar: 'أحدث الفيديوهات'
                    },
                    position: 1,
                    style: 'horizontal_row',
                    itemCount: 8,
                    showTimestamp: true,
                    showChannelName: false,
                    content: {},
                    dateCreated: '2025-01-18T12:00:00.000Z',
                    dateModified: '2025-01-18T12:00:00.000Z'
                  }
                ],
                pagination: {
                  cursor: '',
                  hasMore: false,
                  total: 2
                }
              }
            }
          },
        },
      },
      '404': {
        description: 'Channel not found',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'Channel not found'
            }
          },
        },
      },
    },
  }, 'optional');
}
```

---

### 2. Get Single Section

**Endpoint:** `GET /api/channels/:channelId/sections/:sectionId`

**Description:** Retrieves a single channel section by ID.

**Authentication:** Optional

**OpenAPI Schema:**

```typescript
export class ChannelSectionFetch extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Get a single channel section',
    description: `
      Retrieves detailed information about a specific channel section.

      **Access Control:**
      - Public if channel is public
      - Requires auth if channel is private
    `,
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
        sectionId: Str({ description: 'Section ID' }),
      }),
    },
    responses: {
      '200': {
        description: 'Successfully retrieved section',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                section: ChannelSectionView,
              }),
            }),
            example: {
              success: true,
              result: {
                section: {
                  id: '550e8400-e29b-41d4-a716-446655440001',
                  channelId: '550e8400-e29b-41d4-a716-446655440000',
                  type: 'featured_videos',
                  title: 'Featured Videos',
                  titleLocalized: {
                    en: 'Featured Videos',
                    ar: 'الفيديوهات المميزة'
                  },
                  position: 0,
                  style: 'horizontal_row',
                  itemCount: 12,
                  showTimestamp: true,
                  showChannelName: false,
                  content: {
                    videoIds: ['video-1', 'video-2', 'video-3']
                  },
                  dateCreated: '2025-01-18T12:00:00.000Z',
                  dateModified: '2025-01-18T12:00:00.000Z'
                }
              }
            }
          },
        },
      },
      '404': {
        description: 'Section or channel not found',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'Section not found'
            }
          },
        },
      },
    },
  }, 'optional');
}
```

---

### 3. Create Section

**Endpoint:** `POST /api/channels/:channelId/sections`

**Description:** Creates a new channel section.

**Authentication:** Required (channel owner only)

**OpenAPI Schema:**

```typescript
export class ChannelSectionCreate extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Create a new channel section',
    description: `
      Creates a new section for organizing channel content.

      **Authorization:**
      - User must be authenticated
      - User must own the channel

      **Section Types:**
      - \`featured_videos\` - Manually curated videos (requires videoIds)
      - \`recent_uploads\` - Latest videos from channel (auto-populated)
      - \`popular_uploads\` - Most viewed videos (auto-populated)
      - \`single_playlist\` - Videos from one playlist (requires playlistId)
      - \`multiple_playlists\` - Multiple playlists showcase (requires playlistIds)
      - \`subscribed_channels\` - Channels user subscribes to (auto-populated)
      - \`liked_videos\` - User's liked videos (auto-populated)

      **Position:**
      - New sections are appended to the end by default
      - Position is auto-calculated based on existing sections
      - Use PATCH /sections/reorder to change order

      **Validation:**
      - \`featured_videos\` requires at least 1 videoId
      - \`single_playlist\` requires playlistId
      - \`multiple_playlists\` requires at least 1 playlistId
      - Other types ignore content fields
    `,
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
      }),
      body: {
        content: {
          'application/json': {
            schema: ChannelSectionCreateInput,
            example: {
              type: 'featured_videos',
              title: 'Featured Videos',
              titleLocalized: {
                en: 'Featured Videos',
                ar: 'الفيديوهات المميزة'
              },
              style: 'horizontal_row',
              videoIds: [
                '550e8400-e29b-41d4-a716-446655440010',
                '550e8400-e29b-41d4-a716-446655440011',
                '550e8400-e29b-41d4-a716-446655440012'
              ],
              itemCount: 12,
              showTimestamp: true,
              showChannelName: false
            }
          },
        },
      },
    },
    responses: {
      '201': {
        description: 'Section created successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                section: ChannelSectionView,
              }),
            }),
            example: {
              success: true,
              result: {
                section: {
                  id: '550e8400-e29b-41d4-a716-446655440001',
                  channelId: '550e8400-e29b-41d4-a716-446655440000',
                  type: 'featured_videos',
                  title: 'Featured Videos',
                  titleLocalized: {
                    en: 'Featured Videos',
                    ar: 'الفيديوهات المميزة'
                  },
                  position: 0,
                  style: 'horizontal_row',
                  itemCount: 12,
                  showTimestamp: true,
                  showChannelName: false,
                  content: {
                    videoIds: [
                      '550e8400-e29b-41d4-a716-446655440010',
                      '550e8400-e29b-41d4-a716-446655440011',
                      '550e8400-e29b-41d4-a716-446655440012'
                    ]
                  },
                  dateCreated: '2025-01-18T12:00:00.000Z',
                  dateModified: '2025-01-18T12:00:00.000Z'
                }
              }
            }
          },
        },
      },
      '400': {
        description: 'Invalid input data',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
              details: z.array(z.object({
                field: z.string(),
                message: z.string(),
              })).optional(),
            }),
            example: {
              success: false,
              error: 'Validation failed',
              details: [
                {
                  field: 'videoIds',
                  message: 'featured_videos type requires at least one video ID'
                }
              ]
            }
          },
        },
      },
      '403': {
        description: 'Forbidden - not channel owner',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'You can only create sections for your own channel'
            }
          },
        },
      },
      '404': {
        description: 'Channel not found',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'Channel not found'
            }
          },
        },
      },
    },
  }, 'required');
}
```

---

### 4. Update Section

**Endpoint:** `PUT /api/channels/:channelId/sections/:sectionId`

**Description:** Updates an existing channel section (partial update).

**Authentication:** Required (channel owner only)

**OpenAPI Schema:**

```typescript
export class ChannelSectionUpdate extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Update a channel section',
    description: `
      Updates an existing channel section with partial data.

      **Authorization:**
      - User must be authenticated
      - User must own the channel

      **Notes:**
      - Only provided fields are updated (partial update)
      - Cannot change section \`type\` (delete and recreate instead)
      - Cannot change \`position\` (use PATCH /sections/reorder)
      - Content validation applies based on section type

      **Idempotency:**
      - Safe to retry - same input produces same result
    `,
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
        sectionId: Str({ description: 'Section ID' }),
      }),
      body: {
        content: {
          'application/json': {
            schema: ChannelSectionUpdateInput,
            example: {
              title: 'Updated Featured Videos',
              titleLocalized: {
                en: 'Updated Featured Videos',
                ar: 'الفيديوهات المميزة المحدثة'
              },
              videoIds: [
                '550e8400-e29b-41d4-a716-446655440010',
                '550e8400-e29b-41d4-a716-446655440013',
                '550e8400-e29b-41d4-a716-446655440014'
              ],
              itemCount: 15
            }
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Section updated successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                section: ChannelSectionView,
              }),
            }),
            example: {
              success: true,
              result: {
                section: {
                  id: '550e8400-e29b-41d4-a716-446655440001',
                  channelId: '550e8400-e29b-41d4-a716-446655440000',
                  type: 'featured_videos',
                  title: 'Updated Featured Videos',
                  titleLocalized: {
                    en: 'Updated Featured Videos',
                    ar: 'الفيديوهات المميزة المحدثة'
                  },
                  position: 0,
                  style: 'horizontal_row',
                  itemCount: 15,
                  showTimestamp: true,
                  showChannelName: false,
                  content: {
                    videoIds: [
                      '550e8400-e29b-41d4-a716-446655440010',
                      '550e8400-e29b-41d4-a716-446655440013',
                      '550e8400-e29b-41d4-a716-446655440014'
                    ]
                  },
                  dateCreated: '2025-01-18T12:00:00.000Z',
                  dateModified: '2025-01-18T14:30:00.000Z'
                }
              }
            }
          },
        },
      },
      '400': {
        description: 'Invalid input data',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'Validation failed'
            }
          },
        },
      },
      '403': {
        description: 'Forbidden - not channel owner',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'You can only update sections for your own channel'
            }
          },
        },
      },
      '404': {
        description: 'Section or channel not found',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'Section not found'
            }
          },
        },
      },
    },
  }, 'required');
}
```

---

### 5. Delete Section

**Endpoint:** `DELETE /api/channels/:channelId/sections/:sectionId`

**Description:** Deletes a channel section and reorders remaining sections.

**Authentication:** Required (channel owner only)

**OpenAPI Schema:**

```typescript
export class ChannelSectionDelete extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Delete a channel section',
    description: `
      Permanently deletes a channel section.

      **Authorization:**
      - User must be authenticated
      - User must own the channel

      **Side Effects:**
      - Remaining sections are automatically reordered
      - Position values are recalculated (no gaps)

      **Idempotency:**
      - Safe to retry - 404 returned if already deleted
    `,
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
        sectionId: Str({ description: 'Section ID' }),
      }),
    },
    responses: {
      '200': {
        description: 'Section deleted successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                message: z.string(),
                deletedSectionId: z.string(),
              }),
            }),
            example: {
              success: true,
              result: {
                message: 'Section deleted successfully',
                deletedSectionId: '550e8400-e29b-41d4-a716-446655440001'
              }
            }
          },
        },
      },
      '403': {
        description: 'Forbidden - not channel owner',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'You can only delete sections from your own channel'
            }
          },
        },
      },
      '404': {
        description: 'Section or channel not found',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'Section not found'
            }
          },
        },
      },
    },
  }, 'required');
}
```

---

### 6. Reorder Sections (Bulk Operation)

**Endpoint:** `PATCH /api/channels/:channelId/sections/reorder`

**Description:** Reorders multiple sections in a single atomic operation.

**Authentication:** Required (channel owner only)

**OpenAPI Schema:**

```typescript
export class ChannelSectionReorder extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Reorder channel sections',
    description: `
      Reorders all sections for a channel in a single atomic operation.

      **Authorization:**
      - User must be authenticated
      - User must own the channel

      **Request:**
      - Provide ordered array of section IDs
      - First ID gets position 0, second gets position 1, etc.
      - Must include ALL existing sections (prevents accidental deletions)

      **Validation:**
      - All section IDs must exist
      - All section IDs must belong to the channel
      - No duplicate IDs allowed
      - Array length must match existing section count

      **Atomicity:**
      - Either all sections are reordered, or none (rollback on error)

      **Idempotency:**
      - Safe to retry - same order produces same result
    `,
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
      }),
      body: {
        content: {
          'application/json': {
            schema: ChannelSectionReorderInput,
            example: {
              sectionIds: [
                '550e8400-e29b-41d4-a716-446655440003',  // Now position 0
                '550e8400-e29b-41d4-a716-446655440001',  // Now position 1
                '550e8400-e29b-41d4-a716-446655440002',  // Now position 2
              ]
            }
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Sections reordered successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                sections: z.array(ChannelSectionView),
                message: z.string(),
              }),
            }),
            example: {
              success: true,
              result: {
                message: 'Sections reordered successfully',
                sections: [
                  {
                    id: '550e8400-e29b-41d4-a716-446655440003',
                    channelId: '550e8400-e29b-41d4-a716-446655440000',
                    type: 'recent_uploads',
                    title: 'Recent Uploads',
                    position: 0,
                    style: 'horizontal_row',
                    itemCount: 8,
                    showTimestamp: true,
                    showChannelName: false,
                    content: {},
                    dateCreated: '2025-01-18T12:00:00.000Z',
                    dateModified: '2025-01-18T15:00:00.000Z'
                  },
                  {
                    id: '550e8400-e29b-41d4-a716-446655440001',
                    channelId: '550e8400-e29b-41d4-a716-446655440000',
                    type: 'featured_videos',
                    title: 'Featured Videos',
                    position: 1,
                    style: 'horizontal_row',
                    itemCount: 12,
                    showTimestamp: true,
                    showChannelName: false,
                    content: {
                      videoIds: ['video-1', 'video-2', 'video-3']
                    },
                    dateCreated: '2025-01-18T12:00:00.000Z',
                    dateModified: '2025-01-18T15:00:00.000Z'
                  },
                  {
                    id: '550e8400-e29b-41d4-a716-446655440002',
                    channelId: '550e8400-e29b-41d4-a716-446655440000',
                    type: 'single_playlist',
                    title: 'Islamic History Series',
                    position: 2,
                    style: 'horizontal_row',
                    itemCount: 10,
                    showTimestamp: true,
                    showChannelName: false,
                    content: {
                      playlistId: 'playlist-123'
                    },
                    dateCreated: '2025-01-18T12:00:00.000Z',
                    dateModified: '2025-01-18T15:00:00.000Z'
                  }
                ]
              }
            }
          },
        },
      },
      '400': {
        description: 'Invalid input data',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
              details: z.object({
                expected: z.number(),
                provided: z.number(),
                missing: z.array(z.string()).optional(),
                extra: z.array(z.string()).optional(),
              }).optional(),
            }),
            example: {
              success: false,
              error: 'Section count mismatch',
              details: {
                expected: 3,
                provided: 2,
                missing: ['550e8400-e29b-41d4-a716-446655440002']
              }
            }
          },
        },
      },
      '403': {
        description: 'Forbidden - not channel owner',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'You can only reorder sections for your own channel'
            }
          },
        },
      },
      '404': {
        description: 'Channel or section not found',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().default(false),
              error: z.string(),
            }),
            example: {
              success: false,
              error: 'One or more section IDs not found'
            }
          },
        },
      },
    },
  }, 'required');
}
```

---

## Implementation Guide

### Storage Pattern

Channel sections are stored in a dedicated R2 bucket following the repository pattern:

```typescript
// R2 Bucket: channel-sections (or channel-sections-preview for dev)
// Key format: channelId/sectionId
// Example: 550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440001

// Repository setup
import R2Repository from '../../lib/r2Repo';
import { env } from 'cloudflare:workers';

const sectionsRepo = new R2Repository<ChannelSection>(env.channel_sections);
```

### Listing Sections for a Channel

```typescript
// List all sections for a channel
async function listSectionsForChannel(
  channelId: string,
  limit: number = 20,
  cursor?: string
): Promise<PaginationResponse<ChannelSection>> {
  // Use R2 list with prefix to get all sections for channel
  const listResult = await env.channel_sections.list({
    prefix: `${channelId}/`,
    limit,
    cursor,
  });

  // Fetch full objects
  const sections = await Promise.all(
    listResult.objects.map(async (obj) => {
      const section = await sectionsRepo.getObject(obj.key);
      return section;
    })
  );

  // Sort by position (ascending)
  sections.sort((a, b) => a.position - b.position);

  return {
    cursor: listResult.truncated ? listResult.cursor : '',
    items: sections.filter((s) => s !== null) as ChannelSection[],
  };
}
```

### Creating a Section

```typescript
async function createSection(
  channelId: string,
  userId: string,
  input: ChannelSectionCreateInput
): Promise<ChannelSection> {
  // Validate section type and content
  validateSectionContent(input.type, input);

  // Get existing sections to calculate position
  const existingSections = await listSectionsForChannel(channelId);
  const nextPosition = existingSections.items.length;

  // Create section object
  const section: ChannelSection = {
    id: crypto.randomUUID(),
    channelId,
    userId,
    type: input.type,
    title: input.title,
    titleLocalized: input.titleLocalized,
    position: nextPosition,
    style: input.style || 'horizontal_row',
    videoIds: input.videoIds || [],
    playlistId: input.playlistId,
    playlistIds: input.playlistIds || [],
    channelIds: input.channelIds || [],
    itemCount: input.itemCount || 12,
    showTimestamp: input.showTimestamp ?? true,
    showChannelName: input.showChannelName ?? false,
    dateCreated: new Date().toISOString(),
    dateModified: new Date().toISOString(),
  };

  // Save to R2 with composite key
  await sectionsRepo.putObject(`${channelId}/${section.id}`, section);

  // Queue analytics event
  const queue = new Queue();
  await queue.send(MessageType.ChannelSectionCreate, {
    channelId,
    sectionId: section.id,
    userId,
    timestamp: new Date().toISOString(),
  });

  return section;
}

// Validation helper
function validateSectionContent(type: string, input: any): void {
  if (type === 'featured_videos' && (!input.videoIds || input.videoIds.length === 0)) {
    throw new Error('featured_videos type requires at least one video ID');
  }
  if (type === 'single_playlist' && !input.playlistId) {
    throw new Error('single_playlist type requires playlistId');
  }
  if (type === 'multiple_playlists' && (!input.playlistIds || input.playlistIds.length === 0)) {
    throw new Error('multiple_playlists type requires at least one playlist ID');
  }
}
```

### Reordering Sections (Atomic Operation)

```typescript
async function reorderSections(
  channelId: string,
  userId: string,
  sectionIds: string[]
): Promise<ChannelSection[]> {
  // Fetch all existing sections
  const existingSections = await listSectionsForChannel(channelId);

  // Validate: all IDs must be present
  if (sectionIds.length !== existingSections.items.length) {
    throw new Error('Section count mismatch');
  }

  // Validate: all IDs must exist
  const existingIds = new Set(existingSections.items.map((s) => s.id));
  const invalidIds = sectionIds.filter((id) => !existingIds.has(id));
  if (invalidIds.length > 0) {
    throw new Error(`Invalid section IDs: ${invalidIds.join(', ')}`);
  }

  // Update positions
  const updatedSections: ChannelSection[] = [];
  for (let i = 0; i < sectionIds.length; i++) {
    const section = existingSections.items.find((s) => s.id === sectionIds[i])!;
    const updatedSection = {
      ...section,
      position: i,
      dateModified: new Date().toISOString(),
    };
    updatedSections.push(updatedSection);
  }

  // Save all sections (atomic-like behavior in R2)
  await Promise.all(
    updatedSections.map((section) =>
      sectionsRepo.putObject(`${channelId}/${section.id}`, section)
    )
  );

  // Queue analytics event
  const queue = new Queue();
  await queue.send(MessageType.ChannelSectionReorder, {
    channelId,
    userId,
    sectionCount: updatedSections.length,
    timestamp: new Date().toISOString(),
  });

  return updatedSections;
}
```

### Authorization Helper

```typescript
async function verifyChannelOwnership(
  channelId: string,
  userId: string
): Promise<boolean> {
  const channelRepo = new R2Repository<Channel>(env.channels);
  const channel = await channelRepo.getObject(channelId);

  if (!channel) {
    throw new Error('Channel not found');
  }

  if (channel.userId !== userId) {
    return false;
  }

  return true;
}
```

### Transformation to View Model

```typescript
function transformSectionToView(section: ChannelSection): ChannelSectionView {
  return {
    id: section.id,
    channelId: section.channelId,
    type: section.type,
    title: section.title,
    titleLocalized: section.titleLocalized,
    position: section.position,
    style: section.style,
    itemCount: section.itemCount,
    showTimestamp: section.showTimestamp,
    showChannelName: section.showChannelName,
    content: {
      videoIds: section.videoIds.length > 0 ? section.videoIds : undefined,
      playlistId: section.playlistId,
      playlistIds: section.playlistIds.length > 0 ? section.playlistIds : undefined,
      channelIds: section.channelIds.length > 0 ? section.channelIds : undefined,
    },
    dateCreated: section.dateCreated,
    dateModified: section.dateModified,
  };
}
```

---

## Error Handling

### Standard Error Response

All endpoints use the consistent error format:

```typescript
{
  success: false,
  error: "Human-readable error message",
  details?: {
    // Optional additional context
  }
}
```

### HTTP Status Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| 200 | OK | Successful GET, PUT, PATCH |
| 201 | Created | Successful POST (resource created) |
| 204 | No Content | Successful DELETE (no response body) |
| 400 | Bad Request | Invalid input, validation failure |
| 401 | Unauthorized | Missing or invalid JWT token |
| 403 | Forbidden | Valid auth but insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource, state conflict |
| 422 | Unprocessable | Valid syntax but semantic errors |
| 500 | Internal Error | Unexpected server error |

### Validation Errors

```typescript
{
  success: false,
  error: "Validation failed",
  details: [
    {
      field: "videoIds",
      message: "featured_videos type requires at least one video ID"
    },
    {
      field: "title",
      message: "Title must be between 1 and 100 characters"
    }
  ]
}
```

### Authorization Errors

```typescript
// 401 Unauthorized (no valid token)
{
  success: false,
  error: "Missing or invalid Authorization header. Expected: Bearer <token>"
}

// 403 Forbidden (valid token, but not channel owner)
{
  success: false,
  error: "You can only create sections for your own channel"
}
```

---

## Examples

### Example 1: Create Featured Videos Section

```bash
curl -X POST https://videos.api.alummahnow.net/api/channels/550e8400-e29b-41d4-a716-446655440000/sections \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "type": "featured_videos",
    "title": "Featured Islamic Lectures",
    "titleLocalized": {
      "en": "Featured Islamic Lectures",
      "ar": "المحاضرات الإسلامية المميزة"
    },
    "style": "horizontal_row",
    "videoIds": [
      "video-1",
      "video-2",
      "video-3"
    ],
    "itemCount": 12,
    "showTimestamp": true,
    "showChannelName": false
  }'
```

**Response:**
```json
{
  "success": true,
  "result": {
    "section": {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "channelId": "550e8400-e29b-41d4-a716-446655440000",
      "type": "featured_videos",
      "title": "Featured Islamic Lectures",
      "titleLocalized": {
        "en": "Featured Islamic Lectures",
        "ar": "المحاضرات الإسلامية المميزة"
      },
      "position": 0,
      "style": "horizontal_row",
      "itemCount": 12,
      "showTimestamp": true,
      "showChannelName": false,
      "content": {
        "videoIds": ["video-1", "video-2", "video-3"]
      },
      "dateCreated": "2025-01-18T12:00:00.000Z",
      "dateModified": "2025-01-18T12:00:00.000Z"
    }
  }
}
```

---

### Example 2: List All Sections

```bash
curl https://videos.api.alummahnow.net/api/channels/550e8400-e29b-41d4-a716-446655440000/sections
```

**Response:**
```json
{
  "success": true,
  "result": {
    "sections": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "channelId": "550e8400-e29b-41d4-a716-446655440000",
        "type": "featured_videos",
        "title": "Featured Islamic Lectures",
        "titleLocalized": {
          "en": "Featured Islamic Lectures",
          "ar": "المحاضرات الإسلامية المميزة"
        },
        "position": 0,
        "style": "horizontal_row",
        "itemCount": 12,
        "showTimestamp": true,
        "showChannelName": false,
        "content": {
          "videoIds": ["video-1", "video-2", "video-3"]
        },
        "dateCreated": "2025-01-18T12:00:00.000Z",
        "dateModified": "2025-01-18T12:00:00.000Z"
      },
      {
        "id": "550e8400-e29b-41d4-a716-446655440002",
        "channelId": "550e8400-e29b-41d4-a716-446655440000",
        "type": "recent_uploads",
        "title": "Recent Uploads",
        "titleLocalized": {
          "en": "Recent Uploads",
          "ar": "أحدث الفيديوهات"
        },
        "position": 1,
        "style": "horizontal_row",
        "itemCount": 8,
        "showTimestamp": true,
        "showChannelName": false,
        "content": {},
        "dateCreated": "2025-01-18T12:00:00.000Z",
        "dateModified": "2025-01-18T12:00:00.000Z"
      }
    ],
    "pagination": {
      "cursor": "",
      "hasMore": false,
      "total": 2
    }
  }
}
```

---

### Example 3: Update Section

```bash
curl -X PUT https://videos.api.alummahnow.net/api/channels/550e8400-e29b-41d4-a716-446655440000/sections/550e8400-e29b-41d4-a716-446655440001 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Top Islamic Lectures",
    "videoIds": ["video-1", "video-4", "video-5"],
    "itemCount": 15
  }'
```

**Response:**
```json
{
  "success": true,
  "result": {
    "section": {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "channelId": "550e8400-e29b-41d4-a716-446655440000",
      "type": "featured_videos",
      "title": "Top Islamic Lectures",
      "titleLocalized": {
        "en": "Featured Islamic Lectures",
        "ar": "المحاضرات الإسلامية المميزة"
      },
      "position": 0,
      "style": "horizontal_row",
      "itemCount": 15,
      "showTimestamp": true,
      "showChannelName": false,
      "content": {
        "videoIds": ["video-1", "video-4", "video-5"]
      },
      "dateCreated": "2025-01-18T12:00:00.000Z",
      "dateModified": "2025-01-18T14:30:00.000Z"
    }
  }
}
```

---

### Example 4: Reorder Sections

```bash
curl -X PATCH https://videos.api.alummahnow.net/api/channels/550e8400-e29b-41d4-a716-446655440000/sections/reorder \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "sectionIds": [
      "550e8400-e29b-41d4-a716-446655440002",
      "550e8400-e29b-41d4-a716-446655440001"
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "result": {
    "message": "Sections reordered successfully",
    "sections": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440002",
        "channelId": "550e8400-e29b-41d4-a716-446655440000",
        "type": "recent_uploads",
        "title": "Recent Uploads",
        "position": 0,
        "style": "horizontal_row",
        "itemCount": 8,
        "showTimestamp": true,
        "showChannelName": false,
        "content": {},
        "dateCreated": "2025-01-18T12:00:00.000Z",
        "dateModified": "2025-01-18T15:00:00.000Z"
      },
      {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "channelId": "550e8400-e29b-41d4-a716-446655440000",
        "type": "featured_videos",
        "title": "Featured Islamic Lectures",
        "position": 1,
        "style": "horizontal_row",
        "itemCount": 12,
        "showTimestamp": true,
        "showChannelName": false,
        "content": {
          "videoIds": ["video-1", "video-2", "video-3"]
        },
        "dateCreated": "2025-01-18T12:00:00.000Z",
        "dateModified": "2025-01-18T15:00:00.000Z"
      }
    ]
  }
}
```

---

### Example 5: Delete Section

```bash
curl -X DELETE https://videos.api.alummahnow.net/api/channels/550e8400-e29b-41d4-a716-446655440000/sections/550e8400-e29b-41d4-a716-446655440001 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response:**
```json
{
  "success": true,
  "result": {
    "message": "Section deleted successfully",
    "deletedSectionId": "550e8400-e29b-41d4-a716-446655440001"
  }
}
```

---

## Rate Limiting

All authenticated endpoints are subject to rate limiting:

- **100 requests per minute** per user
- **1000 requests per hour** per IP address

Rate limit headers included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705582800
```

When exceeded:

```json
{
  "success": false,
  "error": "Rate limit exceeded. Try again in 30 seconds.",
  "retryAfter": 30
}
```

---

## Queue Events

Channel section operations trigger queue events for analytics:

```typescript
// Event types
enum MessageType {
  ChannelSectionCreate = 'channel_section_create',
  ChannelSectionUpdate = 'channel_section_update',
  ChannelSectionDelete = 'channel_section_delete',
  ChannelSectionReorder = 'channel_section_reorder',
  ChannelSectionView = 'channel_section_view',
}

// Event payload examples
{
  type: 'channel_section_create',
  channelId: '550e8400-e29b-41d4-a716-446655440000',
  sectionId: '550e8400-e29b-41d4-a716-446655440001',
  userId: 'user-123',
  timestamp: '2025-01-18T12:00:00.000Z'
}

{
  type: 'channel_section_reorder',
  channelId: '550e8400-e29b-41d4-a716-446655440000',
  userId: 'user-123',
  sectionCount: 3,
  timestamp: '2025-01-18T15:00:00.000Z'
}
```

---

## Wrangler Configuration

Add to `wrangler.jsonc`:

```jsonc
{
  "r2_buckets": [
    // ... existing buckets
    {
      "binding": "channel_sections",
      "bucket_name": "al-ummah-now-channel-sections",
      "preview_bucket_name": "al-ummah-now-channel-sections-preview"
    }
  ]
}
```

---

## Next Steps

1. **Implementation Phase:**
   - Create TypeScript interfaces in `packages/shared-types/src/channel-section.ts`
   - Implement endpoint handlers in `apps/api-videos/src/endpoints/channel-section/`
   - Add transformation functions to `apps/api-videos/src/lib/transformations.ts`
   - Register endpoints in `apps/api-videos/src/index.ts`

2. **Testing Phase:**
   - Test with Swagger UI at http://127.0.0.1:8686/
   - Verify authorization enforcement
   - Test reorder atomicity
   - Validate bilingual content

3. **Deployment Phase:**
   - Create R2 buckets in Cloudflare dashboard
   - Update `wrangler.jsonc` bindings
   - Deploy to staging environment
   - Run smoke tests
   - Deploy to production

4. **Documentation Phase:**
   - Update `ROADMAP.md` with channel sections feature
   - Add usage examples to `TECHNICAL_DOCUMENTATION.md`
   - Document queue event types in processor app
   - Create user-facing API guide

---

## References

- **Al Ummah Now API Patterns**: `/home/meywd/AlUmmahNow/apps/api-videos/CLAUDE.md`
- **Authentication Guide**: `/home/meywd/AlUmmahNow/apps/api-videos/AUTHENTICATION.md`
- **OpenAPI Helper**: `/home/meywd/AlUmmahNow/apps/api-videos/src/lib/openapi-auth.ts`
- **R2 Repository**: `/home/meywd/AlUmmahNow/apps/api-videos/src/lib/r2Repo.ts`
- **YouTube API Reference**: https://developers.google.com/youtube/v3/docs/channelSections

---

**End of Specification**
