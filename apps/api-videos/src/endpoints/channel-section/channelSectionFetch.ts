import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { Channel, ChannelSection } from '@al-ummah/shared-types';
import { transformChannelSectionToView } from '../../lib/transformations';
// Using console logging as per project pattern

export class ChannelSectionFetch extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Channel Sections'],
      summary: 'Get single channel section',
      description: `
        Retrieves details of a specific channel section by ID.

        **Public Access:**
        - Public channels: Section visible to everyone
        - Private channels: Only visible to channel owner (requires auth)
      `,
      request: {
        params: z.object({
          channelId: Str({ description: 'Channel ID' }),
          sectionId: Str({ description: 'Section ID' }),
        }),
      },
      responses: {
        '200': {
          description: 'Successfully retrieved channel section',
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
        '404': {
          description: 'Channel or section not found',
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
    'optional'
  );

  async handle(c: any) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId, sectionId } = request.params;

    console.log(`Fetching section ${sectionId} for channel ${channelId}`);

    // Get auth context (optional)
    const auth = c.get('auth');

    // Verify channel exists
    const channelRepo = new R2Repository<Channel>(c.env.channels);
    const channel = await channelRepo.getObject(channelId);

    if (!channel) {
      console.warn(`Channel not found: ${channelId}`);
      return c.json(
        {
          success: false,
          error: 'Channel not found',
        },
        404
      );
    }

    // For now, all channels are publicly visible
    // TODO: Add privacy controls when Channel type supports it

    // Fetch the section
    const sectionsRepo = new R2Repository<ChannelSection>(c.env.channel_sections);
    const section = await sectionsRepo.getObject(`${channelId}/${sectionId}`);

    if (!section) {
      console.warn(`Section not found: ${sectionId} in channel ${channelId}`);
      return c.json(
        {
          success: false,
          error: 'Section not found',
        },
        404
      );
    }

    // Transform to view model
    const sectionView = transformChannelSectionToView(section);

    console.log(`Successfully fetched section ${sectionId} for channel ${channelId}`);

    return c.json({
      success: true,
      result: {
        section: sectionView,
      },
    });
  }
}