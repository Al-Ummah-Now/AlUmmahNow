import { Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { withResolvedPosition } from '../../lib/channelSectionOrder';
import R2Repository from '../../lib/r2Repo';
import {
  Channel,
  ChannelSection,
  ChannelSectionUpdateInput,
  CHANNEL_SECTION_CONSTRAINTS
} from '@al-ummah/shared-types';
import {
  transformChannelSectionToView,
  validateSectionContent
} from '../../lib/transformations';
import { MessageType, queueChannelSectionEvent } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from '../../base';

// Zod schema for the input
const ChannelSectionUpdateInputSchema = z.object({
  title: z.string().min(1).max(CHANNEL_SECTION_CONSTRAINTS.MAX_TITLE_LENGTH).optional(),
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

export class ChannelSectionUpdate extends AuthenticatedRoute {
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
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          channelId: Str({ description: 'Channel ID' }),
          sectionId: Str({ description: 'Section ID' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: ChannelSectionUpdateInputSchema,
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

  async handle(c: AppContext) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId, sectionId } = request.params;
    const input = request.body as ChannelSectionUpdateInput;

    const userId = this.getUserId(c);

    logger.info(`Updating section ${sectionId} for channel ${channelId} by user ${userId}`, {
      updates: Object.keys(input),
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

    if (channel.userId !== userId) {
      logger.warn(`User ${userId} attempted to update section for channel ${channelId} owned by ${channel.userId}`);
      return c.json(
        {
          success: false,
          error: 'You can only update sections for your own channel',
        },
        403
      );
    }

    // Get existing section
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

    // Validate content if being updated
    const validation = validateSectionContent(section.type, input);
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

    // Apply the partial update to the fresh section with a conditional write
    // (SCALABILITY-AUDIT AV-20); a section deleted meanwhile is not re-created
    const saved = await sectionsRepo.updateObject(`${channelId}/${sectionId}`, (fresh) => {
      Object.assign(fresh, {
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
      });
    });
    if (!saved) {
      return c.json(
        {
          success: false,
          error: 'Section not found',
        },
        404
      );
    }
    const updatedSection = await withResolvedPosition(c.env.channel_sections, channelId, saved);

    // Queue analytics event
    await queueChannelSectionEvent(c.env.queue, MessageType.ChannelSectionUpdate, {
      channelId,
      sectionId,
      userId: userId,
      timestamp: new Date().toISOString(),
    });

    // Transform to view model
    const sectionView = transformChannelSectionToView(updatedSection);

    logger.info(`Successfully updated section ${sectionId} for channel ${channelId}`);

    return c.json({
      success: true,
      result: {
        section: sectionView,
      },
    });
  }
}