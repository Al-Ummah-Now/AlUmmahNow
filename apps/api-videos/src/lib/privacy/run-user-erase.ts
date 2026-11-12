/**
 * Cheap erasure of an E2E run account (QA/stage only; #887).
 *
 * The full erasure (./user-data.ts eraseUserData) scans whole buckets to find
 * everything a user ever touched. With hundreds of run accounts a day that
 * clogged the admin-jobs queue for hours (QA 2026-11-11: 712 erasures, each a
 * scan of ~50k objects). A run account only owns what its run created, so this
 * erasure finds it through the indexes instead:
 *
 *   ownership index (content_ownership, deleted rows included): its channels,
 *     and the videos it owns or that sit on those channels
 *   search_playlists: playlists on those channels
 *   keyed prefixes: watch_history/{userId}:, upload-defaults/{userId}/,
 *     channel_sections/{channelId}/, community posts/{channelId}/
 *   NOTIFICATIONS_DB subscriptions, then the profile
 *   (hooks remove Bunny media and the channels' and profile's collections)
 *
 * Not covered, by design (run accounts only): reactions and comments on
 * content the account did not own, reports it filed, and posts or playlists
 * outside its channels. Real users always go through eraseUserData.
 *
 * Every step is idempotent. `step` (the job's params) says where to resume
 * when the operation budget runs out. When the index is incomplete the step
 * throws, so the job is retried with backoff rather than falling back to a scan.
 */
import { defaultPointerPrefix } from '../uploadDefaultPointer';
import { sectionOrderKey } from '../channelSectionOrder';
import { eraseUserSubscriptions } from '../subscription-store';
import { isOwnershipComplete } from '../search/ownership';
import { BudgetExhausted, OperationBudget, asBucket, deleteKeys, readJson, type BucketLike } from './scan';
import type { ErasureHooks, PrivacyBuckets } from './user-data';

type Json = Record<string, any>;

/** The run-user sweep's actor (lib/e2e/runUserSweep.ts): its deletions take this erasure. */
export const RUN_USER_SWEEP_ACTOR = 'e2e-run-sweep';

export interface RunUserEraseEnv extends PrivacyBuckets {
	SEARCH_DB?: D1Database;
}

export interface RunUserEraseResult {
	complete: boolean;
	/** Step to resume from when incomplete */
	step: number;
	deletedVideoIds: string[];
	deleted: Record<string, number>;
}

export class OwnershipIndexIncomplete extends Error {
	constructor() {
		super('The ownership index is incomplete; retrying instead of scanning the buckets');
		this.name = 'OwnershipIndexIncomplete';
	}
}

async function prefixKeys(bucket: BucketLike, prefix: string, budget: OperationBudget): Promise<string[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		budget.spend();
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		keys.push(...page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return keys;
}

/** The account's channels and the videos it owns or that sit on them, from the ownership index. */
export async function runUserOwnedIds(db: D1Database, userId: string): Promise<{ channels: string[]; videos: string[] }> {
	if (!(await isOwnershipComplete(db as never, 'channel')) || !(await isOwnershipComplete(db as never, 'video'))) {
		throw new OwnershipIndexIncomplete();
	}
	// Deleted rows included: a run's videos are usually soft-deleted (in the trash) by then
	const { results: ch } = await db
		.prepare(`SELECT id FROM content_ownership WHERE kind = 'channel' AND owner_id = ?`)
		.bind(userId)
		.all<{ id: string }>();
	const channels = (ch ?? []).map((r) => r.id);
	const { results: v } = await db
		.prepare(
			`SELECT id FROM content_ownership WHERE kind = 'video' AND (owner_id = ?${channels.length ? ` OR channel_id IN (${channels.map(() => '?').join(', ')})` : ''})`,
		)
		.bind(userId, ...channels)
		.all<{ id: string }>();
	return { channels, videos: (v ?? []).map((r) => r.id) };
}

export async function eraseRunUserData(
	env: RunUserEraseEnv,
	userId: string,
	budget: OperationBudget,
	hooks: ErasureHooks = {},
	startStep = 0,
): Promise<RunUserEraseResult> {
	const db = env.SEARCH_DB;
	if (!db) throw new Error('SEARCH_DB is not bound');
	const result: RunUserEraseResult = { complete: false, step: startStep, deletedVideoIds: [], deleted: {} };
	const bump = (key: string, by: number) => {
		if (by > 0) result.deleted[key] = (result.deleted[key] ?? 0) + by;
	};
	const { channels, videos } = await runUserOwnedIds(db, userId);
	const community = asBucket(env.community_posts);

	const steps: Array<() => Promise<void>> = [
		async () => bump('watchHistory', await deleteKeys(asBucket(env.watch_history), await prefixKeys(asBucket(env.watch_history), `${userId}:`, budget), budget)),
		async () => {
			const defaults = asBucket(env['upload-defaults']);
			bump('uploadDefaults', await deleteKeys(defaults, await prefixKeys(defaults, `${userId}/`, budget), budget));
			await deleteKeys(defaults, await prefixKeys(defaults, defaultPointerPrefix(userId), budget), budget);
		},
		// Videos (subtitles, streaming media through the hook, then the record)
		async () => {
			const bucket = asBucket(env.videos);
			for (const videoId of videos) {
				if (env.subtitles) {
					const subtitles = asBucket(env.subtitles);
					bump('subtitles', await deleteKeys(subtitles, await prefixKeys(subtitles, `${videoId}/`, budget), budget));
				}
				budget.spend();
				const stored = await bucket.get(videoId);
				if (!stored) continue;
				// The record names the Bunny library the media lives in
				const record = await stored.json<Record<string, unknown>>().catch(() => undefined);
				if (hooks.onVideoDeleted) await hooks.onVideoDeleted(videoId, record as never);
				await deleteKeys(bucket, [videoId], budget);
				result.deletedVideoIds.push(videoId);
				bump('videos', 1);
			}
		},
		// Community posts of its channels with their subtrees
		async () => {
			for (const channelId of channels) {
				for (const key of await prefixKeys(community, `posts/${channelId}/`, budget)) {
					const file = key.split('/')[2];
					if (file && file !== 'index.json') {
						const postId = file.replace(/\.json$/, '');
						for (const prefix of [`comments/${postId}/`, `likes/${postId}/`, `votes/${postId}/`, `comment-likes/${postId}/`]) {
							await deleteKeys(community, await prefixKeys(community, prefix, budget), budget);
						}
						bump('communityPosts', 1);
					}
					await deleteKeys(community, [key], budget);
				}
			}
		},
		// Playlists on its channels (search_playlists knows their channel)
		async () => {
			if (!channels.length) return;
			const { results } = await db
				.prepare(`SELECT id FROM search_playlists WHERE channel_id IN (${channels.map(() => '?').join(', ')})`)
				.bind(...channels)
				.all<{ id: string }>();
			bump('playlists', await deleteKeys(asBucket(env.playlists), (results ?? []).map((r) => r.id), budget));
		},
		// Channel sections, tabs and @handles, then the channels
		async () => {
			const channelsBucket = asBucket(env.channels);
			const sections = asBucket(env.channel_sections);
			const tabs = asBucket(env.channel_tabs);
			for (const channelId of channels) {
				bump('channelSections', await deleteKeys(sections, await prefixKeys(sections, `${channelId}/`, budget), budget));
				await deleteKeys(sections, [sectionOrderKey(channelId)], budget);
				await deleteKeys(tabs, [`channel-tabs/${channelId}`], budget);
				const channel = await readJson<Json>(channelsBucket, channelId, budget);
				if (channel && typeof channel.handle === 'string' && channel.handle) {
					const handleKey = `channel-handles/${channel.handle.toLowerCase()}`;
					const entry = await readJson<Json>(tabs, handleKey, budget);
					if (entry?.channelId === channelId) await deleteKeys(tabs, [handleKey], budget);
				}
				// Its Bunny collections (lib/channelCollection.ts) go with the record
				if (channel && hooks.onChannelDeleted) await hooks.onChannelDeleted(channelId, channel);
				bump('channels', await deleteKeys(channelsBucket, [channelId], budget));
			}
		},
		// Subscriptions (D1), then the profile last
		async () => {
			if (env.NOTIFICATIONS_DB) {
				budget.spend();
				bump('subscriptions', await eraseUserSubscriptions(env.NOTIFICATIONS_DB, userId));
			}
			budget.spend();
			const profiles = asBucket(env.profiles);
			const stored = await profiles.get(userId);
			if (stored) {
				if (hooks.onProfileDeleted) await hooks.onProfileDeleted(userId, await stored.json().catch(() => null));
				bump('profile', await deleteKeys(profiles, [userId], budget));
			}
		},
	];

	try {
		while (result.step < steps.length) {
			await steps[result.step]();
			result.step++;
		}
		result.complete = true;
	} catch (error) {
		if (!(error instanceof BudgetExhausted)) throw error;
	}
	return result;
}
