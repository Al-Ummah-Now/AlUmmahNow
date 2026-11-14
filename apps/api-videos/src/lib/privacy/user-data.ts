/**
 * GDPR data subject rights for api-videos (Story 1.3, AC 2).
 *
 * - collectUserData(): right of access / portability (Art. 15, 20). Gathers
 *   everything this API stores about a user across the R2 buckets.
 * - eraseUserData(): right to erasure (Art. 17). Deletes what belongs only to
 *   the user and anonymises what is part of other people's content (comments
 *   in their threads, reports needed for moderation history).
 *
 * The sign-in account (email, password, sessions) lives in the separate
 * AlUmmahNowAuth service and is not touched here.
 *
 * The export scans whole buckets. The erase finds the user's records through
 * the ownership index and the privacy footprints (./footprints.ts, #1073) when
 * those are complete, and scans a bucket only when its index is not.
 * Both run as a fixed sequence of phases over R2 list pages and stop when the
 * per-request operation budget is spent, returning a `resumeToken`; calling
 * again with that token continues from the same phase and page. Work inside a
 * page is idempotent, so re-running an interrupted page is safe.
 *
 * R2 layout reference (see docs/compliance/GDPR.md for the full inventory):
 *   profiles/{userId}                                  profile (+ legacy watchHistory, subscribedTo, privacyConsent)
 *   channels/{channelId}                               channel (owner: userId; subscriptions[] of others)
 *   channel_sections/{channelId}/{sectionId}           sections of a channel
 *   channel_tabs/channel-tabs/{channelId}              tab config of a channel
 *   videos/{videoId}                                   video (owner: userId; embeds comments, likes, dislikes)
 *   watch_history/{userId}:{videoId}                   watch history entry
 *   community_posts/posts/{channelId}/{postId}.json    post (+ likes/, votes/, comments/ (incl. reply-parents/ pointers), comment-likes/ trees)
 *   playlists/{playlistId}                             playlist (owner: userId)
 *   upload-defaults/{userId}/...                       upload templates
 *   reports/report:{entityId}:{reportId}:{reporterId}  reports filed by the user
 */

import { eraseUserSubscriptions, exportUserSubscriptions, subscriberChannelOf } from '../subscription-store';
import { getEmailSettings, getSeenAt, getSettings } from '../notifications';
import { defaultPointerPrefix } from '../uploadDefaultPointer';
import { deleteVideoSideRecords } from '../videoSideRecords';
import { sectionOrderKey } from '../channelSectionOrder';
import { BucketLike, BudgetExhausted, OperationBudget, asBucket, deleteKeys, readJson, updateJson, writeJson } from './scan';
import { isReportClaimOf, reportClaimKey } from '../report-claims';
import { isOwnershipComplete } from '../search/ownership';
import { logger } from '../logger';
import type { SearchDb } from '@al-ummah/shared-types';
import { footprintTargets, footprintsComplete, forgetFootprints } from './footprints';
import { eraseCaptionMinutes } from '../captions/minutes';

/** Tombstone written in place of a user id on content kept after erasure. */
export const DELETED_USER_ID = 'deleted-user';
export const DELETED_CHANNEL_ID = 'deleted-channel';

export const EXPORT_FORMAT_VERSION = 1;

/** Objects per list page. Small enough that one page's work fits in a request budget. */
export const DEFAULT_PAGE_SIZE = 100;

export interface PrivacyBuckets {
	profiles: unknown;
	channels: unknown;
	channel_sections: unknown;
	channel_tabs: unknown;
	videos: unknown;
	watch_history: unknown;
	community_posts: unknown;
	playlists: unknown;
	'upload-defaults': unknown;
	reports: unknown;
	subtitles?: unknown;
	/** Upload markers (ops/upload-reaper/created/<videoId>) and the scheduler's entries: lib/videoSideRecords.ts */
	global_settings?: unknown;
	SCHEDULED_VIDEOS?: unknown;
	'scheduled-videos'?: unknown;
	/** Channel subscriptions (lib/subscription-store.ts) */
	NOTIFICATIONS_DB?: D1Database;
	/** Ownership index and privacy footprints: the erase reads them instead of scanning (#1073) */
	SEARCH_DB?: unknown;
}

type Json = Record<string, any>;

interface Reaction {
	userId?: string;
	channelId?: string;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Resumable phase engine
// ---------------------------------------------------------------------------

interface Checkpoint {
	/** Format: 1 (export), 2 (erase since #1073). A token of another format starts over. */
	v?: number;
	/** Index of the phase to (re)start. */
	p: number;
	/** R2 list cursor of the page to (re)start within that phase. */
	c?: string;
	/** Channel ids owned by the user (discovered in the channels phase). */
	o: string[];
	/** Keys of owned channels, deleted after their videos and posts. */
	k: string[];
	/** Index-driven phases: the last item finished (items run in sorted order). */
	x?: string;
	/** Index-driven phases: the item `c` belongs to (an item's own list pages). */
	y?: string;
	/** How the current phase finds its records: 'i' indexes, 's' bucket scan. */
	m?: 'i' | 's';
}

export function encodeResumeToken(checkpoint: Checkpoint): string {
	return btoa(JSON.stringify(checkpoint)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeResumeToken(token: string | undefined | null, version = 1): Checkpoint {
	const fresh: Checkpoint = { p: 0, o: [], k: [], ...(version !== 1 ? { v: version } : {}) };
	if (!token) return fresh;
	try {
		const padded = token.replace(/-/g, '+').replace(/_/g, '/');
		const parsed = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as Partial<Checkpoint>;
		if (typeof parsed.p !== 'number' || parsed.p < 0) return fresh;
		// A token from an older phase list (a deploy mid-erase) starts over: every phase is idempotent
		if ((parsed.v ?? 1) !== version) return fresh;
		return {
			...(version !== 1 ? { v: version } : {}),
			p: Math.floor(parsed.p),
			c: typeof parsed.c === 'string' ? parsed.c : undefined,
			o: Array.isArray(parsed.o) ? parsed.o.filter((v): v is string => typeof v === 'string').slice(0, 1000) : [],
			k: Array.isArray(parsed.k) ? parsed.k.filter((v): v is string => typeof v === 'string').slice(0, 1000) : [],
			x: typeof parsed.x === 'string' ? parsed.x : undefined,
			y: typeof parsed.y === 'string' ? parsed.y : undefined,
			m: parsed.m === 'i' || parsed.m === 's' ? parsed.m : undefined,
		};
	} catch {
		return fresh;
	}
}

interface PhaseContext {
	budget: OperationBudget;
	checkpoint: Checkpoint;
	pageSize: number;
}

type Phase = (ctx: PhaseContext) => Promise<void>;

/** Iterate list pages of `prefix`, recording the start of each page in the checkpoint. */
async function scanPages(
	bucket: BucketLike,
	prefix: string | undefined,
	ctx: PhaseContext,
	onPage: (objects: Array<{ key: string }>) => Promise<void>,
): Promise<void> {
	let cursor = ctx.checkpoint.c;
	do {
		ctx.checkpoint.c = cursor;
		ctx.budget.spend();
		const page = await bucket.list({ prefix, cursor, limit: ctx.pageSize });
		await onPage(page.objects);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	ctx.checkpoint.c = undefined;
}

/** List every key under a prefix (for small, per-entity subtrees). */
async function allKeys(bucket: BucketLike, prefix: string, budget: OperationBudget): Promise<string[]> {
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

async function runPhases(
	phases: Phase[],
	budget: OperationBudget,
	resumeToken: string | undefined,
	pageSize: number,
	version = 1,
): Promise<{ complete: boolean; resumeToken?: string }> {
	const checkpoint = decodeResumeToken(resumeToken, version);
	const ctx: PhaseContext = { budget, checkpoint, pageSize };
	try {
		while (checkpoint.p < phases.length) {
			await phases[checkpoint.p](ctx);
			checkpoint.p++;
			checkpoint.c = undefined;
			checkpoint.x = undefined;
			checkpoint.y = undefined;
			checkpoint.m = undefined;
		}
		return { complete: true };
	} catch (error) {
		if (!(error instanceof BudgetExhausted)) throw error;
		return { complete: false, resumeToken: encodeResumeToken(checkpoint) };
	}
}

export interface RunOptions {
	resumeToken?: string;
	pageSize?: number;
}

function isVideoKey(key: string): boolean {
	return !key.startsWith('index:');
}

/** Walk a comment and its nested replies. */
function forEachComment(comments: unknown, visit: (comment: Json, parentId?: string) => void, parentId?: string): void {
	if (!Array.isArray(comments)) return;
	for (const comment of comments) {
		if (!comment || typeof comment !== 'object') continue;
		visit(comment as Json, parentId);
		forEachComment((comment as Json).replies, visit, (comment as Json).id);
	}
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface UserDataExport {
	formatVersion: number;
	generatedAt: string;
	userId: string;
	/** False when the operation budget ran out; call again with resumeToken and merge the arrays. */
	complete: boolean;
	resumeToken?: string;
	notes: string[];
	profile: Json | null;
	privacyConsent: Json | null;
	channels: Json[];
	channelSections: Json[];
	channelTabs: Json[];
	videos: Json[];
	videoComments: Json[];
	videoReactions: Json[];
	commentReactions: Json[];
	subscriptions: Json[];
	watchHistory: Json[];
	legacyWatchHistory: Json[];
	communityPosts: Json[];
	communityComments: Json[];
	communityLikes: Json[];
	communityCommentLikes: Json[];
	pollVotes: Json[];
	playlists: Json[];
	uploadDefaults: Json[];
	reportsFiled: Json[];
	/** Notification preferences and when the notification menu was last opened (NOTIFICATIONS_DB). */
	notificationState: Json[];
}

/** Array sections of the export; partial exports are merged by concatenating these. */
export const EXPORT_LIST_FIELDS = [
	'channels',
	'channelSections',
	'channelTabs',
	'videos',
	'videoComments',
	'videoReactions',
	'commentReactions',
	'subscriptions',
	'watchHistory',
	'legacyWatchHistory',
	'communityPosts',
	'communityComments',
	'communityLikes',
	'communityCommentLikes',
	'pollVotes',
	'playlists',
	'uploadDefaults',
	'reportsFiled',
	'notificationState',
] as const;

const EXPORT_NOTES = [
	'Your sign-in account (email, password, sessions) is held by the Al Ummah Now account service; export it from your account settings.',
	'Pseudonymous event logs (views, likes, analytics beacons) are kept for 13 months for abuse prevention and statistics and are not individually exportable; see docs/compliance/GDPR.md.',
	"Video metadata is included for videos you own; comments other people left on them are summarised as counts because they are those people's data.",
];

function emptyExport(userId: string): UserDataExport {
	const out = {
		formatVersion: EXPORT_FORMAT_VERSION,
		generatedAt: new Date().toISOString(),
		userId,
		complete: true,
		notes: [...EXPORT_NOTES],
		profile: null,
		privacyConsent: null,
	} as UserDataExport;
	for (const field of EXPORT_LIST_FIELDS) out[field] = [];
	return out;
}

function summariseOwnedVideo(video: Json): Json {
	const { comments, likes, dislikes, ...metadata } = video;
	return {
		...metadata,
		commentsCount: Array.isArray(comments) ? comments.length : 0,
		likesCount: Array.isArray(likes) ? likes.length : 0,
		dislikesCount: Array.isArray(dislikes) ? dislikes.length : 0,
	};
}

/**
 * Collect everything stored about `userId` (one bounded pass). When the
 * budget runs out the result has `complete: false` and a `resumeToken`.
 */
export async function collectUserData(
	env: PrivacyBuckets,
	userId: string,
	budget: OperationBudget,
	options: RunOptions = {},
): Promise<UserDataExport> {
	const out = emptyExport(userId);
	const userSuffix = `/${userId}.json`;
	const community = asBucket(env.community_posts);

	// An interrupted unit of work is redone on resume, so roll back anything it
	// already added: resumed exports concatenate without duplicates.
	const atomically = async (work: () => Promise<void>) => {
		const lengths = EXPORT_LIST_FIELDS.map((field) => out[field].length);
		try {
			await work();
		} catch (error) {
			EXPORT_LIST_FIELDS.forEach((field, i) => {
				out[field].length = lengths[i];
			});
			throw error;
		}
	};

	const readEach = (bucket: BucketLike, filter: (key: string) => boolean, onItem: (item: Json, key: string, ctx: PhaseContext) => void) =>
		async (ctx: PhaseContext, prefix?: string) =>
			scanPages(bucket, prefix, ctx, (objects) =>
				atomically(async () => {
					for (const { key } of objects) {
						if (!filter(key)) continue;
						const item = await readJson<Json>(bucket, key, ctx.budget);
						if (item) onItem(item, key, ctx);
					}
				}),
			);

	const phases: Phase[] = [
		async (ctx) => {
			const profile = await readJson<Json>(asBucket(env.profiles), userId, ctx.budget);
			if (!profile) return;
			const { watchHistory, privacyConsent, ...rest } = profile;
			out.profile = rest;
			out.legacyWatchHistory = Array.isArray(watchHistory) ? watchHistory : [];
			out.privacyConsent = privacyConsent ?? null;
			for (const channelId of Array.isArray(profile.subscribedTo) ? profile.subscribedTo : []) {
				out.subscriptions.push({ channelId, source: 'profile' });
			}
		},
		(ctx) =>
			readEach(asBucket(env.watch_history), () => true, (entry) => {
				if (entry.userId === userId) out.watchHistory.push(entry);
			})(ctx, `${userId}:`),
		(ctx) => readEach(asBucket(env['upload-defaults']), () => true, (t) => void out.uploadDefaults.push(t))(ctx, `${userId}/`),
		(ctx) =>
			readEach(asBucket(env.channels), () => true, (channel, key, c) => {
				const channelId = channel.id ?? key;
				if (channel.userId === userId) {
					if (!c.checkpoint.o.includes(channelId)) c.checkpoint.o.push(channelId);
					const { subscriptions, ...rest } = channel;
					out.channels.push({ ...rest, subscribersCount: Array.isArray(subscriptions) ? subscriptions.length : 0 });
				}
				for (const sub of (channel.subscriptions as Reaction[] | undefined) ?? []) {
					// A member's own subscription is stored under a `user:` key, not a channel id
					if (sub?.userId === userId) out.subscriptions.push({ ...sub, channelId: subscriberChannelOf(sub.channelId as string | undefined), subscribedToChannelId: channelId });
				}
			})(ctx),
		(ctx) =>
			atomically(async () => {
				for (const channelId of ctx.checkpoint.o) {
					const sections = asBucket(env.channel_sections);
					for (const key of await allKeys(sections, `${channelId}/`, ctx.budget)) {
						const section = await readJson<Json>(sections, key, ctx.budget);
						if (section) out.channelSections.push(section);
					}
					const tabs = await readJson<Json>(asBucket(env.channel_tabs), `channel-tabs/${channelId}`, ctx.budget);
					if (tabs) out.channelTabs.push(tabs);
				}
			}),
		(ctx) =>
			readEach(asBucket(env.videos), isVideoKey, (video, key, c) => {
				const videoId = video.id ?? key;
				if (video.userId === userId || c.checkpoint.o.includes(video.channelId)) out.videos.push(summariseOwnedVideo(video));
				for (const kind of ['likes', 'dislikes'] as const) {
					for (const reaction of (video[kind] as Reaction[] | undefined) ?? []) {
						if (reaction?.userId === userId) out.videoReactions.push({ ...reaction, videoId, kind });
					}
				}
				forEachComment(video.comments, (comment, parentId) => {
					if (comment.userId === userId) {
						const { replies, likes, dislikes, ...rest } = comment;
						out.videoComments.push({ ...rest, videoId, parentCommentId: parentId });
					}
					for (const kind of ['likes', 'dislikes'] as const) {
						for (const reaction of (comment[kind] as Reaction[] | undefined) ?? []) {
							if (reaction?.userId === userId) out.commentReactions.push({ ...reaction, videoId, commentId: comment.id, kind });
						}
					}
				});
			})(ctx),
		(ctx) =>
			readEach(community, (key) => !key.endsWith('/index.json'), (post, _key, c) => {
				if (post.userId === userId || c.checkpoint.o.includes(post.channelId)) out.communityPosts.push(post);
			})(ctx, 'posts/'),
		(ctx) =>
			readEach(community, (key) => !key.endsWith('/index.json') && !key.endsWith('/pinned.json') && !key.includes('/reply-parents/'), (comment) => {
				if (comment.userId === userId) out.communityComments.push(comment);
			})(ctx, 'comments/'),
		(ctx) => readEach(community, (key) => key.endsWith(userSuffix), (r) => void out.communityLikes.push(r))(ctx, 'likes/'),
		(ctx) => readEach(community, (key) => key.endsWith(userSuffix), (r) => void out.pollVotes.push(r))(ctx, 'votes/'),
		(ctx) => readEach(community, (key) => key.endsWith(userSuffix), (r) => void out.communityCommentLikes.push(r))(ctx, 'comment-likes/'),
		(ctx) =>
			readEach(asBucket(env.playlists), () => true, (playlist) => {
				if (playlist.userId === userId) out.playlists.push(playlist);
			})(ctx),
		(ctx) => readEach(asBucket(env.reports), (key) => key.endsWith(`:${userId}`), (r) => void out.reportsFiled.push(r))(ctx),
		// Subscriptions stored in D1 (SCALABILITY-AUDIT AV-4)
		(ctx) =>
			atomically(async () => {
				if (!env.NOTIFICATIONS_DB) return;
				ctx.budget.spend();
				out.subscriptions.push(...(await exportUserSubscriptions(env.NOTIFICATIONS_DB, userId)));
			}),
		// Notification preferences and the menu-seen time (D1, one row each)
		(ctx) =>
			atomically(async () => {
				const ndb = env.NOTIFICATIONS_DB;
				if (!ndb) return;
				ctx.budget.spend();
				const [seenAt, settings, email] = await Promise.all([getSeenAt(ndb, userId), getSettings(ndb, userId), getEmailSettings(ndb, userId)]);
				out.notificationState.push({ menuSeenAt: seenAt === null ? null : new Date(seenAt).toISOString(), categories: settings, email });
			}),
	];

	const result = await runPhases(phases, budget, options.resumeToken, options.pageSize ?? DEFAULT_PAGE_SIZE);
	out.complete = result.complete;
	if (result.resumeToken) out.resumeToken = result.resumeToken;
	return out;
}

// ---------------------------------------------------------------------------
// Erasure
// ---------------------------------------------------------------------------

export interface ErasureSummary {
	userId: string;
	complete: boolean;
	/** Pass back to continue an incomplete erasure. */
	resumeToken?: string;
	deleted: Record<string, number>;
	anonymized: Record<string, number>;
	/** Owned video ids removed from R2 in this pass (their streaming media is removed via onVideoDeleted). */
	deletedVideoIds: string[];
	/**
	 * Community posts the user liked or voted on. Their cached counters are
	 * recomputed by the processor from the remaining records on the next like/vote.
	 */
	affectedPosts: string[];
}

export interface ErasureHooks {
	/** Remove the streaming media of a deleted video (Bunny Stream). Must not throw. */
	onVideoDeleted?: (videoId: string, video?: { bunnyLibraryId?: number | string | null; playUrl?: string | null; thumbnailUrl?: string | null }) => Promise<void>;
	/** Remove what the profile owned outside R2 (its Bunny collections) just before it is deleted. Must not throw. */
	onProfileDeleted?: (userId: string, profile: unknown) => Promise<void>;
	/** Remove what an owned channel holds outside R2 (its Bunny collections) just before its record is deleted. Must not throw. */
	onChannelDeleted?: (channelId: string, channel: unknown) => Promise<void>;
}

function bump(map: Record<string, number>, key: string, by = 1): void {
	if (by > 0) map[key] = (map[key] ?? 0) + by;
}

/** Counts of one conditional-write attempt, merged into the summary only when the write landed. */
function newErasureSummary(): ErasureSummary {
	return { userId: '', complete: true, deleted: {}, anonymized: {}, deletedVideoIds: [], affectedPosts: [] };
}

function mergeErasureSummary(into: ErasureSummary, from: ErasureSummary): void {
	for (const [key, by] of Object.entries(from.deleted)) bump(into.deleted, key, by);
	for (const [key, by] of Object.entries(from.anonymized)) bump(into.anonymized, key, by);
}

function stripUserReactions(list: unknown, userId: string): { list: Reaction[]; removed: number } {
	if (!Array.isArray(list)) return { list: [], removed: 0 };
	const kept = (list as Reaction[]).filter((reaction) => reaction?.userId !== userId);
	return { list: kept, removed: list.length - kept.length };
}

function anonymizeVideoComments(comments: unknown, userId: string, summary: ErasureSummary): boolean {
	let changed = false;
	forEachComment(comments, (comment) => {
		for (const kind of ['likes', 'dislikes'] as const) {
			const { list, removed } = stripUserReactions(comment[kind], userId);
			if (removed > 0) {
				comment[kind] = list;
				bump(summary.deleted, 'commentReactions', removed);
				changed = true;
			}
		}
		if (comment.userId === userId) {
			// Keep the thread structure (replies from other people), drop the content and identity.
			comment.userId = DELETED_USER_ID;
			comment.channelId = DELETED_CHANNEL_ID;
			comment.text = '';
			comment.isDeleted = true;
			comment.dateModified = new Date().toISOString();
			bump(summary.anonymized, 'videoComments');
			changed = true;
		}
	});
	return changed;
}

/** Format of erase resume tokens: 2 since the index-driven phases (#1073). */
const ERASE_TOKEN_VERSION = 2;

/** Bound parameters per IN (...) list (D1 allows 100). */
const IN_CHUNK = 90;

/** Which buckets the erase may find the user's data in through indexes instead of scans. */
export interface EraseIndexes {
	/** Owned channels (content_ownership) and legacy subscriptions on other channels (footprints) */
	channels: boolean;
	/** Owned videos (content_ownership) and reactions/comments on other videos (footprints) */
	videos: boolean;
	/** Posts written on other channels, comments, likes, votes and comment likes (footprints) */
	community: boolean;
	playlists: boolean;
	reports: boolean;
}

const NO_INDEXES: EraseIndexes = { channels: false, videos: false, community: false, playlists: false, reports: false };

/** One read per index; any failure means "scan", never "skip". */
export async function eraseIndexes(db: SearchDb | undefined): Promise<EraseIndexes> {
	if (!db) return NO_INDEXES;
	try {
		const [channel, video, fVideos, fChannels, fCommunity, fPlaylists, fReports] = await Promise.all([
			isOwnershipComplete(db, 'channel'),
			isOwnershipComplete(db, 'video'),
			footprintsComplete(db, 'videos'),
			footprintsComplete(db, 'channels'),
			footprintsComplete(db, 'community_posts'),
			footprintsComplete(db, 'playlists'),
			footprintsComplete(db, 'reports'),
		]);
		return { channels: channel && fChannels, videos: video && fVideos, community: fCommunity, playlists: fPlaylists, reports: fReports };
	} catch (error) {
		logger.warn('[Privacy] Could not read the erase indexes; scanning the buckets', { error: error instanceof Error ? error.message : String(error) });
		return NO_INDEXES;
	}
}

/**
 * Run `work` for each item in sorted order, recording the last finished item
 * (`x`) so a resumed call continues after it; `c` (an item's own list cursor)
 * is only reused for the item it was recorded for (`y`).
 */
async function eachItem(ctx: PhaseContext, items: Iterable<string>, work: (item: string) => Promise<void>): Promise<void> {
	const cp = ctx.checkpoint;
	for (const item of [...new Set(items)].sort()) {
		if (cp.x !== undefined && item <= cp.x) continue;
		if (cp.y !== item) {
			cp.y = item;
			cp.c = undefined;
		}
		await work(item);
		cp.x = item;
		cp.y = undefined;
		cp.c = undefined;
	}
}

async function selectColumn(ctx: PhaseContext, db: SearchDb, sql: string, binds: unknown[]): Promise<string[]> {
	ctx.budget.spend();
	const { results } = await db.prepare(sql).bind(...binds).all<{ id: string }>();
	return (results ?? []).map((r) => r.id);
}

/**
 * Erase / anonymise everything stored about `userId` (one bounded pass).
 * Idempotent and resumable: call again with `resumeToken` until `complete`.
 * The profile is deleted last.
 *
 * What the user owns or touched is found through indexes when they are
 * complete (#1073): content_ownership for owned channels and videos (deleted
 * ones included), privacy_footprints (lib/privacy/footprints.ts) for their
 * data inside other people's records, key prefixes for the rest. A bucket
 * whose index is not complete is scanned as before. Every phase picks its
 * method on its own and changes the same records either way. Two lookups stay
 * prefix scans: live stream records (`livestream:` in the videos bucket) and
 * each touched post's comment and comment-like trees.
 */
export async function eraseUserData(
	env: PrivacyBuckets,
	userId: string,
	budget: OperationBudget,
	hooks: ErasureHooks = {},
	options: RunOptions = {},
): Promise<ErasureSummary> {
	const summary: ErasureSummary = { userId, complete: true, deleted: {}, anonymized: {}, deletedVideoIds: [], affectedPosts: [] };
	const community = asBucket(env.community_posts);
	const channels = asBucket(env.channels);
	const videos = asBucket(env.videos);
	const playlists = asBucket(env.playlists);
	const reports = asBucket(env.reports);
	const userSuffix = `/${userId}.json`;
	const db = env.SEARCH_DB as SearchDb | undefined;

	let indexes: Promise<EraseIndexes> | undefined;
	const indexed = async (ctx: PhaseContext, pick: (ix: EraseIndexes) => boolean): Promise<boolean> => {
		if (!db) return false;
		if (!indexes) {
			ctx.budget.spend(7);
			indexes = eraseIndexes(db);
		}
		return pick(await indexes);
	};

	/** A phase with an index-driven and a scanning method; a resumed phase that changed method starts over. */
	const either = (pick: (ix: EraseIndexes) => boolean, byIndex: Phase, byScan: Phase): Phase => async (ctx) => {
		const mode = (await indexed(ctx, pick)) ? 'i' : 's';
		const cp = ctx.checkpoint;
		if (cp.m !== undefined && cp.m !== mode) {
			cp.c = undefined;
			cp.x = undefined;
			cp.y = undefined;
		}
		cp.m = mode;
		await (mode === 'i' ? byIndex : byScan)(ctx);
	};

	const deletePrefixPages = (bucket: BucketLike, prefix: string, label: string): Phase => (ctx) =>
		scanPages(bucket, prefix, ctx, async (objects) => {
			bump(summary.deleted, label, await deleteKeys(bucket, objects.map((o) => o.key), ctx.budget));
		});

	/** Delete the user's own records among `keys` (likes/, votes/, comment-likes/ trees). */
	const deleteMine = async (keys: string[], label: string, ctx: PhaseContext) => {
		const mine = keys.filter((key) => key.endsWith(userSuffix));
		if (label !== 'communityCommentLikes') {
			for (const key of mine) {
				const postId = key.split('/')[1];
				if (postId && !summary.affectedPosts.includes(postId)) summary.affectedPosts.push(postId);
			}
		}
		bump(summary.deleted, label, await deleteKeys(community, mine, ctx.budget));
	};

	const deleteUserRecords = (prefix: string, label: string): Phase => (ctx) =>
		scanPages(community, prefix, ctx, (objects) => deleteMine(objects.map((o) => o.key), label, ctx));

	// --- Per-record work, the same whichever way the record was found ---

	/** An owned channel is remembered (deleted later) and its @handle freed; another channel loses the user's subscriptions. */
	const eraseInChannel = async (ctx: PhaseContext, key: string, channel: Json) => {
		if (channel.userId === userId) {
			const channelId = channel.id ?? key;
			if (!ctx.checkpoint.o.includes(channelId)) ctx.checkpoint.o.push(channelId);
			if (!ctx.checkpoint.k.includes(key)) ctx.checkpoint.k.push(key);
			// Free the channel's @handle (index entry in channel_tabs, see lib/channelHandles.ts)
			// only if the entry is this channel's (a stale field must not free another channel's handle)
			if (typeof channel.handle === 'string' && channel.handle) {
				const handleKey = `channel-handles/${channel.handle.toLowerCase()}`;
				const entry = await readJson<Json>(asBucket(env.channel_tabs), handleKey, ctx.budget);
				if (entry?.channelId === channelId) await deleteKeys(asBucket(env.channel_tabs), [handleKey], ctx.budget);
			}
			return;
		}
		if (stripUserReactions(channel.subscriptions, userId).removed === 0) return;
		// Conditional rewrite of the fresh channel (SCALABILITY-AUDIT AV-23)
		let removed = 0;
		await updateJson<Json>(channels, key, (fresh) => {
			const stripped = stripUserReactions(fresh.subscriptions, userId);
			removed = stripped.removed;
			if (removed === 0) return false;
			fresh.subscriptions = stripped.list;
			return true;
		}, ctx.budget);
		if (removed > 0) bump(summary.deleted, 'subscriptions', removed);
	};

	/** An owned video is deleted (subtitles, media, record); another loses the user's reactions and comments. */
	const eraseInVideo = async (ctx: PhaseContext, key: string, video: Json) => {
		const videoId = video.id ?? key;
		if (video.userId === userId || ctx.checkpoint.o.includes(video.channelId)) {
			if (env.subtitles) {
				const subtitles = asBucket(env.subtitles);
				bump(summary.deleted, 'subtitles', await deleteKeys(subtitles, await allKeys(subtitles, `${videoId}/`, ctx.budget), ctx.budget));
			}
			// The scheduler entry and upload marker name the user too (lib/videoSideRecords.ts)
			await deleteVideoSideRecords({ global_settings: env.global_settings, SCHEDULED_VIDEOS: env.SCHEDULED_VIDEOS ?? env['scheduled-videos'] }, videoId, video);
			if (hooks.onVideoDeleted) await hooks.onVideoDeleted(videoId, video as never);
			await deleteKeys(videos, [key], ctx.budget);
			summary.deletedVideoIds.push(videoId);
			bump(summary.deleted, 'videos');
			return;
		}
		// Strip and anonymise on the fresh video with a conditional write
		// (SCALABILITY-AUDIT AV-23), counting only the attempt that landed
		const needsChange = (['likes', 'dislikes'] as const).some((kind) => stripUserReactions(video[kind], userId).removed > 0)
			|| anonymizeVideoComments(structuredClone(video.comments), userId, newErasureSummary());
		if (!needsChange) return;
		let attempt = newErasureSummary();
		await updateJson<Json>(videos, key, (fresh) => {
			attempt = newErasureSummary();
			let changed = false;
			for (const kind of ['likes', 'dislikes'] as const) {
				const { list, removed } = stripUserReactions(fresh[kind], userId);
				if (removed > 0) {
					fresh[kind] = list;
					bump(attempt.deleted, 'videoReactions', removed);
					changed = true;
				}
			}
			if (anonymizeVideoComments(fresh.comments, userId, attempt)) changed = true;
			return changed;
		}, ctx.budget);
		mergeErasureSummary(summary, attempt);
	};

	/** A post of an owned channel, or written by the user: its subtrees first, then the post. */
	const eraseCommunityPostKey = async (ctx: PhaseContext, key: string) => {
		const [, channelId, file] = key.split('/');
		if (!file) return;
		const owned = ctx.checkpoint.o.includes(channelId);
		if (file === 'index.json') {
			if (owned) await deleteKeys(community, [key], ctx.budget);
			return;
		}
		let postId = file.replace(/\.json$/, '');
		if (!owned) {
			const post = await readJson<Json>(community, key, ctx.budget);
			if (!post || post.userId !== userId) return;
			postId = post.id ?? postId;
		}
		for (const prefix of [`comments/${postId}/`, `likes/${postId}/`, `votes/${postId}/`, `comment-likes/${postId}/`]) {
			await deleteKeys(community, await allKeys(community, prefix, ctx.budget), ctx.budget);
		}
		await deleteKeys(community, [key], ctx.budget);
		bump(summary.deleted, 'communityPosts');
	};

	/** The user's comment on someone else's post: anonymised, thread kept. */
	const anonymizeCommunityCommentKey = async (ctx: PhaseContext, key: string) => {
		// Index documents, the pinned pointer and reply-parent pointers hold no user data
		if (key.endsWith('/index.json') || key.endsWith('/pinned.json') || key.includes('/reply-parents/')) return;
		// Conditional rewrite (SCALABILITY-AUDIT AV-23): a concurrent like or
		// edit cannot bring the author back
		let anonymized = false;
		await updateJson<Json>(community, key, (comment) => {
			anonymized = false;
			if (comment.userId !== userId) return false;
			comment.userId = DELETED_USER_ID;
			comment.channelId = DELETED_CHANNEL_ID;
			comment.content = '';
			comment.userDisplayName = '';
			delete comment.userAvatarUrl;
			comment.deletedAt = comment.deletedAt ?? new Date().toISOString();
			anonymized = true;
			return true;
		}, ctx.budget);
		if (anonymized) bump(summary.anonymized, 'communityComments');
	};

	/** Reports filed: kept for moderation history, reporter identity removed; the user's claims deleted. */
	const eraseReportKey = async (ctx: PhaseContext, key: string) => {
		// The one-report-per-entity claims (lib/report-claims.ts) name the user: delete them
		if (isReportClaimOf(key, userId)) {
			await deleteKeys(reports, [key], ctx.budget);
			return;
		}
		if (!key.endsWith(`:${userId}`)) return;
		const report = await readJson<Json>(reports, key, ctx.budget);
		if (report) {
			report.reporterId = DELETED_USER_ID;
			await writeJson(reports, key.slice(0, key.length - userId.length) + DELETED_USER_ID, report, ctx.budget);
		}
		await deleteKeys(reports, [key], ctx.budget);
		bump(summary.anonymized, 'reportsFiled');
	};

	const erasePlaylistKey = async (ctx: PhaseContext, key: string, mine: string[]) => {
		const playlist = await readJson<Json>(playlists, key, ctx.budget);
		if (playlist && playlist.userId === userId) mine.push(key);
	};

	/** The touched posts (comments, likes, votes, comment likes) from the footprints. */
	const touchedPosts = (ctx: PhaseContext) => {
		ctx.budget.spend();
		return footprintTargets(db!, userId, 'post');
	};

	const phases: Phase[] = [
		deletePrefixPages(asBucket(env.watch_history), `${userId}:`, 'watchHistory'),
		async (ctx) => {
			const uploadDefaults = asBucket(env['upload-defaults']);
			await deletePrefixPages(uploadDefaults, `${userId}/`, 'uploadDefaults')(ctx);
			// The default-template pointers (lib/uploadDefaultPointer.ts)
			await deleteKeys(uploadDefaults, await allKeys(uploadDefaults, defaultPointerPrefix(userId), ctx.budget), ctx.budget);
		},

		// Channels: remember owned ones (deleted later), remove the user's subscriptions from others
		either(
			(ix) => ix.channels,
			async (ctx) => {
				const owned = await selectColumn(ctx, db!, `SELECT id FROM content_ownership WHERE kind = 'channel' AND owner_id = ?`, [userId]);
				ctx.budget.spend();
				const subscribed = await footprintTargets(db!, userId, 'channel');
				await eachItem(ctx, [...owned, ...subscribed], async (key) => {
					const channel = await readJson<Json>(channels, key, ctx.budget);
					if (channel) await eraseInChannel(ctx, key, channel);
				});
			},
			(ctx) =>
				scanPages(channels, undefined, ctx, async (objects) => {
					for (const { key } of objects) {
						const channel = await readJson<Json>(channels, key, ctx.budget);
						if (channel) await eraseInChannel(ctx, key, channel);
					}
				}),
		),

		// Sections and tabs of owned channels
		async (ctx) => {
			const sections = asBucket(env.channel_sections);
			for (const channelId of ctx.checkpoint.o) {
				bump(summary.deleted, 'channelSections', await deleteKeys(sections, await allKeys(sections, `${channelId}/`, ctx.budget), ctx.budget));
				await deleteKeys(sections, [sectionOrderKey(channelId)], ctx.budget);
				await deleteKeys(asBucket(env.channel_tabs), [`channel-tabs/${channelId}`], ctx.budget);
			}
		},

		// Videos: delete owned (with subtitles and media), strip reactions and anonymise comments elsewhere
		either(
			(ix) => ix.videos,
			async (ctx) => {
				// Owned by the user or on an owned channel, soft-deleted ones included
				const ids = await selectColumn(ctx, db!, `SELECT id FROM content_ownership WHERE kind = 'video' AND owner_id = ?`, [userId]);
				for (let i = 0; i < ctx.checkpoint.o.length; i += IN_CHUNK) {
					const chunk = ctx.checkpoint.o.slice(i, i + IN_CHUNK);
					ids.push(...(await selectColumn(ctx, db!, `SELECT id FROM content_ownership WHERE kind = 'video' AND channel_id IN (${chunk.map(() => '?').join(', ')})`, chunk)));
				}
				ctx.budget.spend();
				ids.push(...(await footprintTargets(db!, userId, 'video')));
				await eachItem(ctx, ids.filter(isVideoKey), async (key) => {
					const video = await readJson<Json>(videos, key, ctx.budget);
					if (video) await eraseInVideo(ctx, key, video);
				});
			},
			(ctx) =>
				scanPages(videos, undefined, ctx, async (objects) => {
					for (const { key } of objects) {
						if (!isVideoKey(key)) continue;
						const video = await readJson<Json>(videos, key, ctx.budget);
						if (video) await eraseInVideo(ctx, key, video);
					}
				}),
		),

		// Live stream records (videos bucket, `livestream:<id>`): no index names their owner, so
		// their prefix is listed whichever way the videos were found (a repeat after a scan is a no-op)
		(ctx) =>
			scanPages(videos, 'livestream:', ctx, async (objects) => {
				for (const { key } of objects) {
					const record = await readJson<Json>(videos, key, ctx.budget);
					if (record) await eraseInVideo(ctx, key, record);
				}
			}),

		// Community posts of owned channels or authored by the user: subtrees first, then the post
		either(
			(ix) => ix.community,
			async (ctx) => {
				ctx.budget.spend();
				const authored = await footprintTargets(db!, userId, 'post-author');
				const items = [...ctx.checkpoint.o.map((channelId) => `c:${channelId}`), ...authored.map((key) => `a:${key}`)];
				await eachItem(ctx, items, async (item) => {
					if (item.startsWith('a:')) return eraseCommunityPostKey(ctx, item.slice(2));
					await scanPages(community, `posts/${item.slice(2)}/`, ctx, async (objects) => {
						for (const { key } of objects) await eraseCommunityPostKey(ctx, key);
					});
				});
			},
			(ctx) =>
				scanPages(community, 'posts/', ctx, async (objects) => {
					for (const { key } of objects) await eraseCommunityPostKey(ctx, key);
				}),
		),

		// The user's comments on other posts: anonymise
		either(
			(ix) => ix.community,
			async (ctx) =>
				eachItem(ctx, await touchedPosts(ctx), (postId) =>
					scanPages(community, `comments/${postId}/`, ctx, async (objects) => {
						for (const { key } of objects) await anonymizeCommunityCommentKey(ctx, key);
					}),
				),
			(ctx) =>
				scanPages(community, 'comments/', ctx, async (objects) => {
					for (const { key } of objects) await anonymizeCommunityCommentKey(ctx, key);
				}),
		),

		// Post likes and poll votes: one key per post and user
		...([['likes', 'communityLikes'], ['votes', 'pollVotes']] as const).map(([tree, label]) =>
			either(
				(ix) => ix.community,
				async (ctx) =>
					eachItem(ctx, await touchedPosts(ctx), async (postId) => {
						const key = `${tree}/${postId}${userSuffix}`;
						ctx.budget.spend();
						const page = await community.list({ prefix: key, limit: 10 });
						await deleteMine(page.objects.map((o) => o.key).filter((k) => k === key), label, ctx);
					}),
				deleteUserRecords(`${tree}/`, label),
			),
		),
		// Comment likes: under each touched post's comment-likes tree
		either(
			(ix) => ix.community,
			async (ctx) =>
				eachItem(ctx, await touchedPosts(ctx), (postId) =>
					scanPages(community, `comment-likes/${postId}/`, ctx, (objects) => deleteMine(objects.map((o) => o.key), 'communityCommentLikes', ctx)),
				),
			deleteUserRecords('comment-likes/', 'communityCommentLikes'),
		),

		// Owned channels themselves (after their videos and posts), each after its hook
		async (ctx) => {
			for (const key of ctx.checkpoint.k) {
				const channel = await readJson<Json>(channels, key, ctx.budget);
				// Gone already: a resumed pass deleted it (and ran its hook) before
				if (!channel) continue;
				if (hooks.onChannelDeleted) await hooks.onChannelDeleted(channel.id ?? key, channel);
				bump(summary.deleted, 'channels', await deleteKeys(channels, [key], ctx.budget));
			}
		},

		// Playlists
		either(
			(ix) => ix.playlists,
			async (ctx) => {
				ctx.budget.spend();
				await eachItem(ctx, await footprintTargets(db!, userId, 'playlist'), async (key) => {
					const mine: string[] = [];
					await erasePlaylistKey(ctx, key, mine);
					bump(summary.deleted, 'playlists', await deleteKeys(playlists, mine, ctx.budget));
				});
			},
			(ctx) =>
				scanPages(playlists, undefined, ctx, async (objects) => {
					const mine: string[] = [];
					for (const { key } of objects) await erasePlaylistKey(ctx, key, mine);
					bump(summary.deleted, 'playlists', await deleteKeys(playlists, mine, ctx.budget));
				}),
		),

		// Reports filed: keep for moderation history, remove the reporter's identity
		either(
			(ix) => ix.reports,
			async (ctx) => {
				ctx.budget.spend();
				await eachItem(ctx, await footprintTargets(db!, userId, 'report'), async (entityId) => {
					await scanPages(reports, `report:${entityId}:`, ctx, async (objects) => {
						for (const { key } of objects) await eraseReportKey(ctx, key);
					});
					await deleteKeys(reports, [reportClaimKey(entityId, userId)], ctx.budget);
				});
			},
			(ctx) =>
				scanPages(reports, undefined, ctx, async (objects) => {
					for (const { key } of objects) await eraseReportKey(ctx, key);
				}),
		),

		// Subscriptions in D1 (SCALABILITY-AUDIT AV-4), the footprints, then the profile last
		async (ctx) => {
			if (env.NOTIFICATIONS_DB) {
				ctx.budget.spend();
				const removed = await eraseUserSubscriptions(env.NOTIFICATIONS_DB, userId);
				if (removed > 0) bump(summary.deleted, 'subscriptions', removed);
			}
			if (db) {
				ctx.budget.spend(3);
				await forgetFootprints(db, userId);
				// The search binding is the D1 database; the minutes need its batch and all()
				await eraseCaptionMinutes(db as unknown as D1Database, userId);
			}
			const profiles = asBucket(env.profiles);
			ctx.budget.spend();
			const stored = await profiles.get(userId);
			if (stored) {
				if (hooks.onProfileDeleted) await hooks.onProfileDeleted(userId, await stored.json().catch(() => null));
				await deleteKeys(profiles, [userId], ctx.budget);
				bump(summary.deleted, 'profile');
			}
		},
	];

	const result = await runPhases(phases, budget, options.resumeToken, options.pageSize ?? DEFAULT_PAGE_SIZE, ERASE_TOKEN_VERSION);
	summary.complete = result.complete;
	if (result.resumeToken) summary.resumeToken = result.resumeToken;
	return summary;
}

export type { BucketLike };
