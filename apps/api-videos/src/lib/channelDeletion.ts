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

import { sectionOrderKey } from './channelSectionOrder';
import R2Repository from './r2Repo';
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
				if (await softDeleteIfOwned(bucket, object.key, channelId, now)) removed++;
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

/**
 * Soft-deletes one stored object when it belongs to the channel (true when it
 * did). Conditional write (SCALABILITY-AUDIT AV-3/AV-23): a concurrent edit,
 * comment or view flush is re-read, and cannot undo the soft delete. Throws
 * when the write fails.
 */
async function softDeleteIfOwned(bucket: R2Bucket, key: string, channelId: string, now: string): Promise<boolean> {
	let marked = false;
	await new R2Repository<Record<string, unknown>>(bucket).updateObject(key, (record) => {
		marked = false;
		if (!record || record.channelId !== channelId || record.isDeleted === true) return false;
		Object.assign(record, { isDeleted: true, deletedAt: now, markedForDeletion: true, markedForDeletionAt: now });
		marked = true;
		return true;
	});
	return marked;
}

/**
 * Deletes one stored object when it belongs to the channel (the admin purge,
 * lib/admin/deletions.ts). Idempotent: an object already gone counts as done.
 */
async function hardDeleteIfOwned(bucket: R2Bucket, key: string, channelId: string): Promise<boolean> {
	const record = await new R2Repository<Record<string, unknown>>(bucket).getObject(key);
	if (!record || record.channelId !== channelId) return false;
	await bucket.delete(key);
	return true;
}

/** Posts, sections and the section order of a deleted channel (prefix deletes, no scan). */
export async function removeChannelPostsAndSections(
	env: Pick<ContentBuckets, 'community_posts' | 'channel_sections'>,
	channelId: string,
): Promise<{ posts: number; sections: number }> {
	const posts = await deletePrefix(env.community_posts, `posts/${channelId}/`);
	const sections = await deletePrefix(env.channel_sections, `${channelId}/`);
	await env.channel_sections?.delete(sectionOrderKey(channelId));
	return { posts, sections };
}

/**
 * One bounded step of soft-deleting (or, `hard`, deleting) a channel's objects in a bucket with no
 * per-channel index (playlists): scans at most `budget` objects from `cursor`,
 * `concurrency` reads at a time. The returned `cursor` is where the next step
 * starts (absent once the scan reached the end); `failed` counts writes that
 * failed, so the caller can retry the step (every write here is idempotent).
 */
export async function softDeleteChannelObjectsStep(
	bucket: R2Bucket,
	channelId: string,
	opts: { cursor?: string; budget?: number; concurrency?: number; now?: string; hard?: boolean } = {},
): Promise<{ removed: number; failed: number; scanned: number; cursor?: string }> {
	const budget = opts.budget ?? 500;
	const concurrency = opts.concurrency ?? 16;
	const now = opts.now ?? new Date().toISOString();
	let cursor = opts.cursor;
	let scanned = 0;
	let removed = 0;
	let failed = 0;
	do {
		// Never list past the budget: the list cursor then marks exactly where this step stopped
		const page = await bucket.list({ limit: Math.min(100, budget - scanned), cursor });
		scanned += page.objects.length;
		const keys = page.objects.map((o) => o.key).filter((k) => !k.startsWith('index:'));
		let next = 0;
		await Promise.all(
			Array.from({ length: Math.min(concurrency, keys.length) }, async () => {
				while (next < keys.length) {
					const key = keys[next++];
					try {
						if (await (opts.hard ? hardDeleteIfOwned(bucket, key, channelId) : softDeleteIfOwned(bucket, key, channelId, now))) removed++;
					} catch (error) {
						failed++;
						logger.warn('[ChannelDeletion] Could not soft-delete object', { key, channelId, error: error instanceof Error ? error.message : String(error) });
					}
				}
			}),
		);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor && scanned < budget);
	return { removed, failed, scanned, cursor };
}

/** Remove a deleted channel's content (bounded scan of videos + playlists). */
export async function removeChannelContent(env: ContentBuckets, channelId: string, maxObjects = 5000): Promise<ChannelContentRemoval> {
	const now = new Date().toISOString();
	const counter = { scanned: 0 };
	const videos = await softDeleteMatching(env.videos, channelId, maxObjects, now, counter);
	const playlists = await softDeleteMatching(env.playlists, channelId, maxObjects * 2, now, counter);
	const { posts, sections } = await removeChannelPostsAndSections(env, channelId);
	const result = { videos, playlists, posts, sections, scanned: counter.scanned };
	logger.info('[ChannelDeletion] Channel content removed', { channelId, ...result });
	return result;
}
