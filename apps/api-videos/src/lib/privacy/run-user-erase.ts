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
 *   privacy_footprints: its playlists without a channel (Watch later, personal playlists)
 *   NOTIFICATIONS_DB subscriptions, its footprints, channel-team invitations
 *   and activity rows (cancelled / anonymized), then the profile
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
import { eraseTierHistory } from '../tierChanges';
import { eraseCreatorTermsAcceptance } from '../creatorTerms';
import { postLocationKey } from '../community-posts';
import { eraseChannelHandleHistory } from './handle-history';
import { defaultPointerPrefix } from '../uploadDefaultPointer';
import { deleteVideoSideRecords } from '../videoSideRecords';
import { isSystemPlaylist, watchLaterId } from '../library';
import { footprintTargets, forgetFootprints } from './footprints';
import { eraseCaptionMinutes } from '../captions/minutes';
import { eraseYoutubeImports } from '../youtube-import/erase';
import { eraseLiveSessionOwner } from '../live/store';
import { sectionOrderKey } from '../channelSectionOrder';
import { eraseUserSubscriptions } from '../subscription-store';
import { isOwnershipComplete } from '../search/ownership';
import { BudgetExhausted, OperationBudget, asBucket, deleteKeys, readJson, type BucketLike } from './scan';
import { DELETED_USER_ID, type ErasureHooks, type PrivacyBuckets } from './user-data';
import { anonymizeTeamActivity, cancelInvitesOfUser } from '../channelTeam';
import { eraseMoveOffers } from '../channelMoveData';
import { eraseImageOwners } from '../csam/imageOwners';
import { eraseProfileEmailReports } from '../admin/profile-email-reports';
import { ADMIN_BACKUPS_UNBOUND_ERROR, eraseLegacyRestoreBackups } from '../admin/legacy-restore';
import { logger } from '../logger';

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
	/** Non-fatal gaps recorded when a required binding was absent (e.g. ADMIN_BACKUPS unbound). */
	errors?: string[];
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

type IndexedVideo = { id: string; owner_id: string | null; channel_id: string | null };

/** Candidate channels and videos, to be checked against the stored records in each erasure step. */
export async function runUserOwnedIds(db: D1Database, userId: string, received: string[] = []): Promise<{ channels: string[]; videos: IndexedVideo[] }> {
	if (!(await isOwnershipComplete(db as never, 'channel')) || !(await isOwnershipComplete(db as never, 'video'))) {
		throw new OwnershipIndexIncomplete();
	}
	// Deleted rows included: a run's videos are usually soft-deleted (in the trash) by then
	const { results: ch } = await db
		.prepare(`SELECT id FROM content_ownership WHERE kind = 'channel' AND owner_id = ?`)
		.bind(userId)
		.all<{ id: string }>();
	const channels = [...new Set([...(ch ?? []).map((r) => r.id), ...received])];
	// Two index searches joined with UNION ALL (deduplicated below), not `owner_id = ? OR channel_id IN (...)`:
	// SQLite does not use the (kind, owner_id) and (kind, channel_id) indexes for an OR under
	// `kind = 'video'` (nor for a plain UNION, which merges in id order), so it read every video
	// (~7.6k rows per erased account on QA, 31M rows on 2026-11-13).
	const { results: v } = await db
		.prepare(
			`SELECT id, owner_id, channel_id FROM content_ownership WHERE kind = 'video' AND owner_id = ?${channels.length ? ` UNION ALL SELECT id, owner_id, channel_id FROM content_ownership WHERE kind = 'video' AND channel_id IN (${channels.map(() => '?').join(', ')})` : ''}`,
		)
		.bind(userId, ...channels)
		.all<IndexedVideo>();
	return { channels, videos: [...new Map((v ?? []).map(row => [row.id, row])).values()] };
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
	// Its moves stop before its channels are listed (lib/channelMoveData.ts)
	const moves = { SEARCH_DB: db, channels: env.channels };
	const spend = (n: number) => budget.spend(n);
	let received: string[];
	try {
		({ received } = await eraseMoveOffers(moves, userId, DELETED_USER_ID, spend));
	} catch (error) {
		if (!(error instanceof BudgetExhausted)) throw error;
		return result;
	}
	// And what a move just brought, in case the index has not followed yet
	const { channels, videos } = await runUserOwnedIds(db, userId, received);
	const community = asBucket(env.community_posts);
	const channelsBucket = asBucket(env.channels);
	const readChannel = async (channelId: string) => {
		budget.spend();
		const stored = await channelsBucket.get(channelId);
		// Let a read or parse failure retry the job. Only a missing object can use a fallback.
		return stored ? (await stored.json<Json>()) ?? {} : null;
	};
	let again = false;

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
			const channelRecords = new Map<string, Json | null>();
			for (const candidate of videos) {
				const videoId = candidate.id;
				budget.spend();
				const stored = await bucket.get(videoId);
				// The record names the Bunny library and the channel the video actually sits on.
				// The index supplies the channel only when retrying cleanup after the record is gone.
				const record = stored ? (await stored.json<Json>()) ?? {} : undefined;
				const channelId = record ? record.channelId : candidate.channel_id;
				const recordOwner = record ? record.userId : candidate.owner_id;
				let channel: Json | null | undefined;
				if (typeof channelId === 'string' && channelId) {
					if (!channelRecords.has(channelId)) channelRecords.set(channelId, await readChannel(channelId));
					channel = channelRecords.get(channelId);
				}
				if ((channel ? channel.userId : recordOwner) !== userId) continue;
				if (stored) {
					// Under an open takedown case: its own job copies the evidence, then deletes the record (lib/csam/contain.ts)
					if (record?.csamTakedown) continue;
					// Nothing of it goes before its media is written down, and the record is first: what follows is the job's too
					if (hooks.onVideoDeleted) {
						budget.reserve(2);
						await hooks.onVideoDeleted(videoId, record as never);
						if (record && (await readJson<Json>(bucket, videoId, budget))?.csamTakedown) continue;
					}
					await deleteKeys(bucket, [videoId], budget);
					result.deletedVideoIds.push(videoId);
					bump('videos', 1);
				}
				if (env.subtitles) {
					const subtitles = asBucket(env.subtitles);
					bump('subtitles', await deleteKeys(subtitles, await prefixKeys(subtitles, `${videoId}/`, budget), budget));
				}
				// The scheduler entry and upload marker name the user too (lib/videoSideRecords.ts)
				if (stored) await deleteVideoSideRecords({ global_settings: env.global_settings, SCHEDULED_VIDEOS: env.SCHEDULED_VIDEOS ?? env['scheduled-videos'] }, videoId, record);
			}
		},
		// Community posts of its channels with their subtrees
		async () => {
			for (const channelId of channels) {
				if ((await readChannel(channelId))?.userId !== userId) continue;
				for (const key of await prefixKeys(community, `posts/${channelId}/`, budget)) {
					const file = key.split('/')[2];
					if (file && file !== 'index.json') {
						// Under an open takedown case: its own job deletes it
						const post = await readJson<Json>(community, key, budget);
						if (post?.csamTakedown) continue;
						const postId = file.replace(/\.json$/, '');
						if (hooks.onPostDeleted) await hooks.onPostDeleted(channelId, postId, post);
						for (const prefix of [`comments/${postId}/`, `likes/${postId}/`, `votes/${postId}/`, `comment-likes/${postId}/`]) {
							await deleteKeys(community, await prefixKeys(community, prefix, budget), budget);
						}
						bump('communityPosts', 1);
					}
					// A post goes with its location record (lib/community-posts.ts) in one delete
					const located = file && file !== 'index.json' ? [postLocationKey(file.replace(/\.json$/, ''))] : [];
					await deleteKeys(community, [key, ...located], budget);
				}
			}
		},
		// Playlists on its channels (search_playlists knows their channel)
		async () => {
			const owned: string[] = [];
			for (const channelId of channels) {
				if ((await readChannel(channelId))?.userId === userId) owned.push(channelId);
			}
			if (!owned.length) return;
			const { results } = await db
				.prepare(`SELECT id FROM search_playlists WHERE channel_id IN (${owned.map(() => '?').join(', ')})`)
				.bind(...owned)
				.all<{ id: string }>();
			bump('playlists', await deleteKeys(asBucket(env.playlists), (results ?? []).map((r) => r.id), budget));
		},
		// Its playlists without a channel (Watch later, personal playlists, #1183): the footprints name
		// them; only the account's own are deleted
		async () => {
			const playlists = asBucket(env.playlists);
			budget.spend();
			const named = await footprintTargets(db as never, userId, 'playlist');
			const mine: string[] = [];
			for (const key of new Set([...named, watchLaterId(userId)])) {
				const playlist = await readJson<Json>(playlists, key, budget);
				if (playlist?.userId === userId && (!playlist.channelId || playlist.channelId === userId || isSystemPlaylist(playlist))) mine.push(key);
			}
			bump('playlists', await deleteKeys(playlists, mine, budget));
		},
		// Channel sections, tabs and @handles, then the channels
		async () => {
			const sections = asBucket(env.channel_sections);
			const tabs = asBucket(env.channel_tabs);
			for (const channelId of channels) {
				const channel = await readChannel(channelId);
				if (channel?.userId !== userId) continue;
				bump('channelSections', await deleteKeys(sections, await prefixKeys(sections, `${channelId}/`, budget), budget));
				await deleteKeys(sections, [sectionOrderKey(channelId)], budget);
				await deleteKeys(tabs, [`channel-tabs/${channelId}`], budget);
				if (typeof channel.handle === 'string' && channel.handle) {
					const handleKey = `channel-handles/${channel.handle.toLowerCase()}`;
					const entry = await readJson<Json>(tabs, handleKey, budget);
					if (entry?.channelId === channelId) await deleteKeys(tabs, [handleKey], budget);
				}
				// Its old handles (handle history) stop redirecting to it
				await eraseChannelHandleHistory(tabs, channelId, budget);
				// Its Bunny collections (lib/channelCollection.ts) go with the record
				if (hooks.onChannelDeleted) await hooks.onChannelDeleted(channelId, channel);
				bump('channels', await deleteKeys(channelsBucket, [channelId], budget));
			}
		},
		// Subscriptions (D1), then the profile last
		async () => {
			if (env.NOTIFICATIONS_DB) {
				budget.spend();
				bump('subscriptions', await eraseUserSubscriptions(env.NOTIFICATIONS_DB, userId));
			}
			// The footprints point at nothing of the account's any more
			budget.spend(3);
			await forgetFootprints(db as never, userId);
			await eraseCaptionMinutes(db, userId);
			// Tier requests (name, about), tier changes, and creator Terms acceptance
			await eraseTierHistory(db as unknown as D1Database, userId);
			await eraseCreatorTermsAcceptance(db as unknown as D1Database, userId);
			// Move from YouTube: imports, snapshots, consents, staged captions (Google token revoked)
			budget.spend(2);
			await eraseYoutubeImports(db, env as never, userId);
			// Channel teams: invitations to or from the account are cancelled, its id
			// leaves the activity log and closed invitations (as in eraseUserData)
			budget.spend(2);
			await cancelInvitesOfUser(db, userId);
			await anonymizeTeamActivity(db, userId, DELETED_USER_ID);
			// Their live sessions' tier owner (search migration 0060), as the full erasure does
			budget.spend();
			await eraseLiveSessionOwner(db, userId);
			budget.spend();
			const profiles = asBucket(env.profiles);
			const stored = await profiles.get(userId);
			if (stored) {
				const storedProfile = await stored.json<Json>().catch(() => null);
				// Free the user's @handle (public profile, lib/userHandles.ts) if the index entry is theirs
				if (storedProfile && typeof storedProfile.handle === 'string' && storedProfile.handle) {
					const tabs = asBucket(env.channel_tabs);
					const handleKey = `channel-handles/${storedProfile.handle.toLowerCase()}`;
					const entry = await readJson<Json>(tabs, handleKey, budget);
					if (entry?.kind === 'user' && entry.userId === userId && !entry.channelId) await deleteKeys(tabs, [handleKey], budget);
				}
				if (hooks.onProfileDeleted) await hooks.onProfileDeleted(userId, storedProfile);
				bump('profile', await deleteKeys(profiles, [userId], budget));
			}
			// Profile email reports and legacy profile restore copies, as the full erasure does (after the profile)
			if (env.ADMIN_BACKUPS) {
				const backups = asBucket(env.ADMIN_BACKUPS);
				bump('profileEmailReports', await eraseProfileEmailReports(backups, userId, budget));
				bump('legacyRestoreBackups', await eraseLegacyRestoreBackups(backups, userId, budget));
			} else {
				logger.warn('[Privacy] ADMIN_BACKUPS is not bound; skipped legacy-restore backup erasure', { userId });
				result.errors = [...(result.errors ?? []), ADMIN_BACKUPS_UNBOUND_ERROR];
			}
			// Who uploaded which image (lib/csam/imageOwners.ts); CSAM evidence is never erased here
			budget.spend();
			await eraseImageOwners(db, userId);
		},
		// Again after the profile, as the full erasure does: a channel a move brought meanwhile starts the steps over
		async () => {
			const late = await eraseMoveOffers(moves, userId, DELETED_USER_ID, spend);
			again = late.received.length > 0;
			// A move that finished its records as the profile went may have brought the channel's subscriptions (runTransfer)
			if (again || !env.NOTIFICATIONS_DB) return;
			spend(1);
			bump('subscriptions', await eraseUserSubscriptions(env.NOTIFICATIONS_DB, userId));
		},
	];

	try {
		while (result.step < steps.length) {
			await steps[result.step]();
			// The next pass lists its channels again
			if (again) return { ...result, step: 0 };
			result.step++;
		}
		result.complete = true;
	} catch (error) {
		if (!(error instanceof BudgetExhausted)) throw error;
	}
	return result;
}
