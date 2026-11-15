/**
 * R2 backfill, internal side (X-API-Key; admin-api proxies it behind media:manage and audit).
 * docs/media-delivery/BACKFILL.md.
 *
 *   GET  /internal/media/backfill/runs                        recent runs
 *   POST /internal/media/backfill/runs { scope, actorId }     new run → estimating (queued)
 *   GET  /internal/media/backfill/runs/:id                    one run: status, estimate, settings, spend, counts
 *   GET  /internal/media/backfill/runs/:id/items?state=&cursor=&limit=
 *   PUT  /internal/media/backfill/runs/:id/settings { settings }   concurrency, spacing, budget cap
 *   POST /internal/media/backfill/runs/:id/start | pause | cancel
 *   POST /internal/media/backfill/runs/:id/retry-failed       every failed item back to pending
 *   POST /internal/media/backfill/items/retry { runId, videoId }   (also the Errors page's Retry)
 *   POST /internal/media/backfill/flip { target, videoIds?, channelId?, undo?, actorId }
 *   GET  /internal/media/backfill/channels/:id/verification   { videos, verified }
 *   GET  /internal/media/backfill/libraries                   Bunny libraries with verified/removal counts
 *   GET  /internal/media/backfill/libraries/:id/removals?status=&cursor=
 *   POST /internal/media/backfill/libraries/:id/removals { graceDays, actorId }   schedule (retire)
 *   POST /internal/media/backfill/libraries/:id/removals/cancel
 *   POST /internal/media/backfill/removals/retry { videoId }  (also the Errors page's Retry)
 */
import { Hono, type Context } from 'hono';
import { parseBackfillScope, parseBackfillSettings, type BackfillItemState, type ExecutionContextLike } from '@al-ummah/shared-types';
import { MediaSettingsError } from '../../lib/media/settings';
import { BackfillStateError, cancelRun, changeSettings, createRun, pauseRun, retryItem, startRun } from '../../lib/media/backfill/run';
import { getRunRow, listItems, listRuns, readRun, runView, countsOf, spentOf } from '../../lib/media/backfill/store';
import { channelVerification, flipChannel, flipGlobal, flipVideos, MAX_FLIP_VIDEOS } from '../../lib/media/backfill/flip';
import { cancelRemovals, librarySummaries, listRemovals, RemovalError, retryRemoval, scheduleRemovals } from '../../lib/media/backfill/removal';
import type { BackfillEnv } from '../../lib/media/backfill/types';

type E = { Bindings: BackfillEnv };
type C = Context<E>;

const SAFE = /^[A-Za-z0-9-]{8,64}$/;
const STATES: BackfillItemState[] = ['pending', 'copying', 'transcoding', 'verifying', 'verified', 'failed', 'skipped', 'cancelled'];

const bad = (c: C, error: string, code = 'bad_request') => c.json({ success: false, code, error }, 400);
const ctxOf = (c: C): ExecutionContextLike | undefined => {
	try {
		return c.executionCtx as unknown as ExecutionContextLike;
	} catch {
		return undefined;
	}
};
const actor = (body: Record<string, unknown>) => (typeof body.actorId === 'string' && body.actorId ? body.actorId.slice(0, 128) : 'admin');

export function createBackfillInternalRouter() {
	const app = new Hono<E>();

	app.onError((error, c) => {
		if (error instanceof BackfillStateError) return c.json({ success: false, code: error.code, error: error.message }, error.code === 'not_found' ? 404 : 409);
		if (error instanceof RemovalError) return c.json({ success: false, code: error.code, error: error.message }, 400);
		if (error instanceof MediaSettingsError) return c.json({ success: false, code: 'settings_refused', error: error.message, problems: error.problems }, 400);
		throw error;
	});

	app.get('/runs', async (c) => c.json({ success: true, result: { runs: await listRuns(c.env.SEARCH_DB!, Number(c.req.query('limit')) || 20) } }));

	app.post('/runs', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		const scope = parseBackfillScope(body.scope);
		if ('error' in scope) return bad(c, scope.error);
		if (!scope.ok) return bad(c, 'bad scope');
		return c.json({ success: true, result: { run: await createRun(c.env, scope.scope, actor(body)) } }, 201);
	});

	app.get('/runs/:id', async (c) => {
		const id = c.req.param('id');
		if (!SAFE.test(id)) return bad(c, 'bad run id');
		const run = await readRun(c.env.SEARCH_DB!, id);
		return run ? c.json({ success: true, result: { run } }) : c.json({ success: false, code: 'not_found', error: 'No such run' }, 404);
	});

	app.get('/runs/:id/items', async (c) => {
		const id = c.req.param('id');
		const state = c.req.query('state') as BackfillItemState | undefined;
		if (!SAFE.test(id)) return bad(c, 'bad run id');
		if (state && !STATES.includes(state)) return bad(c, `state must be one of ${STATES.join(', ')}`);
		const cursor = c.req.query('cursor');
		if (cursor && !SAFE.test(cursor)) return bad(c, 'bad cursor');
		return c.json({ success: true, result: await listItems(c.env.SEARCH_DB!, id, { state, cursor, limit: Number(c.req.query('limit')) || 50 }) });
	});

	app.put('/runs/:id/settings', async (c) => {
		const id = c.req.param('id');
		const row = SAFE.test(id) ? await getRunRow(c.env.SEARCH_DB!, id) : null;
		if (!row) return c.json({ success: false, code: 'not_found', error: 'No such run' }, 404);
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		const current = runView(row, await countsOf(c.env.SEARCH_DB!, id), await spentOf(c.env.SEARCH_DB!, id)).settings;
		const parsed = parseBackfillSettings(body.settings, current);
		if ('error' in parsed) return bad(c, parsed.error);
		if (!parsed.ok) return bad(c, 'bad settings');
		return c.json({ success: true, result: { run: await changeSettings(c.env, id, parsed.settings) } });
	});

	app.post('/runs/:id/:action{start|pause|cancel|retry-failed}', async (c) => {
		const id = c.req.param('id');
		if (!SAFE.test(id)) return bad(c, 'bad run id');
		const action = c.req.param('action');
		if (action === 'start') return c.json({ success: true, result: { run: await startRun(c.env, ctxOf(c), id) } });
		if (action === 'pause') return c.json({ success: true, result: { run: await pauseRun(c.env, id) } });
		if (action === 'cancel') return c.json({ success: true, result: { run: await cancelRun(c.env, id) } });
		const { items } = await listItems(c.env.SEARCH_DB!, id, { state: 'failed', limit: 200 });
		let retried = 0;
		for (const item of items) if ((await retryItem(c.env, ctxOf(c), id, item.videoId)).retried) retried++;
		return c.json({ success: true, result: { retried, run: await readRun(c.env.SEARCH_DB!, id) } });
	});

	app.post('/items/retry', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		if (typeof body.runId !== 'string' || !SAFE.test(body.runId) || typeof body.videoId !== 'string' || !SAFE.test(body.videoId)) return bad(c, 'runId and videoId are required');
		const out = await retryItem(c.env, ctxOf(c), body.runId, body.videoId);
		if (!out.retried && out.why === 'no such run') return c.json({ success: false, code: 'not_found', error: out.why }, 404);
		return c.json({ success: true, result: out });
	});

	app.post('/flip', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		const undo = body.undo === true;
		if (body.target === 'videos') {
			const ids = Array.isArray(body.videoIds) ? [...new Set(body.videoIds.filter((v): v is string => typeof v === 'string' && SAFE.test(v)))] : [];
			if (!ids.length || ids.length > MAX_FLIP_VIDEOS) return bad(c, `videoIds must list 1-${MAX_FLIP_VIDEOS} video ids`);
			return c.json({ success: true, result: await flipVideos(c.env, ids, actor(body), undo) });
		}
		if (body.target === 'channel') {
			if (typeof body.channelId !== 'string' || !SAFE.test(body.channelId)) return bad(c, 'channelId is required');
			const settings = await flipChannel(c.env, body.channelId, actor(body), undo);
			return c.json({ success: true, result: { settings, verification: await channelVerification(c.env, body.channelId) } });
		}
		if (body.target === 'global') return c.json({ success: true, result: { settings: await flipGlobal(c.env, actor(body), undo) } });
		return bad(c, 'target must be videos, channel or global');
	});

	app.get('/channels/:id/verification', async (c) => {
		const id = c.req.param('id');
		if (!SAFE.test(id)) return bad(c, 'bad channel id');
		return c.json({ success: true, result: await channelVerification(c.env, id) });
	});

	app.get('/libraries', async (c) => c.json({ success: true, result: { libraries: await librarySummaries(c.env) } }));

	app.get('/libraries/:id/removals', async (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) return bad(c, 'bad library id');
		const cursor = c.req.query('cursor');
		if (cursor && !SAFE.test(cursor)) return bad(c, 'bad cursor');
		const status = c.req.query('status');
		if (status && !['scheduled', 'removing', 'removed', 'cancelled', 'failed'].includes(status)) return bad(c, 'bad status');
		return c.json({ success: true, result: await listRemovals(c.env, id, { status, cursor, limit: Number(c.req.query('limit')) || 50 }) });
	});

	app.post('/libraries/:id/removals', async (c) => {
		const id = Number(c.req.param('id'));
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		if (!Number.isInteger(id)) return bad(c, 'bad library id');
		return c.json({ success: true, result: await scheduleRemovals(c.env, id, Number(body.graceDays), actor(body)) });
	});

	app.post('/libraries/:id/removals/cancel', async (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) return bad(c, 'bad library id');
		return c.json({ success: true, result: await cancelRemovals(c.env, id) });
	});

	app.post('/removals/retry', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		if (typeof body.videoId !== 'string' || !SAFE.test(body.videoId)) return bad(c, 'videoId is required');
		return c.json({ success: true, result: await retryRemoval(c.env, ctxOf(c), body.videoId) });
	});

	return app;
}
