import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { CommunityPost, PostType, VoteResults } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

export class GetPollResults extends OpenAPIRoute {
  static schema = {
    tags: ['Community'],
    summary: 'Get poll results',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID'),
      }),
    },
    responses: {
      200: {
        description: 'Poll results',
        content: {
          'application/json': {
            schema: z.object({
              totalVotes: z.number(),
              options: z.array(z.object({
                id: z.string(),
                text: z.string().optional(),
                votes: z.number(),
                percentage: z.number(),
              })),
              votingEnded: z.boolean(),
              showResults: z.boolean(),
            }),
          },
        },
      },
      403: {
        description: 'Results not available yet',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
      404: {
        description: 'Poll not found',
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

  async handle(c: any): Promise<Response> {
    const { channelId: postChannelId, postId } = c.req.param();

    try {
      // Direct key lookup (O(1))
      const postKey = `posts/${postChannelId}/${postId}.json`;
      const postData = await c.env.community_posts.get(postKey);

      if (!postData) {
        return c.json({ error: 'Poll not found' }, 404);
      }

      const post: CommunityPost = await postData.json();

      if (post.type !== PostType.POLL || !post.poll) {
        return c.json({ error: 'Poll not found' }, 404);
      }

      // Check if voting ended
      const votingEnded = post.poll.votingEndsAt
        ? new Date(post.poll.votingEndsAt) < new Date()
        : false;

      // Check if results should be shown
      const showResults = post.poll.showResults || votingEnded;

      if (!showResults) {
        // Check if user has voted (would need auth for this)
        // For now, we'll show results if voting ended or showResults is true
        return c.json({
          error: 'Results will be available after voting ends',
        }, 403);
      }

      // Get results
      const resultsKey = `votes/${postId}/results.json`;
      const resultsData = await c.env.community_posts.get(resultsKey);

      let results: VoteResults | null = null;
      if (resultsData) {
        results = await resultsData.json();
      }

      // Combine poll options with results
      const options = post.poll.options.map(opt => ({
        id: opt.id,
        text: opt.text,
        votes: results?.options[opt.id]?.count || 0,
        percentage: results?.options[opt.id]?.percentage || 0,
      }));

      return c.json({
        totalVotes: results?.totalVotes || 0,
        options,
        votingEnded,
        showResults,
      });
    } catch (error) {
      logger.error('Error getting poll results:', error);
      return c.json({ error: 'Failed to get results' }, 500);
    }
  }
}