/**
 * /internal/admin/* — platform content management for admin-api.
 *
 * Behind the INTERNAL_API_KEY check of every /internal/* path (src/index.ts):
 * only admin-api calls these, after checking the admin's permissions. It
 * passes the acting admin's id in X-Admin-Actor (recorded on suspensions and
 * bans) and writes the audit log itself.
 */
import { DEFAULT_TIER_ID } from '@al-ummah/shared-types';
import { readTierChange, recordTierChange, recordTierChangeEmail } from '../lib/tierChanges';
import { readRequestsAllowed, setRequestsAllowed, upgradeMode } from '../lib/upgradeMode';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
	ADMIN_CHANNEL_SORTS,
	ADMIN_USER_SORTS,
	ADMIN_VIDEO_SORTS,
	ADMIN_VIDEO_STATUSES,
	ADMIN_JOB_STATUSES,
	ADMIN_CREATOR_FILTERS,
	MAX_BULK_CREATOR_TIER,
	ADMIN_TIER_REQUEST_FILTERS,
	type AccountNoticeRequest,
	LIVE_PROVIDERS,
} from '@al-ummah/shared-types';
import { listChannels, listComments, listUsers, listVideos, type WaitUntil } from '../lib/admin/directory';
import { searchUsers } from '../lib/admin/userSearch';
import { AccountNoticeBody, accountEmailContact, accountNotice } from '../lib/admin/accountNotices';
import { cleanLookup, lookup } from '../lib/admin/lookup';
import { videoThumbnailFolder } from '../lib/admin/purgeCopies';
import * as admin from '../lib/admin/service';
import { checkImage, checkThumbnailShapeFor, storeImage } from '../lib/admin/images';
import { countJobs, getJob, listJobs, retryJob } from '../lib/admin/jobs';
import { LegacyRestoreError } from '../lib/admin/legacy-restore';
import { isDeletionKind, listDeletions } from '../lib/admin/deletions';
import { logger } from '../lib/logger';
import R2Repository from '../lib/r2Repo';
import type { LiveEnv } from '../lib/live/providers';
import { providerUsage } from '../lib/live/service';
import { listChannelOverrides, readLiveRouting, readSession, removeChannelOverride, resetLiveRouting, setChannelOverride, writeLiveRouting } from '../lib/live/store';
import { compareProviders } from '../lib/live/qoe';
import { readStream, streamEnd, type LiveStreamRecord } from '../lib/live/streams';
import { bulkAssignTier, limitHitsSince, listCreators, tierCounts, withCreatorInfo } from '../lib/admin/creators';
import { createChannelFor, lookupAccount, provisionProfile } from '../lib/admin/invites';
import { readCaptionSettings, writeCaptionSettings } from '../lib/captions/jobs';
import { listTranslationEditions } from '../lib/quran/translations';
import { platformEditions } from '../endpoints/quran/quranTranslations';
import { addGrant, CaptionMinutesError, listGrants, listLedger, readUsage, revokeGrant, subjectOfUser } from '../lib/captions/minutes';
import { assignTier, createTier, CreatorTierError, deleteTier, purgeTiers, readAssignment, readDefaultTierId, readDeletedTiers, readTier, readTiers, reorderTiers, requestTierPurge, restoreTier, saveTier, setDefaultTier } from '../lib/creatorTiers';
import { shortLinkClicksReport, siteVisitsReport } from '../lib/site-visits';
import { decideTierRequest, decisionNotificationPayload, listTierRequests, readRequestRow, readTierRequestForAdmin, recordDelivery, TierRequestError, type TierRequestsEnv } from '../lib/tierRequests';
import { enqueueNotification, type NotificationsEnv } from '../lib/notifications';
import { InitiateBodySchema, initiateUpload, type InitiateBody } from '../endpoints/video/uploadInitiate';
import { loadChannelRecord } from '../lib/channelAccess';

type Env = { Bindings: admin.AdminServiceEnv & Record<string, unknown> };

/** The request's waitUntil (index passes run after the response); none outside a Worker request. */
const waitUntilOf = (c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }): WaitUntil | undefined => {
	try {
		const ctx = c.executionCtx;
		return (p) => ctx.waitUntil(p);
	} catch {
		return undefined;
	}
};

const app = new Hono<Env>();

const yesNo = z.enum(['yes', 'no']).optional();
const page = {
	page: z.coerce.number().int().min(1).optional(),
	pageSize: z.coerce.number().int().min(1).max(100).optional(),
	// A picker's page (admin-api /api/suggest with an empty query): no COUNT over the whole list
	noTotal: z.enum(['1', 'true']).optional().transform((v) => !!v),
};
const ids = z
	.string()
	.optional()
	.transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional();

const ChannelQuery = z.object({
	q: z.string().max(200).optional(),
	verified: yesNo,
	suspended: yesNo,
	ownerId: z.string().max(200).optional(),
	ids,
	createdFrom: date,
	createdTo: date,
	sort: z.enum(ADMIN_CHANNEL_SORTS as [string, ...string[]]).optional(),
	...page,
});

const VideoQuery = z.object({
	q: z.string().max(200).optional(),
	channelId: z.string().max(200).optional(),
	noChannel: z.enum(['1', 'true']).optional().transform((v) => !!v),
	ownerId: z.string().max(200).optional(),
	status: z.enum(ADMIN_VIDEO_STATUSES as [string, ...string[]]).optional(),
	visibility: z.enum(['public', 'private']).optional(),
	hidden: yesNo,
	ids,
	createdFrom: date,
	createdTo: date,
	sort: z.enum(ADMIN_VIDEO_SORTS as [string, ...string[]]).optional(),
	...page,
});

const UserQuery = z.object({
	q: z.string().max(200).optional(),
	banned: yesNo,
	/** a tier id, `none`, needs_tier, has_tier or hit_limit (lib/admin/directory.ts userTierWhere) */
	tier: z.string().max(40).optional(),
	sort: z.enum(ADMIN_USER_SORTS as [string, ...string[]]).optional(),
	...page,
});

const UserSearchQuery = z.object({
	q: z.string().max(200).default(''),
	exclude: ids,
	channelId: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(20).optional(),
});

/** A usr_ id (what the transfer moves a channel to); an email or @handle is refused with a clear code. */
const USER_ID = /^[A-Za-z0-9_-]{1,200}$/;

const CommentQuery = z.object({
	q: z.string().max(200).optional(),
	videoId: z.string().max(200).optional(),
	userId: z.string().max(200).optional(),
	...page,
});

const CursorQuery = z.object({
	q: z.string().max(200).optional(),
	channelId: z.string().max(200).optional(),
	ownerId: z.string().max(200).optional(),
	cursor: z.string().max(2000).optional(),
	pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const ChannelEdit = z
	.object({
		name: z.string().trim().min(1).max(100).optional(),
		handle: z.string().trim().min(1).max(60).optional(),
		description: z.string().max(5000).optional(),
		avatarUrl: z.string().url().nullable().optional(),
		coverUrl: z.string().url().nullable().optional(),
	})
	.strict();

const VideoEdit = z
	.object({
		title: z.string().trim().min(1).max(200).optional(),
		description: z.string().max(10000).optional(),
		isPublic: z.boolean().optional(),
	})
	.strict();

const UserEdit = z
	.object({
		displayName: z.string().trim().min(1).max(100).optional(),
		userName: z.string().trim().min(1).max(60).optional(),
		bio: z.string().max(5000).optional(),
	})
	.strict();

const Reason = z.object({ reason: z.string().max(1000).optional() });

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
	const result = schema.safeParse(value);
	if (!result.success) throw new admin.AdminError(400, 'invalid_request', result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
	return result.data;
}

const actor = (c: Context<Env>) => c.req.header('X-Admin-Actor') || 'admin';
const body = async (c: Context<Env>) => c.req.json().catch(() => ({}));
const ok = (c: Context<Env>, result: unknown) => c.json({ success: true, result });

app.onError((error, c) => {
	if (error instanceof CaptionMinutesError) {
		return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
	}
	if (error instanceof CreatorTierError) {
		return c.json({ success: false, code: error.code, error: error.message, ...(error.details ?? {}) }, error.status as 400);
	}
	if (error instanceof TierRequestError) {
		return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
	}
	if (error instanceof admin.AdminError) {
		return c.json({ success: false, code: error.code, error: error.message }, error.status);
	}
	if (error instanceof LegacyRestoreError) {
		return c.json({ success: false, code: error.code, error: error.message }, error.status);
	}
	logger.error('[AdminInternal] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
	return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

// Batch lookup for the admin reports queue: titles, channels, owners and user names of a page in one call
app.post('/lookup', async (c) => ok(c, await lookup(c.env, cleanLookup(await body(c)))));

// Channels
// Site visits (D-SEO-9): landing pages and sources of the videos site, last ?days= (1-365, default 30)
// with the short link clicks of the same days (alummahnow.link, wiki AUN-SHORT-LINKS) as shortLinks
app.get('/analytics/visits', async (c) => {
	const db = (c.env as { NOTIFICATIONS_DB?: D1Database }).NOTIFICATIONS_DB;
	const days = Number(c.req.query('days') ?? 30);
	const [visits, shortLinks] = await Promise.all([siteVisitsReport(db, days), shortLinkClicksReport(db, days)]);
	return ok(c, { ...visits, shortLinks });
});
app.get('/channels', async (c) => ok(c, await listChannels(c.env, parse(ChannelQuery, c.req.query()) as never, waitUntilOf(c))));
app.get('/channels/:id', async (c) => ok(c, await admin.channelDetail(c.env, c.req.param('id'))));
app.patch('/channels/:id', async (c) => ok(c, await admin.updateChannel(c.env, c.req.param('id'), parse(ChannelEdit, await body(c)))));
app.post('/channels/:id/images/:kind', async (c) => {
	const kind = c.req.param('kind');
	if (kind !== 'avatar' && kind !== 'cover') throw new admin.AdminError(400, 'invalid_image_kind');
	const form = await c.req.parseBody();
	const url = await storeImage(c.env, checkImage(form.photo), kind);
	return ok(c, await admin.updateChannel(c.env, c.req.param('id'), kind === 'avatar' ? { avatarUrl: url } : { coverUrl: url }));
});
app.post('/channels/:id/suspend', async (c) => ok(c, await admin.suspendChannel(c.env, c.req.param('id'), actor(c), parse(Reason, await body(c)).reason)));
app.post('/channels/:id/unsuspend', async (c) => ok(c, await admin.unsuspendChannel(c.env, c.req.param('id'), actor(c))));
app.post('/channels/:id/transfer', async (c) => {
	const { newOwnerId } = parse(z.object({ newOwnerId: z.string().trim().min(1).max(200) }), await body(c));
	if (!USER_ID.test(newOwnerId)) throw new admin.AdminError(400, 'invalid_new_owner');
	return ok(c, await admin.transferChannel(c.env, c.req.param('id'), newOwnerId, actor(c)));
});
app.delete('/channels/:id', async (c) => ok(c, await admin.deleteChannel(c.env, c.req.param('id'), actor(c), parse(Reason, await body(c)).reason)));

// Videos
app.get('/videos', async (c) => ok(c, await listVideos(c.env, parse(VideoQuery, c.req.query()) as never, waitUntilOf(c))));
app.get('/videos/:id', async (c) => ok(c, await admin.videoDetail(c.env, c.req.param('id'))));
app.patch('/videos/:id', async (c) => ok(c, await admin.updateVideo(c.env, c.req.param('id'), parse(VideoEdit, await body(c)))));
app.post('/videos/:id/thumbnail', async (c) => {
	const form = await c.req.parseBody();
	const file = checkImage(form.photo);
	await checkThumbnailShapeFor(c.env as never, c.req.param('id'), file);
	// In the video's own folder, so its purge erases it (lib/admin/purgeCopies.ts)
	const url = await storeImage(c.env, file, 'thumbnail', videoThumbnailFolder(c.req.param('id')).slice(0, -1));
	return ok(c, await admin.updateVideo(c.env, c.req.param('id'), { thumbnailUrl: url }));
});
app.post('/videos/:id/move', async (c) => {
	const { channelId } = parse(z.object({ channelId: z.string().min(1).max(200) }), await body(c));
	return ok(c, await admin.moveVideo(c.env, c.req.param('id'), channelId, actor(c)));
});
app.post('/videos/:id/unpublish', async (c) => ok(c, await admin.setVideoPublished(c.env, c.req.param('id'), false)));
app.post('/videos/:id/republish', async (c) => ok(c, await admin.setVideoPublished(c.env, c.req.param('id'), true)));
app.post('/videos/:id/reprocess', async (c) => ok(c, await admin.reprocessVideo(c.env, c.req.param('id'))));
app.delete('/videos/:id', async (c) => ok(c, await admin.deleteVideo(c.env, c.req.param('id'), actor(c), parse(Reason, await body(c)).reason)));

// Comments, playlists, community posts
app.get('/comments', async (c) => ok(c, await listComments(c.env, parse(CommentQuery, c.req.query()), waitUntilOf(c))));
app.delete('/videos/:videoId/comments/:commentId', async (c) => {
	const { deletion } = await admin.deleteComment(c.env, c.req.param('videoId'), c.req.param('commentId'), actor(c), parse(Reason, await body(c)).reason);
	return ok(c, { deleted: true, deletion });
});
app.get('/playlists', async (c) => ok(c, await admin.listPlaylists(c.env, parse(CursorQuery, c.req.query()))));
app.delete('/playlists/:id', async (c) => {
	const { deletion } = await admin.deletePlaylist(c.env, c.req.param('id'), actor(c), parse(Reason, await body(c)).reason);
	return ok(c, { deleted: true, deletion });
});
app.get('/posts', async (c) => ok(c, await admin.listPosts(c.env, parse(CursorQuery, c.req.query()))));
app.delete('/posts/:channelId/:postId', async (c) => {
	const { deletion } = await admin.deletePost(c.env, c.req.param('channelId'), c.req.param('postId'), actor(c), parse(Reason, await body(c)).reason);
	return ok(c, { deleted: true, deletion });
});

// Users (videos profiles)
app.get('/users', async (c) => {
	const query = parse(UserQuery, c.req.query());
	const page = await listUsers(c.env, query as never, waitUntilOf(c));
	// The Users list carries each user's creator tier (the old Creators page); pickers (noTotal) do not need it
	return ok(c, query.noTotal ? page : await withCreatorInfo(c.env as never, page));
});
app.get('/users/search', async (c) => ok(c, await searchUsers(c.env, parse(UserSearchQuery, c.req.query()) as never)));
// Invited creators (docs/admin/INVITES.md): who has an email, the invited user's
// profile (create-only) and channels made for them
app.get('/accounts', async (c) => ok(c, await lookupAccount(c.env, c.req.query('email') ?? '')));
app.post('/users/provision', async (c) => {
	const input = parse(z.object({ userId: z.string().min(1).max(64), email: z.string().trim().email().max(254), displayName: z.string().max(100).nullable().optional() }), await body(c));
	return ok(c, await provisionProfile(c.env, input as { userId: string; email: string; displayName?: string | null }));
});
app.get('/users/:id', async (c) => ok(c, await admin.userDetail(c.env, c.req.param('id'))));
app.post('/users/:id/channels', async (c) => {
	const input = parse(z.object({ name: z.string().trim().min(1).max(100), handle: z.string().trim().max(60).nullable().optional(), description: z.string().max(5000).nullable().optional() }), await body(c));
	return ok(c, { channel: await createChannelFor(c.env, c.req.param('id'), input as { name: string; handle?: string | null; description?: string | null }) });
});
// Admin Tools bulk import (wiki TOOLS-ADMIN TA-5): the normal initiate for any channel, owned by the
// channel's owner and uploaded by the acting admin, without the tier gate, upload counters, draft limit
// or edge limiter (admin-api checked imports:manage and audits every call). Processing, review,
// captions and categories are the same as any upload. The TUS session belongs to the admin, whose
// Admin Tools token then uploads to /api/videos/tus.
const AdminImportInitiate = InitiateBodySchema.omit({ youtubeImport: true }).extend({ channelId: z.string().min(1).max(200) });
app.post('/import/initiate', async (c) => {
	const adminId = c.req.header('X-Admin-Actor') ?? '';
	if (!/^usr_[A-Za-z0-9]{8,64}$/.test(adminId)) throw new admin.AdminError(400, 'invalid_request', 'X-Admin-Actor must be the importing admin\'s user id');
	const { channelId, ...input } = parse(AdminImportInitiate, await body(c));
	const channel = await loadChannelRecord(c.env as never, channelId);
	if (!channel?.userId || channel.isDeleted) throw new admin.AdminError(404, 'channel_not_found', 'No such channel');
	if (channel.isSuspended) throw new admin.AdminError(409, 'channel_suspended', 'The channel is suspended');
	const ownerId = channel.userId;
	return initiateUpload(
		c as never,
		{ userId: adminId, roles: null, channelId, ownerId, ...(ownerId !== adminId ? { uploadedBy: adminId } : {}), adminImport: true },
		input as InitiateBody,
	);
});
app.patch('/users/:id', async (c) => ok(c, await admin.updateUser(c.env, c.req.param('id'), parse(UserEdit, await body(c)))));
app.post('/users/:id/ban', async (c) => ok(c, await admin.banUser(c.env, c.req.param('id'), actor(c), parse(Reason, await body(c)).reason)));
app.post('/users/:id/unban', async (c) => ok(c, await admin.unbanUser(c.env, c.req.param('id'), actor(c))));
app.post('/users/:id/delete-data', async (c) => ok(c, await admin.deleteUserData(c.env, c.req.param('id'), actor(c), parse(Reason, await body(c)).reason)));
// A revoked invite's data once auth purged its account (#716); called by admin-api's trash cleanup only
app.post('/users/:id/erase-revoked-invite', async (c) => ok(c, await admin.eraseRevokedInviteUser(c.env, c.req.param('id'), actor(c))));
// Account notices (warn-user): the in-app notice, and what an account email needs (admin-api sends it)
app.post('/users/:id/account-notices', async (c) => ok(c, await accountNotice(c.env as never, c.req.param('id'), parse(AccountNoticeBody, await body(c)) as AccountNoticeRequest)));
app.get('/users/:id/account-email', async (c) => ok(c, await accountEmailContact(c.env as never, c.req.param('id'))));

// Soft deletes (lib/admin/deletions.ts): "Recently deleted", restore, "Delete permanently now"
const DeletionQuery = z.object({
	kind: z.string().refine(isDeletionKind, 'unknown kind').optional(),
	cursor: z.string().max(400).optional(),
	pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
const deletionKind = (c: Context<Env>) => {
	const kind = c.req.param('kind') ?? '';
	if (!isDeletionKind(kind)) throw new admin.AdminError(404, 'deletion_not_found');
	return kind;
};
app.get('/deletions', async (c) => {
	const query = parse(DeletionQuery, c.req.query());
	return ok(c, await listDeletions(c.env.SEARCH_DB as never, { kind: query.kind as never, cursor: query.cursor, pageSize: query.pageSize }));
});
app.post('/deletions/:kind/:id/restore', async (c) => ok(c, await admin.restoreDeletion(c.env, deletionKind(c), c.req.param('id'), actor(c))));
app.post('/deletions/:kind/:id/purge', async (c) => ok(c, { deletion: await admin.requestDeletionPurge(c.env, deletionKind(c), c.req.param('id'), actor(c)) }));

// Restore legacy profile fields (lib/admin/legacy-restore.ts): dry run, then a queued job
const LegacyRestoreRequest = z.object({
	/** admin-api's id for this run, also in its audit rows */
	runId: z.guid().optional(),
	approved: z
		.array(z.object({ id: z.string().regex(/^usr_[0-9a-f]{32}$/), legacyId: z.string().regex(/^[0-9a-f]{32}$/), fields: z.array(z.string().max(100)).min(1).max(50) }))
		.min(1)
		.max(300),
});
app.get('/legacy-profiles/plan', async (c) => ok(c, await admin.legacyRestorePlan(c.env)));
app.post('/legacy-profiles/restore', async (c) => {
	const request = parse(LegacyRestoreRequest, await body(c));
	return ok(c, await admin.startLegacyRestore(c.env, request.approved as never, actor(c), request.runId));
});

// Creator tiers (lib/creatorTiers.ts): who may upload and create channels.
// admin-api checks creators:manage and writes the audit row.
const CreatorQuery = z.object({
	q: z.string().max(200).optional(),
	filter: z.enum(ADMIN_CREATOR_FILTERS).optional(),
	tierId: z.string().max(40).optional(),
	...page,
});
const TierAssign = z
	.object({ tierId: z.string().min(1).max(40).nullable(), source: z.enum(['admin', 'subscription']).optional(), quiet: z.boolean().optional() })
	.strict();
/** Who held no row held the default (Member): the "from" of a tier change */
const heldTier = (assignment: { tierId: string } | null | undefined) => assignment?.tierId ?? DEFAULT_TIER_ID;
const TierBody = z
	.object({
		id: z.string().max(40).optional(),
		name: z.string().max(60).optional(),
		unlimited: z.boolean().optional(),
		perHour: z.coerce.number().optional(),
		perDay: z.coerce.number().optional(),
		maxConcurrent: z.coerce.number().optional(),
		maxChannels: z.coerce.number().nullable().optional(),
		captionMinutesMonth: z.coerce.number().optional(),
		importCountsAgainstLimits: z.boolean().optional(),
		audioTracksPerVideo: z.coerce.number().optional(),
		live: z.boolean().optional(),
		liveHoursMonth: z.coerce.number().optional(),
		liveMaxConcurrent: z.coerce.number().optional(),
		liveMaxStreamMinutes: z.coerce.number().optional(),
		uploads: z.boolean().optional(),
		channels: z.boolean().optional(),
		pages: z.boolean().optional(),
		requestable: z.boolean().optional(),
		hidden: z.boolean().optional(),
		sortOrder: z.coerce.number().optional(),
		nameAr: z.string().max(60).nullable().optional(),
		description: z.string().max(200).nullable().optional(),
		descriptionAr: z.string().max(200).nullable().optional(),
	})
	.strict();
const searchDb = (c: Context<Env>) => c.env.SEARCH_DB as D1Database;
app.get('/creators', async (c) => ok(c, await listCreators(c.env as never, parse(CreatorQuery, c.req.query()))));
app.get('/creator-tiers', async (c) => {
	// ?counts=0: the definitions only. The counts scan every profile and every assignment
	// (on QA 2026-11-11: ~38k + 11k rows per call, 1,700 calls in 17 min from the admin user
	// page's tier control, the top reader of the search database while it was overloaded),
	// and only the Creators overview and Tiers pages show them.
	if (c.req.query('counts') === '0') {
		const [items, defaultTierId] = await Promise.all([readTiers(searchDb(c)), readDefaultTierId(searchDb(c))]);
		return ok(c, { items, defaultTierId });
	}
	const [items, defaultTierId, counts, limitHits7d] = await Promise.all([
		readTiers(searchDb(c)),
		readDefaultTierId(searchDb(c)),
		tierCounts(searchDb(c)),
		limitHitsSince(searchDb(c)),
	]);
	return ok(c, { items, defaultTierId, counts, limitHits7d });
});
// Rank: the whole list in its new order, lowest first (admin-api audits it, with Undo)
const TierOrder = z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(200) }).strict();
app.put('/creator-tiers/order', async (c) => ok(c, await reorderTiers(searchDb(c), parse(TierOrder, await body(c)).ids, actor(c))));
// The default tier: what new sign-ups get (a tier id). admin-api audits it.
const TierDefault = z.object({ tierId: z.string().min(1).max(40) }).strict();
app.put('/creator-tiers/default', async (c) => ok(c, await setDefaultTier(searchDb(c), parse(TierDefault, await body(c)).tierId, actor(c))));
const TierBulk = z
	.object({
		userIds: z.array(z.string().min(1).max(128)).min(1).max(MAX_BULK_CREATOR_TIER),
		tierId: z.string().min(1).max(40).nullable(),
		dryRun: z.boolean().optional(),
	})
	.strict();
app.post('/creators/tier', async (c) => {
	const input = parse(TierBulk, await body(c)) as { userIds: string[]; tierId: string | null; dryRun?: boolean };
	const result = await bulkAssignTier(searchDb(c), input, actor(c));
	if (!input.dryRun) {
		for (const { userId, previous } of result.changed) {
			await recordTierChange(c.env as never, { userId, from: heldTier(previous), to: input.tierId ?? DEFAULT_TIER_ID, reason: 'admin' });
		}
	}
	return ok(c, result);
});
app.post('/creator-tiers', async (c) => {
	// Admins never type ids: any id sent is ignored and one is made from the name (lib/creatorTiers newTierId)
	const { id: _ignored, ...input } = parse(TierBody, await body(c));
	return ok(c, await createTier(searchDb(c), input, actor(c), undefined, { requireLocalized: true }));
});
app.put('/creator-tiers/:id', async (c) => ok(c, await saveTier(searchDb(c), c.req.param('id'), parse(TierBody, await body(c)), actor(c), { requireLocalized: true })));
// Soft delete (restorable for 30 days); the admin-api cleanup purges through POST /creator-tiers/purge
const TierDelete = z.object({ reason: z.string().max(500).nullable().optional() }).strict();
app.delete('/creator-tiers/:id', async (c) => {
	const input = parse(TierDelete, (await c.req.json().catch(() => null)) ?? {});
	return ok(c, await deleteTier(searchDb(c), c.req.param('id'), { actorId: actor(c), reason: input.reason?.trim() || null }));
});
app.get('/creator-tiers/deleted', async (c) => ok(c, { items: await readDeletedTiers(searchDb(c)) }));
app.post('/creator-tiers/:id/restore', async (c) => ok(c, await restoreTier(searchDb(c), c.req.param('id'))));
app.post('/creator-tiers/:id/purge-request', async (c) => ok(c, await requestTierPurge(searchDb(c), c.req.param('id'), actor(c))));
const TierPurge = z
	.object({ cutoff: z.string().datetime(), limit: z.number().int().min(1).max(500).optional(), keep: z.array(z.string().min(1).max(40)).max(500).optional() })
	.strict();
app.post('/creator-tiers/purge', async (c) => {
	const input = parse(TierPurge, await body(c));
	return ok(c, await purgeTiers(searchDb(c), input.cutoff, input.limit, input.keep ?? []));
});
app.get('/users/:id/creator-tier', async (c) => ok(c, { assignment: await readAssignment(searchDb(c), c.req.param('id')) }));
app.put('/users/:id/creator-tier', async (c) => {
	const input = parse(TierAssign, await body(c));
	const result = await assignTier(searchDb(c), c.req.param('id'), input.tierId, actor(c), input.source ?? 'admin');
	// The user is told (in the app and by email), except for an invite's tier (`quiet`: the invite says it)
	await recordTierChange(c.env as never, { userId: c.req.param('id'), from: heldTier(result.previous), to: result.assignment?.tierId ?? DEFAULT_TIER_ID, reason: 'admin', quiet: input.quiet === true });
	return ok(c, result);
});

// Tier requests (lib/tierRequests.ts, wiki AUN-TIER-REQUESTS): the admin's queue and decisions.
// admin-api checks creators:manage, writes the audit row and queues the delivery job, which calls
// notify (in-app notice, deduplicated per decision) and records the email outcome through delivery.
const TierRequestQuery = z.object({
	filter: z.enum(ADMIN_TIER_REQUEST_FILTERS).optional(),
	cursor: z.string().max(400).optional(),
	pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
const TierDecision = z.object({ decision: z.enum(['approve', 'decline']), reason: z.string().max(2000).nullable().optional() }).strict();
const TierDelivery = z
	.object({ notified: z.boolean().optional(), emailStatus: z.enum(['queued', 'sent', 'sunk', 'disabled', 'no_address', 'failed']).optional(), emailError: z.string().max(500).nullable().optional() })
	.strict();
const tierRequestsEnv = (c: Context<Env>) => c.env as unknown as TierRequestsEnv;
// "Allow tier requests" (owner rule 2026-11-15, shared-types UPGRADE_MODES): with no payment provider
// enabled it decides between the request form and "Upgrades aren't available"; admin-api audits it
app.get('/tier-requests/settings', async (c) => ok(c, { ...(await readRequestsAllowed(searchDb(c))), ...(await upgradeMode(c.env as never)) }));
const RequestsSetting = z.object({ allowed: z.boolean() }).strict();
app.put('/tier-requests/settings', async (c) => {
	const result = await setRequestsAllowed(searchDb(c), parse(RequestsSetting, await body(c)).allowed, actor(c));
	return ok(c, { ...result, ...(await upgradeMode(c.env as never)) });
});
app.get('/tier-requests', async (c) => ok(c, await listTierRequests(tierRequestsEnv(c), parse(TierRequestQuery, c.req.query()) as never)));
app.get('/tier-requests/:id', async (c) => ok(c, { request: await readTierRequestForAdmin(tierRequestsEnv(c), c.req.param('id')) }));
app.post('/tier-requests/:id/decide', async (c) => {
	const input = parse(TierDecision, await body(c));
	const result = await decideTierRequest(searchDb(c), c.req.param('id'), { approve: input.decision === 'approve', reason: input.reason ?? null, actorId: actor(c) });
	// Stored as a change; the decision's own delivery tells the user (no second notice)
	if (result.request.status === 'approved') {
		await recordTierChange(c.env as never, { userId: result.request.userId, from: result.request.fromTierId, to: result.request.tierId, reason: 'request', requestId: result.request.id, quiet: true });
	}
	return ok(c, result);
});
// Tier changes (lib/tierChanges.ts): the email job reads one and records what it did
app.get('/tier-changes/:id', async (c) => {
	const change = await readTierChange(searchDb(c), c.req.param('id'));
	if (!change) throw new CreatorTierError(404, 'tier_change_not_found');
	return ok(c, { change });
});
const TierChangeDelivery = z.object({ emailStatus: z.string().min(1).max(20), emailError: z.string().max(500).nullable().optional() }).strict();
app.post('/tier-changes/:id/delivery', async (c) => {
	const input = parse(TierChangeDelivery, await body(c));
	await recordTierChangeEmail(searchDb(c), c.req.param('id'), input.emailStatus, input.emailError ?? null);
	return ok(c, { recorded: true });
});
app.post('/tier-requests/:id/notify', async (c) => {
	const db = searchDb(c);
	const row = await readRequestRow(db, c.req.param('id'));
	if (!row) throw new TierRequestError(404, 'tier_request_not_found');
	if (row.status !== 'approved' && row.status !== 'declined') throw new TierRequestError(409, 'tier_request_not_decided');
	const payload = decisionNotificationPayload(
		{ id: row.id, userId: row.user_id, status: row.status, decidedAt: row.decided_at, tierName: row.tier_name },
		await readTier(db, row.tier_id),
	);
	if (!(await enqueueNotification(c.env as unknown as NotificationsEnv, payload))) throw new TierRequestError(503, 'notification_not_queued', 'The notification could not be queued');
	await recordDelivery(db, row.id, { notified: true });
	return ok(c, { queued: true, decidedAt: row.decided_at });
});
app.post('/tier-requests/:id/delivery', async (c) => {
	const input = parse(TierDelivery, await body(c));
	await recordDelivery(searchDb(c), c.req.param('id'), input);
	return ok(c, { recorded: true });
});

// Caption minutes (AUN-CAPTIONS §6): the user's month and the admin's grants; admin-api audits each change
app.get('/users/:id/caption-minutes', async (c) => {
	const db = searchDb(c);
	const userId = c.req.param('id');
	const usage = await readUsage(db, await subjectOfUser(db, userId));
	const [grants, ledger] = await Promise.all([listGrants(db, userId), listLedger(db, userId)]);
	return ok(c, { usage, grants, ledger });
});
const GrantBody = z.object({ minutes: z.coerce.number(), scope: z.enum(['month', 'until_used']), reason: z.string().max(500) }).strict();
app.post('/users/:id/caption-minutes/grants', async (c) => ok(c, { grant: await addGrant(searchDb(c), c.req.param('id'), parse(GrantBody, await body(c)), actor(c)) }));
const GrantRevoke = z.object({ reason: z.string().max(500) }).strict();
app.post('/users/:id/caption-minutes/grants/:grantId/revoke', async (c) =>
	ok(c, { grant: await revokeGrant(searchDb(c), c.req.param('id'), c.req.param('grantId'), parse(GrantRevoke, await body(c)).reason, actor(c)) }),
);

// Captions & translation settings (AUN-CAPTIONS §10, O2, O4, O5, O6, O7); admin-api audits each change
const deeplKeyBound = async (c: Context<Env>) => {
	const v = (c.env as { AI_KEY_DEEPL?: string | { get(): Promise<string> } }).AI_KEY_DEEPL;
	return !!v && !!(typeof v === 'string' ? v : await v.get().catch(() => ''));
};
app.get('/captions/settings', async (c) => {
	const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
	const [settings, editions, translations] = await Promise.all([
		readCaptionSettings(c.env as never),
		platformEditions(searchDb(c)),
		searchDb(c).prepare('SELECT kind, COUNT(*) AS requests, SUM(items) AS items, SUM(cached) AS cached FROM translation_audit WHERE at >= ? GROUP BY kind').bind(since).all<{ kind: string; requests: number; items: number; cached: number }>(),
	]);
	return ok(c, { settings, deeplKeyBound: await deeplKeyBound(c), editions, translations30d: translations.results ?? [] });
});
app.put('/captions/settings', async (c) => ok(c, { settings: await writeCaptionSettings(c.env as never, await body(c)), deeplKeyBound: await deeplKeyBound(c) }));
app.get('/captions/quran-translations/editions', async (c) => {
	const lang = (c.req.query('language') ?? '').toLowerCase();
	if (!/^[a-z]{2,3}$/.test(lang)) throw new admin.AdminError(400, 'invalid_language', 'a language code is required');
	const editions = await listTranslationEditions(c.env as never, lang);
	if (!editions) throw new admin.AdminError(409, 'quran_unavailable', 'Quran Foundation cannot be reached');
	return ok(c, { editions });
});
const EditionBody = z.object({ id: z.coerce.number().int().positive() }).strict();
app.put('/captions/quran-translations/:lang', async (c) => {
	const lang = c.req.param('lang').toLowerCase();
	if (!/^[a-z]{2,3}$/.test(lang) || lang === 'ar') throw new admin.AdminError(400, 'invalid_language', 'a language code other than ar');
	const { id } = parse(EditionBody, await body(c));
	const editions = await listTranslationEditions(c.env as never, lang);
	if (!editions) throw new admin.AdminError(409, 'quran_unavailable', 'Quran Foundation cannot be reached; nothing changed');
	const edition = editions.find((e) => e.id === id);
	if (!edition) throw new admin.AdminError(400, 'unknown_edition', `no ${lang} edition ${id}`);
	await searchDb(c)
		.prepare(
			`INSERT INTO quran_translation_defaults (lang, qf_translation_id, name, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (lang) DO UPDATE SET qf_translation_id = excluded.qf_translation_id, name = excluded.name, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
		)
		.bind(lang, edition.id, edition.name.slice(0, 200), actor(c), new Date().toISOString())
		.run();
	return ok(c, { editions: await platformEditions(searchDb(c)) });
});
app.delete('/captions/quran-translations/:lang', async (c) => {
	await searchDb(c).prepare('DELETE FROM quran_translation_defaults WHERE lang = ?').bind(c.req.param('lang').toLowerCase()).run();
	return ok(c, { editions: await platformEditions(searchDb(c)) });
});

// Admin jobs (heavy actions run from the admin-jobs queue; see lib/admin/jobs.ts)
const JobQuery = z.object({
	status: z.enum(ADMIN_JOB_STATUSES).optional(),
	targetKind: z.enum(['channel', 'video', 'user']).optional(),
	targetId: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(100).optional(),
});
app.get('/jobs', async (c) => ok(c, { items: await listJobs(c.env, parse(JobQuery, c.req.query())) }));
app.get('/jobs/counts', async (c) => ok(c, { failed: await countJobs(c.env, 'failed'), retrying: await countJobs(c.env, 'retrying') }));
app.get('/jobs/:id', async (c) => {
	const job = await getJob(c.env, c.req.param('id'));
	if (!job) throw new admin.AdminError(404, 'job_not_found');
	return ok(c, job);
});
app.post('/jobs/:id/retry', async (c) => {
	const existing = await getJob(c.env, c.req.param('id'));
	if (!existing) throw new admin.AdminError(404, 'job_not_found');
	if (existing.status !== 'failed') throw new admin.AdminError(409, 'job_not_failed', 'Only failed jobs can be retried');
	return ok(c, await retryJob(c.env, existing.id));
});

// ---------------------------------------------------------------------------
// Live streaming providers (D3; lib/live/*). admin-api checks the permission
// and writes the audit rows. Settings apply to new streams within 15 s and
// never touch a session that is live.
// ---------------------------------------------------------------------------
const LiveOverride = z.object({ provider: z.enum(LIVE_PROVIDERS), note: z.string().max(500).nullable().optional() }).strict();
const LiveMove = z.object({ provider: z.enum(LIVE_PROVIDERS).nullable() }).strict();
const LiveCompareQuery = z.object({
	from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
	to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
	tests: z.enum(['1', '0']).optional(),
});
const LiveSessionsQuery = z.object({
	status: z.enum(['active', 'recent']).optional(),
	provider: z.enum(LIVE_PROVIDERS).optional(),
	limit: z.coerce.number().int().min(1).max(200).optional(),
});
const liveEnv = (c: Context<Env>) => c.env as unknown as LiveEnv & { videos: R2Bucket };

app.get('/live/settings', async (c) => {
	const settings = await readLiveRouting(searchDb(c));
	const [usage, overrides] = await Promise.all([providerUsage(liveEnv(c), settings), listChannelOverrides(searchDb(c))]);
	return ok(c, { settings, usage, overrides });
});
app.put('/live/settings', async (c) => {
	const out = await writeLiveRouting(searchDb(c), await body(c), actor(c));
	return ok(c, out);
});
/** Reset to the shipped defaults (the settings row is removed). */
app.delete('/live/settings', async (c) => ok(c, await resetLiveRouting(searchDb(c))));
app.put('/live/overrides/:channelId', async (c) => {
	const input = parse(LiveOverride, await body(c));
	const channelId = c.req.param('channelId');
	const out = await setChannelOverride(searchDb(c), channelId, input.provider, input.note?.trim() || null, actor(c));
	return ok(c, { channelId, provider: input.provider, ...out });
});
app.delete('/live/overrides/:channelId', async (c) => {
	const channelId = c.req.param('channelId');
	return ok(c, { channelId, ...(await removeChannelOverride(searchDb(c), channelId)) });
});
/** The stream's next session goes to `provider` (null cancels). A live session is never moved. */
app.post('/live/streams/:id/move', async (c) => {
	const input = parse(LiveMove, await body(c));
	const id = c.req.param('id');
	let previous: string | null = null;
	const updated = await new R2Repository<LiveStreamRecord>(liveEnv(c).videos).updateObject(`livestream:${id}`, (fresh) => {
		previous = fresh.providerMove ?? null;
		fresh.providerMove = input.provider;
	});
	if (!updated) throw new admin.AdminError(404, 'not_found', 'Live stream not found');
	return ok(c, { id, providerMove: input.provider, previous, currentProvider: updated.provider ?? null });
});
app.get('/live/sessions', async (c) => {
	const q = parse(LiveSessionsQuery, c.req.query());
	const where: string[] = [];
	const binds: unknown[] = [];
	if (q.status === 'active') where.push("s.status IN ('provisioned', 'live')");
	if (q.provider) {
		where.push('s.provider = ?');
		binds.push(q.provider);
	}
	const { results } = await searchDb(c)
		.prepare(
			`SELECT s.*, ch.admin_title AS channel_name FROM live_sessions s
			   LEFT JOIN content_ownership ch ON ch.kind = 'channel' AND ch.id = s.channel_id
			  ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC LIMIT ?`,
		)
		.bind(...binds, q.limit ?? 50)
		.all();
	return ok(c, { items: results ?? [] });
});
app.get('/live/compare', async (c) => {
	const q = parse(LiveCompareQuery, c.req.query());
	const now = Date.now();
	const to = q.to ? Date.parse(q.to) + 86_400_000 : now;
	const from = q.from ? Date.parse(q.from) : to - 30 * 86_400_000;
	const settings = await readLiveRouting(searchDb(c));
	return ok(c, await compareProviders(searchDb(c), settings, from, to, { includeTests: q.tests === '1', now }));
});
/** End a session (admin). Used for stuck sessions; the owner normally ends their own. */
app.post('/live/sessions/:id/end', async (c) => {
	const session = await readSession(searchDb(c), c.req.param('id'));
	if (!session) throw new admin.AdminError(404, 'not_found', 'Session not found');
	const out = await streamEnd(liveEnv(c) as never, { ...((await readStream(liveEnv(c) as never, session.stream_id)) ?? { id: session.stream_id, title: '', userId: '', status: 'live' }), sessionId: session.id } as LiveStreamRecord, 'admin');
	return ok(c, { session: out.session });
});

export default app;
