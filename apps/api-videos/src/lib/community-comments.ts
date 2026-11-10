/**
 * Community comment writes that many people make at once
 * (docs/architecture/SCALABILITY-AUDIT.md, AV-10 / AV-11 / AV-12).
 *
 * - Comment indexes (`comments/<post>/top-level/index.json`, the replies index
 *   of each thread) change with a conditional write, so two comments at once
 *   are both listed (a blind rewrite used to drop one).
 * - A comment's `likes` is the number of like records under
 *   `comment-likes/<post>/<comment>/`, recounted inside a conditional write of
 *   the comment after every like or unlike: exact under double clicks, two
 *   tabs and concurrent likers, and it never resets other fields.
 * - Other comment fields (replies count, heart, edit, pin, delete) change on
 *   the fresh comment with a conditional write.
 */
import type { PostComment } from '@al-ummah/shared-types';
import R2Repository, { casBackoff, ConcurrentUpdateError, DEFAULT_CAS_ATTEMPTS } from './r2Repo';

interface CommentIndex {
	postId: string;
	commentIds: string[];
	lastUpdated: string;
}

/** Adds `commentId` to an index (newest first for top-level, oldest first for replies). */
export async function addToCommentIndex(
	bucket: R2Bucket,
	indexKey: string,
	postId: string,
	commentId: string,
	at: 'start' | 'end',
): Promise<void> {
	await new R2Repository<CommentIndex>(bucket).updateObject(
		indexKey,
		(index) => {
			if (index.commentIds.includes(commentId)) return false;
			if (at === 'start') index.commentIds.unshift(commentId);
			else index.commentIds.push(commentId);
			index.lastUpdated = new Date().toISOString();
			return true;
		},
		{ initial: () => ({ postId, commentIds: [], lastUpdated: new Date().toISOString() }) },
	);
}

/** Removes `commentId` from an index, if it is there. */
export async function removeFromCommentIndex(bucket: R2Bucket, indexKey: string, commentId: string): Promise<void> {
	await new R2Repository<CommentIndex>(bucket).updateObject(indexKey, (index) => {
		if (!index.commentIds.includes(commentId)) return false;
		index.commentIds = index.commentIds.filter((id) => id !== commentId);
		index.lastUpdated = new Date().toISOString();
		return true;
	});
}

/** Number of like records of a comment (one per user). */
export async function countCommentLikes(bucket: R2Bucket, postId: string, commentId: string): Promise<number> {
	let count = 0;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: `comment-likes/${postId}/${commentId}/`, cursor });
		count += page.objects.length;
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return count;
}

/**
 * Stores the comment's like total, recounted from the like records on every
 * attempt (after reading the comment), so a write that lands is never older
 * than the copy it replaces. Resolves to the total, or null when the comment
 * is gone.
 */
export async function recountCommentLikes(bucket: R2Bucket, postId: string, commentId: string, commentKey: string): Promise<number | null> {
	for (let attempt = 1; attempt <= DEFAULT_CAS_ATTEMPTS; attempt++) {
		const object = await bucket.get(commentKey);
		if (!object) return null;
		const comment = await object.json<PostComment>();
		// Counted after reading the comment: whatever lands is at least as new
		const total = await countCommentLikes(bucket, postId, commentId);
		if (comment.likes === total) return total;
		comment.likes = total;
		const written = await bucket.put(commentKey, JSON.stringify(comment), {
			httpMetadata: { contentType: 'application/json' },
			onlyIf: { etagMatches: object.etag },
		});
		if (written) return total;
		if (attempt < DEFAULT_CAS_ATTEMPTS) await casBackoff(attempt);
	}
	throw new ConcurrentUpdateError(commentKey, DEFAULT_CAS_ATTEMPTS);
}

/** Changes the fresh comment with a conditional write (never re-creates a deleted one). */
export function patchComment<E>(
	bucket: R2Bucket,
	commentKey: string,
	mutate: (comment: PostComment) => { reject: E } | boolean | void,
): Promise<{ data: PostComment | null; rejected?: E }> {
	return new R2Repository<PostComment>(bucket).updateObjectOrReject<E>(commentKey, mutate);
}
