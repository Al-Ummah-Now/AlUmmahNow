/**
 * Discovery ranking, internal side (X-API-Key = INTERNAL_API_KEY; the /internal/* guard in index.ts).
 * admin-api proxies these behind RBAC and audit (videos admin → Discovery); the Errors page's
 * "Run now" on a run that gave up calls /rank (admin-api errors-actions.ts).
 *
 *   GET  /internal/discovery/status            last run summary, recent jobs, the main rails (mode, label, size)
 *   POST /internal/discovery/rank              { actorId? } → 202 { job, existing } a run now (admin-jobs queue)
 *   GET  /internal/discovery/preview?rail=&scope=&limit=   a rail's first items with why they are there
 */
import { Hono } from 'hono';
import { logger } from '../../lib/logger';
import { DISCOVERY_NEEDS_ACTION_KEY, RAIL_IDS, discoveryJobs, readLastRun, startDiscoveryRank, type DiscoveryEnv, type RailId } from '../../lib/ranking/job';
import { railPage } from '../../lib/ranking/serve';

const SCOPE = /^(|lang:(ar|en)|cat:[a-z0-9_-]{1,64})$/;

export function createDiscoveryInternalRouter() {
	const app = new Hono<{ Bindings: DiscoveryEnv & { videos: R2Bucket; channels?: R2Bucket } }>();

	app.onError((error, c) => {
		logger.error('[Discovery] Internal call failed', { path: c.req.path, error: error.message });
		return c.json({ success: false, error: 'internal_error' }, 500);
	});

	app.get('/status', async (c) => {
		const db = c.env.SEARCH_DB as unknown as { prepare(sql: string): { all<T>(): Promise<{ results?: T[] }> } } | undefined;
		const [lastRun, jobs, rails] = await Promise.all([
			readLastRun(c.env),
			discoveryJobs(c.env, 10),
			db
				?.prepare("SELECT rail, scope, mode, label, items, signal_items, computed_at FROM discovery_rails WHERE scope IN ('', 'lang:ar', 'lang:en') ORDER BY rail, scope")
				.all<{ rail: string; scope: string; mode: string; label: string; items: number; signal_items: number; computed_at: number }>()
				.then((r) => r.results ?? [])
				.catch(() => []) ?? [],
		]);
		return c.json({
			success: true,
			result: {
				lastRun,
				jobs,
				rails: rails.map((r) => ({ rail: r.rail, scope: r.scope, mode: r.mode, label: r.label, items: Number(r.items), signalItems: Number(r.signal_items), computedAt: new Date(Number(r.computed_at)).toISOString() })),
				needsActionKey: DISCOVERY_NEEDS_ACTION_KEY,
			},
		});
	});

	app.post('/rank', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { actorId?: unknown };
		const actorId = typeof body?.actorId === 'string' && body.actorId ? body.actorId.slice(0, 128) : 'admin';
		const { job, existing } = await startDiscoveryRank(c.env, actorId);
		return c.json({ success: true, result: { job, existing } }, 202);
	});

	app.get('/preview', async (c) => {
		const rail = c.req.query('rail') as RailId;
		const scope = c.req.query('scope') ?? '';
		if (!(RAIL_IDS as readonly string[]).includes(rail) || !SCOPE.test(scope)) return c.json({ success: false, error: 'invalid_rail' }, 400);
		const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 24));
		const page = await railPage(c.env as never, { rail, scope, limit });
		if (!page) return c.json({ success: true, result: { rail, scope, meta: null, items: [] } });
		return c.json({
			success: true,
			result: {
				rail,
				scope: page.meta.scope,
				meta: page.meta,
				items: page.entries.map((e) => ({
					position: e.position,
					reason: e.reason,
					score: e.score,
					id: e.video.id,
					title: e.video.title,
					titleLocalized: (e.video as { titleLocalized?: Record<string, string> }).titleLocalized,
					thumbnailUrl: e.video.thumbnailUrl,
					channelId: e.video.channelId,
					channelName: e.video.channelName,
					channelNameLocalized: (e.video as { channelNameLocalized?: Record<string, string> }).channelNameLocalized,
				})),
			},
		});
	});

	return app;
}
