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
 * page is idempotent, so re-running an interrupted page is safe. The progress is
 * sealed (./resume-state.ts): a token that does not open starts over.
 *
 * Progress only says which channels to look at and where to continue. Whether a
 * channel (or a record on one) belongs to the user is decided from the live
 * channel record right before it is read for an export or deleted (ownershipOf):
 * what is on someone else's channel is never exported or deleted as the user's.
 * The progress holds one batch of the user's channels (OWNED_BYTES); an account
 * with more goes round again, batch by batch.
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
 *   MEDIA_PRIVATE studio/{userId}/...                  Studio brand kit and shared assets (institution mode)
 *   ADMIN_BACKUPS legacy-restore/by-user/{userId}/...  pointers to pre-change profile copies (legacy-restore/{jobId}/{userId}/{etag}.json)
 *   reports/report:{entityId}:{reportId}:{reporterId}  reports filed by the user
 */

import { eraseTierHistory } from '../tierChanges';
import { eraseUserSubscriptions, exportUserSubscriptions, subscriberChannelOf } from '../subscription-store';
import { getEmailSettings, getQuietHours, getSeenAt, getSettings } from '../notifications';
import { defaultPointerPrefix } from '../uploadDefaultPointer';
import { readAssets, readBrandKit, studioPrefix } from '../studio/brandKit';
import { deleteVideoSideRecords } from '../videoSideRecords';
import { sectionOrderKey } from '../channelSectionOrder';
import { BucketLike, BudgetExhausted, OperationBudget, asBucket, deleteKeys, readJson, updateJson, writeJson } from './scan';
import { isReportClaimOf, reportClaimKey } from '../report-claims';
import { ResumeUnavailableError, openResume, sealResume, type ResumeEnv, type ResumeScope } from './resume-state';
import { isOwnershipComplete } from '../search/ownership';
import { logger } from '../logger';
import type { SearchDb } from '@al-ummah/shared-types';
import { postLocationKey } from '../community-posts';
import { eraseChannelHandleHistory } from './handle-history';
import { footprintTargets, footprintsComplete, forgetFootprints } from './footprints';
import { eraseCaptionMinutes } from '../captions/minutes';
import { eraseYoutubeImports } from '../youtube-import/erase';
import { eraseLiveSessionOwner } from '../live/store';
import { LIVE_DELETE_BATCH, eraseLiveChat, eraseLiveReminders, exportLiveChat, exportLiveReminders, isMissingTable } from '../live/metadata';
import { eraseImageOwners } from '../csam/imageOwners';
import { eraseProfileEmailReports } from '../admin/profile-email-reports';
import { ADMIN_BACKUPS_UNBOUND_ERROR, eraseLegacyRestoreBackups } from '../admin/legacy-restore';
import { eraseChannelComments, eraseCommentsOfChannel } from '../channelComments';
import { purgePostComment } from '../channelComments/jobs';
import { anonymizeTeamActivity, cancelInvitesOfUser } from '../channelTeam';
import { exportMoveOffers, forgetMoveOffers, stopMoveOffers } from '../channelMoveData';

/** Tombstone written in place of a user id on content kept after erasure. */
export const DELETED_USER_ID = 'deleted-user';
export const DELETED_CHANNEL_ID = 'deleted-channel';

export const EXPORT_FORMAT_VERSION = 1;

/** Format of the export's progress: raise it when its phase list changes (2: move offers). */
const EXPORT_STATE_VERSION = 2;
/** The export's channels phase in its phase list, and where a further round of channels begins. */
const EXPORT_CHANNELS_PHASE = 4;

/** Objects per list page. Small enough that one page's work fits in a request budget. */
export const DEFAULT_PAGE_SIZE = 100;

export interface PrivacyBuckets extends ResumeEnv {
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
	/** Studio brand kit and shared assets under studio/<userId>/ (lib/studio/brandKit.ts) */
	MEDIA_PRIVATE?: unknown;
	subtitles?: unknown;
	/** Upload markers (ops/upload-reaper/created/<videoId>) and the scheduler's entries: lib/videoSideRecords.ts */
	global_settings?: unknown;
	SCHEDULED_VIDEOS?: unknown;
	'scheduled-videos'?: unknown;
	/** Channel subscriptions (lib/subscription-store.ts) */
	NOTIFICATIONS_DB?: D1Database;
	/** Profile email reports (lib/admin/profile-emails.ts) and legacy profile restore copies (lib/admin/legacy-restore.ts) */
	ADMIN_BACKUPS?: unknown;
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
	/** Index of the phase to (re)start. */
	p: number;
	/** When the run began (ms): a channel moved to another account since is nobody's to export or erase here. */
	t: number;
	/** R2 list cursor of the page to (re)start within that phase. */
	c?: string;
	/** This batch of the user's channels: the id, or [id, key] where they differ. Erased ones go after their content. */
	o: Array<string | [string, string]>;
	/** The user has more channels than the batch holds: another round follows. */
	more?: boolean;
	/** Export: where the next round's channels begin, and the round (0: the first). */
	q?: { c?: string; x?: string };
	r?: number;
	/** Item-driven phases: the last item finished (items run in sorted order). */
	x?: string;
	/** Item-driven phases: the item `c` belongs to (an item's own list pages). */
	y?: string;
	/** How the current phase finds its records: 'i' indexes, 's' bucket scan. */
	m?: 'i' | 's';
}

const freshCheckpoint = (): Checkpoint => ({ p: 0, t: Date.now(), o: [] });

/** The checkpoint of a sealed state (written by this module for this format), or null. */
function checkpointOf(state: Record<string, unknown>): Checkpoint | null {
	const { p, t, o } = state as Partial<Checkpoint>;
	if (!Number.isInteger(p) || (p as number) < 0 || !Number.isFinite(t) || !Array.isArray(o)) return null;
	return state as unknown as Checkpoint;
}

/** Room for a batch of channels in the progress (the rest of a token is cursors and keys, see RESUME_TOKEN_MAX). */
const OWNED_BYTES = 1500;
const channelIdOf = (entry: string | [string, string]): string => (typeof entry === 'string' ? entry : entry[0]);
const channelKeyOf = (entry: string | [string, string]): string => (typeof entry === 'string' ? entry : entry[1]);
const ownedIds = (cp: Checkpoint): string[] => cp.o.map(channelIdOf);

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
	env: ResumeEnv,
	scope: ResumeScope,
): Promise<{ complete: boolean; resumeToken?: string; restarted: boolean; unavailable?: ResumeUnavailableError }> {
	let checkpoint: Checkpoint | null = null;
	if (resumeToken) {
		const opened = await openResume(env, scope, resumeToken);
		if ('state' in opened) checkpoint = checkpointOf(opened.state);
		const reason = 'restart' in opened ? opened.restart : 'unusable';
		// Expired is ordinary; a state this server did not make for this run is worth a line
		if (!checkpoint) logger[reason === 'expired' ? 'debug' : 'warn']('[Privacy] Run starts over', { purpose: scope.purpose, userId: scope.userId, reason });
	}
	const restarted = !!resumeToken && !checkpoint;
	checkpoint ??= freshCheckpoint();
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
		return { complete: true, restarted };
	} catch (error) {
		if (!(error instanceof BudgetExhausted)) throw error;
		try {
			return { complete: false, resumeToken: await sealResume(env, scope, checkpoint), restarted };
		} catch (unavailable) {
			if (!(unavailable instanceof ResumeUnavailableError)) throw unavailable;
			return { complete: false, restarted, unavailable };
		}
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

/** Whose a record is: the user's, the channel owner's (`follow`, when it names the user), nobody's to touch, or someone else's. */
type Standing = { kind: 'mine' | 'leave' | 'other' } | { kind: 'follow'; ownerId: string };
const MINE: Standing = { kind: 'mine' };
const LEAVE: Standing = { kind: 'leave' };
const NOT_MINE: Standing = { kind: 'other' };

/**
 * Who a channel, and a record on it, belongs to right now: read from the live records, never from the checkpoint.
 *
 *   the live channel is the user's            → the user's
 *   ... and came to them after the run began  → left alone
 *   the live channel is someone else's        → never the user's; a record that still names them follows the channel
 *   there is no channel record                → the record's own owner decides (nobody owns the channel)
 *   the channel record cannot be read         → left alone and reported (`onUnreadable`)
 */
function ownershipOf(env: PrivacyBuckets, userId: string, onUnreadable: (channelId: string) => void) {
	const bucket = asBucket(env.channels);
	const reported = new Set<string>();
	const report = (channelId: string) => {
		if (reported.has(channelId)) return;
		reported.add(channelId);
		onUnreadable(channelId);
	};

	/** The stored channel; 'unreadable' when it is not a channel record that names its owner. */
	const readChannel = async (ctx: PhaseContext, key: string): Promise<Json | 'absent' | 'unreadable'> => {
		ctx.budget.spend();
		const stored = await bucket.get(key);
		if (!stored) return 'absent';
		try {
			const channel = await stored.json<Json>();
			return channel && typeof channel === 'object' && typeof channel.userId === 'string' && channel.userId ? channel : 'unreadable';
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			return 'unreadable';
		}
	};

	/** Moved to another account after this run began. */
	const movedSince = (ctx: PhaseContext, channel: Json): boolean => {
		const at = typeof channel.transferredAt === 'string' ? Date.parse(channel.transferredAt) : NaN;
		return Number.isFinite(at) && at >= ctx.checkpoint.t;
	};

	/** The channel is the user's, as it was when the run began. */
	const isOwned = (ctx: PhaseContext, channel: Json | 'absent' | 'unreadable'): channel is Json =>
		typeof channel === 'object' && channel.userId === userId && !movedSince(ctx, channel);

	/** Adds a channel to the batch; false when the batch is full (the first one always fits). */
	const remember = (ctx: PhaseContext, channelId: string, key: string): boolean => {
		const { o } = ctx.checkpoint;
		if (o.some((entry) => channelKeyOf(entry) === key)) return true;
		const next: Checkpoint['o'] = [...o, channelId === key ? key : [channelId, key]];
		if (o.length && new TextEncoder().encode(JSON.stringify(next)).length > OWNED_BYTES) return false;
		ctx.checkpoint.o = next;
		return true;
	};

	/** One of the batch's channels, still the user's. */
	const ownsChannel = async (ctx: PhaseContext, channelId: string): Promise<boolean> => {
		for (const entry of ctx.checkpoint.o) {
			if (channelIdOf(entry) !== channelId) continue;
			const channel = await readChannel(ctx, channelKeyOf(entry));
			if (channel === 'unreadable') report(channelId);
			if (isOwned(ctx, channel)) return true;
		}
		return false;
	};

	/** An unreadable channel met on the way: reported if the ownership index names the user as its owner. */
	const reportIfMine = async (ctx: PhaseContext, channelId: string): Promise<void> => {
		const db = env.SEARCH_DB as D1Database | undefined;
		if (!db) return;
		ctx.budget.spend();
		if (await db.prepare(`SELECT 1 AS n FROM content_ownership WHERE kind = 'channel' AND id = ? AND owner_id = ?`).bind(channelId, userId).first()) report(channelId);
	};

	/** Whose a video, stream, post or playlist is. */
	const standing = async (ctx: PhaseContext, record: Json, channelId: unknown = record.channelId): Promise<Standing> => {
		if (record.userId !== userId) {
			return typeof channelId === 'string' && ownedIds(ctx.checkpoint).includes(channelId) && (await ownsChannel(ctx, channelId)) ? MINE : NOT_MINE;
		}
		// No channel (a personal playlist; uploads without one carry the user id)
		if (typeof channelId !== 'string' || !channelId || channelId === userId) return MINE;
		const known = ctx.checkpoint.o.find((entry) => channelIdOf(entry) === channelId);
		const channel = await readChannel(ctx, known ? channelKeyOf(known) : channelId);
		if (channel === 'absent') return MINE;
		if (channel === 'unreadable') {
			report(channelId);
			return LEAVE;
		}
		if (channel.userId !== userId) return { kind: 'follow', ownerId: channel.userId };
		return movedSince(ctx, channel) ? LEAVE : MINE;
	};
	const isMine = async (ctx: PhaseContext, record: Json): Promise<boolean> => (await standing(ctx, record)).kind === 'mine';

	return { readChannel, isOwned, remember, ownsChannel, reportIfMine, report, standing, isMine };
}

export interface RunOptions {
	resumeToken?: string;
	pageSize?: number;
	/** A channel record that cannot be read: what it holds is left out (export) or left in place (erase). Must not throw. */
	onChannelUnreadable?: (channelId: string) => void;
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
	/** The given token could not be continued: this pass is the first one again, drop what earlier passes returned. */
	restarted?: boolean;
	/** The user's channels whose stored record cannot be read (left out; the team is told). */
	unreadableChannels?: string[];
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
	/** Studio brand kit and the shared assets' names and sizes (the files themselves are downloadable in Studio) */
	studioBrandKit: Json[];
	reportsFiled: Json[];
	/** Notification preferences and when the notification menu was last opened (NOTIFICATIONS_DB). */
	notificationState: Json[];
	/** Roles held on other people's channels (docs/specs/CHANNEL-ROLES.md §12). */
	channelMemberships: Json[];
	/** Channel invitations sent to or by the account (SEARCH_DB channel_invites). */
	channelInvites: Json[];
	/** Live chat messages the account wrote (SEARCH_DB live_chat_messages, wiki E17). */
	liveChatMessages: Json[];
	/** Live streams and premieres the account asked to be reminded of (NOTIFICATIONS_DB live_reminders). */
	liveReminders: Json[];
	/** Private time-stamped notes on videos (SEARCH_DB video_notes, wiki E21-D9); deleted notes are left out. */
	videoNotes: Json[];
	/** Channel move offers sent to or by the account (SEARCH_DB channel_move_offers, wiki AUN-CHANNEL-CLAIM). */
	channelMoveOffers: Json[];
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
	'studioBrandKit',
	'reportsFiled',
	'notificationState',
	'channelMemberships',
	'channelInvites',
	'liveChatMessages',
	'liveReminders',
	'videoNotes',
	'channelMoveOffers',
] as const;

const EXPORT_NOTES = [
	'Your sign-in account (email, password, sessions) is held by the Al Ummah Now account service; export it from your account settings.',
	'Pseudonymous event logs (views, likes, analytics beacons) are kept for 13 months for abuse prevention and statistics and are not individually exportable; see docs/compliance/GDPR.md.',
	"Video metadata is included for videos you own; comments other people left on them are summarized as counts because they are those people's data.",
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
 * budget runs out the result has `complete: false` and a `resumeToken`. Throws
 * ResumeUnavailableError when it needs another pass and cannot make the token:
 * a part is never returned as if it were all.
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
	const own = ownershipOf(env, userId, (channelId) => {
		(out.unreadableChannels ??= []).push(channelId);
		options.onChannelUnreadable?.(channelId);
	});

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

	const readEach = (bucket: BucketLike, filter: (key: string) => boolean, onItem: (item: Json, key: string, ctx: PhaseContext) => void | Promise<void>) =>
		async (ctx: PhaseContext, prefix?: string) =>
			scanPages(bucket, prefix, ctx, (objects) =>
				atomically(async () => {
					for (const { key } of objects) {
						if (!filter(key)) continue;
						const item = await readJson<Json>(bucket, key, ctx.budget);
						if (item) await onItem(item, key, ctx);
					}
				}),
			);

	const exportPages = async (
		ctx: PhaseContext,
		database: D1Database | undefined,
		read: (d: D1Database, user: string, cursor: string | null) => Promise<{ rows: Json[]; cursor: string | null }>,
		into: Json[],
	) => {
		if (!database) return;
		try {
			do {
				ctx.budget.spend();
				const page = await read(database, userId, ctx.checkpoint.c ?? null);
				into.push(...page.rows);
				ctx.checkpoint.c = page.cursor ?? undefined;
			} while (ctx.checkpoint.c);
		} catch (error) {
			if (!isMissingTable(error)) throw error;
		}
	};

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
		async (ctx) => {
			if (!env.MEDIA_PRIVATE) return;
			ctx.budget.spend();
			const kit = await readBrandKit(env.MEDIA_PRIVATE, userId);
			ctx.budget.spend();
			const { assets } = await readAssets(env.MEDIA_PRIVATE, userId);
			if (kit || assets.length) out.studioBrandKit.push({ brandKit: kit, assets });
		},
		// Channels, one at a time: the user's with their sections and tabs, their roles and subscriptions on others.
		// A round ends when its batch is full; the next one goes on from there (the `posts` phase)
		async (ctx) => {
			const cp = ctx.checkpoint;
			if (cp.q) {
				({ c: cp.c, x: cp.x } = cp.q);
				cp.q = undefined;
			}
			const bucket = asBucket(env.channels);
			do {
				ctx.budget.spend();
				const page = await bucket.list({ cursor: cp.c, limit: ctx.pageSize });
				for (const { key } of page.objects) {
					if (cp.x !== undefined && key <= cp.x) continue;
					let full = false;
					await atomically(async () => {
						const channel = await own.readChannel(ctx, key);
						if (channel === 'absent') return;
						if (channel === 'unreadable') return own.reportIfMine(ctx, key);
						const channelId = channel.id ?? key;
						if (own.isOwned(ctx, channel)) {
							if (!own.remember(ctx, channelId, key)) {
								full = true;
								return;
							}
							const { subscriptions, ...rest } = channel;
							out.channels.push({ ...rest, subscribersCount: Array.isArray(subscriptions) ? subscriptions.length : 0 });
							const sections = asBucket(env.channel_sections);
							for (const sectionKey of await allKeys(sections, `${channelId}/`, ctx.budget)) {
								const section = await readJson<Json>(sections, sectionKey, ctx.budget);
								if (section) out.channelSections.push(section);
							}
							const tabs = await readJson<Json>(asBucket(env.channel_tabs), `channel-tabs/${channelId}`, ctx.budget);
							if (tabs) out.channelTabs.push(tabs);
						}
						for (const member of Array.isArray(channel.members) ? (channel.members as Json[]) : []) {
							if (member?.userId === userId) out.channelMemberships.push({ channelId, channelName: channel.name, role: member.role, addedAt: member.addedAt ?? null });
						}
						for (const sub of (channel.subscriptions as Reaction[] | undefined) ?? []) {
							// A member's own subscription is stored under a `user:` key, not a channel id
							if (sub?.userId === userId) out.subscriptions.push({ ...sub, channelId: subscriberChannelOf(sub.channelId as string | undefined), subscribedToChannelId: channelId });
						}
					});
					if (full) {
						cp.q = { c: cp.c, x: cp.x };
						return;
					}
					cp.x = key;
				}
				cp.c = page.truncated ? page.cursor : undefined;
			} while (cp.c);
		},
		(ctx) =>
			readEach(asBucket(env.videos), isVideoKey, async (video, key, c) => {
				const videoId = video.id ?? key;
				// Later rounds: only what others put on that round's channels (the rest came with the first)
				const again = !!c.checkpoint.r;
				if ((!again || video.userId !== userId) && (await own.isMine(c, video))) out.videos.push(summariseOwnedVideo(video));
				if (again) return;
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
		async (ctx) => {
			await readEach(community, (key) => !key.endsWith('/index.json'), async (post, _key, c) => {
				if ((!c.checkpoint.r || post.userId !== userId) && (await own.isMine(c, post))) out.communityPosts.push(post);
			})(ctx, 'posts/');
			// The next batch of channels, if the last one was full
			if (!ctx.checkpoint.q) return;
			ctx.checkpoint.o = [];
			ctx.checkpoint.r = (ctx.checkpoint.r ?? 0) + 1;
			ctx.checkpoint.p = EXPORT_CHANNELS_PHASE - 1;
		},
		(ctx) =>
			readEach(community, (key) => !key.endsWith('/index.json') && !key.endsWith('/pinned.json') && !key.includes('/reply-parents/'), (comment) => {
				if (comment.userId === userId) out.communityComments.push(comment);
			})(ctx, 'comments/'),
		(ctx) => readEach(community, (key) => key.endsWith(userSuffix), (r) => void out.communityLikes.push(r))(ctx, 'likes/'),
		(ctx) => readEach(community, (key) => key.endsWith(userSuffix), (r) => void out.pollVotes.push(r))(ctx, 'votes/'),
		(ctx) => readEach(community, (key) => key.endsWith(userSuffix), (r) => void out.communityCommentLikes.push(r))(ctx, 'comment-likes/'),
		(ctx) =>
			readEach(asBucket(env.playlists), () => true, async (playlist, _key, c) => {
				if (playlist.userId === userId && (await own.isMine(c, playlist))) out.playlists.push(playlist);
			})(ctx),
		(ctx) => readEach(asBucket(env.reports), (key) => key.endsWith(`:${userId}`), (r) => void out.reportsFiled.push(r))(ctx),
		// Subscriptions stored in D1 (SCALABILITY-AUDIT AV-4)
		(ctx) =>
			atomically(async () => {
				if (!env.NOTIFICATIONS_DB) return;
				ctx.budget.spend();
				out.subscriptions.push(...(await exportUserSubscriptions(env.NOTIFICATIONS_DB, userId)));
			}),
		// Channel invitations to or from the account. Sent ones leave out the
		// invitee's email: that is the other person's data.
		(ctx) =>
			atomically(async () => {
				const sdb = env.SEARCH_DB as D1Database | undefined;
				if (!sdb) return;
				ctx.budget.spend();
				const { results } = await sdb
					.prepare('SELECT id, channel_id, role, invitee_user_id, invitee_email, by_email, invited_by, status, created_at, expires_at, responded_at FROM channel_invites WHERE invitee_user_id = ? OR invited_by = ? ORDER BY created_at')
					.bind(userId, userId)
					.all<Json>();
				for (const row of results ?? []) {
					const received = row.invitee_user_id === userId;
					out.channelInvites.push({
						id: row.id,
						direction: received ? 'received' : 'sent',
						channelId: row.channel_id,
						role: row.role,
						status: row.status,
						// A sent email invitation never names the account it reached
						...(received ? { invitedBy: row.invited_by } : { inviteeUserId: row.by_email ? null : (row.invitee_user_id ?? null) }),
						createdAt: row.created_at,
						expiresAt: row.expires_at,
						respondedAt: row.responded_at ?? null,
					});
				}
			}),
		// Private video notes, in video and time order (idx_video_notes_user_video)
		(ctx) =>
			atomically(async () => {
				const sdb = env.SEARCH_DB as D1Database | undefined;
				if (!sdb) return;
				ctx.budget.spend();
				const { results } = await sdb
					.prepare('SELECT id, video_id, start_ms, end_ms, body, created_at, updated_at FROM video_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY video_id, start_ms, id')
					.bind(userId)
					.all<Json>();
				for (const row of results ?? []) {
					out.videoNotes.push({ id: row.id, videoId: row.video_id, startMs: row.start_ms, endMs: row.end_ms ?? null, text: row.body, createdAt: row.created_at, updatedAt: row.updated_at });
				}
			}),
		// Notification preferences and the menu-seen time (D1, one row each)
		(ctx) =>
			atomically(async () => {
				const ndb = env.NOTIFICATIONS_DB;
				if (!ndb) return;
				ctx.budget.spend();
				const [seenAt, settings, email, quietHours] = await Promise.all([
					getSeenAt(ndb, userId),
					getSettings(ndb, userId),
					getEmailSettings(ndb, userId),
					getQuietHours(ndb, userId),
				]);
				out.notificationState.push({ menuSeenAt: seenAt === null ? null : new Date(seenAt).toISOString(), categories: settings, email, quietHours });
			}),
		// Live chat and reminders (wiki E17), a page at a time until done
		(ctx) => exportPages(ctx, env.SEARCH_DB as D1Database | undefined, exportLiveChat, out.liveChatMessages),
		(ctx) => exportPages(ctx, env.NOTIFICATIONS_DB, exportLiveReminders, out.liveReminders),
		// Channel move offers to or from the account (idx_channel_move_offers_to / _from)
		(ctx) =>
			atomically(async () => {
				const sdb = env.SEARCH_DB as D1Database | undefined;
				if (!sdb) return;
				ctx.budget.spend();
				out.channelMoveOffers.push(...(await exportMoveOffers(sdb, userId)));
			}),
	];

	const result = await runPhases(phases, budget, options.resumeToken, options.pageSize ?? DEFAULT_PAGE_SIZE, env, { purpose: 'export', userId, version: EXPORT_STATE_VERSION });
	if (result.unavailable) throw result.unavailable;
	out.complete = result.complete;
	if (result.restarted) out.restarted = true;
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
	/** The given token could not be continued: this pass was the first one again. */
	restarted?: boolean;
	deleted: Record<string, number>;
	anonymized: Record<string, number>;
	/** Owned video ids removed from R2 in this pass (their streaming media is removed via onVideoDeleted). */
	deletedVideoIds: string[];
	/**
	 * Community posts the user liked or voted on. Their cached counters are
	 * recomputed by the processor from the remaining records on the next like/vote.
	 */
	affectedPosts: string[];
	/** Non-fatal gaps recorded when a required binding was absent (e.g. ADMIN_BACKUPS unbound). */
	errors?: string[];
}

/** `errors` entry of a channel whose record cannot be read: it and what is on it stay, and the team is told. */
export const channelUnreadableError = (channelId: string) => `channel_unreadable:${channelId}`;

/** A pass's summary, and why no further pass can follow it (the pass's own follow-ups still apply). */
export interface ErasurePass extends ErasureSummary {
	unavailable?: ResumeUnavailableError;
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

/**
 * The user's comments a channel removed (#771) are deleted, not anonymised:
 * hidden from everyone already, their replies went with them.
 */
function dropChannelRemoved(comments: unknown, userId: string, summary: ErasureSummary): boolean {
	if (!Array.isArray(comments)) return false;
	let changed = false;
	for (let i = comments.length - 1; i >= 0; i--) {
		const comment = comments[i] as Json | null;
		if (!comment || typeof comment !== 'object') continue;
		if (comment.userId === userId && comment.removedBy === 'channel') {
			comments.splice(i, 1);
			bump(summary.deleted, 'videoComments');
			changed = true;
		} else if (dropChannelRemoved(comment.replies, userId, summary)) {
			changed = true;
		}
	}
	return changed;
}

function anonymizeVideoComments(comments: unknown, userId: string, summary: ErasureSummary): boolean {
	let changed = dropChannelRemoved(comments, userId, summary);
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

/** Format of the erase's progress: raise it when its phase list changes (2: #1073, 3: wiki E17, 4: kept by the server, 5: move offers). */
const ERASE_STATE_VERSION = 5;
/** The erase's channels phase in its phase list, and where a further round of channels begins. */
const ERASE_CHANNELS_PHASE = 4;

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
): Promise<ErasurePass> {
	const summary: ErasureSummary = { userId, complete: true, deleted: {}, anonymized: {}, deletedVideoIds: [], affectedPosts: [] };
	const community = asBucket(env.community_posts);
	const channels = asBucket(env.channels);
	const videos = asBucket(env.videos);
	const playlists = asBucket(env.playlists);
	const reports = asBucket(env.reports);
	const userSuffix = `/${userId}.json`;
	const db = env.SEARCH_DB as SearchDb | undefined;
	const own = ownershipOf(env, userId, (channelId) => {
		summary.errors = [...(summary.errors ?? []), channelUnreadableError(channelId)];
		options.onChannelUnreadable?.(channelId);
	});

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

	/** A record on someone else's channel that still names the user as its owner goes to the channel's owner, as a move does. */
	const followChannel = (fresh: Json, standing: Standing, channelId: unknown): boolean => {
		if (standing.kind !== 'follow' || fresh.userId !== userId || fresh.channelId !== channelId) return false;
		fresh.userId = standing.ownerId;
		return true;
	};

	/** An owned channel is remembered (deleted later); another channel loses the user's subscriptions. */
	const eraseInChannel = async (ctx: PhaseContext, key: string, channel: Json) => {
		if (channel.userId === userId) {
			// One that came to the user after the run began is not part of it; a full batch leaves the rest to another round
			if (own.isOwned(ctx, channel) && !own.remember(ctx, channel.id ?? key, key)) ctx.checkpoint.more = true;
			return;
		}
		const isMember = (list: unknown) => Array.isArray(list) && list.some((m: Json) => m?.userId === userId);
		if (stripUserReactions(channel.subscriptions, userId).removed === 0 && !isMember(channel.members)) return;
		// Conditional rewrite of the fresh channel (SCALABILITY-AUDIT AV-23):
		// the user's subscription and their channel role (docs/specs/CHANNEL-ROLES.md §12)
		let removed = 0;
		let membership = false;
		await updateJson<Json>(channels, key, (fresh) => {
			const stripped = stripUserReactions(fresh.subscriptions, userId);
			removed = stripped.removed;
			membership = isMember(fresh.members);
			if (removed === 0 && !membership) return false;
			if (removed > 0) fresh.subscriptions = stripped.list;
			if (membership) fresh.members = (fresh.members as Json[]).filter((m) => m?.userId !== userId);
			if (fresh.memberChangedAt && typeof fresh.memberChangedAt === 'object') delete (fresh.memberChangedAt as Json)[userId];
			return true;
		}, ctx.budget);
		if (removed > 0) bump(summary.deleted, 'subscriptions', removed);
		if (membership) bump(summary.deleted, 'channelMemberships');
	};

	const eraseInChannelKey = async (ctx: PhaseContext, key: string) => {
		const channel = await own.readChannel(ctx, key);
		if (channel === 'unreadable') return own.reportIfMine(ctx, key);
		if (channel !== 'absent') await eraseInChannel(ctx, key, channel);
	};

	/** An owned video is deleted (subtitles, media, record); another loses the user's reactions and comments. */
	const eraseInVideo = async (ctx: PhaseContext, key: string, video: Json) => {
		const videoId = video.id ?? key;
		const standing = await own.standing(ctx, video);
		if (standing.kind === 'mine') {
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
		// A video or stream the user uploaded or created as a channel member stays
		// with the channel; only the record of who did it is anonymised
		const namedAs = (record: Json) => (['uploadedBy', 'createdBy'] as const).filter((field) => record[field] === userId);
		const needsChange = (['likes', 'dislikes'] as const).some((kind) => stripUserReactions(video[kind], userId).removed > 0)
			|| namedAs(video).length > 0
			|| standing.kind === 'follow'
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
			for (const field of namedAs(fresh)) {
				fresh[field] = DELETED_USER_ID;
				bump(attempt.anonymized, 'memberUploads');
				changed = true;
			}
			if (followChannel(fresh, standing, video.channelId)) {
				bump(attempt.anonymized, 'channelRecords');
				changed = true;
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
		const owned = ownedIds(ctx.checkpoint).includes(channelId) && (await own.ownsChannel(ctx, channelId));
		if (file === 'index.json') {
			if (owned) await deleteKeys(community, [key], ctx.budget);
			return;
		}
		let postId = file.replace(/\.json$/, '');
		if (!owned) {
			const post = await readJson<Json>(community, key, ctx.budget);
			if (!post) return;
			const standing: Standing = post.userId === userId ? await own.standing(ctx, post, channelId) : NOT_MINE;
			if (standing.kind !== 'mine') {
				// On someone else's channel: the post stays with the channel and goes to its owner; the
				// author is anonymised (docs/specs/CHANNEL-ROLES.md §12)
				if (standing.kind !== 'follow' && post.authorId !== userId) return;
				let anonymized = false;
				let followed = false;
				await updateJson<Json>(community, key, (fresh) => {
					anonymized = fresh.authorId === userId;
					if (anonymized) fresh.authorId = DELETED_USER_ID;
					followed = followChannel(fresh, standing, post.channelId);
					return anonymized || followed;
				}, ctx.budget);
				if (anonymized) bump(summary.anonymized, 'memberPosts');
				if (followed) bump(summary.anonymized, 'channelRecords');
				return;
			}
			postId = post.id ?? postId;
		}
		for (const prefix of [`comments/${postId}/`, `likes/${postId}/`, `votes/${postId}/`, `comment-likes/${postId}/`]) {
			await deleteKeys(community, await allKeys(community, prefix, ctx.budget), ctx.budget);
		}
		// The post and its location record (lib/community-posts.ts) in one delete
		await deleteKeys(community, [key, postLocationKey(postId)], ctx.budget);
		bump(summary.deleted, 'communityPosts');
	};

	/** The user's comment on someone else's post: anonymised, thread kept. */
	const anonymizeCommunityCommentKey = async (ctx: PhaseContext, key: string) => {
		// Index documents, the pinned pointer and reply-parent pointers hold no user data
		if (key.endsWith('/index.json') || key.endsWith('/pinned.json') || key.includes('/reply-parents/')) return;
		// Conditional rewrite (SCALABILITY-AUDIT AV-23): a concurrent like or
		// edit cannot bring the author back
		let anonymized = false;
		let removedByChannel = false;
		await updateJson<Json>(community, key, (comment) => {
			anonymized = false;
			removedByChannel = false;
			if (comment.userId !== userId) return false;
			// Removed by the channel (#771): deleted with its replies below, not anonymised
			if (comment.removedBy === 'channel') {
				removedByChannel = true;
				return false;
			}
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
		if (removedByChannel) {
			const match = /^comments\/([^/]+)\/(?:top-level|replies\/([^/]+))\/([^/]+)\.json$/.exec(key);
			if (match) {
				ctx.budget.spend(8);
				await purgePostComment({ community_posts: env.community_posts } as never, match[1], match[3], match[2] ?? null, () => true);
				bump(summary.deleted, 'communityComments');
			}
		}
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
		if (!playlist) return;
		const standing: Standing = playlist.userId === userId ? await own.standing(ctx, playlist) : NOT_MINE;
		if (standing.kind === 'mine') {
			mine.push(key);
			return;
		}
		// On someone else's channel: kept, it goes to the channel's owner; one created as a member loses its creator
		if (standing.kind !== 'follow' && playlist.createdBy !== userId) return;
		let anonymized = false;
		let followed = false;
		await updateJson<Json>(playlists, key, (fresh) => {
			anonymized = fresh.createdBy === userId;
			if (anonymized) fresh.createdBy = DELETED_USER_ID;
			followed = followChannel(fresh, standing, playlist.channelId);
			return anonymized || followed;
		}, ctx.budget);
		if (anonymized) bump(summary.anonymized, 'memberPlaylists');
		if (followed) bump(summary.anonymized, 'channelRecords');
	};

	/** The touched posts (comments, likes, votes, comment likes) from the footprints. */
	const touchedPosts = (ctx: PhaseContext) => {
		ctx.budget.spend();
		return footprintTargets(db!, userId, 'post');
	};

	// Channel move offers (search migration 0121): open ones close, a move that hasn't changed hands stops, and the
	// id leaves the rest (lib/channelMoveData.ts). Before the channels, so none changes hands while the run erases
	// them: what a move made the user's until then is theirs, so the run's beginning counts from here. And again
	// before the profile, for an offer made or accepted meanwhile: a channel that came that way starts the run over.
	// Phases of their own: the last one can't resume part way, so what is added there raises what one pass must fit.
	const moveOffers = (first: boolean): Phase => async (ctx) => {
		if (!db) return;
		const offers = { SEARCH_DB: db as unknown as D1Database, channels: env.channels };
		const { closed, received } = await stopMoveOffers(offers, userId, (n) => ctx.budget.spend(n));
		if (closed > 0) bump(summary.deleted, 'channelMoveOffers', closed);
		const cp = ctx.checkpoint;
		if (!first && received) {
			// Over from the top; the first phase forgets the offer then, so a pass that dies here finds it again
			Object.assign(cp, { p: -1, o: [], more: undefined });
			return;
		}
		ctx.budget.spend();
		await forgetMoveOffers(offers.SEARCH_DB, userId, DELETED_USER_ID);
		// The next moment: a flip in this one was an offer's, found above
		if (first) cp.t = Date.now() + 1;
	};

	const phases: Phase[] = [
		moveOffers(true),
		deletePrefixPages(asBucket(env.watch_history), `${userId}:`, 'watchHistory'),
		// Studio brand kit and shared assets (institution mode)
		async (ctx) => {
			if (env.MEDIA_PRIVATE) await deletePrefixPages(asBucket(env.MEDIA_PRIVATE), studioPrefix(userId), 'studioBrandKit')(ctx);
		},
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
				await eachItem(ctx, [...owned, ...subscribed], (key) => eraseInChannelKey(ctx, key));
			},
			(ctx) =>
				scanPages(channels, undefined, ctx, async (objects) => {
					for (const { key } of objects) await eraseInChannelKey(ctx, key);
				}),
		),

		// Sections and tabs of owned channels
		async (ctx) => {
			const sections = asBucket(env.channel_sections);
			await eachItem(ctx, ownedIds(ctx.checkpoint), async (channelId) => {
				if (!(await own.ownsChannel(ctx, channelId))) return;
				bump(summary.deleted, 'channelSections', await deleteKeys(sections, await allKeys(sections, `${channelId}/`, ctx.budget), ctx.budget));
				await deleteKeys(sections, [sectionOrderKey(channelId)], ctx.budget);
				await deleteKeys(asBucket(env.channel_tabs), [`channel-tabs/${channelId}`], ctx.budget);
			});
		},

		// Videos: delete owned (with subtitles and media), strip reactions and anonymise comments elsewhere
		either(
			(ix) => ix.videos,
			async (ctx) => {
				// Owned by the user or on an owned channel, soft-deleted ones included
				const ids = await selectColumn(ctx, db!, `SELECT id FROM content_ownership WHERE kind = 'video' AND owner_id = ?`, [userId]);
				const batch = ownedIds(ctx.checkpoint);
				for (let i = 0; i < batch.length; i += IN_CHUNK) {
					const chunk = batch.slice(i, i + IN_CHUNK);
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
				const items = [...ownedIds(ctx.checkpoint).map((channelId) => `c:${channelId}`), ...authored.map((key) => `a:${key}`)];
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

		// Owned channels themselves (after their videos, posts and playlists). Everything kept by channel id goes
		// before the record, so nothing later needs to know a channel whose record is gone
		async (ctx) => {
			await eachItem(ctx, ctx.checkpoint.o.map(channelKeyOf), async (key) => {
				const channel = await own.readChannel(ctx, key);
				// Gone already: a resumed pass deleted it (and ran its hook) before
				if (channel === 'absent') return;
				if (channel === 'unreadable') return own.report(key);
				// Moved meanwhile: the new owner's, only the user's own traces leave it
				if (!own.isOwned(ctx, channel)) return eraseInChannel(ctx, key, channel);
				const channelId = channel.id ?? key;
				const tabs = asBucket(env.channel_tabs);
				if (db) {
					// Studio's comment index and channel blocks (#771)
					ctx.budget.spend();
					await eraseCommentsOfChannel(db, channelId);
				}
				// Free the channel's @handle (index entry in channel_tabs, see lib/channelHandles.ts)
				// only if the entry is this channel's (a stale field must not free another channel's handle)
				if (typeof channel.handle === 'string' && channel.handle) {
					const handleKey = `channel-handles/${channel.handle.toLowerCase()}`;
					const entry = await readJson<Json>(tabs, handleKey, ctx.budget);
					if (entry?.channelId === channelId) await deleteKeys(tabs, [handleKey], ctx.budget);
				}
				// Its old handles (handle history) stop redirecting to it and stop being held
				await eraseChannelHandleHistory(tabs, channelId, ctx.budget);
				// The check and the delete after the hook must fit, or a resumed pass would run the hook again
				ctx.budget.reserve(2);
				if (hooks.onChannelDeleted) await hooks.onChannelDeleted(channelId, channel);
				if (!own.isOwned(ctx, await own.readChannel(ctx, key))) return;
				bump(summary.deleted, 'channels', await deleteKeys(channels, [key], ctx.budget));
			});
			// More channels than one batch holds: the deleted ones are gone, so the next round finds the rest
			if (!ctx.checkpoint.more) return;
			ctx.checkpoint.more = undefined;
			ctx.checkpoint.o = [];
			ctx.checkpoint.p = ERASE_CHANNELS_PHASE - 1;
		},

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

		// Live chat and reminders (wiki E17): every row the person wrote or set, in bounded batches. Their own
		// streams' chat goes with the stream records above (admin job 'live.purge-streams')
		async (ctx) => {
			try {
				for (let n = LIVE_DELETE_BATCH; db && n === LIVE_DELETE_BATCH; ) {
					ctx.budget.spend();
					n = await eraseLiveChat(db as unknown as D1Database, userId);
					if (n > 0) bump(summary.deleted, 'liveChatMessages', n);
				}
				for (let n = LIVE_DELETE_BATCH; env.NOTIFICATIONS_DB && n === LIVE_DELETE_BATCH; ) {
					ctx.budget.spend();
					n = await eraseLiveReminders(env.NOTIFICATIONS_DB, userId);
					if (n > 0) bump(summary.deleted, 'liveReminders', n);
				}
			} catch (error) {
				if (!isMissingTable(error)) throw error;
			}
		},

		moveOffers(false),
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
				// Studio's comment index and channel blocks (#771): the user's comments and blocks of them (their
				// channels' rows went with the channels); a block they placed keeps the row without naming them
				ctx.budget.spend(4);
				await eraseChannelComments(db, userId);
				// The search binding is the D1 database; the minutes need its batch and all()
				await eraseCaptionMinutes(db as unknown as D1Database, userId);
				// Tier requests (name, about) and tier changes
				await eraseTierHistory(db as unknown as D1Database, userId);
				// Move from YouTube: imports, snapshots, consents, staged captions (Google token revoked)
				ctx.budget.spend(2);
				await eraseYoutubeImports(db as unknown as D1Database, env as never, userId);
				// Channel teams (docs/specs/CHANNEL-ROLES.md §12): invitations to or
				// from the account are cancelled, its activity rows anonymized
				const cancelled = await cancelInvitesOfUser(db as unknown as D1Database, userId);
				if (cancelled.length) bump(summary.deleted, 'channelInvites', cancelled.length);
				await anonymizeTeamActivity(db as unknown as D1Database, userId, DELETED_USER_ID);
				// Their live sessions' tier owner (search migration 0060)
				await eraseLiveSessionOwner(db as unknown as D1Database, userId);
				// Private video notes, tombstones included (search migration 0095, wiki E21-D9)
				ctx.budget.spend();
				const notes = await (db as unknown as D1Database).prepare('DELETE FROM video_notes WHERE user_id = ?').bind(userId).run();
				bump(summary.deleted, 'videoNotes', Number(notes.meta?.changes ?? 0));
			}
			const profiles = asBucket(env.profiles);
			ctx.budget.spend();
			const stored = await profiles.get(userId);
			if (stored) {
				const storedProfile = await stored.json<Json>().catch(() => null);
				// Free the user's @handle (public profile, lib/userHandles.ts) if the index entry is theirs
				if (storedProfile && typeof storedProfile.handle === 'string' && storedProfile.handle) {
					const tabs = asBucket(env.channel_tabs);
					const handleKey = `channel-handles/${storedProfile.handle.toLowerCase()}`;
					const entry = await readJson<Json>(tabs, handleKey, ctx.budget);
					if (entry?.kind === 'user' && entry.userId === userId && !entry.channelId) await deleteKeys(tabs, [handleKey], ctx.budget);
				}
				if (hooks.onProfileDeleted) await hooks.onProfileDeleted(userId, storedProfile);
				await deleteKeys(profiles, [userId], ctx.budget);
				bump(summary.deleted, 'profile');
			}
			// Profile email reports and legacy profile restore copies, found by their own per-user pointer
			// prefixes. After the profile: a job running now either sees the profile gone or has its pointer here.
			if (env.ADMIN_BACKUPS) {
				const backups = asBucket(env.ADMIN_BACKUPS);
				bump(summary.deleted, 'profileEmailReports', await eraseProfileEmailReports(backups, userId, ctx.budget));
				const removed = await eraseLegacyRestoreBackups(backups, userId, ctx.budget);
				if (removed > 0) bump(summary.deleted, 'legacyRestoreBackups', removed);
			} else {
				logger.warn('[Privacy] ADMIN_BACKUPS is not bound; skipped legacy-restore backup erasure', { userId });
				summary.errors = [...(summary.errors ?? []), ADMIN_BACKUPS_UNBOUND_ERROR];
			}
			// Who uploaded which image (lib/csam/imageOwners.ts). CSAM evidence is not here: it
			// lives in its own bucket that no erasure touches (docs/specs/CSAM-RESPONSE.md §4)
			if (db) {
				ctx.budget.spend();
				await eraseImageOwners(db as never, userId);
			}
		},
	];

	const result = await runPhases(phases, budget, options.resumeToken, options.pageSize ?? DEFAULT_PAGE_SIZE, env, { purpose: 'erase', userId, version: ERASE_STATE_VERSION });
	summary.complete = result.complete;
	if (result.resumeToken) summary.resumeToken = result.resumeToken;
	if (result.restarted) summary.restarted = true;
	return result.unavailable ? { ...summary, unavailable: result.unavailable } : summary;
}

export type { BucketLike };
