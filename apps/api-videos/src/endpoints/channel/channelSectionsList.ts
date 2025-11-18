import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import R2Repository from '../../lib/r2Repo';
import { ChannelSection } from '@al-ummah/shared-types';
import { addAuthToSchema } from '../../lib/openapi-auth';

export class ChannelSectionsList extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'List channel sections',
    description: 'Get all sections for a channel, ordered by position',
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
      }),
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              sections: z.array(z.any()), // ChannelSection type
            }),
          },
        },
      },
      404: {
        description: 'Channel not found',
      },
    },
  }, 'optional');

  async handle(c: Context) {
    const { channelId } = c.req.param();

    // List all sections for this channel using R2 bucket API directly
    const bucket = c.env.channel_sections;
    const prefix = `${channelId}/`;

    const listResult = await bucket.list({ prefix, limit: 1000 });

    const sections: ChannelSection[] = [];

    if (listResult.objects && listResult.objects.length > 0) {
      // Fetch each section's data
      for (const obj of listResult.objects) {
        const data = await bucket.get(obj.key);
        if (data) {
          const section = await data.json() as ChannelSection;
          sections.push(section);
        }
      }
    }

    // Sort by position
    sections.sort((a, b) => a.position - b.position);

    return c.json({
      success: true,
      sections,
    });
  }
}