import { Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { applySectionOrder, changeSectionOrder } from '../../lib/channelSectionOrder';
import R2Repository from '../../lib/r2Repo';
import {
  Channel,
  ChannelSection,
  ChannelSectionReorderInput,
  CHANNEL_SECTION_CONSTRAINTS
} from '@al-ummah/shared-types';
import { transformChannelSectionsToView } from '../../lib/transformations';
import { canEditChannelLayout } from '../../lib/channelSectionAccess';
import { spotlightFirst } from '../../lib/channelSectionRules';
import { purgeSectionsCache } from '../../lib/channelSectionCache';
import { waitUntilOf } from '../../lib/search/ownership';
import { MessageType, queueChannelSectionEvent } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from '../../base';

// Zod schema for the input
const ChannelSectionReorderInputSchema = z.object({
  sectionIds: z.array(z.string())
    .min(1)
    .max(CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL),
});

export class ChannelSectionReorder extends AuthenticatedRoute {
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
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          channelId: Str({ description: 'Channel ID' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: ChannelSectionReorderInputSchema,
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
                  sections: z.array(z.any()), // Will be ChannelSectionView[]
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

  async handle(c: AppContext) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.params;
    const { sectionIds } = request.body as ChannelSectionReorderInput;

    const userId = this.getUserId(c);

    logger.info(`Reordering sections for channel ${channelId} by user ${userId}`, {
      sectionCount: sectionIds.length,
    });

    // Verify channel ownership
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

    if (!canEditChannelLayout(channel, userId)) {
      logger.warn(`User ${userId} attempted to reorder sections for channel ${channelId} owned by ${channel.userId}`);
      return c.json({ success: false, code: 'forbidden', error: 'You can only reorder sections for your own channel' }, 403);
    }

    // Fetch all existing sections
    const listResult = await c.env.channel_sections.list({
      prefix: `${channelId}/`,
      limit: 1000,
    });

    const sectionsRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    const existingSections = await Promise.all(
      listResult.objects.map(async (obj: any) => {
        return await sectionsRepo.getObject(obj.key);
      })
    );

    const filteredSections = existingSections.filter((s): s is ChannelSection => s !== null);

    // Validate: count must match
    if (sectionIds.length !== filteredSections.length) {
      const existingIds = new Set(filteredSections.map((s) => s.id));
      const providedIds = new Set(sectionIds);
      const missing = [...existingIds].filter((id) => !providedIds.has(id));
      const extra = [...providedIds].filter((id) => !existingIds.has(id));

      logger.warn('Section count mismatch in reorder', {
        expected: filteredSections.length,
        provided: sectionIds.length,
        missing,
        extra,
      });

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

    // Validate: no duplicates
    const uniqueIds = new Set(sectionIds);
    if (uniqueIds.size !== sectionIds.length) {
      logger.warn('Duplicate section IDs in reorder request');
      return c.json(
        {
          success: false,
          error: 'Duplicate section IDs provided',
        },
        400
      );
    }

    // Validate: all IDs exist
    const existingIds = new Set(filteredSections.map((s) => s.id));
    const invalidIds = sectionIds.filter((id) => !existingIds.has(id));
    if (invalidIds.length > 0) {
      logger.warn('Invalid section IDs in reorder', { invalidIds });
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

    const spotlightIds = new Set(filteredSections.filter((s) => s.type === 'channel_spotlight').map((s) => s.id));

    // Store the new order with one conditional write (SCALABILITY-AUDIT
    // AV-20). A section created meanwhile (in the fresh order but not in the
    // list this request validated against) keeps its place at the end.
    let updatedSections: ChannelSection[];
    try {
      const { order } = await changeSectionOrder<never>(c.env.channel_sections, channelId, (ids) => {
        const requested = new Set(sectionIds);
        // The spotlight always leads (spec §5), whatever order the client sent
        return spotlightFirst([...sectionIds, ...ids.filter((id) => !requested.has(id) && !existingIds.has(id))], spotlightIds);
      });
      updatedSections = applySectionOrder(filteredSections, order);
    } catch (error) {
      logger.error('Failed to save reordered sections', { error });
      return c.json(
        {
          success: false,
          error: 'Failed to reorder sections',
        },
        500
      );
    }


    purgeSectionsCache(c.req.url, channelId, waitUntilOf(c as never));

    // Queue analytics event
    await queueChannelSectionEvent(c.env.queue, MessageType.ChannelSectionReorder, {
      channelId,
      userId: userId,
      sectionCount: updatedSections.length,
      timestamp: new Date().toISOString(),
    });

    // Transform to view models
    const sectionViews = transformChannelSectionsToView(updatedSections, channel);

    logger.info(`Successfully reordered ${updatedSections.length} sections for channel ${channelId}`);

    return c.json({
      success: true,
      result: {
        message: 'Sections reordered successfully',
        sections: sectionViews,
      },
    });
  }
}