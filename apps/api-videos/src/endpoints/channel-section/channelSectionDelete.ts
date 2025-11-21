import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { Channel, ChannelSection } from '@al-ummah/shared-types';
import { MessageType, queueChannelSectionEvent } from '../../lib/queue';
import { logger } from '../../lib/logger';
// Using console logging as per project pattern

export class ChannelSectionDelete extends OpenAPIRoute {
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
          userId: z.string().optional().nullable(),
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

  async handle(c: any) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId, sectionId } = request.params;

    // Get auth context
    const auth = c.get('auth');
    if (!auth) {
      logger.warn('Unauthorized attempt to delete channel section');
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        401
      );
    }

    logger.info(`Deleting section ${sectionId} for channel ${channelId} by user ${auth.userId}`);

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
      logger.warn(`User ${auth.userId} attempted to delete section for channel ${channelId} owned by ${channel.userId}`);
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

    const deletedPosition = section.position;

    // Delete the section
    await sectionsRepo.deleteObject(`${channelId}/${sectionId}`);

    // Update positions of remaining sections
    const listResult = await c.env.channel_sections.list({
      prefix: `${channelId}/`,
      limit: 1000,
    });

    // Fetch and update positions for sections that were after the deleted one
    const updatePromises: Promise<void>[] = [];

    for (const obj of listResult.objects) {
      const remainingSection = await sectionsRepo.getObject(obj.key);
      if (remainingSection && remainingSection.position > deletedPosition) {
        const updatedSection: ChannelSection = {
          ...remainingSection,
          position: remainingSection.position - 1,
          dateModified: new Date().toISOString(),
        };
        updatePromises.push(
          sectionsRepo.putObject(obj.key, updatedSection)
        );
      }
    }

    // Wait for all position updates
    await Promise.all(updatePromises);

    // Queue analytics event
    await queueChannelSectionEvent(c.env.queue, MessageType.ChannelSectionDelete, {
      channelId,
      sectionId,
      userId: auth.userId,
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