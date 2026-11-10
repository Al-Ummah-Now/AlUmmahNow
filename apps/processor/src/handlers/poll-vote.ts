import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { Logger } from '@al-ummah/logger';
import { importLegacyPost, syncPollVote } from '../lib/post-counters';
import { continueImport } from './post-like';

interface PollVotedPayload {
  postId: string;
  channelId: string;
  actor: { userId: string; channelId?: string };
  optionIds: string[];
  timestamp: string;
}

/**
 * Poll vote (SCALABILITY-AUDIT PR-2, PR-3).
 *
 * One vote costs one R2 read and one D1 transaction, however many votes the
 * poll has: D1 holds each voter's options (poll_votes) and the totals
 * (analytics_daily counters), changed together. No recount, no results.json,
 * no write to the post document: api-videos reads the totals from D1.
 */
export async function handlePollVoteEvent(
  message: AlUmmahMessage,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  logger.debug(`Processing poll vote message: ${MessageType[message.type]}`, message.payload);

  const { postId, channelId, actor, optionIds, timestamp } = message.payload as unknown as PollVotedPayload;
  if (!postId || !channelId || !optionIds?.length || !actor?.userId) {
    throw new Error('Poll vote message missing required fields: postId, channelId, optionIds');
  }
  const db = env.NOTIFICATIONS_DB;
  if (!db) {
    logger.warn('NOTIFICATIONS_DB not bound; poll vote not counted', { postId });
    return;
  }

  const imported = await importLegacyPost(db, env.community_posts, postId, 'votes', message.id);
  const counted = await syncPollVote(db, env.community_posts, postId, actor.userId, timestamp);
  if (imported === 'more') await continueImport(message, env, logger, postId);

  logger.debug('Poll vote processed', { postId, channelId, userId: actor.userId, options: counted, imported });
}
