import { isChannelDeleted } from '../../lib/community-posts';
import { withPostViews } from '../../lib/post-views';
import { z } from 'zod';
import { isUpcoming } from '../../lib/scheduled-posts';
import R2Repository from '../../lib/r2Repo';
import {
  CommunityPost,
  PostType,
  PostStatus,
  ListCommunityPostsResponse,
  VoteRecord,
} from '@al-ummah/shared-types';
import { OptionalAuthRoute, AppContext } from '../../base';
import { withPostCounts } from '../../lib/post-counters';
import { logger } from '../../lib/logger';
import { withChannelNames } from '../../lib/channelNames';

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1).optional(),
  limit: z.coerce.number().min(1).max(50).default(20).optional(),
  type: z.nativeEnum(PostType).optional(),
  status: z.nativeEnum(PostStatus).optional(),
});

export class ListCommunityPosts extends OptionalAuthRoute {
  schema = {
    tags: ['Community'],
    summary: 'List community posts for a channel',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID to list posts from'),
      }),
      query: querySchema,
    },
    responses: {
      200: {
        description: 'List of community posts',
        content: {
          'application/json': {
            schema: z.object({
              posts: z.array(z.any()),
              pagination: z.object({
                page: z.number(),
                limit: z.number(),
                total: z.number(),
                hasNext: z.boolean(),
              }),
            }),
          },
        },
      },
      400: {
        description: 'Invalid request parameters',
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
    const { channelId: postChannelId } = c.req.param();
    const request = await this.getValidatedData<typeof this.schema>();
    const { page = 1, limit = 20, type, status = PostStatus.PUBLISHED } = request.query;
    const viewerId = this.getUserId(c);

    try {
      // Get channel post index
      const indexKey = `posts/${postChannelId}/index.json`;
      const indexData = await c.env.community_posts.get(indexKey);

      if (!indexData || (await isChannelDeleted(c.env.channels, postChannelId))) {
        // No posts for this channel (or the channel is deleted)
        return c.json({
          posts: [],
          pagination: {
            page,
            limit,
            total: 0,
            hasNext: false,
          },
        });
      }

      const index = await indexData.json() as { postIds: string[], lastUpdated: string };

      // Load posts from index
      const startIdx = (page - 1) * limit;
      const endIdx = startIdx + limit;
      const pagePostIds = index.postIds.slice(startIdx, endIdx);

      const posts: CommunityPost[] = [];

      for (const postId of pagePostIds) {
        const postKey = `posts/${postChannelId}/${postId}.json`;
        const postData = await c.env.community_posts.get(postKey);

        if (postData) {
          const post = (await postData.json()) as CommunityPost;

          // Filter out soft-deleted posts
          if (post.isDeleted) {
            continue;
          }

          // Filter out moderation-hidden posts
          if (post.isHidden) {
            continue;
          }

          // A scheduled post waits for its time; only its author sees it before then (#1218)
          if (isUpcoming(post) && post.userId !== viewerId) {
            continue;
          }

          // Filter by status
          if (post.status !== status && status !== PostStatus.PUBLISHED) {
            continue;
          }

          // Filter by type
          if (type && post.type !== type) {
            continue;
          }

          // Check if poll/quiz has ended
          if (post.poll?.votingEndsAt) {
            const endTime = new Date(post.poll.votingEndsAt);
            if (endTime < new Date()) {
              post.poll.showResults = true; // Show results after voting ends
            }
          }

          posts.push(post);
        }
      }

      // Views: legacy field + D1 count (SCALABILITY-AUDIT AV-8)
      await withPostViews(c.env.NOTIFICATIONS_DB, posts);

      // Sort by creation date (newest first)
      posts.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      // Put pinned posts at the top
      posts.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return 0;
      });

      // Like / vote totals live in D1 (the processor no longer writes them into the document)
      await withPostCounts(c.env.NOTIFICATIONS_DB, posts);

      // Attach per-viewer state (liked / poll vote) for authenticated requests
      // viewerId: the signed-in viewer (above)
      if (viewerId) {
        await Promise.all(
          posts.map(async (post) => {
            const like = await c.env.community_posts.head(`likes/${post.id}/${viewerId}.json`);
            post.viewerHasLiked = like !== null;
            if (post.type === PostType.POLL) {
              const vote = await c.env.community_posts.get(`votes/${post.id}/${viewerId}.json`);
              if (vote) {
                const record = (await vote.json()) as VoteRecord;
                post.viewerPollVote = record.optionIds;
              }
            }
          })
        );
      }

      return c.json({
        // The channel's name in every language (lib/channelNames.ts), posts stored before it included
        posts: await withChannelNames(c.env.channels, posts),
        pagination: {
          page,
          limit,
          total: index.postIds.length,
          hasNext: endIdx < index.postIds.length,
        },
      });
    } catch (error) {
      logger.error('Error listing community posts:', error);
      return c.json({ error: 'Failed to list posts' }, 500);
    }
  }
}