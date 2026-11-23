/**
 * /internal/admin/import/sources/* — social import sources (wiki TOOLS-ADMIN TA-9), for admin-api's
 * /api/admin/import/sources (super admins, import_sources:manage, audited there). Behind the
 * INTERNAL_API_KEY check of every /internal/* path (src/index.ts); X-Admin-Actor names the admin.
 *
 *   GET    /                          ?channelId= → { sources }
 *   GET    /channels/:channelId/connections        → { connections }: what the owner connected
 *   POST   /                          { channelId, network, address, label?, schedule?, permission? } → 201 { source }
 *   GET    /:id                       → { source }
 *   PATCH  /:id                       { label?, schedule?, enabled? } → { source } (409 not_connected: turning on a connected source whose connection is gone)
 *   DELETE /:id                       → { deleted } (its posts and videos stay)
 *   POST   /:id/sync                  → 202 { jobId, status } (the one already waiting, if any)
 *   GET    /:id/items                 ?state=&limit= → { items }
 *   POST   /retry                     { jobId } the Errors page's Retry (admin-api lib/errors-actions.ts), for a sync or a
 *                                     Takeout match job: a failed one runs again; a cancelled one starts a new run
 *   POST   /:id/cancel                { jobId, byName? } → { job } (with its log): cancels one of the source's jobs;
 *                                     idempotent (a cancelled or finished job is answered as it is); 404 job_not_found
 *
 * YouTube Takeout files (YouTube sources only, else 409 not_youtube; lib/importSources/takeout.ts):
 *   POST   /:id/takeout/files                 { files: [{ name, size, videoId?, title?, durationMs?, mimeType? }] } (≤ 500)
 *                                             → 202 { listed, added, jobId, status }: the match job is queued
 *   GET    /:id/takeout                       ?state=&limit= → { files, counts, jobId }
 *   POST   /:id/takeout/files/:fileId/confirm { itemId } → { file }: an admin's pick for an ambiguous file
 *                                             (400 not_a_candidate, 409 not_ambiguous / file_taken)
 *   POST   /:id/takeout/files/:fileId/upload  → { file, upload }: the record's resumable upload (409 not_matched / has_file)
 *   POST   /:id/takeout/files/:fileId/uploaded → 202 { file, jobId, status }: the job posts the record's video
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { IMPORT_SOURCE_NETWORKS, IMPORT_SOURCE_SCHEDULES, TAKEOUT_FILE_STATES, TAKEOUT_MAX_FILES_PER_REQUEST, type SourceItemState, type TakeoutFileState } from '@al-ummah/shared-types';
import { getJob, retryJob } from '../lib/admin/jobs';
import { loadChannelRecord } from '../lib/channelAccess';
import { authorizeSource, channelConnections, normalizeAddress, stillAuthorized } from '../lib/importSources/authorize';
import { resolveBlueskyAddress } from '../lib/importSources/fetchers';
import { cancelSourceJob, SOURCE_JOB_KINDS, startSourceSync } from '../lib/importSources/job';
import { confirmTakeoutFile, listTakeoutFiles, markTakeoutUploaded, openTakeoutUpload, startTakeoutJob, TAKEOUT_JOB_KIND, takeoutReport } from '../lib/importSources/takeout';
import { deleteSource, insertSource, listItems, listSources, readSource, SourceError, updateSource, viewSource } from '../lib/importSources/store';
import { apiError } from '../lib/api-error';
import { logger } from '../lib/logger';

type Env = { Bindings: Record<string, unknown> };
const app = new Hono<Env>();

const ITEM_STATES = ['pending', 'posted', 'skipped', 'awaiting_file'] as const;
const actorOf = (c: Context<Env>) => {
	const id = c.req.header('X-Admin-Actor') ?? '';
	if (!/^usr_[A-Za-z0-9]{8,64}$/.test(id)) throw new SourceError(400, 'invalid_request', "X-Admin-Actor must be the admin's user id");
	return id;
};
const ok = (c: Context<Env>, result: unknown, status: 200 | 201 | 202 = 200) => c.json({ success: true, result }, status);
const body = async (c: Context<Env>) => c.req.json().catch(() => ({}));
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
	const r = schema.safeParse(value);
	if (!r.success) throw new SourceError(400, 'invalid_request', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
	return r.data;
}

app.onError((error, c) => {
	if (error instanceof SourceError) return apiError(c, error.status, error.code, { error: error.message });
	logger.error('[ImportSources] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
	return apiError(c, 500, 'internal_error', { error: 'Internal error' });
});

const Create = z.object({
	channelId: z.string().min(1).max(200),
	network: z.enum(IMPORT_SOURCE_NETWORKS),
	address: z.string().min(1).max(500),
	label: z.string().max(120).optional(),
	schedule: z.enum(IMPORT_SOURCE_SCHEDULES).optional(),
	permission: z.object({ by: z.string().max(200), note: z.string().max(1000) }).optional(),
});
const Patch = z.object({ label: z.string().max(120).optional(), schedule: z.enum(IMPORT_SOURCE_SCHEDULES).optional(), enabled: z.boolean().optional() }).strict();
const ItemsQuery = z.object({ state: z.enum(ITEM_STATES).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });

const sourceOr404 = async (c: Context<Env>) => {
	const row = await readSource(c.env, c.req.param('id') ?? '');
	if (!row) throw new SourceError(404, 'source_not_found', 'No such source');
	return row;
};

app.get('/', async (c) => {
	const channelId = c.req.query('channelId');
	return ok(c, { sources: await listSources(c.env, channelId ? channelId.slice(0, 200) : undefined) });
});

app.get('/channels/:channelId/connections', async (c) => ok(c, { connections: await channelConnections(c.env, c.req.param('channelId')) }));

app.post('/', async (c) => {
	const actorId = actorOf(c);
	const input = parse(Create, await body(c));
	const channel = await loadChannelRecord(c.env as never, input.channelId);
	if (!channel?.userId || channel.isDeleted) throw new SourceError(404, 'channel_not_found', 'No such channel');
	let address = normalizeAddress(input.network, input.address);
	if (input.network === 'bluesky') address = await resolveBlueskyAddress(address);
	const auth = await authorizeSource(c.env, { channelId: input.channelId, network: input.network, address, permission: input.permission });
	const row = await insertSource(c.env, {
		channelId: input.channelId,
		network: input.network,
		address,
		label: (input.label?.trim() || auth.label || address).slice(0, 120),
		auth: auth.auth,
		socialAccountId: auth.socialAccountId,
		ytImportId: auth.ytImportId,
		permission: auth.permission,
		schedule: input.schedule ?? 'manual',
		createdBy: actorId,
	});
	logger.info('[ImportSources] Source added', { sourceId: row.id, channelId: row.channel_id, network: row.network, auth: row.auth_kind });
	return ok(c, { source: await viewSource(c.env, row.id) }, 201);
});

app.post('/retry', async (c) => {
	const { jobId } = parse(z.object({ jobId: z.string().min(1).max(64) }), await body(c));
	const job = await getJob(c.env as never, jobId);
	if (!job || !SOURCE_JOB_KINDS.includes(job.kind)) throw new SourceError(404, 'job_not_found', 'No such sync job');
	// A cancelled job: a new run from the start (a new job), or the one already waiting
	if (job.status === 'cancelled') {
		const source = await readSource(c.env, String((job.params as { sourceId?: unknown }).sourceId ?? ''));
		if (!source) throw new SourceError(404, 'source_not_found', 'No such source');
		const started = job.kind === TAKEOUT_JOB_KIND ? await startTakeoutJob(c.env as never, source, job.actorId) : await startSourceSync(c.env as never, source, job.actorId);
		return ok(c, { status: started.status, jobId: started.id });
	}
	const retried = await retryJob(c.env as never, jobId);
	return ok(c, { status: retried?.status ?? job.status, jobId });
});

app.get('/:id', async (c) => ok(c, { source: await viewSource(c.env, (await sourceOr404(c)).id) }));

app.patch('/:id', async (c) => {
	const row = await sourceOr404(c);
	const patch = parse(Patch, await body(c));
	// A connected source turns back on only while the owner's connection is there
	if (patch.enabled && !row.enabled && !(await stillAuthorized(c.env, row))) throw new SourceError(409, 'not_connected', "The owner's connection to this account is gone; they need to connect it again");
	await updateSource(c.env, row.id, patch);
	return ok(c, { source: await viewSource(c.env, row.id) });
});

app.delete('/:id', async (c) => {
	const row = await sourceOr404(c);
	return ok(c, { deleted: await deleteSource(c.env, row.id) });
});

app.post('/:id/sync', async (c) => {
	const actorId = actorOf(c);
	const row = await sourceOr404(c);
	const job = await startSourceSync(c.env as never, row, actorId);
	return ok(c, { jobId: job.id, status: job.status }, 202);
});

const CancelBody = z.object({ jobId: z.string().min(1).max(64), byName: z.string().max(200).nullable().optional() });
app.post('/:id/cancel', async (c) => {
	const actorId = actorOf(c);
	const row = await sourceOr404(c);
	const input = parse(CancelBody, await body(c));
	return ok(c, { job: await cancelSourceJob(c.env as never, row, input.jobId, { id: actorId, name: input.byName?.trim() || null }) });
});

// --- YouTube Takeout files ---------------------------------------------------------------------------
const TakeoutFiles = z.object({
	files: z
		.array(
			z.object({
				name: z.string().trim().min(1).max(300).refine((n) => !/[\\/\u0000-\u001f\u007f]/.test(n) && n !== '.' && n !== '..', 'a file name, without folders or control characters'),
				size: z.number().int().positive().max(1024 ** 4),
				videoId: z.string().max(20).nullable().optional(),
				title: z.string().max(500).nullable().optional(),
				durationMs: z.number().int().nonnegative().max(1000 * 3600 * 48).nullable().optional(),
				mimeType: z.string().max(100).regex(/^video\/[\w.+-]+$/).nullable().optional(),
			}),
		)
		.min(1)
		.max(TAKEOUT_MAX_FILES_PER_REQUEST),
});
const TakeoutQuery = z.object({ state: z.enum(TAKEOUT_FILE_STATES).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
const youtubeSourceOr404 = async (c: Context<Env>) => {
	const row = await sourceOr404(c);
	if (row.network !== 'youtube') throw new SourceError(409, 'not_youtube', 'Takeout files are only for a YouTube source');
	return row;
};

app.post('/:id/takeout/files', async (c) => {
	const actorId = actorOf(c);
	const row = await youtubeSourceOr404(c);
	const { files } = parse(TakeoutFiles, await body(c));
	const added = await listTakeoutFiles(c.env, row.id, files, actorId);
	const job = await startTakeoutJob(c.env as never, row, actorId);
	logger.info('[ImportSources] Takeout files listed', { sourceId: row.id, listed: files.length, added, jobId: job.id });
	return ok(c, { listed: files.length, added, jobId: job.id, status: job.status }, 202);
});

app.get('/:id/takeout', async (c) => {
	const row = await youtubeSourceOr404(c);
	const q = parse(TakeoutQuery, { state: c.req.query('state'), limit: c.req.query('limit') });
	return ok(c, await takeoutReport(c.env, row, { state: q.state as TakeoutFileState | undefined, limit: q.limit }));
});

app.post('/:id/takeout/files/:fileId/confirm', async (c) => {
	const row = await youtubeSourceOr404(c);
	const { itemId } = parse(z.object({ itemId: z.string().min(1).max(200) }), await body(c));
	return ok(c, { file: await confirmTakeoutFile(c.env, row, c.req.param('fileId'), itemId) });
});

/** The request's ExecutionContext, or one that runs waitUntil work inline (tests call the router without one). */
function executionCtx(c: Context<Env>): ExecutionContext {
	try {
		return c.executionCtx as unknown as ExecutionContext;
	} catch {
		return { waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
	}
}

app.post('/:id/takeout/files/:fileId/upload', async (c) => {
	const actorId = actorOf(c);
	const row = await youtubeSourceOr404(c);
	return ok(c, await openTakeoutUpload(c.env as never, executionCtx(c), row, c.req.param('fileId'), actorId));
});

app.post('/:id/takeout/files/:fileId/uploaded', async (c) => {
	const actorId = actorOf(c);
	const row = await youtubeSourceOr404(c);
	return ok(c, await markTakeoutUploaded(c.env as never, row, c.req.param('fileId'), actorId), 202);
});

app.get('/:id/items', async (c) => {
	const row = await sourceOr404(c);
	const q = parse(ItemsQuery, { state: c.req.query('state'), limit: c.req.query('limit') });
	return ok(c, { items: await listItems(c.env, row.id, { state: q.state as SourceItemState | undefined, limit: q.limit }) });
});

export default app;
