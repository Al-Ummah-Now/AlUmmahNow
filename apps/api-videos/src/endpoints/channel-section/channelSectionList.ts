import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { Channel, ChannelSection, ChannelSectionView } from '@al-ummah/shared-types';
import { transformChannelSectionToView, transformChannelSectionsToView } from '../../lib/transformations';
import { logger } from '../../lib/logger';
// Using console logging as per project pattern

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
        headers: z.object({
          userId: z.string().optional().nullable(),
          channelId: z.string().optional().nullable(),
        }),
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
          cursor: Str({
            description: 'Pagination cursor from previous response',
            required: false,
          }),
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
                  sections: z.array(z.any()), // Will be ChannelSectionView[]
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

  async handle(c: any) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.params;
    const { limit, cursor, type } = request.query;

    logger.info(`Listing channel sections for channel ${channelId}`, {
      limit,
      cursor,
      type,
    });

    // Get auth context (optional)
    const auth = c.get('auth');

    // Verify channel exists
    const channelRepo = new R2Repository<Channel>(c.env.channels);
    const channel = await channelRepo.getObject(channelId);

    if (!channel) {
      logger.warn(`Channel not found: ${channelId}`);
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    // Check if channel is deleted (soft delete)
    if (channel.isDeleted) {
      logger.warn(`Channel is deleted: ${channelId}`);
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    // Check if channel is hidden (moderation) - blocks everyone including owner
    if (channel.isHidden) {
      logger.warn(`Channel is hidden: ${channelId}`);
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    // Check if channel is private - only owner can access
    if (channel.isPrivate && channel.userId !== auth?.userId) {
      logger.warn(`Private channel ${channelId} access denied for user ${auth?.userId}`);
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    // List sections with prefix for this channel
    const listResult = await c.env.channel_sections.list({
      prefix: `${channelId}/`,
      limit,
      cursor,
    });

    // Fetch full objects
    const sectionsRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    const sections = await Promise.all(
      listResult.objects.map(async (obj: any) => {
        const section = await sectionsRepo.getObject(obj.key);
        return section;
      })
    );

    // Filter out nulls, deleted, and hidden sections
    let filteredSections = sections.filter((s): s is ChannelSection => {
      if (s === null) return false;
      if (s.isDeleted) return false;
      if (s.isHidden) return false;
      return true;
    });

    // Filter by type if provided
    if (type) {
      filteredSections = filteredSections.filter((s) => s.type === type);
    }

    // Sort by position (ascending)
    filteredSections.sort((a, b) => a.position - b.position);

    // Transform to view models
    const sectionViews = transformChannelSectionsToView(filteredSections);

    logger.info(`Found ${filteredSections.length} sections for channel ${channelId}`);

    return c.json({
      success: true,
      result: {
        sections: sectionViews,
        pagination: {
          cursor: listResult.truncated ? listResult.cursor : '',
          hasMore: listResult.truncated,
          total: filteredSections.length,
        },
      },
    });
  }
}