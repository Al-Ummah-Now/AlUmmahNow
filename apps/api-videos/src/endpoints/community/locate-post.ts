import { z } from 'zod';
import { CommunityPost, PostStatus } from '@al-ummah/shared-types';
import { OptionalAuthRoute, AppContext } from '../../base';
import { isChannelDeleted } from '../../lib/community-posts';
import { logger } from '../../lib/logger';

const NOT_FOUND = { error: 'Post not found' };

/**
 * GET /api/community/posts/:postId
 * Where a community post lives: its id and channel only, for short links (alummahnow.link/p/<id>,
 * wiki AUN-SHORT-LINKS), which carry the post id alone. The channel comes from the search index
 * (search_posts, unique on id); the post itself is then read so a draft, scheduled, hidden or deleted
 * post, or one of a deleted channel, is "not found" as it is everywhere else. Not a view.
 */
export class LocateCommunityPost extends OptionalAuthRoute {
  schema = {
    tags: ['Community'],
    summary: 'Locate a community post by id',
    description: '🔓 Authentication optional. The channel of a published post, for short links. 404 for a draft, scheduled, hidden or deleted post. Does not count a view.',
    request: {
      params: z.object({ postId: z.string().min(1).max(64).describe('Post ID') }),
    },
    responses: {
      200: {
        description: 'The post and its channel',
        content: { 'application/json': { schema: z.object({ id: z.string(), channelId: z.string() }) } },
      },
      404: {
        description: 'Post not found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  };

  async handle(c: AppContext): Promise<Response> {
    const { postId } = c.req.param();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(postId)) return c.json(NOT_FOUND, 404);
    const db = (c.env as { SEARCH_DB?: D1Database }).SEARCH_DB;
    if (!db) return c.json(NOT_FOUND, 404);
    try {
      const row = await db.prepare('SELECT channel_id FROM search_posts WHERE id = ?1').bind(postId).first<{ channel_id: string | null }>();
      const channelId = row?.channel_id;
      if (!channelId) return c.json(NOT_FOUND, 404);
      const object = await c.env.community_posts.get(`posts/${channelId}/${postId}.json`);
      if (!object) return c.json(NOT_FOUND, 404);
      const post = (await object.json()) as CommunityPost & { isDeleted?: boolean; isHidden?: boolean };
      const published = !post.status || post.status === PostStatus.PUBLISHED;
      if (!published || post.isDeleted || post.isHidden || (await isChannelDeleted(c.env.channels, channelId))) {
        return c.json(NOT_FOUND, 404);
      }
      c.header('Cache-Control', 'public, max-age=60');
      return c.json({ id: postId, channelId });
    } catch (error) {
      logger.error('[Community] Locating a post failed', { postId, error });
      return c.json({ error: 'Failed to locate post' }, 500);
    }
  }
}
