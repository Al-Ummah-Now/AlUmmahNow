import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import R2Repository from '../../lib/r2Repo';
import { ChannelSection } from '@al-ummah/shared-types';
import { addAuthToSchema } from '../../lib/openapi-auth';

export class ChannelSectionsGet extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Get single channel section',
    description: 'Get a specific section by ID',
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
        sectionId: Str({ description: 'Section ID' }),
      }),
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              section: z.any(), // ChannelSection type
            }),
          },
        },
      },
      404: {
        description: 'Section not found',
      },
    },
  }, 'optional');

  async handle(c: Context) {
    const { channelId, sectionId } = c.req.param();

    const repo = new R2Repository<ChannelSection>(c.env.channel_sections);
    const section = await repo.getObject(`${channelId}/${sectionId}`);

    if (!section) {
      return c.json({ success: false, error: 'Section not found' }, 404);
    }

    return c.json({
      success: true,
      section,
    });
  }
}