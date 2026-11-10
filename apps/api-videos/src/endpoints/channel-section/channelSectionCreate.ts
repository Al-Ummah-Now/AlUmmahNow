import { Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { changeSectionOrder, listChannelSections } from '../../lib/channelSectionOrder';
import R2Repository from '../../lib/r2Repo';
import {
  Channel,
  ChannelSection,
  ChannelSectionCreateInput,
  CHANNEL_SECTION_CONSTRAINTS
} from '@al-ummah/shared-types';
import { transformChannelSectionToView } from '../../lib/transformations';
import { canEditChannelLayout } from '../../lib/channelSectionAccess';
import {
  checkSectionConsent,
  checkSectionContent,
  checkSectionLimits,
  clampItemCount,
  spotlightFirst,
  type SectionRuleError,
} from '../../lib/channelSectionRules';
import { ChannelSectionCreateInputSchema, SectionErrorSchema } from '../../lib/channelSectionSchemas';
import { purgeSectionsCache } from '../../lib/channelSectionCache';
import { waitUntilOf } from '../../lib/search/ownership';
import { MessageType, queueChannelSectionEvent } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from '../../base';

export class ChannelSectionCreate extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Channel Sections'],
      summary: 'Create a new channel section',
      description: `
        Creates a new section for organizing channel content.

        **Authorization:**
        - User must be authenticated
        - User must be able to edit the channel layout (owner; channel admin once channel roles exist)
        - subscribed_channels / liked_videos: channel owner only, with \`consent: true\`

        **Position:**
        - Appended last; a channel_spotlight is always first
        - Use PATCH /sections/reorder to change order

        **Limits:** 12 sections per channel; one of each automatic type (shorts and
        live_streams: one per sort / filter); one spotlight.

        **Errors** carry a stable \`code\`: validation_failed, section_limit,
        section_type_limit (409), owner_consent_required (403), consent_required,
        invalid_video, invalid_playlist, invalid_channel.
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
        '409': {
          description: 'This section type is already on the channel',
          content: { 'application/json': { schema: SectionErrorSchema } },
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
    const input = request.body as ChannelSectionCreateInput;

    const userId = this.getUserId(c);

    logger.debug(`Creating section for channel ${channelId} by user ${userId}`, {
      type: input.type,
      title: input.title,
    });

    // Verify channel exists and ownership
    const channelRepo = new R2Repository<Channel>(c.env.channels);
    const channel = await channelRepo.getObject(channelId);

    if (!channel) {
      logger.debug(`Channel not found: ${channelId}`);
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    if (!canEditChannelLayout(channel, userId)) {
      logger.warn(`User ${userId} attempted to create section for channel ${channelId} owned by ${channel.userId}`);
      return c.json({ success: false, code: 'forbidden', error: 'You can only create sections for your own channel' }, 403);
    }

    const reject = (failure: SectionRuleError) => {
      logger.warn('[ChannelSectionCreate] Rejected', { channelId, type: input.type, code: failure.code, field: failure.field });
      return c.json({ success: false, code: failure.code, error: failure.error, ...(failure.field ? { field: failure.field } : {}) }, failure.status);
    };

    const consentFailure = checkSectionConsent(channel, userId, input.type, input, 'create');
    if (consentFailure) return reject(consentFailure);
    const contentFailure = await checkSectionContent(c.env, channel, input.type, input);
    if (contentFailure) return reject(contentFailure);

    // Per-type limits read the live sections; the total limit is enforced again
    // by the conditional order write below (parallel creates)
    const existing = (await listChannelSections<ChannelSection>(c.env.channel_sections, channelId)).filter((s) => !s.isDeleted);
    const limitFailure = checkSectionLimits(existing, input);
    if (limitFailure) return reject(limitFailure);

    // Reserve the next slot in the channel's order document with a
    // conditional write (SCALABILITY-AUDIT AV-20): parallel creates get
    // distinct positions and the section limit holds under concurrency.
    // A spotlight goes first (spec §5).
    const sectionId = crypto.randomUUID();
    const spotlightIds = new Set(existing.filter((s) => s.type === 'channel_spotlight').map((s) => s.id));
    if (input.type === 'channel_spotlight') spotlightIds.add(sectionId);
    const { order, rejected } = await changeSectionOrder<'full'>(c.env.channel_sections, channelId, (ids) =>
      ids.length >= CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL ? { reject: 'full' } : spotlightFirst([...ids, sectionId], spotlightIds),
    );

    if (rejected || !order) {
      logger.debug(`Maximum sections limit reached for channel ${channelId}`);
      return reject({ status: 400, code: 'section_limit', error: `Up to ${CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL} sections per channel` });
    }
    const nextPosition = order.sectionIds.indexOf(sectionId);
    const now = new Date().toISOString();

    // Create section object
    const section: ChannelSection = {
      id: sectionId,
      channelId,
      userId: userId,
      type: input.type,
      title: input.title,
      titleLocalized: input.titleLocalized,
      position: nextPosition,
      style: input.style || 'horizontal_row',
      videoIds: input.videoIds || [],
      playlistId: input.playlistId,
      playlistIds: input.playlistIds || [],
      channelIds: input.channelIds || [],
      ...(input.type === 'channel_spotlight' ? { trailerVideoId: input.trailerVideoId, returningVideoId: input.returningVideoId } : {}),
      ...(input.type === 'shorts' ? { sort: input.sort ?? 'latest' } : {}),
      ...(input.type === 'live_streams' ? { liveFilter: input.liveFilter ?? 'live_and_upcoming' } : {}),
      ...(input.type === 'community_posts' ? { postMode: input.postMode ?? 'latest' } : {}),
      ...(input.consent === true && (input.type === 'subscribed_channels' || input.type === 'liked_videos')
        ? { consent: { grantedBy: userId, grantedAt: now } }
        : {}),
      itemCount: clampItemCount(input.type, input.itemCount),
      showTimestamp: input.showTimestamp ?? true,
      showChannelName: input.showChannelName ?? false,
      dateCreated: now,
      dateModified: now,
    };

    // Save to R2 with composite key
    const sectionsRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    try {
      await sectionsRepo.putObject(`${channelId}/${section.id}`, section);
    } catch (error) {
      // Give the reserved slot back so the order holds no section that does not exist
      await changeSectionOrder<never>(c.env.channel_sections, channelId, (ids) => ids.filter((id) => id !== section.id)).catch(() => undefined);
      throw error;
    }

    // Queue analytics event
    await queueChannelSectionEvent(c.env.queue, MessageType.ChannelSectionCreate, {
      channelId,
      sectionId: section.id,
      userId: userId,
      timestamp: new Date().toISOString(),
    });

    purgeSectionsCache(c.req.url, channelId, waitUntilOf(c as never));

    // Transform to view model
    const sectionView = transformChannelSectionToView(section, channel);

    logger.debug(`Successfully created section ${section.id} for channel ${channelId}`, {
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