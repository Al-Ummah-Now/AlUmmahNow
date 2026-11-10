import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { Logger } from '@al-ummah/logger';
import { importLegacyPost, syncPostLike } from '../lib/post-counters';

interface PostLikedPayload {
  postId: string;
  channelId: string;
  actor: { userId: string; channelId?: string };
  timestamp: string;
}

/**
 * Like / unlike of a community post (SCALABILITY-AUDIT PR-2, PR-4).
 *
 * Brings D1 in line with the user's like document and moves the post's like
 * counter by exactly the change, in one transaction (lib/post-counters.ts).
 * The post document is not touched: api-videos reads the count from D1.
 */
export async function handlePostLikeEvent(
  message: AlUmmahMessage,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  logger.debug(`Processing post like message: ${MessageType[message.type]}`, message.payload);

  const { postId, channelId, actor, timestamp } = message.payload as unknown as PostLikedPayload;
  if (!postId || !channelId || !actor?.userId) {
    throw new Error('Post like message missing required fields: postId, channelId, actor.userId');
  }
  const db = env.NOTIFICATIONS_DB;
  if (!db) {
    logger.warn('NOTIFICATIONS_DB not bound; post like not counted', { postId });
    return;
  }

  const imported = await importLegacyPost(db, env.community_posts, postId, 'likes', message.id);
  const liked = await syncPostLike(db, env.community_posts, postId, actor.userId, timestamp);
  if (imported === 'more') await continueImport(message, env, logger, postId);

  logger.debug('Post like processed', { postId, channelId, userId: actor.userId, liked, imported });
}

/**
 * A post with more legacy records than one call imports: send the event again
 * (applying it twice changes nothing) so the next call picks up the cursor.
 */
export async function continueImport(message: AlUmmahMessage, env: QueueEnvironment, logger: Logger, postId: string): Promise<void> {
  if (!env.MESSAGE_QUEUE) throw new Error(`legacy import of post ${postId} not finished; retrying`);
  await env.MESSAGE_QUEUE.send(message);
  logger.debug('Legacy post counter import continues in a follow-up message', { postId });
}
