/**
 * Internal stale-upload endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). The admin API proxies these behind its
 * `videos:uploads` permission and writes the audit row (apps/admin-api,
 * routers/staleUploads.router.ts). Not part of the public contract.
 *
 *   GET  /internal/uploads/stale?status=&limit=   items, reaper mode, last sweep, recent deletes, dead letters
 *   POST /internal/uploads/scan                   run the sweep now (enqueues checks)
 *   POST /internal/uploads/delete  { ids, actor } Delete now: a forced check loop (still never touches ready videos)
 *   POST /internal/uploads/keep    { ids, actor } never pick these again (until Retry)
 *   POST /internal/uploads/retry   { ids, actor } restart the check loop (a failed item, a kept one)
 *   POST /internal/uploads/mode    { mode, actor } dry-run | live
 *   GET  /internal/uploads/test-library-purge      QA/stage purge state (lib/uploads/testLibraryPurge.ts)
 *   POST /internal/uploads/test-library-purge      { action: start|stop, dryRun?, resume?, minAgeMinutes? (10-1440), concurrency? (1-50), pageSize? (10-100), statuses? (Bunny statuses to delete, e.g. [0,1,2,3,7]), actor }
 *
 * See lib/uploads/reaper.ts for the loop and its rules.
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { RecordId } from '../../validation/identifiers';
import { IntegerQuery, optionalJson } from '../../validation/legacy-request';
import { apiError } from '../../lib/api-error';
import { logger } from '../../lib/logger';
import {
	keepItem,
	listAudit,
	listItems,
	readItem,
	readReaperConfig,
	readReaperSweep,
	ReaperEnv,
	REAPER_KIND,
	startReaperLoop,
	sweepStaleUploads,
	writeReaperConfig,
} from '../../lib/uploads/reaper';
import { purgeAllowed, readPurgeState, startPurge, stopPurge, type PurgeEnv } from '../../lib/uploads/testLibraryPurge';

const MAX_IDS = 100;
const STATUSES = ['checking', 'would_delete', 'deleted', 'kept', 'skipped', 'failed'] as const;

type Env = PurgeEnv & { NOTIFICATIONS_DB?: D1Database };

const Actor = z.object({ actor: RecordId.default('admin') });
const Batch = Actor.extend({ ids: z.array(z.string().regex(/^[A-Za-z0-9-]{8,64}$/)).min(1).max(MAX_IDS).transform((ids) => [...new Set(ids)]) });
const Mode = Actor.extend({ mode: z.enum(['dry-run', 'live']) });
const Status = z.enum([...STATUSES, 'open', 'all']).optional();
const StaleQuery = z.object({ status: Status, limit: IntegerQuery.optional() });
const StaleBody = z.object({ status: Status, limit: z.number().int().nonnegative().or(IntegerQuery).nullish(), hide: z.array(RecordId) });
const Purge = z.discriminatedUnion('action', [
	Actor.extend({ action: z.literal('stop') }),
	Actor.extend({
		action: z.literal('start'), dryRun: z.boolean().optional(), resume: z.boolean().optional(),
		minAgeMinutes: z.number().int().nonnegative().optional(), concurrency: z.number().int().positive().optional(),
		pageSize: z.number().int().positive().optional(), statuses: z.array(z.number().int().min(0).max(10)).max(32).optional(),
	}),
]);

/** Most videos one list may leave out (POST /stale) */
export const MAX_HIDE = 10_000;

export function createUploadsInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	/**
	 * The list. GET for a reader who sees everything; POST { status?, limit?, hide: string[] } with the videos the
	 * reader may not see (admin-api: those a case keeps), which are neither listed nor counted.
	 */
	const stale = async (c: { env: Env; json: (b: unknown, s?: number) => Response }, q: { status?: string; limit?: number }, hide: ReadonlySet<string>) => {
		const status = q.status;
		const limit = Math.min(Math.max(q.limit || 200, 1), 500);
		const listed = (await listItems(c.env, 2000)).filter((i) => !hide.has(i.videoId));
		// Every status over all items the reader may see, whatever is shown (the tabs; a status without items is missing)
		const counts: Record<string, number> = {};
		for (const item of listed) counts[item.status] = (counts[item.status] ?? 0) + 1;
		let items = listed;
		if (status && (STATUSES as readonly string[]).includes(status)) items = items.filter((i) => i.status === status);
		else if (status === 'open') items = items.filter((i) => i.status !== 'deleted' && i.status !== 'skipped');
		items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

		let deadLetters: unknown[] = [];
		if (c.env.NOTIFICATIONS_DB) {
			try {
				const { results } = await c.env.NOTIFICATIONS_DB.prepare(
					`SELECT id, dlq, attempts, failure_reason, body_json, received_at FROM dead_letters
					 WHERE replayed_at IS NULL AND body_json LIKE ? ORDER BY received_at DESC LIMIT 50`,
				)
					.bind(`%"kind":"${REAPER_KIND}"%`)
					.all<{ id: string; dlq: string; attempts: number; failure_reason: string | null; body_json: string; received_at: string | number }>();
				deadLetters = (results ?? []).map((row) => {
					let videoId: string | undefined;
					try {
						videoId = (JSON.parse(row.body_json) as { videoId?: string }).videoId;
					} catch {
						videoId = undefined;
					}
					return { id: row.id, dlq: row.dlq, attempts: row.attempts, failureReason: row.failure_reason, receivedAt: row.received_at, videoId };
				});
			} catch (error) {
				logger.warn('[UploadReaperAdmin] Dead letters unavailable', { error: error instanceof Error ? error.message : String(error) });
			}
		}

		return c.json({
			success: true,
			result: {
				items: items.slice(0, limit),
				counts,
				config: await readReaperConfig(c.env),
				sweep: await readReaperSweep(c.env),
				audit: await listAudit(c.env, 50),
				deadLetters,
			},
		});
	};
	app.get('/stale', (c) => {
		const parsed = StaleQuery.safeParse(c.req.query());
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		return stale(c as never, parsed.data, new Set());
	});
	app.post('/stale', async (c) => {
		const body: unknown = await c.req.json().catch(() => null);
		const hide = (body as { hide?: unknown } | null)?.hide;
		// Keep the existing response for the endpoint's explicit list-size limit.
		if (Array.isArray(hide) && hide.length > MAX_HIDE) return apiError(c, 413, 'too_many', { error: 'Too many video ids' });
		const parsed = StaleBody.safeParse(body);
		if (!parsed.success) return apiError(c, 400, 'bad_request', { error: 'Invalid filters or video ids' });
		return stale(c as never, { status: parsed.data.status, limit: parsed.data.limit ?? undefined }, new Set(parsed.data.hide));
	});

	app.post('/scan', async (c) => {
		const parsed = Actor.safeParse(await optionalJson(c.req));
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const stats = await sweepStaleUploads(c.env, { actor: parsed.data.actor });
		return c.json({ success: true, result: stats });
	});

	const loopAction = (force: boolean, reason: string) => async (c: Context<{ Bindings: Env }>) => {
		const parsed = Batch.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'Invalid video ids or actor' }, 400);
		const { ids, actor } = parsed.data;
		const results = [];
		for (const id of ids) {
			const item = await readItem(c.env, id);
			if (!item) {
				results.push({ videoId: id, started: false, why: 'not a stale upload' });
				continue;
			}
			try {
				results.push({
					videoId: id,
					...(await startReaperLoop(c.env, id, item.target, { reason, force: force || !!item.force, actor })),
				});
			} catch (error) {
				results.push({ videoId: id, started: false, why: error instanceof Error ? error.message : String(error) });
			}
		}
		logger.info('[UploadReaperAdmin] Loop action', { reason, actor, count: ids.length });
		return c.json({ success: true, result: { results } });
	};

	// Delete now: forced (skips the 24 h wait and dry-run), still a confirming
	// second check, and still never deletes a ready/encoding video or a record
	// that finished.
	app.post('/delete', loopAction(true, 'admin-delete'));
	// Retry keeps the item's earlier force (a failed Delete now retries the delete)
	app.post('/retry', loopAction(false, 'admin-retry'));

	// QA/stage only: removes every Bunny video of this environment without a record
	app.get('/test-library-purge', async (c) =>
		c.json({ success: true, result: { allowed: purgeAllowed(c.env), state: await readPurgeState(c.env) } }),
	);

	app.post('/test-library-purge', async (c) => {
		if (!purgeAllowed(c.env)) return c.json({ success: false, error: 'The test-library purge runs only on QA / stage' }, 403);
		const parsed = Purge.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const body = parsed.data;
		const actor = body.actor;
		if (body.action === 'stop') return c.json({ success: true, result: { state: await stopPurge(c.env, actor) } });
		try {
			const state = await startPurge(c.env, { actor, dryRun: body.dryRun !== false, resume: body.resume === true, minAgeMinutes: body.minAgeMinutes, concurrency: body.concurrency, pageSize: body.pageSize, statuses: body.statuses });
			return c.json({ success: true, result: { state } });
		} catch (error) {
			return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 409);
		}
	});

	app.post('/keep', async (c) => {
		const parsed = Batch.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'Invalid video ids or actor' }, 400);
		const { ids, actor } = parsed.data;
		const results = [];
		for (const id of ids) results.push({ videoId: id, kept: await keepItem(c.env, id, actor) });
		return c.json({ success: true, result: { results } });
	});

	app.post('/mode', async (c) => {
		const parsed = Mode.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'mode must be dry-run or live and actor must be valid' }, 400);
		return c.json({ success: true, result: await writeReaperConfig(c.env, parsed.data.mode, parsed.data.actor) });
	});

	return app;
}
