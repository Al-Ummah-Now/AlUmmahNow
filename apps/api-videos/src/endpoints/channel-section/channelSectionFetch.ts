import { Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { withResolvedPosition } from '../../lib/channelSectionOrder';
import R2Repository from '../../lib/r2Repo';
import { Channel, ChannelSection } from '@al-ummah/shared-types';
import { transformChannelSectionToView } from '../../lib/transformations';
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from '../../base';

export class ChannelSectionFetch extends OptionalAuthRoute {
  schema = addAuthToSchema(
    {
      tags: ['Channel Sections'],
      summary: 'Get single channel section',
      description: `
        Retrieves details of a specific channel section by ID.

        **Public Access:**
        - Public channels: Section visible to everyone
        - Private channels: Only visible to channel owner (requires auth)
      `,
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          channelId: Str({ description: 'Channel ID' }),
          sectionId: Str({ description: 'Section ID' }),
        }),
      },
      responses: {
        '200': {
          description: 'Successfully retrieved channel section',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean().default(true),
                result: z.object({
                  section: z.any(), // Will be ChannelSectionView
                }),
              }),
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
            },
          },
        },
      },
    },
    'optional'
  );

  async handle(c: AppContext) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId, sectionId } = request.params;

    logger.info(`Fetching section ${sectionId} for channel ${channelId}`);

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

    // Check if channel is deleted
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

    // Fetch the section
    const sectionsRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    const section = await sectionsRepo.getObject(`${channelId}/${sectionId}`);

    if (!section) {
      logger.warn(`Section not found: ${sectionId} in channel ${channelId}`);
      return c.json(
        {
          success: false,
          error: 'Section not found',
        },
        404
      );
    }

    // Transform to view model
    // Position from the channel's order document (SCALABILITY-AUDIT AV-20)
    const sectionView = transformChannelSectionToView(await withResolvedPosition(c.env.channel_sections, channelId, section), channel);

    logger.info(`Successfully fetched section ${sectionId} for channel ${channelId}`);

    return c.json({
      success: true,
      result: {
        section: sectionView,
      },
    });
  }
}