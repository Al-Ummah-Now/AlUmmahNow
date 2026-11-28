import { postSanitizeOptions, sanitizePostContent } from '../../lib/post-content';
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
import { logger } from '../../lib/logger';
import { rethrowBusy } from '../../lib/r2Repo';
import { writeCommunityPost } from '../../lib/community/writePost';
import { getChannelObject } from './post-comment-helpers';
import { CHANNEL_SUSPENDED_CODE } from '../../middleware/auth';
import { channelNameFields } from '../../lib/channelName';
import { can, channelRoleOf, parsePostFields } from '@al-ummah/shared-types';
import { platformMediaHost, postFieldsMessage } from '../../lib/post-v2';

// Every PostV2 kind (packages/shared-types/src/post-schema.ts). Article, cards and link content is
// checked by parsePostFields, the one validator shared with the CMS and www.
const USER_POST_TYPES = [PostType.TEXT, PostType.IMAGE, PostType.POLL, PostType.QUIZ, PostType.VIDEO, PostType.GIF, PostType.ARTICLE, PostType.CARDS, PostType.LINK] as const;

const mediaSchema = z.object({
  url: z.string().max(2048),
  alt: z.string().max(300).nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});

const createPostSchema = z.object({
  type: z.enum(USER_POST_TYPES),
  content: z.string().max(5000).optional(),
  images: z.array(z.object({
    // The upload's URL (POST /api/community/media/upload/images); must be on a platform media host.
    url: z.string().max(2048).optional(),
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
  scheduledAt: z.string().datetime().optional(),
  // PostV2 fields (post-schema.ts)
  locale: z.enum(['en', 'ar']).optional(),
  translationKey: z.string().max(64).optional(),
  slug: z.string().max(120).optional(),
  title: z.string().max(200).optional(),
  article: z.object({
    title: z.string().max(200),
    excerpt: z.string().max(300).nullable().optional(),
    body: z.string().max(100_000),
    cover: mediaSchema.nullable().optional(),
  }).optional(),
  slides: z.array(z.object({
    id: z.string().max(40).optional(),
    image: mediaSchema,
    heading: z.string().max(140).nullable().optional(),
    body: z.string().max(400).nullable().optional(),
    position: z.enum(['top', 'middle', 'bottom']).optional(),
  })).max(40).optional(),
  link: z.object({
    url: z.string().max(2048),
    title: z.string().max(200).nullable().optional(),
    siteName: z.string().max(80).nullable().optional(),
    description: z.string().max(300).nullable().optional(),
    image: mediaSchema.nullable().optional(),
  }).optional(),
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
        channelId: z.string().optional().nullable().openapi({ description: 'User channel ID (for verification)' }),
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
    const userChannelId = request.headers?.channelId ?? undefined;

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

    // The PostV2 fields (language, slug, translation key; article, cards and link content)
    const v2 = parsePostFields(body.type, body, { mediaHost: platformMediaHost(c.env) });
    if ('error' in v2) {
      return c.json({ error: postFieldsMessage(v2), code: v2.error, field: v2.field }, 400);
    }
    const imageHost = platformMediaHost(c.env);
    const badImage = (body.images ?? []).find((img: { url?: string }) => img.url !== undefined && !isPlatformImage(img.url, imageHost));
    if (badImage) {
      return c.json({ error: 'Images must be uploaded first', code: 'bad_media', field: 'images' }, 400);
    }

    try {
      // Get channel info for denormalized fields
      const channelData = await getChannelObject(c.env.channels, channelId);

      if (!channelData) {
        return c.json({ error: 'Channel not found' }, 404);
      }

      const channel = (await channelData.json()) as Channel;

      // The owner, or a member whose channel role grants post.manage
      // (docs/specs/CHANNEL-ROLES.md); channel roles are not site roles
      if (!can(channelRoleOf(channel as never, userId), 'post.manage')) {
        return c.json({ error: 'You cannot post on this channel' }, 403);
      }
      // The post belongs to the channel's owner, like a member's upload;
      // authorId records the member who wrote it (never in public views)
      const ownerId = channel.userId;

      // A suspended channel publishes nothing new (admin content management)
      if (channel.isSuspended || (channel as { isDeleted?: boolean }).isDeleted) {
        return c.json({ success: false, code: CHANNEL_SUSPENDED_CODE, error: 'This channel is suspended on Al Ummah Now videos' }, 403);
      }

      // Create post object with sanitized content
      const post: CommunityPost = {
        id: crypto.randomUUID(),
        channelId: channelId,
        userId: ownerId,
        ...(ownerId !== userId ? { authorId: userId } : {}),
        type: body.type,
        ...v2.value,
        content: body.content ? sanitizePostContent(body.content) : undefined,
        images: body.images, // Images should be pre-uploaded via /api/community/media/upload/images
        videoId: body.videoId,
        gif: body.gif, // GIF should be pre-uploaded via /api/community/media/upload/gif
        poll: body.poll ? {
          ...body.poll,
          question: sanitizeHtml(body.poll.question, postSanitizeOptions),
          totalVotes: 0,
          showResults: false,
          options: body.poll.options.map((opt, idx) => ({
            id: `option-${idx}`,
            text: opt.text ? sanitizeHtml(opt.text, postSanitizeOptions) : undefined,
            image: opt.image, // Poll option images should be pre-uploaded
            votes: 0,
            percentage: 0
          }))
        } : undefined,
        quiz: body.quiz ? {
          ...body.quiz,
          question: sanitizeHtml(body.quiz.question, postSanitizeOptions),
          explanation: body.quiz.explanation ? sanitizeHtml(body.quiz.explanation, postSanitizeOptions) : undefined,
          totalAttempts: 0,
          correctAttempts: 0,
          options: body.quiz.options.map((opt, idx) => ({
            id: `quiz-option-${idx}`,
            text: sanitizeHtml(opt.text, postSanitizeOptions),
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
        ...channelNameFields(channel),
        channelAvatar: channel.avatarUrl,
        channelVerified: channel.isVerified || false
      };

      // Stored with the same checks as an imported post (lib/community/writePost.ts)
      await writeCommunityPost(c as never, post, { userId, channelId: userChannelId });

      return c.json({ success: true, post });
    } catch (error) {
      rethrowBusy(error);
      logger.error('Error creating community post:', error);
      return c.json({ error: 'Failed to create post' }, 500);
    }
  }
}
function isPlatformImage(url: string, host: ((h: string) => boolean) | undefined): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (!host || host(u.hostname));
  } catch {
    return false;
  }
}
