import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import {
  CommunityPost,
  PostType,
  PostStatus,
  PostVisibility,
  CreateCommunityPostRequest,
} from '@al-ummah/shared-types';
import { getAuthContext } from '../../middleware/auth';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { validateCreatePost } from '../../validation/community-posts';

const createPostSchema = z.object({
  type: z.nativeEnum(PostType),
  content: z.string().max(5000).optional(),
  images: z.array(z.object({
    width: z.number(),
    height: z.number(),
    caption: z.string().max(36).optional(),
    mimeType: z.string(),
    size: z.number()
  })).max(10).optional(),
  videoId: z.string().optional(),
  gif: z.object({
    width: z.number(),
    height: z.number(),
    duration: z.number()
  }).optional(),
  poll: z.object({
    question: z.string(),
    options: z.array(z.object({
      text: z.string().max(65).optional(),
      image: z.object({
        caption: z.string().max(36)
      }).optional()
    })).min(2).max(5),
    multipleChoice: z.boolean().default(false),
    votingEndsAt: z.string().datetime().optional()
  }).optional(),
  quiz: z.object({
    question: z.string(),
    options: z.array(z.object({
      text: z.string(),
      image: z.object({
        caption: z.string()
      }).optional()
    })).min(2).max(4),
    correctOptionId: z.string(),
    explanation: z.string().max(500).optional()
  }).optional(),
  visibility: z.nativeEnum(PostVisibility).default(PostVisibility.PUBLIC),
  commentsEnabled: z.boolean().default(true),
  scheduledAt: z.string().datetime().optional()
});

export class CreateCommunityPost extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Create a community post',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createPostSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Post created successfully',
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
    },
  });

  async handle(c: any): Promise<Response> {
    const auth = c.get('auth');
    const request = await this.getValidatedData<typeof this.schema>();
    const body: any = request.body;

    if (!body) {
      return c.json({ error: 'Request body is required' }, 400);
    }

    // Get user's channel ID from their profile
    const profileKey = `${auth.userId}/profile.json`;
    const profileData = await c.env.profiles.get(profileKey);

    if (!profileData) {
      return c.json({ error: 'User profile not found' }, 404);
    }

    const profile = await profileData.json();

    if (!profile.channelId) {
      return c.json({ error: 'User does not own a channel' }, 403);
    }

    const user = {
      ...auth,
      channelId: profile.channelId
    };

    // Validate request
    const validation = await validateCreatePost(body, user);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }

    try {
      // Get channel info
      const channelKey = `${profile.channelId}/channel.json`;
      const channelData = await c.env.channels.get(channelKey);

      if (!channelData) {
        return c.json({ error: 'Channel not found' }, 404);
      }

      const channel = await channelData.json();

      // Create post object
      const post: CommunityPost = {
        id: crypto.randomUUID(),
        channelId: profile.channelId,
        type: body.type,
        content: body.content,
        images: body.images ? body.images.map(img => ({
          ...img,
          url: `https://cdn.example.com/posts/${crypto.randomUUID()}` // Placeholder URL
        })) : undefined,
        videoId: body.videoId,
        gif: body.gif ? {
          ...body.gif,
          url: `https://cdn.example.com/gifs/${crypto.randomUUID()}` // Placeholder URL
        } : undefined,
        poll: body.poll ? {
          ...body.poll,
          totalVotes: 0,
          showResults: false,
          options: body.poll.options.map((opt, idx) => ({
            id: `option-${idx}`,
            text: opt.text,
            image: opt.image ? {
              ...opt.image,
              url: `https://cdn.example.com/poll-images/${crypto.randomUUID()}`,
              width: 400,
              height: 400,
              mimeType: 'image/jpeg',
              size: 50000
            } : undefined,
            votes: 0,
            percentage: 0
          }))
        } : undefined,
        quiz: body.quiz ? {
          ...body.quiz,
          totalAttempts: 0,
          correctAttempts: 0,
          options: body.quiz.options.map((opt, idx) => ({
            id: `quiz-option-${idx}`,
            text: opt.text,
            image: opt.image ? {
              ...opt.image,
              url: `https://cdn.example.com/quiz-images/${crypto.randomUUID()}`,
              width: 400,
              height: 400,
              caption: opt.image.caption,
              mimeType: 'image/jpeg',
              size: 50000
            } : undefined,
          }))
        } : undefined,
        likes: 0,
        comments: 0,
        shares: 0,
        views: 0,
        createdAt: new Date().toISOString(),
        scheduledAt: body.scheduledAt,
        pinned: false,
        status: body.scheduledAt ? PostStatus.SCHEDULED : PostStatus.PUBLISHED,
        visibility: body.visibility || PostVisibility.PUBLIC,
        commentsEnabled: body.commentsEnabled !== false,
        channelName: channel.name,
        channelAvatar: channel.avatar,
        channelVerified: channel.verified || false
      };

      // Save to R2
      const postKey = `posts/${profile.channelId}/${post.id}.json`;
      await c.env.community_posts.put(postKey, JSON.stringify(post));

      // Update channel index
      await this.updateChannelIndex(c, profile.channelId, post.id);

      // Send to processor queue for notifications (if published)
      if (post.status === PostStatus.PUBLISHED) {
        await c.env.queue.send({
          type: 'community_post_created',
          postId: post.id,
          channelId: profile.channelId,
          timestamp: post.createdAt
        });
      }

      return c.json({ success: true, post });
    } catch (error) {
      console.error('Error creating community post:', error);
      return c.json({ error: 'Failed to create post' }, 500);
    }
  }

  private async updateChannelIndex(c: any, channelId: string, postId: string) {
    const indexKey = `posts/${channelId}/index.json`;
    const existing = await c.env.community_posts.get(indexKey);

    let index = { postIds: [] as string[], lastUpdated: new Date().toISOString() };
    if (existing) {
      index = await existing.json();
    }

    // Add to beginning (newest first)
    index.postIds.unshift(postId);

    // Keep max 1000 post IDs in index
    if (index.postIds.length > 1000) {
      index.postIds = index.postIds.slice(0, 1000);
    }

    index.lastUpdated = new Date().toISOString();
    await c.env.community_posts.put(indexKey, JSON.stringify(index));
  }
}