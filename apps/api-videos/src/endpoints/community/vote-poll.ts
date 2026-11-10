import { z } from 'zod';
import {
  CommunityPost,
  PostType,
  VoteRecord,
  VoteOnPollResponse,
} from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { withPostCounts } from '../../lib/post-counters';
import { logger } from '../../lib/logger';
import { CREATE_ONLY } from '../../lib/r2Repo';

const voteSchema = z.object({
  optionIds: z.array(z.string()).min(1).max(5),
});

export class VoteOnPoll extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Vote on a community poll',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID to vote on'),
      }),
      headers: z.object({
        channelId: z.string().optional().describe('Actor channel ID (the channel voting)'),
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
        description: 'Vote recorded successfully. Results are calculated asynchronously.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
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

  async handle(c: AppContext): Promise<Response> {
    const userId = this.getUserId(c);
    const { channelId: postChannelId, postId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const userChannelId = request.headers?.channelId;
    const body: any = request.body;

    if (!body) {
      return c.json({ error: 'Request body is required' }, 400);
    }

    try {
      // Check if already voted
      const voteKey = `votes/${postId}/${userId}.json`;
      const existingVote = await c.env.community_posts.get(voteKey);

      if (existingVote) {
        return c.json({ error: 'Already voted on this poll' }, 400);
      }

      // Get post using direct key access (fixed N+1 query issue)
      const postKey = `posts/${postChannelId}/${postId}.json`;
      const postData = await c.env.community_posts.get(postKey);

      if (!postData) {
        return c.json({ error: 'Poll not found' }, 404);
      }

      const post: CommunityPost = await withPostCounts(c.env.NOTIFICATIONS_DB, [await postData.json<CommunityPost>()]).then(([p]) => p);

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
        userId: userId,
        postId,
        optionIds: body.optionIds,
        votedAt: new Date().toISOString(),
      };
      // Created once (SCALABILITY-AUDIT AV-22): of two votes at once only the
      // first is stored and counted; the other is refused like any repeat vote.
      const created = await c.env.community_posts.put(voteKey, JSON.stringify(voteRecord), { onlyIf: CREATE_ONLY });
      if (!created) {
        return c.json({ error: 'Already voted on this poll' }, 400);
      }

      // Send to queue for score calculation (moved from synchronous calculation)
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.PollVoted, {
        postId,
        channelId: postChannelId,
        actor: {
          userId: userId,
          channelId: userChannelId,
        },
        optionIds: body.optionIds,
        // Include poll options for processor to initialize results if needed
        pollOptions: post.poll.options.map(opt => ({ id: opt.id })),
        timestamp: new Date().toISOString(),
      });

      // Stored results are recalculated asynchronously by the processor; return
      // the projected results including this vote so the voter sees them at once.
      // Same rounding as the processor (one decimal place).
      const projectedTotal = (post.poll.totalVotes || 0) + 1;
      const projectedOptions = post.poll.options.map((opt) => {
        const votes = (opt.votes || 0) + (body.optionIds.includes(opt.id) ? 1 : 0);
        return {
          id: opt.id,
          votes,
          percentage: Math.round((votes / projectedTotal) * 100 * 10) / 10,
        };
      });

      const response: VoteOnPollResponse = {
        success: true,
        results: {
          totalVotes: projectedTotal,
          options: projectedOptions,
        },
      };
      return c.json({ ...response, message: 'Vote recorded successfully' });
    } catch (error) {
      logger.error('Error voting on poll:', error);
      return c.json({ error: 'Failed to record vote' }, 500);
    }
  }
}