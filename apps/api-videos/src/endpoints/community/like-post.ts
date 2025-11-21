import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { CommunityPost, LikePostResponse } from '@al-ummah/shared-types';
import { getAuthContext } from '../../middleware/auth';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';

export class LikeCommunityPost extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Like a community post',
    request: {
      params: z.object({
        postId: z.string(),
      }),
      headers: z.object({
        channelId: z.string().optional(),
        userId: z.string(),
      }),
    },
    responses: {
      200: {
        description: 'Post liked successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              liked: z.boolean(),
              totalLikes: z.number(),
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

  async handle(c: any): Promise<Response> {
    const auth = c.get('auth');
    const { postId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const { channelId, userId } = request.headers;

    try {
      // Find the post
      let postKey: string | null = null;
      let post: CommunityPost | null = null;

      const listResult = await c.env.community_posts.list({ prefix: 'posts/' });

      for (const object of listResult.objects) {
        if (object.key.includes(`/${postId}.json`)) {
          postKey = object.key;
          const postData = await c.env.community_posts.get(object.key);
          if (postData) {
            post = await postData.json();
          }
          break;
        }
      }

      if (!post || !postKey) {
        return c.json({ error: 'Post not found' }, 404);
      }

      // Check if user already liked
      const likeKey = `likes/${postId}/${userId}.json`;
      const existingLike = await c.env.community_posts.get(likeKey);

      if (!existingLike) {
        // Add like
        const likeRecord = {
          userId: userId,
          channelId: channelId,
          postId,
          likedAt: new Date().toISOString(),
        };
        await c.env.community_posts.put(likeKey, JSON.stringify(likeRecord));

        // Increment like count
        post.likes = (post.likes || 0) + 1;
        await c.env.community_posts.put(postKey, JSON.stringify(post));

        // Send to queue for notifications
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.CommunityPostLiked, {
          postId,
          channelId: post.channelId,
          userId: userId,
          likerChannelId: channelId,
          timestamp: new Date().toISOString()
        });

        return c.json({
          success: true,
          liked: true,
          totalLikes: post.likes,
        });
      } else {
        // Already liked
        return c.json({
          success: true,
          liked: true,
          totalLikes: post.likes,
        });
      }
    } catch (error) {
      console.error('Error liking community post:', error);
      return c.json({ error: 'Failed to like post' }, 500);
    }
  }
}