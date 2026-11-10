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
 *
 * See lib/uploads/reaper.ts for the loop and its rules.
 */

import { Hono } from 'hono';
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

const MAX_IDS = 100;
const STATUSES = new Set(['checking', 'would_delete', 'deleted', 'kept', 'skipped', 'failed']);

type Env = ReaperEnv & { NOTIFICATIONS_DB?: D1Database };

function parseIds(body: unknown): string[] | null {
	const ids = (body as { ids?: unknown })?.ids;
	if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
	const clean = ids.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id));
	return clean.length === ids.length ? [...new Set(clean)] : null;
}

function actorOf(body: unknown): string {
	const actor = (body as { actor?: unknown })?.actor;
	return typeof actor === 'string' && actor.trim() ? actor.trim().slice(0, 200) : 'admin';
}

export function createUploadsInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	app.get('/stale', async (c) => {
		const status = c.req.query('status');
		const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '200', 10) || 200, 1), 500);
		let items = await listItems(c.env, 2000);
		if (status && STATUSES.has(status)) items = items.filter((i) => i.status === status);
		else if (status === 'open') items = items.filter((i) => i.status !== 'deleted' && i.status !== 'skipped');
		items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
		const counts: Record<string, number> = {};
		for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;

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
	});

	app.post('/scan', async (c) => {
		const body = await c.req.json().catch(() => ({}));
		const stats = await sweepStaleUploads(c.env, { actor: actorOf(body) });
		return c.json({ success: true, result: stats });
	});

	const loopAction = (force: boolean, reason: string) => async (c: { req: { json(): Promise<unknown> }; env: Env; json: (b: unknown, s?: number) => Response }) => {
		const body = await c.req.json().catch(() => null);
		const ids = parseIds(body);
		if (!ids) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const actor = actorOf(body);
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
	app.post('/delete', (c) => loopAction(true, 'admin-delete')(c as never));
	// Retry keeps the item's earlier force (a failed Delete now retries the delete)
	app.post('/retry', (c) => loopAction(false, 'admin-retry')(c as never));

	app.post('/keep', async (c) => {
		const body = await c.req.json().catch(() => null);
		const ids = parseIds(body);
		if (!ids) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const actor = actorOf(body);
		const results = [];
		for (const id of ids) results.push({ videoId: id, kept: await keepItem(c.env, id, actor) });
		return c.json({ success: true, result: { results } });
	});

	app.post('/mode', async (c) => {
		const body = await c.req.json().catch(() => null);
		const mode = (body as { mode?: unknown })?.mode;
		if (mode !== 'dry-run' && mode !== 'live') return c.json({ success: false, error: 'mode must be dry-run or live' }, 400);
		return c.json({ success: true, result: await writeReaperConfig(c.env, mode, actorOf(body)) });
	});

	return app;
}
