import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { CommunityPost, LikePostResponse } from '@al-ummah/shared-types';
import { getAuthContext } from '../../middleware/auth';
import { addAuthToSchema } from '../../lib/openapi-auth';

export class UnlikeCommunityPost extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Unlike a community post',
    request: {
      params: z.object({
        postId: z.string(),
      }),
    },
    responses: {
      200: {
        description: 'Post unliked successfully',
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

      // Check if user liked
      const likeKey = `likes/${postId}/${auth.userId}.json`;
      const existingLike = await c.env.community_posts.get(likeKey);

      if (existingLike) {
        // Remove like
        await c.env.community_posts.delete(likeKey);

        // Decrement like count
        post.likes = Math.max(0, (post.likes || 0) - 1);
        await c.env.community_posts.put(postKey, JSON.stringify(post));

        return c.json({
          success: true,
          liked: false,
          totalLikes: post.likes,
        });
      } else {
        // Not liked
        return c.json({
          success: true,
          liked: false,
          totalLikes: post.likes,
        });
      }
    } catch (error) {
      console.error('Error unliking community post:', error);
      return c.json({ error: 'Failed to unlike post' }, 500);
    }
  }
}