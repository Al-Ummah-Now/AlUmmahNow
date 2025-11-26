import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { Logger } from '@al-ummah/logger';
import { CommunityPost } from '@al-ummah/shared-types';

interface ActorPayload {
  userId: string;
  channelId?: string;
}

interface PostLikedPayload {
  postId: string;
  channelId: string;
  actor: ActorPayload;
  timestamp: string;
}

/**
 * Handles community post like events by updating like counts.
 *
 * This handler processes likes asynchronously to prevent race conditions
 * during concurrent like operations. It counts total likes by scanning
 * the likes bucket and updates the post's like count.
 */
export async function handlePostLikeEvent(
  message: AlUmmahMessage,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  logger.debug(`Processing post like message: ${MessageType[message.type]}`, message.payload);

  const payload = message.payload as unknown as PostLikedPayload;
  const { postId, channelId, actor } = payload;

  if (!postId || !channelId || !actor?.userId) {
    throw new Error('Post like message missing required fields: postId, channelId, actor.userId');
  }

  try {
    // Count total likes for this post
    const totalLikes = await countPostLikes(env, postId, logger);

    // Update post with new like count
    await updatePostLikeCount(env, channelId, postId, totalLikes, logger);

    logger.info('Post like processed successfully', {
      postId,
      channelId,
      actor,
      totalLikes,
    });
  } catch (error) {
    logger.error('Failed to process post like', { postId, channelId, actor, error });
    throw error;
  }
}

/**
 * Counts total likes for a post by scanning the likes bucket.
 * Uses R2 list operation with prefix to find all like records for a post.
 */
async function countPostLikes(
  env: QueueEnvironment,
  postId: string,
  logger: Logger
): Promise<number> {
  const likePrefix = `likes/${postId}/`;
  let count = 0;
  let cursor: string | undefined = undefined;

  // Scan all like records for this post
  do {
    const listOptions: { prefix: string; limit: number; cursor?: string } = {
      prefix: likePrefix,
      limit: 1000, // Max R2 list limit
    };
    if (cursor) {
      listOptions.cursor = cursor;
    }

    const listResult = await env.community_posts.list(listOptions);

    count += listResult.objects.length;
    cursor = listResult.truncated ? listResult.cursor : undefined;
  } while (cursor);

  logger.debug('Post likes counted', { postId, totalLikes: count });
  return count;
}

/**
 * Updates the post document with the latest like count.
 */
async function updatePostLikeCount(
  env: QueueEnvironment,
  channelId: string,
  postId: string,
  totalLikes: number,
  logger: Logger
): Promise<void> {
  const postKey = `posts/${channelId}/${postId}.json`;
  const postData = await env.community_posts.get(postKey);

  if (!postData) {
    logger.warn('Post not found for like count update', { postId, channelId });
    return;
  }

  const post = await postData.json<CommunityPost>();

  // Update like count
  post.likes = totalLikes;

  await env.community_posts.put(postKey, JSON.stringify(post));
  logger.debug('Post updated with like count', { postId, totalLikes });
}
