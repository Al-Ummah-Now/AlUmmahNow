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
 * Most buckets have no per-user index, so both operations scan whole buckets.
 * They run as a fixed sequence of phases over R2 list pages and stop when the
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
 *   community_posts/posts/{channelId}/{postId}.json    post (+ likes/, votes/, comments/, comment-likes/ trees)
 *   playlists/{playlistId}                             playlist (owner: userId)
 *   upload-defaults/{userId}/...                       upload templates
 *   reports/report:{entityId}:{reportId}:{reporterId}  reports filed by the user
 */

import { eraseUserSubscriptions, exportUserSubscriptions } from '../subscription-store';
import { BucketLike, BudgetExhausted, OperationBudget, asBucket, deleteKeys, readJson, updateJson, writeJson } from './scan';

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
	/** Channel subscriptions (lib/subscription-store.ts) */
	NOTIFICATIONS_DB?: D1Database;
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
	/** Index of the phase to (re)start. */
	p: number;
	/** R2 list cursor of the page to (re)start within that phase. */
	c?: string;
	/** Channel ids owned by the user (discovered in the channels phase). */
	o: string[];
	/** Keys of owned channels, deleted after their videos and posts. */
	k: string[];
}

export function encodeResumeToken(checkpoint: Checkpoint): string {
	return btoa(JSON.stringify(checkpoint)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeResumeToken(token: string | undefined | null): Checkpoint {
	const fresh: Checkpoint = { p: 0, o: [], k: [] };
	if (!token) return fresh;
	try {
		const padded = token.replace(/-/g, '+').replace(/_/g, '/');
		const parsed = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as Partial<Checkpoint>;
		if (typeof parsed.p !== 'number' || parsed.p < 0) return fresh;
		return {
			p: Math.floor(parsed.p),
			c: typeof parsed.c === 'string' ? parsed.c : undefined,
			o: Array.isArray(parsed.o) ? parsed.o.filter((v): v is string => typeof v === 'string').slice(0, 1000) : [],
			k: Array.isArray(parsed.k) ? parsed.k.filter((v): v is string => typeof v === 'string').slice(0, 1000) : [],
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
): Promise<{ complete: boolean; resumeToken?: string }> {
	const checkpoint = decodeResumeToken(resumeToken);
	const ctx: PhaseContext = { budget, checkpoint, pageSize };
	try {
		while (checkpoint.p < phases.length) {
			await phases[checkpoint.p](ctx);
			checkpoint.p++;
			checkpoint.c = undefined;
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
					if (sub?.userId === userId) out.subscriptions.push({ ...sub, subscribedToChannelId: channelId });
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
			readEach(community, (key) => !key.endsWith('/index.json') && !key.endsWith('/pinned.json'), (comment) => {
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
	onVideoDeleted?: (videoId: string) => Promise<void>;
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

/**
 * Erase / anonymise everything stored about `userId` (one bounded pass).
 * Idempotent and resumable: call again with `resumeToken` until `complete`.
 * The profile is deleted last.
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
	const userSuffix = `/${userId}.json`;

	const deletePrefixPages = (bucket: BucketLike, prefix: string, label: string): Phase => (ctx) =>
		scanPages(bucket, prefix, ctx, async (objects) => {
			bump(summary.deleted, label, await deleteKeys(bucket, objects.map((o) => o.key), ctx.budget));
		});

	const deleteUserRecords = (prefix: string, label: string): Phase => (ctx) =>
		scanPages(community, prefix, ctx, async (objects) => {
			const mine = objects.map((o) => o.key).filter((key) => key.endsWith(userSuffix));
			if (label !== 'communityCommentLikes') {
				for (const key of mine) {
					const postId = key.split('/')[1];
					if (postId && !summary.affectedPosts.includes(postId)) summary.affectedPosts.push(postId);
				}
			}
			bump(summary.deleted, label, await deleteKeys(community, mine, ctx.budget));
		});

	const phases: Phase[] = [
		deletePrefixPages(asBucket(env.watch_history), `${userId}:`, 'watchHistory'),
		deletePrefixPages(asBucket(env['upload-defaults']), `${userId}/`, 'uploadDefaults'),

		// Channels: remember owned ones (deleted later), remove the user's subscriptions from others
		(ctx) => {
			const channels = asBucket(env.channels);
			return scanPages(channels, undefined, ctx, async (objects) => {
				for (const { key } of objects) {
					const channel = await readJson<Json>(channels, key, ctx.budget);
					if (!channel) continue;
					if (channel.userId === userId) {
						const channelId = channel.id ?? key;
						if (!ctx.checkpoint.o.includes(channelId)) ctx.checkpoint.o.push(channelId);
						if (!ctx.checkpoint.k.includes(key)) ctx.checkpoint.k.push(key);
						// Free the channel's @handle (index entry in channel_tabs, see lib/channelHandles.ts)
						if (typeof channel.handle === 'string' && channel.handle) {
							await deleteKeys(asBucket(env.channel_tabs), [`channel-handles/${channel.handle.toLowerCase()}`], ctx.budget);
						}
						continue;
					}
					if (stripUserReactions(channel.subscriptions, userId).removed === 0) continue;
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
				}
			});
		},

		// Sections and tabs of owned channels
		async (ctx) => {
			const sections = asBucket(env.channel_sections);
			for (const channelId of ctx.checkpoint.o) {
				bump(summary.deleted, 'channelSections', await deleteKeys(sections, await allKeys(sections, `${channelId}/`, ctx.budget), ctx.budget));
				await deleteKeys(asBucket(env.channel_tabs), [`channel-tabs/${channelId}`], ctx.budget);
			}
		},

		// Videos: delete owned (with subtitles and media), strip reactions and anonymise comments elsewhere
		(ctx) => {
			const videos = asBucket(env.videos);
			return scanPages(videos, undefined, ctx, async (objects) => {
				for (const { key } of objects) {
					if (!isVideoKey(key)) continue;
					const video = await readJson<Json>(videos, key, ctx.budget);
					if (!video) continue;
					const videoId = video.id ?? key;
					if (video.userId === userId || ctx.checkpoint.o.includes(video.channelId)) {
						if (env.subtitles) {
							const subtitles = asBucket(env.subtitles);
							bump(summary.deleted, 'subtitles', await deleteKeys(subtitles, await allKeys(subtitles, `${videoId}/`, ctx.budget), ctx.budget));
						}
						if (hooks.onVideoDeleted) await hooks.onVideoDeleted(videoId);
						await deleteKeys(videos, [key], ctx.budget);
						summary.deletedVideoIds.push(videoId);
						bump(summary.deleted, 'videos');
						continue;
					}
					// Strip and anonymise on the fresh video with a conditional write
					// (SCALABILITY-AUDIT AV-23), counting only the attempt that landed
					const needsChange = (['likes', 'dislikes'] as const).some((kind) => stripUserReactions(video[kind], userId).removed > 0)
						|| anonymizeVideoComments(structuredClone(video.comments), userId, newErasureSummary());
					if (!needsChange) continue;
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
				}
			});
		},

		// Community posts of owned channels or authored by the user: subtrees first, then the post
		(ctx) =>
			scanPages(community, 'posts/', ctx, async (objects) => {
				for (const { key } of objects) {
					const [, channelId, file] = key.split('/');
					if (!file) continue;
					const owned = ctx.checkpoint.o.includes(channelId);
					if (file === 'index.json') {
						if (owned) await deleteKeys(community, [key], ctx.budget);
						continue;
					}
					let postId = file.replace(/\.json$/, '');
					if (!owned) {
						const post = await readJson<Json>(community, key, ctx.budget);
						if (!post || post.userId !== userId) continue;
						postId = post.id ?? postId;
					}
					for (const prefix of [`comments/${postId}/`, `likes/${postId}/`, `votes/${postId}/`, `comment-likes/${postId}/`]) {
						await deleteKeys(community, await allKeys(community, prefix, ctx.budget), ctx.budget);
					}
					await deleteKeys(community, [key], ctx.budget);
					bump(summary.deleted, 'communityPosts');
				}
			}),

		// The user's comments on other posts: anonymise
		(ctx) =>
			scanPages(community, 'comments/', ctx, async (objects) => {
				for (const { key } of objects) {
					if (key.endsWith('/index.json') || key.endsWith('/pinned.json')) continue;
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
				}
			}),

		deleteUserRecords('likes/', 'communityLikes'),
		deleteUserRecords('votes/', 'pollVotes'),
		deleteUserRecords('comment-likes/', 'communityCommentLikes'),

		// Owned channels themselves (after their videos and posts)
		async (ctx) => {
			bump(summary.deleted, 'channels', await deleteKeys(asBucket(env.channels), ctx.checkpoint.k, ctx.budget));
		},

		// Playlists
		(ctx) => {
			const playlists = asBucket(env.playlists);
			return scanPages(playlists, undefined, ctx, async (objects) => {
				const mine: string[] = [];
				for (const { key } of objects) {
					const playlist = await readJson<Json>(playlists, key, ctx.budget);
					if (playlist && playlist.userId === userId) mine.push(key);
				}
				bump(summary.deleted, 'playlists', await deleteKeys(playlists, mine, ctx.budget));
			});
		},

		// Reports filed: keep for moderation history, remove the reporter's identity
		(ctx) => {
			const reports = asBucket(env.reports);
			return scanPages(reports, undefined, ctx, async (objects) => {
				for (const { key } of objects) {
					if (!key.endsWith(`:${userId}`)) continue;
					const report = await readJson<Json>(reports, key, ctx.budget);
					if (report) {
						report.reporterId = DELETED_USER_ID;
						await writeJson(reports, key.slice(0, key.length - userId.length) + DELETED_USER_ID, report, ctx.budget);
					}
					await deleteKeys(reports, [key], ctx.budget);
					bump(summary.anonymized, 'reportsFiled');
				}
			});
		},

		// Subscriptions in D1 (SCALABILITY-AUDIT AV-4), then the profile last
		async (ctx) => {
			if (env.NOTIFICATIONS_DB) {
				ctx.budget.spend();
				const removed = await eraseUserSubscriptions(env.NOTIFICATIONS_DB, userId);
				if (removed > 0) bump(summary.deleted, 'subscriptions', removed);
			}
			const profiles = asBucket(env.profiles);
			ctx.budget.spend();
			if (await profiles.get(userId)) {
				await deleteKeys(profiles, [userId], ctx.budget);
				bump(summary.deleted, 'profile');
			}
		},
	];

	const result = await runPhases(phases, budget, options.resumeToken, options.pageSize ?? DEFAULT_PAGE_SIZE);
	summary.complete = result.complete;
	if (result.resumeToken) summary.resumeToken = result.resumeToken;
	return summary;
}

export type { BucketLike };
