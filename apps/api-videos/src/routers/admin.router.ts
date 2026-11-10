/**
 * /internal/admin/* — platform content management for admin-api.
 *
 * Behind the INTERNAL_API_KEY check of every /internal/* path (src/index.ts):
 * only admin-api calls these, after checking the admin's permissions. It
 * passes the acting admin's id in X-Admin-Actor (recorded on suspensions and
 * bans) and writes the audit log itself.
 */
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
} from '@al-ummah/shared-types';
import { listChannels, listComments, listUsers, listVideos } from '../lib/admin/directory';
import { searchUsers } from '../lib/admin/userSearch';
import * as admin from '../lib/admin/service';
import { checkImage, checkThumbnailShapeFor, storeImage } from '../lib/admin/images';
import { countJobs, getJob, listJobs, retryJob } from '../lib/admin/jobs';
import { LegacyRestoreError } from '../lib/admin/legacy-restore';
import { isDeletionKind, listDeletions } from '../lib/admin/deletions';
import { logger } from '../lib/logger';
import { bulkAssignTier, limitHitsSince, listCreators, tierCounts } from '../lib/admin/creators';
import { assignTier, CreatorTierError, deleteTier, purgeTiers, readAssignment, readDeletedTiers, readTiers, requestTierPurge, restoreTier, saveTier } from '../lib/creatorTiers';

type Env = { Bindings: admin.AdminServiceEnv & Record<string, unknown> };

const app = new Hono<Env>();

const yesNo = z.enum(['yes', 'no']).optional();
const page = { page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() };
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
	if (error instanceof CreatorTierError) {
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

// Channels
app.get('/channels', async (c) => ok(c, await listChannels(c.env, parse(ChannelQuery, c.req.query()) as never)));
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
app.get('/videos', async (c) => ok(c, await listVideos(c.env, parse(VideoQuery, c.req.query()) as never)));
app.get('/videos/:id', async (c) => ok(c, await admin.videoDetail(c.env, c.req.param('id'))));
app.patch('/videos/:id', async (c) => ok(c, await admin.updateVideo(c.env, c.req.param('id'), parse(VideoEdit, await body(c)))));
app.post('/videos/:id/thumbnail', async (c) => {
	const form = await c.req.parseBody();
	const file = checkImage(form.photo);
	await checkThumbnailShapeFor(c.env as never, c.req.param('id'), file);
	const url = await storeImage(c.env, file, 'thumbnail');
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
app.get('/comments', async (c) => ok(c, await listComments(c.env, parse(CommentQuery, c.req.query()))));
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
app.get('/users', async (c) => ok(c, await listUsers(c.env, parse(UserQuery, c.req.query()) as never)));
app.get('/users/search', async (c) => ok(c, await searchUsers(c.env, parse(UserSearchQuery, c.req.query()) as never)));
app.get('/users/:id', async (c) => ok(c, await admin.userDetail(c.env, c.req.param('id'))));
app.patch('/users/:id', async (c) => ok(c, await admin.updateUser(c.env, c.req.param('id'), parse(UserEdit, await body(c)))));
app.post('/users/:id/ban', async (c) => ok(c, await admin.banUser(c.env, c.req.param('id'), actor(c), parse(Reason, await body(c)).reason)));
app.post('/users/:id/unban', async (c) => ok(c, await admin.unbanUser(c.env, c.req.param('id'), actor(c))));
app.post('/users/:id/delete-data', async (c) => ok(c, await admin.deleteUserData(c.env, c.req.param('id'), actor(c), parse(Reason, await body(c)).reason)));

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
	runId: z.string().uuid().optional(),
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
const TierAssign = z.object({ tierId: z.string().min(1).max(40).nullable(), source: z.enum(['admin', 'subscription']).optional() }).strict();
const TierBody = z
	.object({
		id: z.string().max(40).optional(),
		name: z.string().max(60).optional(),
		unlimited: z.boolean().optional(),
		perHour: z.coerce.number().optional(),
		perDay: z.coerce.number().optional(),
		maxConcurrent: z.coerce.number().optional(),
		maxChannels: z.coerce.number().nullable().optional(),
	})
	.strict();
const searchDb = (c: Context<Env>) => c.env.SEARCH_DB as D1Database;
app.get('/creators', async (c) => ok(c, await listCreators(c.env as never, parse(CreatorQuery, c.req.query()))));
app.get('/creator-tiers', async (c) => {
	const [items, counts, limitHits7d] = await Promise.all([readTiers(searchDb(c)), tierCounts(searchDb(c)), limitHitsSince(searchDb(c))]);
	return ok(c, { items, counts, limitHits7d });
});
const TierBulk = z
	.object({
		userIds: z.array(z.string().min(1).max(128)).min(1).max(MAX_BULK_CREATOR_TIER),
		tierId: z.string().min(1).max(40).nullable(),
		dryRun: z.boolean().optional(),
	})
	.strict();
app.post('/creators/tier', async (c) => ok(c, await bulkAssignTier(searchDb(c), parse(TierBulk, await body(c)) as { userIds: string[]; tierId: string | null; dryRun?: boolean }, actor(c))));
app.post('/creator-tiers', async (c) => {
	const input = parse(TierBody, await body(c));
	if (!input.id) throw new admin.AdminError(400, 'invalid_request', 'id: Required');
	return ok(c, await saveTier(searchDb(c), input.id, input, actor(c), { create: true }));
});
app.put('/creator-tiers/:id', async (c) => ok(c, await saveTier(searchDb(c), c.req.param('id'), parse(TierBody, await body(c)), actor(c))));
// Soft delete (restorable for 30 days); the admin-api cleanup purges through POST /creator-tiers/purge
const TierDelete = z.object({ reason: z.string().max(500).nullable().optional() }).strict();
app.delete('/creator-tiers/:id', async (c) => {
	const input = parse(TierDelete, (await c.req.json().catch(() => null)) ?? {});
	return ok(c, await deleteTier(searchDb(c), c.req.param('id'), { actorId: actor(c), reason: input.reason?.trim() || null }));
});
app.get('/creator-tiers/deleted', async (c) => ok(c, { items: await readDeletedTiers(searchDb(c)) }));
app.post('/creator-tiers/:id/restore', async (c) => ok(c, await restoreTier(searchDb(c), c.req.param('id'))));
app.post('/creator-tiers/:id/purge-request', async (c) => ok(c, await requestTierPurge(searchDb(c), c.req.param('id'), actor(c))));
const TierPurge = z.object({ cutoff: z.string().datetime(), limit: z.number().int().min(1).max(500).optional() }).strict();
app.post('/creator-tiers/purge', async (c) => {
	const input = parse(TierPurge, await body(c));
	return ok(c, await purgeTiers(searchDb(c), input.cutoff, input.limit));
});
app.get('/users/:id/creator-tier', async (c) => ok(c, { assignment: await readAssignment(searchDb(c), c.req.param('id')) }));
app.put('/users/:id/creator-tier', async (c) => {
	const input = parse(TierAssign, await body(c));
	return ok(c, await assignTier(searchDb(c), c.req.param('id'), input.tierId, actor(c), input.source ?? 'admin'));
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

export default app;
