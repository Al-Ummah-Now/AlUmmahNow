/**
 * Index rows → Studio comments: the text, author and thread details come from
 * R2 (the source of truth), read once per video or post. A row whose comment
 * changed in R2 without the index hearing of it (a moderator's hold from
 * admin-api, a write that could not be indexed) is corrected here and left
 * out of a list it no longer belongs to.
 */
import type { CommunityPost, PostComment, SearchDb, StudioComment, StudioCommentTab } from '@al-ummah/shared-types';
import { logger } from '../logger';
import { findStoredComment, isCommentVisible, type StoredComment } from '../comments';
import { resolveCommentAuthors } from '../commentAuthors';
import { channelNamesByIds } from '../channelNames';
import { projectPostComment, projectVideoComments, syncVideoCommentRows, writePostRow, type ChannelCommentRow } from './index';

export interface HydrateEnv {
	videos: R2Bucket;
	community_posts: R2Bucket;
	channels: R2Bucket;
	profiles: R2Bucket;
	SEARCH_DB?: unknown;
}

/** Whether a row (fresh from R2) belongs in a tab. */
export function rowInTab(row: Pick<ChannelCommentRow, 'status' | 'heldBy'>, tab: StudioCommentTab | null): boolean {
	if (!tab) return true;
	if (tab === 'inbox') return row.status === 'published';
	if (tab === 'held') return row.status === 'held' && row.heldBy !== 'channel_block';
	return row.status === 'removed';
}

function sameState(a: ChannelCommentRow | null, b: ChannelCommentRow): boolean {
	return !!a && a.status === b.status && a.heldBy === b.heldBy && a.removedAt === b.removedAt && a.hasLink === b.hasLink;
}

/** Plain text of a post (title, else its text without markup) for the target column. */
export function postTitle(post: Partial<CommunityPost> & { title?: unknown }): string {
	if (typeof post.title === 'string' && post.title.trim()) return post.title.trim();
	const text = (typeof post.content === 'string' ? post.content : '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

interface Loaded {
	row: ChannelCommentRow;
	fresh: ChannelCommentRow | null;
	text: string;
	title: string;
	titleLocalized?: Record<string, string>;
	urlPath: string;
	isPinned: boolean;
	isHearted: boolean;
	repliesCount: number;
	author: { userId: string; channelId: string | null };
	/** Post comments carry their author's name and avatar */
	storedAuthor?: { displayName: string; avatarUrl?: string };
}

async function loadVideoTarget(env: HydrateEnv, videoId: string, rows: ChannelCommentRow[]): Promise<Loaded[]> {
	const object = await env.videos.get(videoId);
	const video = object ? ((await object.json()) as { title?: string; titleLocalized?: Record<string, string>; channelId?: string; isDeleted?: boolean; comments?: StoredComment[] }) : null;
	const freshRows = new Map(projectVideoComments(videoId, video).map((r) => [r.commentId, r]));
	const out: Loaded[] = [];
	for (const row of rows) {
		const found = video ? findStoredComment(video.comments ?? [], row.commentId) : null;
		const comment = found?.comment;
		out.push({
			row,
			fresh: freshRows.get(row.commentId) ?? null,
			text: typeof comment?.text === 'string' ? comment.text : '',
			title: video?.title ?? '',
			...(video?.titleLocalized && typeof video.titleLocalized === 'object' ? { titleLocalized: video.titleLocalized } : {}),
			urlPath: `/video/${videoId}`,
			isPinned: comment?.isPinned === true,
			isHearted: comment?.isHearted === true,
			// Replies anyone can see (held ones are not counted)
			repliesCount: ((comment?.replies ?? []) as StoredComment[]).filter((r) => isCommentVisible(r)).length,
			author: { userId: comment?.userId ?? row.authorUserId, channelId: comment?.channelId ?? row.authorChannelId },
		});
	}
	return out;
}

async function loadPostTarget(env: HydrateEnv, channelId: string, postId: string, rows: ChannelCommentRow[]): Promise<Loaded[]> {
	const object = await env.community_posts.get(`posts/${channelId}/${postId}.json`);
	const post = object ? ((await object.json()) as CommunityPost) : null;
	const postGone = !post || (post.status as string) === 'deleted';
	return Promise.all(rows.map(async (row) => {
		const key = row.parentId ? `comments/${postId}/replies/${row.parentId}/${row.commentId}.json` : `comments/${postId}/top-level/${row.commentId}.json`;
		const stored = postGone ? null : await env.community_posts.get(key);
		const comment = stored ? ((await stored.json()) as PostComment) : null;
		return {
			row,
			fresh: comment ? projectPostComment(postId, channelId, comment) : null,
			text: comment?.content ?? '',
			title: post ? postTitle(post) : '',
			urlPath: `/post/${postId}`,
			isPinned: comment?.isPinned === true,
			isHearted: comment?.isHeartedByCreator === true,
			repliesCount: comment?.repliesCount ?? 0,
			author: { userId: comment?.userId ?? row.authorUserId, channelId: row.authorChannelId },
			storedAuthor: comment ? { displayName: comment.userDisplayName || '', ...(comment.userAvatarUrl ? { avatarUrl: comment.userAvatarUrl } : {}) } : undefined,
		};
	}));
}

/**
 * Turns rows into Studio comments, in the rows' order. With `tab`, rows whose
 * comment no longer belongs there are left out (and their index row fixed).
 */
export async function hydrateRows(env: HydrateEnv, rows: ChannelCommentRow[], tab: StudioCommentTab | null): Promise<StudioComment[]> {
	const byTarget = new Map<string, ChannelCommentRow[]>();
	for (const row of rows) {
		const key = `${row.targetKind}:${row.channelId}:${row.targetId}`;
		const list = byTarget.get(key) ?? [];
		list.push(row);
		byTarget.set(key, list);
	}
	const loaded = (await Promise.all([...byTarget.values()].map((group) => {
		const first = group[0];
		return first.targetKind === 'video' ? loadVideoTarget(env, first.targetId, group) : loadPostTarget(env, first.channelId, first.targetId, group);
	}))).flat();

	await repairRows(env, loaded);

	const kept = loaded.filter((l) => l.fresh && rowInTab(l.fresh, tab));
	// Post comments posted as a person: their current names, per language (#1618)
	const postAsPerson = (l: Loaded) => !!l.storedAuthor && (!l.author.channelId || l.author.channelId === l.author.userId);
	const authorOf = await resolveCommentAuthors(env, [
		...kept.filter((l) => !l.storedAuthor).map((l) => l.author),
		...kept.filter(postAsPerson).map((l) => ({ userId: l.author.userId, channelId: null })),
		// Who removed a comment: their own name (never a channel)
		...kept.filter((l) => l.fresh?.removedByUserId).map((l) => ({ userId: l.fresh!.removedByUserId!, channelId: null })),
	]);
	// Post comments carry the name stored when written: the channel's current names win, per language (#1610)
	const postChannelNames = await channelNamesByIds(env.channels, kept.filter((l) => l.storedAuthor && !postAsPerson(l)).map((l) => l.author.channelId));
	const order = new Map(rows.map((r, i) => [r.commentId, i]));
	return kept
		.sort((a, b) => (order.get(a.row.commentId) ?? 0) - (order.get(b.row.commentId) ?? 0))
		.map((l) => {
			const fresh = l.fresh!;
			const resolved = l.storedAuthor ? null : authorOf(l.author);
			const person = postAsPerson(l) ? authorOf({ userId: l.author.userId, channelId: null }) : null;
			const named = person?.displayName
				? { channelName: person.displayName, channelNameLocalized: person.displayNameLocalized }
				: l.storedAuthor && l.author.channelId ? postChannelNames.get(l.author.channelId) : undefined;
			const author = l.storedAuthor
				? {
					userId: l.author.userId,
					channelId: l.author.channelId,
					displayName: named?.channelName || l.storedAuthor.displayName,
					...(named?.channelNameLocalized ? { displayNameLocalized: named.channelNameLocalized } : {}),
					...(l.storedAuthor.avatarUrl ? { avatarUrl: l.storedAuthor.avatarUrl } : {}),
				}
				: {
					userId: resolved!.userId,
					channelId: resolved!.channelId,
					displayName: resolved!.displayName,
					...(resolved!.displayNameLocalized ? { displayNameLocalized: resolved!.displayNameLocalized } : {}),
					...(resolved!.avatarUrl ? { avatarUrl: resolved!.avatarUrl } : {}),
				};
			const item: StudioComment = {
				id: fresh.commentId,
				kind: fresh.targetKind,
				targetId: fresh.targetId,
				targetTitle: l.title,
				...(l.titleLocalized ? { targetTitleLocalized: l.titleLocalized } : {}),
				targetUrlPath: l.urlPath,
				parentId: fresh.parentId,
				text: l.text,
				createdAt: fresh.createdAt,
				author,
				status: fresh.status,
				...(fresh.heldBy ? { heldBy: fresh.heldBy } : {}),
				isPinned: l.isPinned,
				isHearted: l.isHearted,
				repliesCount: l.repliesCount,
				hasChannelReply: l.row.hasChannelReply,
			};
			if (fresh.status === 'removed') {
				if (fresh.removedAt) item.removedAt = fresh.removedAt;
				if (fresh.removedByUserId) item.removedBy = { userId: fresh.removedByUserId, displayName: authorOf({ userId: fresh.removedByUserId, channelId: null }).displayName };
			}
			return item;
		});
}

/** Rows that disagree with R2 are rewritten (or dropped) from R2. Never throws. */
async function repairRows(env: HydrateEnv, loaded: Loaded[]): Promise<void> {
	const db = env.SEARCH_DB as SearchDb | undefined;
	if (!db) return;
	const stale = loaded.filter((l) => !sameState(l.fresh, l.row));
	if (!stale.length) return;
	const videos = new Set<string>();
	for (const l of stale) {
		try {
			if (l.row.targetKind === 'video') {
				if (videos.has(l.row.targetId)) continue;
				videos.add(l.row.targetId);
				const object = await env.videos.get(l.row.targetId);
				await syncVideoCommentRows(db, l.row.targetId, object ? await object.json() : null, { force: true });
			} else {
				await writePostRow(db, l.row.commentId, l.row.parentId, l.fresh);
			}
		} catch (error) {
			logger.warn('[ChannelComments] Could not repair an index row', { commentId: l.row.commentId, targetId: l.row.targetId, error: error instanceof Error ? error.message : String(error) });
		}
	}
}
