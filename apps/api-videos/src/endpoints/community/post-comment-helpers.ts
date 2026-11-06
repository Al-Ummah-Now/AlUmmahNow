import type { Channel, CommunityPost, PostComment } from '@al-ummah/shared-types';

/**
 * Shared helpers for community post comment endpoints.
 *
 * R2 layout (community_posts bucket):
 * - posts/{channelId}/{postId}.json                          post
 * - comments/{postId}/top-level/{commentId}.json             top-level comment
 * - comments/{postId}/top-level/index.json                   top-level index (newest first)
 * - comments/{postId}/replies/{parentId}/{replyId}.json      reply
 * - comments/{postId}/replies/{parentId}/index.json          replies index (chronological)
 * - comments/{postId}/pinned.json                            { commentId } of the pinned comment
 * - comment-likes/{postId}/{commentId}/{userId}.json         like record
 */

export interface PinnedCommentPointer {
  commentId: string;
  pinnedAt: string;
}

export function topLevelCommentKey(postId: string, commentId: string): string {
  return `comments/${postId}/top-level/${commentId}.json`;
}

export function replyCommentKey(postId: string, parentCommentId: string, replyId: string): string {
  return `comments/${postId}/replies/${parentCommentId}/${replyId}.json`;
}

export function repliesIndexKey(postId: string, parentCommentId: string): string {
  return `comments/${postId}/replies/${parentCommentId}/index.json`;
}

export function pinnedPointerKey(postId: string): string {
  return `comments/${postId}/pinned.json`;
}

export function commentLikeKey(postId: string, commentId: string, userId: string): string {
  return `comment-likes/${postId}/${commentId}/${userId}.json`;
}

/**
 * Find a comment by ID, checking top-level comments first and then replies.
 */
export async function findPostComment(
  bucket: R2Bucket,
  postId: string,
  commentId: string
): Promise<{ comment: PostComment | null; commentKey: string }> {
  const topKey = topLevelCommentKey(postId, commentId);
  const topObj = await bucket.get(topKey);
  if (topObj) {
    return { comment: await topObj.json<PostComment>(), commentKey: topKey };
  }

  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: `comments/${postId}/replies/`, cursor });
    const match = listed.objects.find((object) => object.key.endsWith(`/${commentId}.json`));
    if (match) {
      const replyObj = await bucket.get(match.key);
      if (replyObj) {
        return { comment: await replyObj.json<PostComment>(), commentKey: match.key };
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return { comment: null, commentKey: '' };
}

export type PostOwnerCheck =
  | { ok: true; post: CommunityPost }
  | { ok: false; status: 403 | 404; error: string };

/**
 * Load a post and verify the user owns the channel the post belongs to.
 * Ownership is resolved from the channel object in the channels bucket.
 */
export async function loadPostForChannelOwner(
  env: { community_posts: R2Bucket; channels: R2Bucket },
  postChannelId: string,
  postId: string,
  userId: string
): Promise<PostOwnerCheck> {
  const postObj = await env.community_posts.get(`posts/${postChannelId}/${postId}.json`);
  if (!postObj) {
    return { ok: false, status: 404, error: 'Post not found' };
  }
  const post = await postObj.json<CommunityPost>();

  const channelObj = await getChannelObject(env.channels, post.channelId);
  if (!channelObj) {
    return { ok: false, status: 404, error: 'Channel not found' };
  }
  const channel = await channelObj.json<Channel>();

  if (channel.userId !== userId) {
    return {
      ok: false,
      status: 403,
      error: 'Only the channel owner can perform this action',
    };
  }

  return { ok: true, post };
}

/**
 * Prepare a stored comment for a list response: drops hidden comments and
 * deleted comments without replies, masks deleted comments that still have
 * replies, and normalises status flags that older records may lack.
 */
export function presentComment(comment: PostComment): PostComment | null {
  if (comment.isHidden) {
    return null;
  }

  const isDeleted = Boolean(comment.isDeleted || comment.deletedAt);
  if (isDeleted && (comment.repliesCount || 0) === 0) {
    return null;
  }

  const normalised: PostComment = {
    ...comment,
    likes: comment.likes || 0,
    repliesCount: comment.repliesCount || 0,
    isPinned: Boolean(comment.isPinned),
    isHeartedByCreator: Boolean(comment.isHeartedByCreator),
    isEdited: Boolean(comment.isEdited),
  };

  if (isDeleted) {
    return {
      ...normalised,
      content: '[deleted]',
      userDisplayName: '[deleted]',
      userAvatarUrl: undefined,
    };
  }

  return normalised;
}

/**
 * Mark which comments the viewer has liked (adds isLikedByViewer).
 */
export async function withViewerLikes(
  bucket: R2Bucket,
  postId: string,
  comments: PostComment[],
  userId: string | undefined
): Promise<PostComment[]> {
  if (!userId) {
    return comments;
  }
  return Promise.all(
    comments.map(async (comment) => {
      const like = await bucket.head(commentLikeKey(postId, comment.id, userId));
      return { ...comment, isLikedByViewer: like !== null };
    })
  );
}

/**
 * Read a channel object. Channels are stored under their id (see channelCreate.ts);
 * the legacy `<id>/channel.json` key is still read for objects written by older code.
 */
export async function getChannelObject(bucket: R2Bucket, channelId: string): Promise<R2ObjectBody | null> {
  if (!channelId) return null;
  return (await bucket.get(channelId)) ?? (await bucket.get(`${channelId}/channel.json`));
}
