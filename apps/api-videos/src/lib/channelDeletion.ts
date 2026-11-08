/**
 * Channel deletion helpers.
 *
 * Main-channel rule: a user's main channel can be deleted. When the user has
 * other channels, one of them becomes the main channel: the one named by the
 * caller (`newMainChannelId`), otherwise the oldest remaining channel. When it
 * is the user's only channel the user is simply left without channels (a
 * supported state: they can browse and create a channel again).
 *
 * Content removal: the channel's videos and playlists are soft-deleted
 * (isDeleted + markedForDeletion, so they disappear everywhere at once and the
 * retention sweep can purge media later) and its community posts are deleted.
 * These buckets have no per-channel index, so the scan is bounded per run and
 * runs after the response (waitUntil).
 */

import { logger } from './logger';

export interface OwnedChannelSummary {
	id: string;
	userId: string;
	isMain?: boolean;
	isDeleted?: boolean;
	dateCreated?: string;
}

/** Pick the channel that becomes main when `deletedId` (the current main) is removed. */
export function pickNewMainChannel<T extends OwnedChannelSummary>(owned: T[], deletedId: string, requestedId?: string | null): T | null {
	const remaining = owned.filter((ch) => ch.id !== deletedId && !ch.isDeleted);
	if (remaining.length === 0) return null;
	if (requestedId) {
		const requested = remaining.find((ch) => ch.id === requestedId);
		if (requested) return requested;
	}
	return remaining
		.slice()
		.sort((a, b) => new Date(a.dateCreated || 0).getTime() - new Date(b.dateCreated || 0).getTime())[0];
}

interface ContentBuckets {
	videos: R2Bucket;
	playlists: R2Bucket;
	community_posts: R2Bucket;
	channel_sections?: R2Bucket;
}

export interface ChannelContentRemoval {
	videos: number;
	playlists: number;
	posts: number;
	sections: number;
	scanned: number;
}

async function softDeleteMatching(bucket: R2Bucket, channelId: string, maxObjects: number, now: string, counter: { scanned: number }): Promise<number> {
	let removed = 0;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ limit: 100, cursor });
		for (const object of page.objects) {
			if (counter.scanned >= maxObjects) return removed;
			counter.scanned++;
			if (object.key.startsWith('index:')) continue;
			try {
				const stored = await bucket.get(object.key);
				const record = stored ? await stored.json<Record<string, unknown>>() : null;
				if (!record || record.channelId !== channelId || record.isDeleted === true) continue;
				await bucket.put(object.key, JSON.stringify({
					...record,
					isDeleted: true,
					deletedAt: now,
					markedForDeletion: true,
					markedForDeletionAt: now,
				}), { httpMetadata: { contentType: 'application/json' } });
				removed++;
			} catch (error) {
				logger.warn('[ChannelDeletion] Could not soft-delete object', { key: object.key, channelId, error: error instanceof Error ? error.message : String(error) });
			}
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return removed;
}

async function deletePrefix(bucket: R2Bucket | undefined, prefix: string): Promise<number> {
	if (!bucket) return 0;
	let removed = 0;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, limit: 500, cursor });
		const keys = page.objects.map((o) => o.key);
		if (keys.length > 0) {
			await bucket.delete(keys);
			removed += keys.length;
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return removed;
}

/** Remove a deleted channel's content (bounded scan of videos + playlists). */
export async function removeChannelContent(env: ContentBuckets, channelId: string, maxObjects = 5000): Promise<ChannelContentRemoval> {
	const now = new Date().toISOString();
	const counter = { scanned: 0 };
	const videos = await softDeleteMatching(env.videos, channelId, maxObjects, now, counter);
	const playlists = await softDeleteMatching(env.playlists, channelId, maxObjects * 2, now, counter);
	const posts = await deletePrefix(env.community_posts, `posts/${channelId}/`);
	const sections = await deletePrefix(env.channel_sections, `${channelId}/`);
	const result = { videos, playlists, posts, sections, scanned: counter.scanned };
	logger.info('[ChannelDeletion] Channel content removed', { channelId, ...result });
	return result;
}
