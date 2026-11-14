import { z } from 'zod';
import type { Channel, PostMedia } from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import BunnyStorageClient from '../../lib/bunny/storage';
import { requireSecret, requireEnvVar } from '../../lib/env-helpers';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { validateImageMagicBytes } from '../../lib/security/magic-bytes';
import { IMAGE_MAX_BYTES, PreviewError, fetchPreview, readLimited, safeFetch } from '../../lib/link-preview';
import { logger } from '../../lib/logger';
import { recordImageOwner } from '../../lib/csam/imageOwners';
import { getChannelObject } from './post-comment-helpers';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

const previewSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  siteName: z.string().nullable(),
  image: z.object({ url: z.string(), alt: z.string().nullable(), width: z.number().nullable(), height: z.number().nullable() }).nullable(),
});

/**
 * Link post preview (SS14): reads an outside page's title, site name, description and preview
 * image for the Studio composer. The image is copied to our image storage, so a post never makes
 * readers load it from the outside site. The creator can still change every field.
 */
export class CommunityLinkPreview extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Preview an outside page for a link post',
    request: {
      headers: z.object({ channelId: z.string().openapi({ description: "User's selected channel ID" }).optional().nullable() }),
      body: { content: { 'application/json': { schema: z.object({ url: z.string().max(2048) }) } } },
    },
    responses: {
      200: { description: 'The preview', content: { 'application/json': { schema: z.object({ success: z.boolean(), preview: previewSchema }) } } },
      422: { description: 'The page could not be previewed', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
    },
  }, 'required');

  async handle(c: AppContext): Promise<Response> {
    const userId = this.getUserId(c);
    const request = await this.getValidatedData<typeof this.schema>();
    const channelId = request.headers.channelId;
    const channelData = await getChannelObject(c.env.channels, channelId);
    if (!channelData) return c.json({ error: 'Channel not found' }, 404);
    const channel = (await channelData.json()) as Channel;
    if (channel.userId !== userId) return c.json({ error: 'User does not own this channel' }, 403);

    let page;
    try {
      page = await fetchPreview(request.body.url);
    } catch (error) {
      const code = error instanceof PreviewError ? error.code : 'unreachable';
      return c.json({ error: code }, 422);
    }

    let image: PostMedia | null = null;
    if (page.imageUrl) image = await copyImage(c, page.imageUrl, channelId!, userId);
    logger.info('[link-preview] previewed', { channelId, hasImage: !!image, hasSiteName: !!page.siteName });
    return c.json({
      success: true,
      preview: { url: page.url, title: page.title, description: page.description, siteName: page.siteName, image },
    });
  }
}

/** Copies the page's preview image to our storage; null when it is missing, too big or not an image. */
async function copyImage(c: AppContext, imageUrl: string, channelId: string, userId: string): Promise<PostMedia | null> {
  try {
    const res = await safeFetch(imageUrl, 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9');
    const bytes = await readLimited(res, IMAGE_MAX_BYTES, true);
    const check = validateImageMagicBytes(bytes);
    const type = check.detectedMimeType ?? '';
    if (!check.isValid || !EXT[type]) return null;
    const key = await requireSecret(c.env.image_storage_key, 'image_storage_key');
    const zone = requireEnvVar(c.env, 'ZONE');
    const path = `/community-posts/${channelId}/link-${crypto.randomUUID()}.${EXT[type]}`;
    const body = new Blob([bytes]).stream() as ReadableStream;
    if (!(await new BunnyStorageClient(zone, key).putFile(path, body))) return null;
    await recordImageOwner(c.env.SEARCH_DB, `https://images.alummahnow.net${path}`, { kind: 'post_image', ownerId: userId, channelId });
    return { url: `https://images.alummahnow.net${path}`, alt: null, width: null, height: null };
  } catch (error) {
    if (!(error instanceof PreviewError)) logger.warn('[link-preview] image copy failed', { channelId, userId, error });
    return null;
  }
}
