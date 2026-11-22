/**
 * /internal/admin/import/sources/* — social import sources (wiki TOOLS-ADMIN TA-9), for admin-api's
 * /api/admin/import/sources (super admins, import_sources:manage, audited there). Behind the
 * INTERNAL_API_KEY check of every /internal/* path (src/index.ts); X-Admin-Actor names the admin.
 *
 *   GET    /                          ?channelId= → { sources }
 *   GET    /channels/:channelId/connections        → { connections }: what the owner connected
 *   POST   /                          { channelId, network, address, label?, schedule?, permission? } → 201 { source }
 *   GET    /:id                       → { source }
 *   PATCH  /:id                       { label?, schedule?, enabled? } → { source }
 *   DELETE /:id                       → { deleted } (its posts and videos stay)
 *   POST   /:id/sync                  → 202 { jobId, status } (the one already waiting, if any)
 *   GET    /:id/items                 ?state=&limit= → { items }
 *   POST   /retry                     { jobId } the Errors page's Retry (admin-api lib/errors-actions.ts)
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { IMPORT_SOURCE_NETWORKS, IMPORT_SOURCE_SCHEDULES, type ImportItemState } from '@al-ummah/shared-types';
import { getJob, retryJob } from '../lib/admin/jobs';
import { loadChannelRecord } from '../lib/channelAccess';
import { authorizeSource, channelConnections, normalizeAddress } from '../lib/importSources/authorize';
import { resolveBlueskyAddress } from '../lib/importSources/fetchers';
import { SOURCE_SYNC_JOB_KIND, startSourceSync } from '../lib/importSources/job';
import { deleteSource, insertSource, listItems, listSources, readSource, SourceError, updateSource, viewSource } from '../lib/importSources/store';
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
	if (error instanceof SourceError) return c.json({ success: false, code: error.code, error: error.message }, error.status);
	logger.error('[ImportSources] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
	return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
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
	if (!job || job.kind !== SOURCE_SYNC_JOB_KIND) throw new SourceError(404, 'job_not_found', 'No such sync job');
	const retried = await retryJob(c.env as never, jobId);
	return ok(c, { status: retried?.status ?? job.status });
});

app.get('/:id', async (c) => ok(c, { source: await viewSource(c.env, (await sourceOr404(c)).id) }));

app.patch('/:id', async (c) => {
	const row = await sourceOr404(c);
	const patch = parse(Patch, await body(c));
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

app.get('/:id/items', async (c) => {
	const row = await sourceOr404(c);
	const q = parse(ItemsQuery, { state: c.req.query('state'), limit: c.req.query('limit') });
	return ok(c, { items: await listItems(c.env, row.id, { state: q.state as ImportItemState | undefined, limit: q.limit }) });
});

export default app;
