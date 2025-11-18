import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import R2Repository from '../../lib/r2Repo';
import { ChannelSection, ChannelSectionUpdateRequest, CHANNEL_SECTION_CONSTRAINTS } from '@al-ummah/shared-types';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { validateSectionTitle } from '../../lib/validation/channel-section';

export class ChannelSectionUpdate extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Update channel section',
    description: 'Update an existing channel section (cannot change type)',
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
        sectionId: Str({ description: 'Section ID' }),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              title: z.string().max(100).optional(),
              playlists: z.array(z.string()).optional(),
              channels: z.array(z.string()).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Section updated',
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
      404: {
        description: 'Section not found',
      },
    },
  }, 'required');

  async handle(c: Context) {
    const { channelId, sectionId } = c.req.param();
    const data: ChannelSectionUpdateRequest = await c.req.json();
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

    // 2. Get existing section
    const sectionRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    const section = await sectionRepo.getObject(`${channelId}/${sectionId}`);

    if (!section) {
      return c.json({ success: false, error: 'Section not found' }, 404);
    }

    // 3. Validate updates
    if (data.title !== undefined) {
      const titleError = validateSectionTitle(data.title, section.type);
      if (titleError) {
        return c.json({ success: false, error: titleError }, 400);
      }
    }

    // 4. Validate playlists for playlist-based sections
    if (data.playlists !== undefined) {
      if (section.type === 'singlePlaylist' && data.playlists.length !== 1) {
        return c.json({ success: false, error: 'singlePlaylist must have exactly 1 playlist' }, 400);
      }
      if (section.type === 'multiplePlaylists' && data.playlists.length === 0) {
        return c.json({ success: false, error: 'multiplePlaylists must have at least 1 playlist' }, 400);
      }
    }

    // 5. Validate channels for channel-based sections
    if (data.channels !== undefined) {
      if (section.type === 'multipleChannels' && data.channels.length === 0) {
        return c.json({ success: false, error: 'multipleChannels must have at least 1 channel' }, 400);
      }
    }

    // 6. Update section
    const updatedSection: ChannelSection = {
      ...section,
      title: data.title !== undefined ? data.title : section.title,
      playlists: data.playlists !== undefined ? data.playlists : section.playlists,
      channels: data.channels !== undefined ? data.channels : section.channels,
      dateModified: new Date().toISOString(),
    };

    await sectionRepo.putObject(`${channelId}/${sectionId}`, updatedSection);

    return c.json({ success: true, section: updatedSection });
  }
}