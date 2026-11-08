import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import {
  Channel,
  CommunityPost,
  PostType,
  PostStatus,
  PostVisibility,
  CreateCommunityPostRequest,
} from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { validateCreatePost } from '../../validation/community-posts';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';
import R2Repository from '../../lib/r2Repo';
import { getChannelObject } from './post-comment-helpers';
import { scanInBackground, communityPostScanText } from '../../lib/moderation-scan';

// Sanitization configuration for community posts
// Allows basic formatting while preventing XSS attacks
const sanitizeOptions = {
  allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
  allowedAttributes: {
    'a': ['href']
  },
  allowedSchemes: ['http', 'https'],
  disallowedTagsMode: 'discard' as const
};

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

const Str = (opts: { description: string }) => z.string().openapi(opts);

export class CreateCommunityPost extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Create a community post',
    request: {
      params: z.object({
        channelId: Str({ description: 'Channel ID that will own the post' }),
      }),
      headers: z.object({
        channelId: z.string().optional().openapi({ description: 'User channel ID (for verification)' }),
      }),
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
  }, 'required');

  async handle(c: AppContext): Promise<Response> {
    const userId = this.getUserId(c);

    const request: any = await this.getValidatedData<typeof this.schema>();
    const body: any = request.body;
    const { channelId: postChannelId } = c.req.param();
    const userChannelId = request.headers?.channelId;

    if (!body) {
      return c.json({ error: 'Request body is required' }, 400);
    }

    // Use URL param channelId as the target channel for the post
    const channelId = postChannelId;
    if (!channelId) {
      return c.json({ error: 'channelId is required for creating posts' }, 400);
    }

    // Validate request
    const validation = await validateCreatePost(body, { userId, channelId });
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }

    try {
      // Get channel info for denormalized fields
      const channelData = await getChannelObject(c.env.channels, channelId);

      if (!channelData) {
        return c.json({ error: 'Channel not found' }, 404);
      }

      const channel = (await channelData.json()) as Channel;

      // Verify user owns this channel
      if (channel.userId !== userId) {
        return c.json({ error: 'User does not own this channel' }, 403);
      }

      // Create post object with sanitized content
      const post: CommunityPost = {
        id: crypto.randomUUID(),
        channelId: channelId,
        userId: userId,
        type: body.type,
        content: body.content ? sanitizeHtml(body.content, sanitizeOptions) : undefined,
        images: body.images, // Images should be pre-uploaded via /api/community/media/upload/images
        videoId: body.videoId,
        gif: body.gif, // GIF should be pre-uploaded via /api/community/media/upload/gif
        poll: body.poll ? {
          ...body.poll,
          question: sanitizeHtml(body.poll.question, sanitizeOptions),
          totalVotes: 0,
          showResults: false,
          options: body.poll.options.map((opt, idx) => ({
            id: `option-${idx}`,
            text: opt.text ? sanitizeHtml(opt.text, sanitizeOptions) : undefined,
            image: opt.image, // Poll option images should be pre-uploaded
            votes: 0,
            percentage: 0
          }))
        } : undefined,
        quiz: body.quiz ? {
          ...body.quiz,
          question: sanitizeHtml(body.quiz.question, sanitizeOptions),
          explanation: body.quiz.explanation ? sanitizeHtml(body.quiz.explanation, sanitizeOptions) : undefined,
          totalAttempts: 0,
          correctAttempts: 0,
          options: body.quiz.options.map((opt, idx) => ({
            id: `quiz-option-${idx}`,
            text: sanitizeHtml(opt.text, sanitizeOptions),
            image: opt.image, // Quiz option images should be pre-uploaded
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
        channelAvatar: channel.avatarUrl,
        channelVerified: channel.isVerified || false
      };

      // Save to R2
      const postKey = `posts/${channelId}/${post.id}.json`;
      await c.env.community_posts.put(postKey, JSON.stringify(post));

      // Update channel index
      await this.updateChannelIndex(c, channelId, post.id);

      // Send to processor queue for notifications (if published)
      if (post.status === PostStatus.PUBLISHED) {
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.CommunityPostCreated, {
          postId: post.id,
          channelId: channelId,
          actor: {
            userId,
            channelId: userChannelId,
          },
          timestamp: post.createdAt
        });
      }

      scanInBackground(c, { surface: 'community_post', event: 'create', subjectId: post.id, authorId: userId, channelId, text: communityPostScanText(post) });

      return c.json({ success: true, post });
    } catch (error) {
      logger.error('Error creating community post:', error);
      return c.json({ error: 'Failed to create post' }, 500);
    }
  }

  private async updateChannelIndex(c: any, channelId: string, postId: string) {
    type PostIndex = { postIds: string[]; lastUpdated: string };
    // Conditional write: posts created at the same time must not drop each other from the index
    await new R2Repository<PostIndex>(c.env.community_posts).updateObject(
      `posts/${channelId}/index.json`,
      (index) => {
        // Add to beginning (newest first); keep max 1000 post IDs in index
        index.postIds = [postId, ...index.postIds.filter((id) => id !== postId)].slice(0, 1000);
        index.lastUpdated = new Date().toISOString();
      },
      { initial: () => ({ postIds: [], lastUpdated: new Date().toISOString() }) },
    );
  }
}