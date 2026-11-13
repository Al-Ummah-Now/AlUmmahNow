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
import { markScheduled } from '../../lib/scheduled-posts';
import { parsePostFields, type PostV2Fields } from '@al-ummah/shared-types';
import { platformMediaHost, postFieldsMessage } from '../../lib/post-v2';

const mediaSchema = z.object({
  url: z.string().max(2048),
  alt: z.string().max(300).nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});

/** The PostV2 fields an edit may send (replaced whole); checked by parsePostFields for the post's kind. */
const V2_KEYS = ['locale', 'translationKey', 'slug', 'title', 'article', 'slides', 'link'] as const;

const updatePostSchema = z.object({
  content: z.string().max(5000).optional(),
  visibility: z.nativeEnum(PostVisibility).optional(),
  commentsEnabled: z.boolean().optional(),
  scheduledAt: z.string().datetime().optional(),
  pinned: z.boolean().optional(),
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
      // PostV2 edits: the post's kind decides which fields count; unsent ones keep their value.
      let v2: PostV2Fields | null = null;
      if (V2_KEYS.some((k) => body[k] !== undefined)) {
        const merged: Record<string, unknown> = {
          locale: body.locale ?? post.locale,
          translationKey: body.translationKey ?? post.translationKey,
          slug: body.slug ?? post.slug,
          title: body.title ?? post.title,
          article: body.article ?? post.article,
          slides: body.slides ?? post.slides,
          link: body.link ?? post.link,
        };
        const parsed = parsePostFields(post.type, merged, { mediaHost: platformMediaHost(c.env) });
        if ('error' in parsed) {
          return c.json({ error: postFieldsMessage(parsed), code: parsed.error, field: parsed.field }, 400);
        }
        v2 = parsed.value;
      }

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
        if (v2) {
          // The www address and the CMS key are not the author's to change.
          const keep = fresh.article ? { url: fresh.article.url, externalId: fresh.article.externalId } : {};
          Object.assign(fresh, v2);
          if (fresh.article) Object.assign(fresh.article, Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)));
        }
        fresh.updatedAt = new Date().toISOString();
        return true;
      });
      if (!saved || rejected) {
        return c.json({ error: 'Post not found' }, 404);
      }
      Object.assign(post, saved);
      // Rescheduled: a marker for the new time (the old one is dropped when it comes due; #1218)
      if (body.scheduledAt !== undefined && saved.status === PostStatus.SCHEDULED && saved.scheduledAt) {
        await markScheduled(c.env.community_posts, postChannelId, postId, saved.scheduledAt);
      }

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

      if (body.content !== undefined || v2) {
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