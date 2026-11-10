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
import { transformChannelSectionToView } from '../../lib/transformations';
import { canEditChannelLayout } from '../../lib/channelSectionAccess';
import { checkSectionConsent, checkSectionContent, clampItemCount, type SectionRuleError } from '../../lib/channelSectionRules';
import { ChannelSectionUpdateInputSchema } from '../../lib/channelSectionSchemas';
import { purgeSectionsCache } from '../../lib/channelSectionCache';
import { waitUntilOf } from '../../lib/search/ownership';
import { MessageType, queueChannelSectionEvent } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from '../../base';

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

    if (!canEditChannelLayout(channel, userId)) {
      logger.warn(`User ${userId} attempted to update section for channel ${channelId} owned by ${channel.userId}`);
      return c.json({ success: false, code: 'forbidden', error: 'You can only update sections for your own channel' }, 403);
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

    const reject = (failure: SectionRuleError) => {
      logger.warn('[ChannelSectionUpdate] Rejected', { channelId, sectionId, code: failure.code, field: failure.field });
      return c.json({ success: false, code: failure.code, error: failure.error, ...(failure.field ? { field: failure.field } : {}) }, failure.status);
    };

    // null clears one spotlight video; the rules check that one remains
    const rulesInput = {
      ...input,
      trailerVideoId: input.trailerVideoId === null ? undefined : input.trailerVideoId,
      returningVideoId: input.returningVideoId === null ? undefined : input.returningVideoId,
    };
    const current: ChannelSection = {
      ...section,
      ...(input.trailerVideoId === null ? { trailerVideoId: undefined } : {}),
      ...(input.returningVideoId === null ? { returningVideoId: undefined } : {}),
    };
    const consentFailure = checkSectionConsent(channel, userId, section.type, rulesInput, 'update');
    if (consentFailure) return reject(consentFailure);
    const contentFailure = await checkSectionContent(c.env, channel, section.type, rulesInput, current);
    if (contentFailure) return reject(contentFailure);

    const isConsentType = section.type === 'subscribed_channels' || section.type === 'liked_videos';
    const now = new Date().toISOString();

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
        ...(input.itemCount !== undefined && { itemCount: clampItemCount(section.type, input.itemCount) }),
        ...(section.type === 'channel_spotlight' && input.trailerVideoId !== undefined && { trailerVideoId: input.trailerVideoId ?? undefined }),
        ...(section.type === 'channel_spotlight' && input.returningVideoId !== undefined && { returningVideoId: input.returningVideoId ?? undefined }),
        ...(section.type === 'shorts' && input.sort !== undefined && { sort: input.sort }),
        ...(section.type === 'live_streams' && input.liveFilter !== undefined && { liveFilter: input.liveFilter }),
        ...(section.type === 'community_posts' && input.postMode !== undefined && { postMode: input.postMode }),
        // Opting in records who consented; opting out removes it (spec §6)
        ...(isConsentType && input.consent === true && { consent: { grantedBy: userId, grantedAt: now } }),
        ...(isConsentType && input.consent === false && { consent: undefined }),
        ...(input.showTimestamp !== undefined && { showTimestamp: input.showTimestamp }),
        ...(input.showChannelName !== undefined && { showChannelName: input.showChannelName }),
        dateModified: now,
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

    purgeSectionsCache(c.req.url, channelId, waitUntilOf(c as never));

    // Transform to view model
    const sectionView = transformChannelSectionToView(updatedSection, channel);

    logger.info(`Successfully updated section ${sectionId} for channel ${channelId}`);

    return c.json({
      success: true,
      result: {
        section: sectionView,
      },
    });
  }
}