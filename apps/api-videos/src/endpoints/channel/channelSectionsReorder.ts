import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import R2Repository from '../../lib/r2Repo';
import { ChannelSection, ChannelSectionReorderRequest } from '@al-ummah/shared-types';
import { addAuthToSchema } from '../../lib/openapi-auth';

export class ChannelSectionsReorder extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Channel Sections'],
    summary: 'Reorder channel sections',
    description: 'Change the position of a channel section',
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID' }),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              sectionId: z.string(),
              newPosition: z.number().int().min(0),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Sections reordered successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              sections: z.array(z.object({
                id: z.string(),
                position: z.number(),
              })),
            }),
          },
        },
      },
      400: {
        description: 'Invalid position',
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
    const { channelId } = c.req.param();
    const data: ChannelSectionReorderRequest = await c.req.json();
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

    // 2. Get all sections
    const bucket = c.env.channel_sections;
    const prefix = `${channelId}/`;
    const listResult = await bucket.list({ prefix, limit: 1000 });

    const sections: ChannelSection[] = [];
    if (listResult.objects && listResult.objects.length > 0) {
      for (const obj of listResult.objects) {
        const data = await bucket.get(obj.key);
        if (data) {
          const section = await data.json() as ChannelSection;
          sections.push(section);
        }
      }
    }

    // 3. Find the section to move
    const sectionToMove = sections.find(s => s.id === data.sectionId);
    if (!sectionToMove) {
      return c.json({ success: false, error: 'Section not found' }, 404);
    }

    // 4. Validate new position
    if (data.newPosition >= sections.length) {
      return c.json({ success: false, error: 'Invalid position' }, 400);
    }

    const oldPosition = sectionToMove.position;
    const newPosition = data.newPosition;

    // 5. Reorder sections
    if (oldPosition !== newPosition) {
      // Moving down (old < new)
      if (oldPosition < newPosition) {
        for (const section of sections) {
          if (section.position > oldPosition && section.position <= newPosition) {
            section.position -= 1;
          }
        }
      }
      // Moving up (old > new)
      else {
        for (const section of sections) {
          if (section.position >= newPosition && section.position < oldPosition) {
            section.position += 1;
          }
        }
      }

      // Set the new position for the moved section
      sectionToMove.position = newPosition;

      // 6. Update all affected sections in R2
      const sectionRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
      for (const section of sections) {
        section.dateModified = new Date().toISOString();
        await sectionRepo.putObject(`${channelId}/${section.id}`, section);
      }
    }

    // 7. Return updated positions
    const updatedPositions = sections
      .sort((a, b) => a.position - b.position)
      .map(s => ({ id: s.id, position: s.position }));

    return c.json({
      success: true,
      sections: updatedPositions,
    });
  }
}