import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import {
  CommunityPost,
  PostType,
  VoteRecord,
  VoteResults,
  VoteOnPollRequest,
  VoteOnPollResponse,
} from '@al-ummah/shared-types';
import { getAuthContext } from '../../middleware/auth';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';

const voteSchema = z.object({
  optionIds: z.array(z.string()).min(1).max(5),
});

export class VoteOnPoll extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Vote on a community poll',
    request: {
      headers: z.object({
          userId: z.string().optional().nullable(),
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID to vote on'),
      }),
      body: {
        content: {
          'application/json': {
            schema: voteSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Vote recorded successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              results: z.object({
                totalVotes: z.number(),
                options: z.array(z.object({
                  id: z.string(),
                  votes: z.number(),
                  percentage: z.number(),
                })),
              }),
            }),
          },
        },
      },
      400: {
        description: 'Invalid vote',
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
  });

  async handle(c: any): Promise<Response> {
    const auth = c.get('auth');
    const { channelId, postId } = c.req.param();
    const request = await this.getValidatedData<typeof this.schema>();
    const body: any = request.body;

    if (!body) {
      return c.json({ error: 'Request body is required' }, 400);
    }

    try {
      // Check if already voted
      const voteKey = `votes/${postId}/${auth.userId}.json`;
      const existingVote = await c.env.community_posts.get(voteKey);

      if (existingVote) {
        return c.json({ error: 'Already voted on this poll' }, 400);
      }

      // Get post using direct key access (fixed N+1 query issue)
      const postKey = `posts/${channelId}/${postId}.json`;
      const postData = await c.env.community_posts.get(postKey);

      if (!postData) {
        return c.json({ error: 'Poll not found' }, 404);
      }

      const post: CommunityPost = await postData.json();

      if (post.type !== PostType.POLL || !post.poll) {
        return c.json({ error: 'Post is not a poll' }, 400);
      }

      // Check if voting ended
      if (post.poll.votingEndsAt && new Date(post.poll.votingEndsAt) < new Date()) {
        return c.json({ error: 'Voting has ended' }, 400);
      }

      // Validate option IDs
      const validOptionIds = post.poll.options.map(opt => opt.id);
      const invalidOptions = body.optionIds.filter(id => !validOptionIds.includes(id));

      if (invalidOptions.length > 0) {
        return c.json({ error: 'Invalid option IDs' }, 400);
      }

      // Check multiple choice
      if (!post.poll.multipleChoice && body.optionIds.length > 1) {
        return c.json({ error: 'Multiple selections not allowed' }, 400);
      }

      // Record vote
      const voteRecord: VoteRecord = {
        userId: auth.userId,
        postId,
        optionIds: body.optionIds,
        votedAt: new Date().toISOString(),
      };
      await c.env.community_posts.put(voteKey, JSON.stringify(voteRecord));

      // Update results
      const results = await this.updateResults(c, postId, post.poll, body.optionIds);

      // Update post with new totals
      post.poll.totalVotes = results.totalVotes;
      post.poll.options = post.poll.options.map(opt => ({
        ...opt,
        votes: results.options[opt.id]?.count || 0,
        percentage: results.options[opt.id]?.percentage || 0,
      }));

      // Save updated post
      await c.env.community_posts.put(postKey, JSON.stringify(post));

      // Send to queue for analytics
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.PollVoted, {
        postId,
        channelId: post.channelId,
        userId: auth.userId,
        optionIds: body.optionIds,
        timestamp: new Date().toISOString(),
      });

      return c.json({
        success: true,
        results: {
          totalVotes: results.totalVotes,
          options: post.poll.options.map(opt => ({
            id: opt.id,
            votes: opt.votes,
            percentage: opt.percentage,
          })),
        },
      });
    } catch (error) {
      logger.error('Error voting on poll:', error);
      return c.json({ error: 'Failed to record vote' }, 500);
    }
  }

  /**
   * KNOWN ISSUE: Race Condition in Vote Counting
   *
   * This method uses a read-modify-write pattern that is NOT atomic:
   * 1. Read current vote counts from R2
   * 2. Increment vote counts locally
   * 3. Write updated counts back to R2
   *
   * PROBLEM:
   * If two users vote simultaneously on the same poll:
   * - User A reads: totalVotes = 100
   * - User B reads: totalVotes = 100 (before A's write)
   * - User A increments to 101 and writes
   * - User B increments to 101 and writes (overwrites A's vote!)
   * - Result: totalVotes = 101 instead of 102 (one vote lost)
   *
   * IMPACT:
   * - Vote counts may be inaccurate under concurrent load
   * - Higher traffic = more lost votes
   * - Low-traffic polls will see minimal impact
   *
   * SOLUTION OPTIONS:
   *
   * Option 1: Cloudflare Durable Objects (RECOMMENDED)
   * - Provides single-threaded atomic operations
   * - Each poll gets its own Durable Object instance
   * - Guaranteed consistency without race conditions
   * - Implementation: Move vote counting logic to Durable Objects
   * - Trade-off: Additional complexity, requires Durable Objects setup
   *
   * Option 2: Optimistic Locking with ETags
   * - Add version/etag field to VoteResults
   * - Check etag before write, retry if changed
   * - Simpler than Durable Objects, works with R2
   * - Trade-off: Requires retry logic, may have contention under high load
   *
   * Option 3: Accept the Risk (CURRENT APPROACH)
   * - Suitable for low-traffic community features
   * - Most polls will have sequential votes (low concurrency)
   * - Lost votes are statistically rare in typical usage
   * - Can upgrade to Option 1 or 2 if accuracy becomes critical
   *
   * RECOMMENDATION:
   * - Start with current implementation for MVP/low-traffic
   * - Monitor vote accuracy metrics
   * - Migrate to Durable Objects when poll traffic increases
   * - Consider Option 2 as intermediate step if needed
   */
  private async updateResults(
    c: any,
    postId: string,
    poll: any,
    optionIds: string[]
  ): Promise<VoteResults> {
    const resultsKey = `votes/${postId}/results.json`;
    const existing = await c.env.community_posts.get(resultsKey);

    let results: VoteResults = {
      postId,
      totalVotes: 0,
      options: {},
      lastUpdated: new Date().toISOString(),
    };

    if (existing) {
      results = await existing.json();
    }

    // Initialize all options
    for (const option of poll.options) {
      if (!results.options[option.id]) {
        results.options[option.id] = { count: 0, percentage: 0 };
      }
    }

    // Update vote counts
    results.totalVotes++;
    for (const optionId of optionIds) {
      if (!results.options[optionId]) {
        results.options[optionId] = { count: 0, percentage: 0 };
      }
      results.options[optionId].count++;
    }

    // Recalculate percentages
    for (const optionId in results.options) {
      results.options[optionId].percentage =
        results.totalVotes > 0
          ? Math.round((results.options[optionId].count / results.totalVotes) * 100 * 10) / 10
          : 0;
    }

    results.lastUpdated = new Date().toISOString();
    await c.env.community_posts.put(resultsKey, JSON.stringify(results));

    return results;
  }
}