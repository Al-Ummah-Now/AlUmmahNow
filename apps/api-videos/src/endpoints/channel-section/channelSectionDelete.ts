import { Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { changeSectionOrder } from '../../lib/channelSectionOrder';
import R2Repository from '../../lib/r2Repo';
import { Channel, ChannelSection } from '@al-ummah/shared-types';
import { MessageType, queueChannelSectionEvent } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from '../../base';

export class ChannelSectionDelete extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Channel Sections'],
      summary: 'Delete a channel section',
      description: `
        Deletes a channel section permanently.

        **Authorization:**
        - User must be authenticated
        - User must own the channel

        **Notes:**
        - Deletion is permanent and cannot be undone
        - Other sections' positions are automatically updated
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
          description: 'Section deleted successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean().default(true),
                result: z.object({
                  message: z.string(),
                }),
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

    const userId = this.getUserId(c);

    logger.info(`Deleting section ${sectionId} for channel ${channelId} by user ${userId}`);

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
      logger.warn(`User ${userId} attempted to delete section for channel ${channelId} owned by ${channel.userId}`);
      return c.json(
        {
          success: false,
          error: 'You can only delete sections for your own channel',
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

    // Delete the section, then take it out of the channel's order document
    // with one conditional write (SCALABILITY-AUDIT AV-20). The remaining
    // sections' positions follow from the order; no section is rewritten.
    await sectionsRepo.deleteObject(`${channelId}/${sectionId}`);
    await changeSectionOrder<never>(c.env.channel_sections, channelId, (ids) =>
      ids.includes(sectionId) ? ids.filter((id) => id !== sectionId) : false,
    );

    // Queue analytics event
    await queueChannelSectionEvent(c.env.queue, MessageType.ChannelSectionDelete, {
      channelId,
      sectionId,
      userId: userId,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Successfully deleted section ${sectionId} from channel ${channelId}`);

    return c.json({
      success: true,
      result: {
        message: 'Section deleted successfully',
      },
    });
  }
}