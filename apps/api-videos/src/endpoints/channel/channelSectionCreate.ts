import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import R2Repository from '../../lib/r2Repo';
import { ChannelSection, ChannelSectionCreateRequest, CHANNEL_SECTION_CONSTRAINTS } from '@al-ummah/shared-types';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { validateChannelSection } from '../../lib/validation/channel-section';

export class ChannelSectionCreate extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Create channel section',
    description: 'Add a new section to a channel (max 10 sections)',
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              type: z.enum([
                'allPlaylists',
                'completedEvents',
                'liveEvents',
                'multipleChannels',
                'multiplePlaylists',
                'popularUploads',
                'recentUploads',
                'singlePlaylist',
                'subscriptions',
                'upcomingEvents',
              ]),
              title: z.string().max(100).optional(),
              position: z.number().int().min(0).optional(),
              playlists: z.array(z.string()).optional(),
              channels: z.array(z.string()).optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Section created',
      },
      400: {
        description: 'Validation error',
      },
      401: {
        description: 'Unauthorized',
      },
      403: {
        description: 'Not channel owner',
      },
      409: {
        description: 'Max sections limit reached',
      },
    },
  }, 'required');

  async handle(c: Context) {
    const { channelId } = c.req.param();
    const data: ChannelSectionCreateRequest = await c.req.json();
    const auth = c.get('auth');

    // 1. Check channel ownership
    const channelRepo = new R2Repository<any>(c.env.channels);
    const channel = await channelRepo.getObject(channelId);

    if (!channel) {
      return c.json({ success: false, error: 'Channel not found' }, 404);
    }

    if (channel.userId !== auth.userId) {
      return c.json({ success: false, error: 'Not channel owner' }, 403);
    }

    // 2. Check max sections limit using R2 bucket API directly
    const bucket = c.env.channel_sections;
    const prefix = `${channelId}/`;
    const listResult = await bucket.list({ prefix, limit: 1000 });

    const existingSections: ChannelSection[] = [];
    if (listResult.objects && listResult.objects.length > 0) {
      for (const obj of listResult.objects) {
        const data = await bucket.get(obj.key);
        if (data) {
          const section = await data.json() as ChannelSection;
          existingSections.push(section);
        }
      }
    }

    if (existingSections.length >= CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL) {
      return c.json({
        success: false,
        error: `Maximum ${CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL} sections allowed`,
      }, 409);
    }

    // 3. Validate section data
    const errors = validateChannelSection(data);
    if (errors.length > 0) {
      return c.json({ success: false, errors }, 400);
    }

    // 4. Calculate position
    const position = data.position ?? existingSections.length;

    // 5. Shift existing sections if inserting in middle
    const sectionRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    if (position < existingSections.length) {
      for (const section of existingSections) {
        if (section.position >= position) {
          section.position += 1;
          await sectionRepo.putObject(`${channelId}/${section.id}`, section);
        }
      }
    }

    // 6. Create new section
    const sectionId = `section-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const newSection: ChannelSection = {
      id: sectionId,
      channelId,
      type: data.type,
      title: data.title,
      position,
      playlists: data.playlists,
      channels: data.channels,
      dateCreated: now,
      dateModified: now,
      createdAt: now,  // Add required Timestamps fields
      updatedAt: now,
    };

    await sectionRepo.putObject(`${channelId}/${sectionId}`, newSection);

    return c.json({ success: true, section: newSection }, 201);
  }
}