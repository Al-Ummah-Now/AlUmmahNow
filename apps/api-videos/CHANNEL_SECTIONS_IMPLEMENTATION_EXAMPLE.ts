/**
 * CHANNEL SECTIONS IMPLEMENTATION EXAMPLES
 *
 * This file demonstrates the complete implementation pattern for channel sections
 * endpoints following Al Ummah Now API conventions.
 *
 * NOTE: This is a reference implementation. Actual files should be created in:
 * - /packages/shared-types/src/channel-section.ts
 * - /apps/api-videos/src/endpoints/channel-section/*.ts
 * - /apps/api-videos/src/lib/transformations.ts (add helpers)
 */

// ============================================================================
// SHARED TYPES (packages/shared-types/src/channel-section.ts)
// ============================================================================

import { z } from 'zod';
import { Str, DateTime } from 'chanfana';

// Business model - stored in R2
export const ChannelSection = z.object({
  id: Str(),
  channelId: Str(),
  userId: Str(),

  // Section configuration
  type: z.enum([
    'featured_videos',
    'recent_uploads',
    'popular_uploads',
    'single_playlist',
    'multiple_playlists',
    'subscribed_channels',
    'liked_videos',
  ]),

  // Localized content
  title: Str(),
  titleLocalized: z.record(z.string()).optional(),

  // Display settings
  position: z.number().int().min(0),
  style: z.enum(['horizontal_row', 'vertical_list']).default('horizontal_row'),

  // Content references
  videoIds: z.array(Str()).default([]),
  playlistId: Str().optional(),
  playlistIds: z.array(Str()).default([]),
  channelIds: z.array(Str()).default([]),

  // Item display settings
  itemCount: z.number().int().min(1).max(20).default(12),
  showTimestamp: z.boolean().default(true),
  showChannelName: z.boolean().default(false),

  // Timestamps
  dateCreated: DateTime(),
  dateModified: DateTime(),
});

export type ChannelSection = z.infer<typeof ChannelSection>;

// View model - returned in API responses
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

// Input models
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
  videoIds: z.array(Str()).max(20).optional(),
  playlistId: Str().optional(),
  playlistIds: z.array(Str()).max(10).optional(),
  channelIds: z.array(Str()).max(20).optional(),
  itemCount: z.number().int().min(1).max(20).optional(),
  showTimestamp: z.boolean().optional(),
  showChannelName: z.boolean().optional(),
});

export type ChannelSectionCreateInput = z.infer<typeof ChannelSectionCreateInput>;

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

export type ChannelSectionUpdateInput = z.infer<typeof ChannelSectionUpdateInput>;

export const ChannelSectionReorderInput = z.object({
  sectionIds: z.array(Str()).min(1).max(50),
});

export type ChannelSectionReorderInput = z.infer<typeof ChannelSectionReorderInput>;

// ============================================================================
// TRANSFORMATION HELPERS (apps/api-videos/src/lib/transformations.ts)
// ============================================================================

/**
 * Transform business channel section to view model
 */
export function transformChannelSectionToView(section: ChannelSection): ChannelSectionView {
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

/**
 * Transform multiple channel sections to view models
 */
export function transformChannelSectionsToView(
  sections: ChannelSection[]
): ChannelSectionView[] {
  return sections.map(transformChannelSectionToView);
}

/**
 * Validate section content based on type
 */
export function validateSectionContent(
  type: string,
  input: ChannelSectionCreateInput | ChannelSectionUpdateInput
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (type === 'featured_videos') {
    if (!input.videoIds || input.videoIds.length === 0) {
      errors.push('featured_videos type requires at least one video ID');
    }
  }

  if (type === 'single_playlist') {
    if (!input.playlistId) {
      errors.push('single_playlist type requires playlistId');
    }
  }

  if (type === 'multiple_playlists') {
    if (!input.playlistIds || input.playlistIds.length === 0) {
      errors.push('multiple_playlists type requires at least one playlist ID');
    }
  }

  // Auto-populated types shouldn't have content
  const autoTypes = ['recent_uploads', 'popular_uploads', 'subscribed_channels', 'liked_videos'];
  if (autoTypes.includes(type)) {
    if (input.videoIds && input.videoIds.length > 0) {
      errors.push(`${type} sections are auto-populated, remove videoIds`);
    }
    if (input.playlistId) {
      errors.push(`${type} sections are auto-populated, remove playlistId`);
    }
    if (input.playlistIds && input.playlistIds.length > 0) {
      errors.push(`${type} sections are auto-populated, remove playlistIds`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// ENDPOINT: LIST SECTIONS
// (apps/api-videos/src/endpoints/channel-section/channelSectionList.ts)
// ============================================================================

import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { env } from 'cloudflare:workers';
import R2Repository from '../../lib/r2Repo';
import { transformChannelSectionsToView } from '../../lib/transformations';

export class ChannelSectionsList extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Channel Sections'],
      summary: 'List all sections for a channel',
      description: `
        Retrieves all channel sections ordered by position (ascending).

        **Public Access:**
        - Public channels: All sections visible to everyone
        - Private channels: Only visible to channel owner (requires auth)

        **Filtering:**
        - Optional \`type\` query parameter to filter by section type

        **Pagination:**
        - Cursor-based pagination with configurable limit (default: 20, max: 50)
      `,
      request: {
        params: z.object({
          channelId: Str({ description: 'Channel ID' }),
        }),
        query: z.object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(20)
            .describe('Maximum sections to return'),
          cursor: z.string().optional().describe('Pagination cursor from previous response'),
          type: z
            .enum([
              'featured_videos',
              'recent_uploads',
              'popular_uploads',
              'single_playlist',
              'multiple_playlists',
              'subscribed_channels',
              'liked_videos',
            ])
            .optional()
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
            },
          },
        },
      },
    },
    'optional'
  );

  async handle(c) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.params;
    const { limit, cursor, type } = request.query;

    // Get auth context (optional)
    const auth = c.get('auth');

    // Verify channel exists
    const channelRepo = new R2Repository(env.channels);
    const channel = await channelRepo.getObject(channelId);

    if (!channel) {
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    // Check privacy (if private, require ownership)
    if (!channel.isPublic && (!auth || auth.userId !== channel.userId)) {
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    // List sections with prefix for this channel
    const sectionsRepo = new R2Repository(env.channel_sections);
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

    // Filter out nulls
    let filteredSections = sections.filter((s) => s !== null);

    // Filter by type if provided
    if (type) {
      filteredSections = filteredSections.filter((s) => s.type === type);
    }

    // Sort by position (ascending)
    filteredSections.sort((a, b) => a.position - b.position);

    // Transform to view models
    const sectionViews = transformChannelSectionsToView(filteredSections);

    return {
      success: true,
      result: {
        sections: sectionViews,
        pagination: {
          cursor: listResult.truncated ? listResult.cursor : '',
          hasMore: listResult.truncated,
          total: filteredSections.length,
        },
      },
    };
  }
}

// ============================================================================
// ENDPOINT: CREATE SECTION
// (apps/api-videos/src/endpoints/channel-section/channelSectionCreate.ts)
// ============================================================================

export class ChannelSectionCreate extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Channel Sections'],
      summary: 'Create a new channel section',
      description: `
        Creates a new section for organizing channel content.

        **Authorization:**
        - User must be authenticated
        - User must own the channel

        **Position:**
        - Automatically calculated as last position + 1
        - Use PATCH /sections/reorder to change order

        **Validation:**
        - Section type determines required fields
        - Content validation based on type
      `,
      request: {
        params: z.object({
          channelId: Str({ description: 'Channel ID' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: ChannelSectionCreateInput,
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
                details: z
                  .array(
                    z.object({
                      field: z.string(),
                      message: z.string(),
                    })
                  )
                  .optional(),
              }),
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
            },
          },
        },
      },
    },
    'required'
  );

  async handle(c) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.params;
    const input = request.body;

    // Get auth context
    const auth = c.get('auth');
    if (!auth) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        401
      );
    }

    // Verify channel exists and ownership
    const channelRepo = new R2Repository(env.channels);
    const channel = await channelRepo.getObject(channelId);

    if (!channel) {
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    if (channel.userId !== auth.userId) {
      return c.json(
        {
          success: false,
          error: 'You can only create sections for your own channel',
        },
        403
      );
    }

    // Validate content based on type
    const validation = validateSectionContent(input.type, input);
    if (!validation.valid) {
      return c.json(
        {
          success: false,
          error: 'Validation failed',
          details: validation.errors.map((msg) => ({
            field: 'content',
            message: msg,
          })),
        },
        400
      );
    }

    // Get existing sections to calculate position
    const listResult = await env.channel_sections.list({
      prefix: `${channelId}/`,
    });
    const nextPosition = listResult.objects.length;

    // Create section object
    const section: ChannelSection = {
      id: crypto.randomUUID(),
      channelId,
      userId: auth.userId,
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
    const sectionsRepo = new R2Repository(env.channel_sections);
    await sectionsRepo.putObject(`${channelId}/${section.id}`, section);

    // Queue analytics event
    const queue = new Queue();
    await queue.send(MessageType.ChannelSectionCreate, {
      channelId,
      sectionId: section.id,
      userId: auth.userId,
      timestamp: new Date().toISOString(),
    });

    // Transform to view model
    const sectionView = transformChannelSectionToView(section);

    return c.json(
      {
        success: true,
        result: {
          section: sectionView,
        },
      },
      201
    );
  }
}

// ============================================================================
// ENDPOINT: UPDATE SECTION
// (apps/api-videos/src/endpoints/channel-section/channelSectionUpdate.ts)
// ============================================================================

export class ChannelSectionUpdate extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Channel Sections'],
      summary: 'Update a channel section',
      description: `
        Updates an existing channel section with partial data.

        **Authorization:**
        - User must be authenticated
        - User must own the channel

        **Notes:**
        - Partial update (only provided fields are updated)
        - Cannot change section type (delete and recreate instead)
        - Cannot change position (use PATCH /sections/reorder)
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
            },
          },
        },
      },
    },
    'required'
  );

  async handle(c) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId, sectionId } = request.params;
    const input = request.body;

    // Get auth context
    const auth = c.get('auth');
    if (!auth) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        401
      );
    }

    // Verify channel exists and ownership
    const channelRepo = new R2Repository(env.channels);
    const channel = await channelRepo.getObject(channelId);

    if (!channel) {
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    if (channel.userId !== auth.userId) {
      return c.json(
        {
          success: false,
          error: 'You can only update sections for your own channel',
        },
        403
      );
    }

    // Get existing section
    const sectionsRepo = new R2Repository(env.channel_sections);
    const section = await sectionsRepo.getObject(`${channelId}/${sectionId}`);

    if (!section) {
      return c.json(
        {
          success: false,
          error: 'Section not found',
        },
        404
      );
    }

    // Validate content if being updated
    const validation = validateSectionContent(section.type, input);
    if (!validation.valid) {
      return c.json(
        {
          success: false,
          error: 'Validation failed',
          details: validation.errors,
        },
        400
      );
    }

    // Update section (partial)
    const updatedSection: ChannelSection = {
      ...section,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.titleLocalized !== undefined && { titleLocalized: input.titleLocalized }),
      ...(input.style !== undefined && { style: input.style }),
      ...(input.videoIds !== undefined && { videoIds: input.videoIds }),
      ...(input.playlistId !== undefined && { playlistId: input.playlistId }),
      ...(input.playlistIds !== undefined && { playlistIds: input.playlistIds }),
      ...(input.channelIds !== undefined && { channelIds: input.channelIds }),
      ...(input.itemCount !== undefined && { itemCount: input.itemCount }),
      ...(input.showTimestamp !== undefined && { showTimestamp: input.showTimestamp }),
      ...(input.showChannelName !== undefined && { showChannelName: input.showChannelName }),
      dateModified: new Date().toISOString(),
    };

    // Save updated section
    await sectionsRepo.putObject(`${channelId}/${sectionId}`, updatedSection);

    // Queue analytics event
    const queue = new Queue();
    await queue.send(MessageType.ChannelSectionUpdate, {
      channelId,
      sectionId,
      userId: auth.userId,
      timestamp: new Date().toISOString(),
    });

    // Transform to view model
    const sectionView = transformChannelSectionToView(updatedSection);

    return {
      success: true,
      result: {
        section: sectionView,
      },
    };
  }
}

// ============================================================================
// ENDPOINT: REORDER SECTIONS
// (apps/api-videos/src/endpoints/channel-section/channelSectionReorder.ts)
// ============================================================================

export class ChannelSectionReorder extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Channel Sections'],
      summary: 'Reorder channel sections',
      description: `
        Reorders all sections for a channel in a single atomic operation.

        **Authorization:**
        - User must be authenticated
        - User must own the channel

        **Validation:**
        - Must include ALL existing section IDs
        - No duplicates allowed
        - All IDs must exist and belong to channel

        **Atomicity:**
        - Either all sections reorder or none (rollback on error)
      `,
      request: {
        params: z.object({
          channelId: Str({ description: 'Channel ID' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: ChannelSectionReorderInput,
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
                  message: z.string(),
                  sections: z.array(ChannelSectionView),
                }),
              }),
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
                details: z
                  .object({
                    expected: z.number(),
                    provided: z.number(),
                    missing: z.array(z.string()).optional(),
                    extra: z.array(z.string()).optional(),
                  })
                  .optional(),
              }),
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
            },
          },
        },
      },
    },
    'required'
  );

  async handle(c) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.params;
    const { sectionIds } = request.body;

    // Get auth context
    const auth = c.get('auth');
    if (!auth) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        401
      );
    }

    // Verify channel ownership
    const channelRepo = new R2Repository(env.channels);
    const channel = await channelRepo.getObject(channelId);

    if (!channel) {
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    if (channel.userId !== auth.userId) {
      return c.json(
        {
          success: false,
          error: 'You can only reorder sections for your own channel',
        },
        403
      );
    }

    // Fetch all existing sections
    const listResult = await env.channel_sections.list({
      prefix: `${channelId}/`,
    });

    const sectionsRepo = new R2Repository(env.channel_sections);
    const existingSections = await Promise.all(
      listResult.objects.map(async (obj) => {
        return await sectionsRepo.getObject(obj.key);
      })
    );

    const filteredSections = existingSections.filter((s) => s !== null);

    // Validate: count must match
    if (sectionIds.length !== filteredSections.length) {
      const existingIds = new Set(filteredSections.map((s) => s.id));
      const providedIds = new Set(sectionIds);
      const missing = [...existingIds].filter((id) => !providedIds.has(id));
      const extra = [...providedIds].filter((id) => !existingIds.has(id));

      return c.json(
        {
          success: false,
          error: 'Section count mismatch',
          details: {
            expected: filteredSections.length,
            provided: sectionIds.length,
            missing: missing.length > 0 ? missing : undefined,
            extra: extra.length > 0 ? extra : undefined,
          },
        },
        400
      );
    }

    // Validate: all IDs exist
    const existingIds = new Set(filteredSections.map((s) => s.id));
    const invalidIds = sectionIds.filter((id) => !existingIds.has(id));
    if (invalidIds.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Invalid section IDs',
          details: {
            invalidIds,
          },
        },
        400
      );
    }

    // Update positions
    const updatedSections: ChannelSection[] = [];
    for (let i = 0; i < sectionIds.length; i++) {
      const section = filteredSections.find((s) => s.id === sectionIds[i])!;
      const updatedSection = {
        ...section,
        position: i,
        dateModified: new Date().toISOString(),
      };
      updatedSections.push(updatedSection);
    }

    // Save all sections
    await Promise.all(
      updatedSections.map((section) =>
        sectionsRepo.putObject(`${channelId}/${section.id}`, section)
      )
    );

    // Queue analytics event
    const queue = new Queue();
    await queue.send(MessageType.ChannelSectionReorder, {
      channelId,
      userId: auth.userId,
      sectionCount: updatedSections.length,
      timestamp: new Date().toISOString(),
    });

    // Transform to view models
    const sectionViews = transformChannelSectionsToView(updatedSections);

    return {
      success: true,
      result: {
        message: 'Sections reordered successfully',
        sections: sectionViews,
      },
    };
  }
}

// ============================================================================
// ROUTER REGISTRATION (apps/api-videos/src/index.ts)
// ============================================================================

/**
 * Add to src/index.ts:
 *
 * // Import channel section endpoints
 * import { ChannelSectionsList } from './endpoints/channel-section/channelSectionList';
 * import { ChannelSectionFetch } from './endpoints/channel-section/channelSectionFetch';
 * import { ChannelSectionCreate } from './endpoints/channel-section/channelSectionCreate';
 * import { ChannelSectionUpdate } from './endpoints/channel-section/channelSectionUpdate';
 * import { ChannelSectionDelete } from './endpoints/channel-section/channelSectionDelete';
 * import { ChannelSectionReorder } from './endpoints/channel-section/channelSectionReorder';
 *
 * // Register public endpoints (optional auth)
 * openapi.get('/api/channels/:channelId/sections', ChannelSectionsList);
 * openapi.get('/api/channels/:channelId/sections/:sectionId', ChannelSectionFetch);
 *
 * // Register authenticated endpoints
 * openapi.post('/api/channels/:channelId/sections', ChannelSectionCreate);
 * openapi.put('/api/channels/:channelId/sections/:sectionId', ChannelSectionUpdate);
 * openapi.delete('/api/channels/:channelId/sections/:sectionId', ChannelSectionDelete);
 * openapi.patch('/api/channels/:channelId/sections/reorder', ChannelSectionReorder);
 *
 * // Add auth middleware
 * app.use('/api/channels/:channelId/sections', (c, next) => {
 *   if (c.req.method !== 'GET') {
 *     return authMiddleware(c, next);
 *   }
 *   return next();
 * });
 *
 * // Add to authenticatedPaths array in /openapi.json override
 * const authenticatedPaths = [
 *   // ... existing paths
 *   '/api/channels/{channelId}/sections', // POST
 *   '/api/channels/{channelId}/sections/{sectionId}', // PUT, DELETE
 *   '/api/channels/{channelId}/sections/reorder', // PATCH
 * ];
 */

// ============================================================================
// QUEUE EVENTS (apps/api-videos/src/lib/queue.ts)
// ============================================================================

/**
 * Add to MessageType enum:
 *
 * export enum MessageType {
 *   // ... existing types
 *   ChannelSectionCreate = 'channel_section_create',
 *   ChannelSectionUpdate = 'channel_section_update',
 *   ChannelSectionDelete = 'channel_section_delete',
 *   ChannelSectionReorder = 'channel_section_reorder',
 * }
 */
