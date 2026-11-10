import { recordPostView, withPostViews } from '../../lib/post-views';
import { z } from 'zod';
import { CommunityPost, PostStatus } from '@al-ummah/shared-types';
import { OptionalAuthRoute, AppContext } from '../../base';
import { withPostCounts } from '../../lib/post-counters';
import { logger } from '../../lib/logger';

export class GetCommunityPost extends OptionalAuthRoute {
  schema = {
    tags: ['Community'],
    summary: 'Get a single community post',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID'),
      }),
    },
    responses: {
      200: {
        description: 'Community post details',
        content: {
          'application/json': {
            schema: z.any(), // CommunityPost schema
          },
        },
      },
      404: {
        description: 'Post not found',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext): Promise<Response> {
    const { channelId: postChannelId, postId } = c.req.param();

    try {
      // Direct key lookup (O(1))
      const postKey = `posts/${postChannelId}/${postId}.json`;
      const postData = await c.env.community_posts.get(postKey);

      if (!postData) {
        return c.json({ error: 'Post not found' }, 404);
      }

      const post = (await postData.json()) as CommunityPost;

      // Don't show deleted posts
      if (post.status === PostStatus.DELETED) {
        return c.json({ error: 'Post not found' }, 404);
      }

      // Check if poll/quiz has ended
      if (post.poll?.votingEndsAt) {
        const endTime = new Date(post.poll.votingEndsAt);
        if (endTime < new Date()) {
          post.poll.showResults = true;
        }
      }

      // Count the view atomically in D1 (SCALABILITY-AUDIT AV-8). Reads never
      // write the post JSON: a stale copy written back here used to undo
      // deletes, edits and the like / comment / poll counters.
      await recordPostView(c.env.NOTIFICATIONS_DB, post.id || postId);
      await withPostViews(c.env.NOTIFICATIONS_DB, [post]);

      // Like / vote totals live in D1 (the processor no longer writes them into the document)
      await withPostCounts(c.env.NOTIFICATIONS_DB, [post]);

      return c.json(post);
    } catch (error) {
      logger.error('Error getting community post:', error);
      return c.json({ error: 'Failed to get post' }, 500);
    }
  }
}