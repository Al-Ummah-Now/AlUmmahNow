import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import {
  Channel,
  ChannelSection,
  ChannelSectionCreateInput,
  CHANNEL_SECTION_CONSTRAINTS
} from '@al-ummah/shared-types';
import {
  transformChannelSectionToView,
  validateSectionContent
} from '../../lib/transformations';
import { MessageType, queueChannelSectionEvent } from '../../lib/queue';
import { logger } from '../../lib/logger';
// Using console logging as per project pattern

// Zod schema for the input
const ChannelSectionCreateInputSchema = z.object({
  type: z.enum([
    'featured_videos',
    'recent_uploads',
    'popular_uploads',
    'single_playlist',
    'multiple_playlists',
    'subscribed_channels',
    'liked_videos',
  ]),
  title: z.string().min(1).max(CHANNEL_SECTION_CONSTRAINTS.MAX_TITLE_LENGTH),
  titleLocalized: z.record(z.string()).optional(),
  style: z.enum(['horizontal_row', 'vertical_list']).optional(),
  videoIds: z.array(z.string()).max(CHANNEL_SECTION_CONSTRAINTS.MAX_VIDEO_IDS).optional(),
  playlistId: z.string().optional(),
  playlistIds: z.array(z.string()).max(CHANNEL_SECTION_CONSTRAINTS.MAX_PLAYLIST_IDS).optional(),
  channelIds: z.array(z.string()).max(CHANNEL_SECTION_CONSTRAINTS.MAX_CHANNEL_IDS).optional(),
  itemCount: z.number()
    .int()
    .min(CHANNEL_SECTION_CONSTRAINTS.MIN_ITEM_COUNT)
    .max(CHANNEL_SECTION_CONSTRAINTS.MAX_ITEM_COUNT)
    .optional(),
  showTimestamp: z.boolean().optional(),
  showChannelName: z.boolean().optional(),
});

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
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          channelId: Str({ description: 'Channel ID' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: ChannelSectionCreateInputSchema,
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
                  section: z.any(), // Will be ChannelSectionView
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

  async handle(c: any) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.params;
    const input = request.body as ChannelSectionCreateInput;

    // Get auth context
    const auth = c.get('auth');
    if (!auth) {
      logger.warn('Unauthorized attempt to create channel section');
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        401
      );
    }

    logger.info(`Creating section for channel ${channelId} by user ${auth.userId}`, {
      type: input.type,
      title: input.title,
    });

    // Verify channel exists and ownership
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

    if (channel.userId !== auth.userId) {
      logger.warn(`User ${auth.userId} attempted to create section for channel ${channelId} owned by ${channel.userId}`);
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
      logger.warn('Section content validation failed', { errors: validation.errors });
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
    const listResult = await c.env.channel_sections.list({
      prefix: `${channelId}/`,
      limit: 1000, // Get all to determine position
    });
    const nextPosition = listResult.objects.length;

    // Check max sections limit
    if (nextPosition >= CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL) {
      logger.warn(`Maximum sections limit reached for channel ${channelId}`);
      return c.json(
        {
          success: false,
          error: `Maximum ${CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL} sections allowed per channel`,
        },
        400
      );
    }

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
      itemCount: input.itemCount || CHANNEL_SECTION_CONSTRAINTS.DEFAULT_ITEM_COUNT,
      showTimestamp: input.showTimestamp ?? true,
      showChannelName: input.showChannelName ?? false,
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
    };

    // Save to R2 with composite key
    const sectionsRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    await sectionsRepo.putObject(`${channelId}/${section.id}`, section);

    // Queue analytics event
    await queueChannelSectionEvent(c.env.queue, MessageType.ChannelSectionCreate, {
      channelId,
      sectionId: section.id,
      userId: auth.userId,
      timestamp: new Date().toISOString(),
    });

    // Transform to view model
    const sectionView = transformChannelSectionToView(section);

    logger.info(`Successfully created section ${section.id} for channel ${channelId}`, {
      type: section.type,
      position: section.position,
    });

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