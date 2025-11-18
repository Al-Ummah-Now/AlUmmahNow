import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import R2Repository from '../../lib/r2Repo';
import { ChannelSection } from '@al-ummah/shared-types';
import { addAuthToSchema } from '../../lib/openapi-auth';

export class ChannelSectionDelete extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Delete channel section',
    description: 'Delete a channel section and reorder remaining sections',
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
        sectionId: Str({ description: 'Section ID' }),
      }),
    },
    responses: {
      200: {
        description: 'Section deleted successfully',
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

    // 2. Get section to delete
    const sectionRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    const section = await sectionRepo.getObject(`${channelId}/${sectionId}`);

    if (!section) {
      return c.json({ success: false, error: 'Section not found' }, 404);
    }

    const deletedPosition = section.position;

    // 3. Delete the section
    await sectionRepo.deleteObject(`${channelId}/${sectionId}`);

    // 4. Reorder remaining sections to fill the gap
    const bucket = c.env.channel_sections;
    const prefix = `${channelId}/`;
    const listResult = await bucket.list({ prefix, limit: 1000 });

    const remainingSections: ChannelSection[] = [];
    if (listResult.objects && listResult.objects.length > 0) {
      for (const obj of listResult.objects) {
        const data = await bucket.get(obj.key);
        if (data) {
          const section = await data.json() as ChannelSection;
          remainingSections.push(section);
        }
      }
    }

    // Shift sections that were after the deleted one
    for (const remainingSection of remainingSections) {
      if (remainingSection.position > deletedPosition) {
        remainingSection.position -= 1;
        await sectionRepo.putObject(`${channelId}/${remainingSection.id}`, remainingSection);
      }
    }

    return c.json({ success: true });
  }
}