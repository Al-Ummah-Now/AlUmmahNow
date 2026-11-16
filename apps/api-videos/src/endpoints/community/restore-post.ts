import { z } from 'zod';
import { can } from '@al-ummah/shared-types';
import { roleOnChannel } from '../../lib/channelAccess';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { rethrowBusy } from '../../lib/r2Repo';
import { AdminError, restorePost } from '../../lib/admin/service';

const errorBody = { 'application/json': { schema: z.object({ error: z.string(), code: z.string().optional() }) } };

/**
 * Undo of a post delete (Story 29.4): a delete is a 30-day soft delete (delete-post.ts records it in
 * lib/admin/deletions.ts), so the channel brings its own deleted post back, in its old place, with its
 * comments. A post an admin removed stays removed (403 deleted_by_admin); once the permanent delete has
 * started it is gone (409 purge_in_progress). No subscriber notification is sent again.
 */
export class RestoreCommunityPost extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Restore a deleted community post (Undo)',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID to restore'),
      }),
      headers: z.object({
        channelId: z.string().describe('Actor channel ID (the channel, as its owner or a member with post.manage)'),
      }),
    },
    responses: {
      200: { description: 'Post restored', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
      403: { description: 'Not allowed, or an admin removed the post', content: errorBody },
      404: { description: 'No deleted post to restore', content: errorBody },
      409: { description: 'The permanent delete has started', content: errorBody },
    },
  });

  async handle(c: AppContext): Promise<Response> {
    const userId = this.getUserId(c);
    const { channelId, postId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();

    if (!can(await roleOnChannel(c.env as never, channelId, userId).catch(() => null), 'post.manage')) {
      return c.json({ error: 'You may not restore posts on this channel' }, 403);
    }
    if (!c.env.SEARCH_DB) return c.json({ error: 'Post not found', code: 'deletion_not_found' }, 404);

    try {
      await restorePost(c.env as never, postId, { channelId });
    } catch (error) {
      if (error instanceof AdminError) return c.json({ error: error.message, code: error.code }, error.status as 403 | 404 | 409);
      rethrowBusy(error);
      logger.error('Error restoring community post:', error);
      return c.json({ error: 'Failed to restore post' }, 500);
    }

    // The post is back: listeners (the scholar reference outbox) read its current state
    await new Queue(c.env.queue)
      .send(MessageType.CommunityPostUpdated, { postId, channelId, actor: { userId, channelId: request.headers?.channelId }, timestamp: new Date().toISOString() })
      .catch((error) => logger.warn('Restored post update not queued', { postId, channelId, error: error instanceof Error ? error.message : String(error) }));
    return c.json({ success: true });
  }
}
