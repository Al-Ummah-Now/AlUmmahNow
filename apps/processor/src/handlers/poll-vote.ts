import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { Logger } from '@al-ummah/logger';
import { VoteResults, CommunityPost, PollOption } from '@al-ummah/shared-types';

interface PollVotedPayload {
  postId: string;
  channelId: string;
  userId: string;
  optionIds: string[];
  pollOptions: Array<{ id: string }>;
  timestamp: string;
}

/**
 * Handles poll vote events by calculating and updating vote results.
 *
 * This handler processes votes asynchronously, which helps reduce
 * race conditions compared to synchronous API calculation.
 * While queue processing is not fully atomic, it provides better
 * ordering guarantees than concurrent API requests.
 */
export async function handlePollVoteEvent(
  message: AlUmmahMessage,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  logger.debug(`Processing poll vote message: ${MessageType[message.type]}`, message.payload);

  const payload = message.payload as unknown as PollVotedPayload;
  const { postId, channelId, optionIds, pollOptions } = payload;

  if (!postId || !channelId || !optionIds?.length) {
    throw new Error('Poll vote message missing required fields: postId, channelId, optionIds');
  }

  try {
    // Update vote results
    const results = await updateVoteResults(env, postId, optionIds, pollOptions, logger);

    // Update post with new totals
    await updatePostWithResults(env, channelId, postId, results, logger);

    logger.info(`Poll vote processed successfully`, {
      postId,
      channelId,
      totalVotes: results.totalVotes,
      optionIds,
    });
  } catch (error) {
    logger.error('Failed to process poll vote', { postId, channelId, error });
    throw error;
  }
}

/**
 * Recalculates vote results by reading ALL vote documents for a post.
 * This approach is race-condition proof because:
 * - Each user's vote is stored as a separate document keyed by userId
 * - Duplicate votes just overwrite the same file
 * - We count from source of truth, not increment counters
 */
async function updateVoteResults(
  env: QueueEnvironment,
  postId: string,
  _optionIds: string[], // Not used - we read all votes from storage
  pollOptions: Array<{ id: string }>,
  logger: Logger
): Promise<VoteResults> {
  const votesPrefix = `votes/${postId}/`;
  const resultsKey = `votes/${postId}/results.json`;

  // Initialize fresh results
  const results: VoteResults = {
    postId,
    totalVotes: 0,
    options: {},
    lastUpdated: new Date().toISOString(),
  };

  // Initialize all options from poll configuration
  for (const option of pollOptions) {
    results.options[option.id] = { count: 0, percentage: 0 };
  }

  // List all vote documents for this post (with pagination for large polls)
  let cursor: string | undefined;
  let voteDocsProcessed = 0;

  do {
    const listOptions: { prefix: string; cursor?: string } = { prefix: votesPrefix };
    if (cursor) {
      listOptions.cursor = cursor;
    }
    const listResult = await env.community_posts.list(listOptions);

    // Read each vote document and count
    for (const object of listResult.objects) {
      // Skip the results.json file itself
      if (object.key === resultsKey) {
        continue;
      }

      try {
        const voteData = await env.community_posts.get(object.key);
        if (!voteData) continue;

        const vote = await voteData.json<{ optionIds: string[] }>();

        // Count this vote
        results.totalVotes++;
        voteDocsProcessed++;

        // Count each option selected by this voter
        for (const optionId of vote.optionIds) {
          if (results.options[optionId]) {
            results.options[optionId].count++;
          }
        }
      } catch (error) {
        logger.warn('Failed to read vote document', { key: object.key, error });
      }
    }

    cursor = listResult.truncated ? listResult.cursor : undefined;
  } while (cursor);

  // Recalculate percentages
  for (const optionId in results.options) {
    const option = results.options[optionId];
    if (option) {
      option.percentage =
        results.totalVotes > 0
          ? Math.round((option.count / results.totalVotes) * 100 * 10) / 10
          : 0;
    }
  }

  results.lastUpdated = new Date().toISOString();
  await env.community_posts.put(resultsKey, JSON.stringify(results));

  logger.debug('Vote results recalculated from source', {
    postId,
    totalVotes: results.totalVotes,
    voteDocsProcessed,
  });

  return results;
}

/**
 * Updates the post document with the latest vote totals.
 */
async function updatePostWithResults(
  env: QueueEnvironment,
  channelId: string,
  postId: string,
  results: VoteResults,
  logger: Logger
): Promise<void> {
  const postKey = `posts/${channelId}/${postId}.json`;
  const postData = await env.community_posts.get(postKey);

  if (!postData) {
    logger.warn('Post not found for vote update', { postId, channelId });
    return;
  }

  const post = await postData.json<CommunityPost>();

  if (!post.poll) {
    logger.warn('Post is not a poll', { postId, channelId });
    return;
  }

  // Update poll totals
  post.poll.totalVotes = results.totalVotes;
  post.poll.options = post.poll.options.map((opt: PollOption) => ({
    ...opt,
    votes: results.options[opt.id]?.count || 0,
    percentage: results.options[opt.id]?.percentage || 0,
  }));

  await env.community_posts.put(postKey, JSON.stringify(post));
  logger.debug('Post updated with vote results', { postId, totalVotes: results.totalVotes });
}
