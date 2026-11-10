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
} from '@al-ummah/shared-types';
import { listChannels, listComments, listUsers, listVideos } from '../lib/admin/directory';
import * as admin from '../lib/admin/service';
import { checkImage, storeImage } from '../lib/admin/images';
import { countJobs, getJob, listJobs, retryJob } from '../lib/admin/jobs';
import { logger } from '../lib/logger';

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
	if (error instanceof admin.AdminError) {
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
	const { newOwnerId } = parse(z.object({ newOwnerId: z.string().min(1).max(200) }), await body(c));
	return ok(c, await admin.transferChannel(c.env, c.req.param('id'), newOwnerId, actor(c)));
});
app.delete('/channels/:id', async (c) => ok(c, await admin.deleteChannel(c.env, c.req.param('id'), actor(c))));

// Videos
app.get('/videos', async (c) => ok(c, await listVideos(c.env, parse(VideoQuery, c.req.query()) as never)));
app.get('/videos/:id', async (c) => ok(c, await admin.videoDetail(c.env, c.req.param('id'))));
app.patch('/videos/:id', async (c) => ok(c, await admin.updateVideo(c.env, c.req.param('id'), parse(VideoEdit, await body(c)))));
app.post('/videos/:id/thumbnail', async (c) => {
	const form = await c.req.parseBody();
	const url = await storeImage(c.env, checkImage(form.photo), 'thumbnail');
	return ok(c, await admin.updateVideo(c.env, c.req.param('id'), { thumbnailUrl: url }));
});
app.post('/videos/:id/move', async (c) => {
	const { channelId } = parse(z.object({ channelId: z.string().min(1).max(200) }), await body(c));
	return ok(c, await admin.moveVideo(c.env, c.req.param('id'), channelId, actor(c)));
});
app.post('/videos/:id/unpublish', async (c) => ok(c, await admin.setVideoPublished(c.env, c.req.param('id'), false)));
app.post('/videos/:id/republish', async (c) => ok(c, await admin.setVideoPublished(c.env, c.req.param('id'), true)));
app.post('/videos/:id/reprocess', async (c) => ok(c, await admin.reprocessVideo(c.env, c.req.param('id'))));
app.delete('/videos/:id', async (c) => ok(c, await admin.deleteVideo(c.env, c.req.param('id'), actor(c))));

// Comments, playlists, community posts
app.get('/comments', async (c) => ok(c, await listComments(c.env, parse(CommentQuery, c.req.query()))));
app.delete('/videos/:videoId/comments/:commentId', async (c) => {
	await admin.deleteComment(c.env, c.req.param('videoId'), c.req.param('commentId'));
	return ok(c, { deleted: true });
});
app.get('/playlists', async (c) => ok(c, await admin.listPlaylists(c.env, parse(CursorQuery, c.req.query()))));
app.delete('/playlists/:id', async (c) => {
	await admin.deletePlaylist(c.env, c.req.param('id'));
	return ok(c, { deleted: true });
});
app.get('/posts', async (c) => ok(c, await admin.listPosts(c.env, parse(CursorQuery, c.req.query()))));
app.delete('/posts/:channelId/:postId', async (c) => {
	await admin.deletePost(c.env, c.req.param('channelId'), c.req.param('postId'));
	return ok(c, { deleted: true });
});

// Users (videos profiles)
app.get('/users', async (c) => ok(c, await listUsers(c.env, parse(UserQuery, c.req.query()) as never)));
app.get('/users/:id', async (c) => ok(c, await admin.userDetail(c.env, c.req.param('id'))));
app.patch('/users/:id', async (c) => ok(c, await admin.updateUser(c.env, c.req.param('id'), parse(UserEdit, await body(c)))));
app.post('/users/:id/ban', async (c) => ok(c, await admin.banUser(c.env, c.req.param('id'), actor(c), parse(Reason, await body(c)).reason)));
app.post('/users/:id/unban', async (c) => ok(c, await admin.unbanUser(c.env, c.req.param('id'), actor(c))));
app.post('/users/:id/delete-data', async (c) => ok(c, await admin.deleteUserData(c.env, c.req.param('id'), actor(c))));

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
