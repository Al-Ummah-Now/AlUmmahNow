/**
 * R2 delivery, internal side (X-API-Key = INTERNAL_API_KEY; the /internal/* guard in index.ts).
 * apps/media calls the first two over its service binding; admin-api proxies the rest
 * behind RBAC and audit (epic #687).
 *
 *   GET  /internal/media/source/:videoId   { url, candidates }  Bunny original, then MP4 fallbacks (signed)
 *   POST /internal/media/events            TranscodeJobEvent → the video record
 *   POST /internal/media/mp4               Mp4JobEvent (remux-only job, #1182) → the video record's result.mp4
 *   POST /internal/media/retry             { ids: string[] } → transcode again
 *   GET  /internal/media/jobs?status=&limit=  recent jobs (media_jobs)
 *   GET  /internal/media/summary?days=     time to playable and cost inputs per source, plus `live`
 *                                          (transcoding now, waiting, max concurrent, oldest wait);
 *                                          ?only=live returns just `live` (the Delivery page polls it)
 *   GET  /internal/media/qoe-live?minutes= playback quality per provider per minute (default the last
 *                                          60) and the plays now, from the realtime worker's live object
 *   GET  /internal/media/settings          delivery switch
 *   PUT  /internal/media/settings          { mode, r2Percent, assign, transcode, actorId }
 */
import { Hono } from 'hono';
import { isMediaRev, isMediaVideoId, type DeliverySettings, type Mp4JobEvent, type TranscodeJobEvent } from '@al-ummah/shared-types';
import R2Repository from '../../lib/r2Repo';
import { pushMediaLive, type MediaVideo } from '../../lib/media/r2-delivery';
import { readQoeLive } from '../../lib/media/qoe-live';
import type { LibraryHints } from '../../lib/bunny/libraries';
import { applyJobEvent, applyMp4Event, enqueueTranscode, readDeliverySettings, sourceCandidates, writeDeliverySettings, type MediaEnv } from '../../lib/media/r2-delivery';

const MAX_IDS = 50;

type Env = MediaEnv & {
	/** Max concurrent transcodes: max_instances of apps/media's transcoder container ("4" production, "2" stage and QA) */
	MEDIA_MAX_TRANSCODES?: string;
};

/** What the transcoder is doing now (media_jobs is our own record of the backlog). */
export interface MediaLive {
	/** Jobs a container is working on */
	transcoding: number;
	/** Jobs waiting for a container */
	queued: number;
	/** MEDIA_MAX_TRANSCODES; null when unset */
	maxTranscodes: number | null;
	/** queued_at of the oldest waiting job, and its age in seconds (server clock) */
	oldestQueuedAt: string | null;
	oldestQueuedSeconds: number | null;
	at: string;
}

export function maxTranscodesOf(value: string | undefined): number | null {
	const n = Number(value);
	return value && Number.isInteger(n) && n > 0 ? n : null;
}

export async function readMediaLive(env: Env, now: number = Date.now()): Promise<MediaLive> {
	const at = new Date(now).toISOString();
	const maxTranscodes = maxTranscodesOf(env.MEDIA_MAX_TRANSCODES);
	const db = env.SEARCH_DB;
	if (!db) return { transcoding: 0, queued: 0, maxTranscodes, oldestQueuedAt: null, oldestQueuedSeconds: null, at };
	const row = await db
		.prepare(
			`SELECT SUM(status = 'transcoding') AS transcoding, SUM(status = 'queued') AS queued,
			   MIN(CASE WHEN status = 'queued' THEN queued_at END) AS oldest_queued_at
			 FROM media_jobs WHERE status IN ('queued', 'transcoding')`,
		)
		.first<{ transcoding: number | null; queued: number | null; oldest_queued_at: string | null }>();
	const oldest = row?.oldest_queued_at ?? null;
	const oldestMs = oldest ? Date.parse(oldest) : NaN;
	return {
		transcoding: Number(row?.transcoding) || 0,
		queued: Number(row?.queued) || 0,
		maxTranscodes,
		oldestQueuedAt: oldest,
		oldestQueuedSeconds: Number.isFinite(oldestMs) ? Math.max(0, Math.round((now - oldestMs) / 1000)) : null,
		at,
	};
}

function isEvent(body: unknown): body is TranscodeJobEvent {
	const b = body as Partial<TranscodeJobEvent> | null;
	return !!b && typeof b.videoId === 'string' && isMediaVideoId(b.videoId) && typeof b.jobId === 'string' && ['started', 'progress', 'ready', 'failed'].includes(b.type as string);
}

function isMp4Event(body: unknown): body is Mp4JobEvent {
	const b = body as Partial<Mp4JobEvent> | null;
	return (
		!!b && typeof b.videoId === 'string' && isMediaVideoId(b.videoId) && typeof b.jobId === 'string' && typeof b.rev === 'string' && isMediaRev(b.rev) &&
		(b.access === 'pub' || b.access === 'priv') && (b.type === 'ready' || b.type === 'failed')
	);
}

export function createMediaInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	app.get('/source/:videoId', async (c) => {
		const id = c.req.param('videoId');
		if (!isMediaVideoId(id)) return c.json({ success: false, error: 'bad id' }, 400);
		const video = await c.env.videos.get(id);
		if (!video) return c.json({ success: false, error: 'video not found' }, 404);
		// The source lives in the video's own Bunny library
		const record = await video.json<LibraryHints>().catch(() => null);
		const candidates = await sourceCandidates(c.env, id, record);
		if (!candidates.length) return c.json({ success: false, error: 'no Bunny host configured' }, 404);
		return c.json({ success: true, url: candidates[0], candidates });
	});

	app.post('/events', async (c) => {
		const body = await c.req.json().catch(() => null);
		if (!isEvent(body)) return c.json({ success: false, error: 'bad event' }, 400);
		const result = await applyJobEvent(c.env as never, c.executionCtx as never, body);
		// A stale or duplicate event is not an error for the sender (it stops resending)
		return c.json({ success: true, result });
	});

	app.post('/mp4', async (c) => {
		const body = await c.req.json().catch(() => null);
		if (!isMp4Event(body)) return c.json({ success: false, error: 'bad event' }, 400);
		// Stale or duplicate: not an error for the sender
		return c.json({ success: true, result: await applyMp4Event(c.env, body) });
	});

	app.post('/retry', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { ids?: unknown } | null;
		const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === 'string' && isMediaVideoId(x)).slice(0, MAX_IDS) : [];
		if (!ids.length) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const results = [];
		for (const id of ids) {
			const r = await enqueueTranscode(c.env, id, 'retry', { force: true });
			results.push({ videoId: id, ...r });
			// Live admin view: the job is queued again
			if (r.queued) pushMediaLive(c.env as never, c.executionCtx as never, await new R2Repository<MediaVideo>(c.env.videos).getObject(id));
		}
		return c.json({ success: true, result: { results } });
	});

	app.get('/jobs', async (c) => {
		const db = c.env.SEARCH_DB;
		if (!db) return c.json({ success: true, result: { items: [] } });
		const status = c.req.query('status');
		const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
		const stmt = status
			? db.prepare('SELECT * FROM media_jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?').bind(status, limit)
			: db.prepare('SELECT * FROM media_jobs ORDER BY updated_at DESC LIMIT ?').bind(limit);
		const { results } = await stmt.all();
		return c.json({ success: true, result: { items: results ?? [] } });
	});

	app.get('/qoe-live', async (c) => {
		const minutes = parseInt(c.req.query('minutes') || '60', 10) || 60;
		const live = await readQoeLive(c.env as never, minutes);
		if (!live) return c.json({ success: false, error: 'Live playback quality is unavailable' }, 503);
		return c.json({ success: true, result: live });
	});

	app.get('/summary', async (c) => {
		const db = c.env.SEARCH_DB;
		const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 120);
		const since = new Date(Date.now() - days * 86400_000).toISOString();
		if (c.req.query('only') === 'live') return c.json({ success: true, result: { live: await readMediaLive(c.env) } });
		if (!db) return c.json({ success: true, result: { days, jobs: null, qoe: [], costs: [], live: await readMediaLive(c.env) } });
		const [jobs, qoe, costs, live] = await Promise.all([
			db
				.prepare(
					`SELECT COUNT(*) AS jobs,
					   SUM(status = 'ready') AS ready, SUM(status = 'failed') AS failed, SUM(status IN ('queued', 'transcoding')) AS running,
					   AVG(CASE WHEN status = 'ready' THEN (julianday(ready_at) - julianday(queued_at)) * 86400 END) AS r2_seconds_to_playable,
					   AVG(CASE WHEN bunny_ready_at IS NOT NULL AND bunny_ready_at >= queued_at THEN (julianday(bunny_ready_at) - julianday(queued_at)) * 86400 END) AS bunny_seconds_to_playable,
					   SUM(CASE WHEN status = 'ready' THEN duration_seconds END) AS video_seconds,
					   SUM(CASE WHEN status = 'ready' THEN container_seconds END) AS container_seconds,
					   SUM(CASE WHEN status = 'ready' THEN bytes END) AS bytes
					 FROM media_jobs WHERE queued_at >= ?`,
				)
				.bind(since)
				.first(),
			db
				.prepare(
					`SELECT day, provider, SUM(sessions) AS sessions, SUM(started) AS started, SUM(startup_ms_sum) AS startup_ms_sum,
					   SUM(rebuffers) AS rebuffers, SUM(rebuffer_ms) AS rebuffer_ms, SUM(watch_ms) AS watch_ms, SUM(kbps_watch_s) AS kbps_watch_s,
					   SUM(peak_kbps_sum) AS peak_kbps_sum, SUM(switches) AS switches, SUM(errors) AS errors, SUM(fallbacks) AS fallbacks
					 FROM playback_qoe_daily WHERE day >= ? GROUP BY day, provider ORDER BY day`,
				)
				.bind(since.slice(0, 10))
				.all(),
			db.prepare('SELECT day, provider, metric, value FROM delivery_cost_daily WHERE day >= ? ORDER BY day').bind(since.slice(0, 10)).all(),
			readMediaLive(c.env),
		]);
		// Why plays left R2 (lib/media/playback.ts): the fallback endpoint's count beside the QoE sessions'
		const fallbacks = await db
			.prepare(
				`SELECT requested, actual, reason, SUM(server_fallbacks) AS server_fallbacks, SUM(qoe_sessions) AS qoe_sessions
				 FROM playback_fallback_daily WHERE day >= ? GROUP BY requested, actual, reason ORDER BY server_fallbacks DESC`,
			)
			.bind(since.slice(0, 10))
			.all()
			.catch(() => ({ results: [] }));
		return c.json({ success: true, result: { days, jobs, qoe: qoe.results ?? [], costs: costs.results ?? [], fallbacks: fallbacks.results ?? [], live, settings: await readDeliverySettings(c.env) } });
	});

	app.get('/settings', async (c) => c.json({ success: true, result: await readDeliverySettings(c.env, true) }));

	app.put('/settings', async (c) => {
		const body = (await c.req.json().catch(() => null)) as (Partial<DeliverySettings> & { actorId?: string }) | null;
		if (!body || typeof body.actorId !== 'string' || !body.actorId) return c.json({ success: false, error: 'actorId is required' }, 400);
		const { actorId, ...input } = body;
		return c.json({ success: true, result: await writeDeliverySettings(c.env, input, actorId) });
	});

	return app;
}
