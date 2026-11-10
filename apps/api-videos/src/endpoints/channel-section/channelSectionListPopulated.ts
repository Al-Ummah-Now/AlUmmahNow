import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { ChannelSectionTypeSchema } from '../../lib/channelSectionSchemas';
import { applySectionOrder, listChannelSections, readSectionOrder } from '../../lib/channelSectionOrder';
import R2Repository from '../../lib/r2Repo';
import { Channel, ChannelSection } from '@al-ummah/shared-types';
import { transformChannelSectionsToView } from '../../lib/transformations';
import { transformChannelSectionWithContent } from '../../lib/channelSectionPopulator';
import { canEditChannelLayout } from '../../lib/channelSectionAccess';
import { SECTIONS_CACHE_TTL_SECONDS, sectionsCacheUrl } from '../../lib/channelSectionCache';
import { readEdgeCache, writeEdgeCache } from '../../lib/edge-cache';
import { waitUntilOf } from '../../lib/search/ownership';
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from '../../base';

export class ChannelSectionsListPopulated extends OptionalAuthRoute {
  schema = addAuthToSchema(
    {
      tags: ['Channel Sections'],
      summary: 'List channel sections with populated content',
      description: `
        Retrieves all channel sections with auto-populated content for dynamic types.

        **Public Access:**
        - Public channels: All sections visible to everyone
        - Private channels: Only visible to channel owner (requires auth)

        **Population:** every section type is populated on the server
        (\`populatedContent\`) and carries \`isEmpty\`. Empty sections are left
        out, except for people who can edit the channel, who get them with
        \`emptyHint\` (noContent, consentMissing, communityTabHidden,
        loadFailed) and \`canEdit: true\`. subscribed_channels and liked_videos
        populate only with the channel owner's opt-in.

        **Caching:** signed-out responses are cached at the edge for 60 s.

        **Query Parameters:**
        - populate: Include populated content (videos/playlists/channels)
        - type: Filter by section type
        - limit: Maximum sections to return (default: 20, max: 50)
      `,
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          channelId: Str({ description: 'Channel ID' }),
        }),
        query: z.object({
          populate: Bool({
            description: 'Include populated content',
            default: true,
            required: false,
          }),
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
          type: ChannelSectionTypeSchema
            .optional()
            .describe('Filter by section type'),
        }),
      },
      responses: {
        '200': {
          description: 'Successfully retrieved channel sections with content',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean().default(true),
                result: z.object({
                  sections: z.array(z.any()), // Will be ChannelSectionView[] with populatedContent
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

  async handle(c: AppContext) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.params;
    const { limit, cursor, type, populate } = request.query;

    logger.info(`Listing populated sections for channel ${channelId}`, {
      limit,
      cursor,
      type,
      populate,
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

    const canEdit = canEditChannelLayout(channel, auth?.userId);
    const cacheable = !auth && populate && !type;
    const cacheUrl = sectionsCacheUrl(c.req.url, channelId);
    if (cacheable) {
      const cached = await readEdgeCache<unknown>(cacheUrl);
      if (cached) return c.json(cached as Record<string, unknown>);
    }

    // A channel has at most 12 sections: read them all, then order (AV-20)
    const sections = await listChannelSections<ChannelSection>(c.env.channel_sections, channelId);
    const ordered = applySectionOrder(sections, await readSectionOrder(c.env.channel_sections, channelId));
    let filteredSections = ordered.filter((s) => !s.isDeleted && !s.isHidden);
    if (type) filteredSections = filteredSections.filter((s) => s.type === type);
    filteredSections = filteredSections.slice(0, limit);

    let sectionViews: any[];
    if (populate) {
      // Sections populate in parallel; a failing one comes back empty (loadFailed), never a 500
      const populated = await Promise.all(filteredSections.map((section) => transformChannelSectionWithContent(section, c.env, channel)));
      sectionViews = canEdit
        ? populated.map((view) => ({ ...view, canEdit: true }))
        : populated.filter((view) => !view.isEmpty).map(({ emptyHint: _hint, ...view }) => view);
    } else {
      sectionViews = transformChannelSectionsToView(filteredSections, channel);
    }

    logger.info(`Found ${sectionViews.length} sections for channel ${channelId}`, {
      populated: populate,
      canEdit,
      hiddenEmpty: filteredSections.length - sectionViews.length,
    });

    const body = {
      success: true,
      result: {
        sections: sectionViews,
        pagination: { cursor: '', hasMore: false, total: sectionViews.length },
      },
    };
    if (cacheable) writeEdgeCache(cacheUrl, body, SECTIONS_CACHE_TTL_SECONDS, waitUntilOf(c as never));
    return c.json(body);
  }
}
