import { withPostViews } from '../../lib/post-views';
import R2Repository, { rethrowBusy } from '../../lib/r2Repo';
import { z } from 'zod';
import {
  CommunityPost,
  PostStatus,
  PostVisibility,
  UpdateCommunityPostRequest,
} from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { validateUpdatePost } from '../../validation/community-posts';
import { withPostCounts } from '../../lib/post-counters';
import { logger } from '../../lib/logger';
import Queue, { MessageType } from '../../lib/queue';
import { scanInBackground, communityPostScanText } from '../../lib/moderation-scan';

const updatePostSchema = z.object({
  content: z.string().max(5000).optional(),
  visibility: z.nativeEnum(PostVisibility).optional(),
  commentsEnabled: z.boolean().optional(),
  scheduledAt: z.string().datetime().optional(),
  pinned: z.boolean().optional(),
});

export class UpdateCommunityPost extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Update a community post',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID to update'),
      }),
      headers: z.object({
        channelId: z.string().describe('Actor channel ID (must own the post)'),
      }),
      body: {
        content: {
          'application/json': {
            schema: updatePostSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Post updated successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              post: z.any(),
            }),
          },
        },
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
      403: {
        description: 'Forbidden - not the post owner',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
            }),
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
  });

  async handle(c: AppContext): Promise<Response> {
    const userId = this.getUserId(c);

    const { channelId: postChannelId, postId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const body: any = request.body;
    const userChannelId = request.headers?.channelId;

    if (!body) {
      return c.json({ error: 'Request body is required' }, 400);
    }

    // Verify user owns the channel they're trying to update from
    if (userChannelId !== postChannelId) {
      return c.json({ error: 'You can only update posts from your own channel' }, 403);
    }

    const auth = this.getAuth(c);
    const user = {
      ...auth,
      channelId: postChannelId,
      userId,
    };

    try {
      // Direct key lookup (O(1))
      const postKey = `posts/${postChannelId}/${postId}.json`;
      const postData = await c.env.community_posts.get(postKey);

      if (!postData) {
        return c.json({ error: 'Post not found' }, 404);
      }

      const post: CommunityPost = await postData.json();

      // Validate update
      const validation = await validateUpdatePost(body, post, user);
      if (!validation.valid) {
        return c.json({ error: validation.error }, 400);
      }

      // Apply the allowed fields to the fresh post with a conditional write
      // (SCALABILITY-AUDIT AV-9): a concurrent comment, like or poll count is
      // kept, and a post deleted meanwhile is not brought back
      const { data: saved, rejected } = await new R2Repository<CommunityPost>(c.env.community_posts).updateObjectOrReject<'deleted'>(postKey, (fresh) => {
        if (fresh.status === PostStatus.DELETED) return { reject: 'deleted' };
        if (body.content !== undefined) {
          fresh.content = body.content;
        }
        if (body.visibility !== undefined) {
          fresh.visibility = body.visibility;
        }
        if (body.commentsEnabled !== undefined) {
          fresh.commentsEnabled = body.commentsEnabled;
        }
        if (body.scheduledAt !== undefined) {
          fresh.scheduledAt = body.scheduledAt;
        }
        if (body.pinned !== undefined) {
          fresh.pinned = body.pinned;
        }
        fresh.updatedAt = new Date().toISOString();
        return true;
      });
      if (!saved || rejected) {
        return c.json({ error: 'Post not found' }, 404);
      }
      Object.assign(post, saved);

      // Send queue event
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.CommunityPostUpdated, {
        postId,
        channelId: postChannelId,
        actor: {
          userId,
          channelId: userChannelId,
        },
        updatedFields: Object.keys(body).filter(k => body[k] !== undefined),
        timestamp: post.updatedAt,
      });

      if (body.content !== undefined) {
        scanInBackground(c, { surface: 'community_post', event: 'edit', subjectId: postId, authorId: userId, channelId: postChannelId, text: communityPostScanText(post) });
      }

      // Like / vote totals live in D1 (the document's may be stale)
      await withPostCounts(c.env.NOTIFICATIONS_DB, [post]);
      await withPostViews(c.env.NOTIFICATIONS_DB, [post]);
      return c.json({ success: true, post });
    } catch (error) {
      rethrowBusy(error);
      logger.error('Error updating community post:', error);
      return c.json({ error: 'Failed to update post' }, 500);
    }
  }
}