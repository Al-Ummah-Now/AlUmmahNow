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
 *   GET  /internal/media/settings          the legacy delivery switch view of the provider settings
 *   PUT  /internal/media/settings          { mode, r2Percent, assign, transcode, actorId } (kept for old admin builds)
 *   GET  /internal/media/providers         { settings, health, problems } provider settings (docs/media-delivery/PROVIDERS.md)
 *   PUT  /internal/media/providers         { settings, actorId } → 400 { problems } when unsafe
 *   POST /internal/media/health/check      one provider health pass now (the Errors page "Check now")
 *   /internal/media/backfill/*            the R2 backfill and Bunny retirement (backfillInternal.ts)
 *   GET  /internal/media/troubleshoot      the troubleshooting panel's jobs (lib/media/troubleshoot.ts): queued,
 *                                          running, waiting and recent failed/cancelled, with the Transcoder's view
 *   POST /internal/media/troubleshoot/actions  { action: retry-now | cancel, videoId, actorId } → 202 { job }
 *                                          (admin-jobs queue: retry with backoff, DLQ, Errors page item when it gives up)
 *   POST /internal/media/troubleshoot/retry-now  { videoId } (the Errors page "Retry now" of a stall) → { job }
 *   POST /internal/media/troubleshoot/jobs/retry { jobId } (the Errors page Retry of an action that gave up)
 *   PUT  /internal/media/videos/:id/override  { override | null, actorId } a video's playback override
 *                                          (lib/media/video-override.ts) → { override, media };
 *                                          400 { problem } when it would leave the video unplayable
 */
import { Hono } from 'hono';
import { isMediaRev, isMediaVideoId, settingsProblems, type AudioExtractJobEvent, type DeliverySettings, type ErrorReporterEnv, type ExecutionContextLike, type Mp4JobEvent, type TranscodeJobEvent } from '@al-ummah/shared-types';
import R2Repository from '../../lib/r2Repo';
import { pushMediaLive, type MediaVideo } from '../../lib/media/r2-delivery';
import { readQoeLive } from '../../lib/media/qoe-live';
import { readHealth, runHealthCheck } from '../../lib/media/health';
import { MediaSettingsError, readMediaSettings, saveMediaSettings } from '../../lib/media/settings';
import { setVideoOverride } from '../../lib/media/video-override';
import { createBackfillInternalRouter } from './backfillInternal';
import type { LibraryHints } from '../../lib/bunny/libraries';
import { readTroubleshootJobs, type TroubleshootEnv } from '../../lib/media/troubleshoot';
import { createJob, getJob, retryJob, type JobEnv } from '../../lib/admin/jobs';
import { readStartTimes, type StartTimeStats } from '../../lib/media/start-times';
import { transcodeCeilingOf } from '@al-ummah/shared-types';
import { effectiveTranscodes, readTranscodeLimitView, saveTranscodeLimit, TranscodeLimitError } from '../../lib/media/transcode-limit';
import { applyAudioExtractEvent, applyJobEvent, applyMp4Event, enqueueAudioExtract, enqueueTranscode, readDeliverySettings, sourceCandidates, writeDeliverySettings, type MediaEnv } from '../../lib/media/r2-delivery';
import { apiError } from '../../lib/api-error';

const MAX_IDS = 50;

type Env = MediaEnv & ErrorReporterEnv & {
	BUNNY_SIGN_URLS?: string;
	/** Hard ceiling of the admin's max concurrent transcodes: apps/media's container max_instances ("3371" production, "2" stage and QA); unset means no ceiling, never a made-up one */
	MEDIA_TRANSCODE_CEILING?: string;
};

/** What the transcoder is doing now (media_jobs is our own record of the backlog). */
export interface MediaLive {
	/** Jobs a container is working on */
	transcoding: number;
	/** Jobs waiting for a container */
	queued: number;
	/** The concurrent transcodes range the dispatcher enforces now (the admin's setting under the ceiling) */
	rangeMin: number;
	rangeMax: number;
	/** The ceiling (the container's max_instances); null when not configured */
	ceiling: number | null;
	/** queued_at of the oldest waiting job, and its age in seconds (server clock) */
	oldestQueuedAt: string | null;
	oldestQueuedSeconds: number | null;
	/** How long transcodes took to start over the last days (p50/p95, cold vs warm); null without data access */
	startTimes: StartTimeStats | null;
	at: string;
}

export async function readMediaLive(env: Env, now: number = Date.now()): Promise<MediaLive> {
	const at = new Date(now).toISOString();
	const ceiling = transcodeCeilingOf(env.MEDIA_TRANSCODE_CEILING);
	const range = await effectiveTranscodes(env, now);
	const db = env.SEARCH_DB;
	if (!db) return { transcoding: 0, queued: 0, rangeMin: range.min, rangeMax: range.max, ceiling, oldestQueuedAt: null, oldestQueuedSeconds: null, startTimes: null, at };
	const row = await db
		.prepare(
			`SELECT SUM(status = 'transcoding') AS transcoding, SUM(status = 'queued') AS queued,
			   MIN(CASE WHEN status = 'queued' THEN queued_at END) AS oldest_queued_at
			 FROM media_jobs WHERE status IN ('queued', 'transcoding')`,
		)
		.first<{ transcoding: number | null; queued: number | null; oldest_queued_at: string | null }>();
	// Start times are a nice-to-have: a failing read never hides the live figures
	const startTimes = await readStartTimes(db, now).catch(() => null);
	const oldest = row?.oldest_queued_at ?? null;
	const oldestMs = oldest ? Date.parse(oldest) : NaN;
	return {
		transcoding: Number(row?.transcoding) || 0,
		queued: Number(row?.queued) || 0,
		rangeMin: range.min,
		rangeMax: range.max,
		ceiling,
		oldestQueuedAt: oldest,
		oldestQueuedSeconds: Number.isFinite(oldestMs) ? Math.max(0, Math.round((now - oldestMs) / 1000)) : null,
		startTimes,
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

function isAudioExtractEvent(body: unknown): body is AudioExtractJobEvent {
	const b = body as Partial<AudioExtractJobEvent> | null;
	return (
		!!b && typeof b.videoId === 'string' && isMediaVideoId(b.videoId) && typeof b.jobId === 'string' && typeof b.rev === 'string' && isMediaRev(b.rev) &&
		(b.access === 'pub' || b.access === 'priv') && (b.type === 'ready' || b.type === 'failed')
	);
}

export function createMediaInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	// R2 backfill of existing videos and Bunny retirement (backfillInternal.ts)
	app.route('/backfill', createBackfillInternalRouter() as never);

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

	app.post('/audio-extract', async (c) => {
		const body = await c.req.json().catch(() => null);
		if (!isAudioExtractEvent(body)) return apiError(c, 400, 'bad_request', { error: 'bad event' });
		return c.json({ success: true, result: await applyAudioExtractEvent(c.env, body, c.executionCtx as never) });
	});

	app.post('/audio-extract/retry', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { ids?: unknown } | null;
		const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === 'string' && isMediaVideoId(x)).slice(0, MAX_IDS) : [];
		if (!ids.length) return apiError(c, 400, 'bad_request', { error: `ids must be 1-${MAX_IDS} video ids` });
		const videosRepo = new R2Repository<MediaVideo>(c.env.videos);
		const results = [];
		for (const id of ids) {
			const video = await videosRepo.getObject(id);
			if (!video) {
				results.push({ videoId: id, queued: false, why: 'video not found' });
				continue;
			}
			const r = await enqueueAudioExtract(c.env, video, { force: true });
			results.push({ videoId: id, ...r });
		}
		return c.json({ success: true, result: { results } });
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

	app.get('/troubleshoot', async (c) => c.json({ success: true, result: await readTroubleshootJobs(c.env as TroubleshootEnv) }));

	/** Retry now / Cancel run as admin jobs (owner rule: queued, retried, failures flag the admin). */
	const queueAction = async (env: Env, action: 'retry-now' | 'cancel', videoId: string, actorId: string) =>
		createJob(env as unknown as JobEnv, { kind: action === 'cancel' ? 'media.transcode-cancel' : 'media.transcode-retry', targetKind: 'video', targetId: videoId, actorId });

	app.post('/troubleshoot/actions', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { action?: unknown; videoId?: unknown; actorId?: unknown } | null;
		if (body?.action !== 'retry-now' && body?.action !== 'cancel') return c.json({ success: false, error: 'action must be retry-now or cancel' }, 400);
		if (typeof body.videoId !== 'string' || !isMediaVideoId(body.videoId)) return c.json({ success: false, error: 'bad video id' }, 400);
		if (typeof body.actorId !== 'string' || !body.actorId) return c.json({ success: false, error: 'actorId is required' }, 400);
		const job = await queueAction(c.env, body.action, body.videoId, body.actorId);
		return c.json({ success: true, result: { job } }, 202);
	});

	app.post('/troubleshoot/retry-now', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { videoId?: unknown } | null;
		if (typeof body?.videoId !== 'string' || !isMediaVideoId(body.videoId)) return c.json({ success: false, error: 'bad video id' }, 400);
		const job = await queueAction(c.env, 'retry-now', body.videoId, 'errors-retry');
		if (job.status === 'failed') return c.json({ success: false, error: job.lastError ?? 'could not queue' }, 503);
		return c.json({ success: true, result: { job } });
	});

	app.post('/troubleshoot/jobs/retry', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { jobId?: unknown } | null;
		if (typeof body?.jobId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.jobId)) return c.json({ success: false, error: 'bad job id' }, 400);
		const existing = await getJob(c.env as unknown as JobEnv, body.jobId);
		if (!existing || !existing.kind.startsWith('media.transcode-')) return c.json({ success: false, error: 'job not found' }, 404);
		const job = await retryJob(c.env as unknown as JobEnv, body.jobId);
		return c.json({ success: true, result: { job } });
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
		return c.json({ success: true, result: { days, jobs, qoe: qoe.results ?? [], costs: costs.results ?? [], fallbacks: fallbacks.results ?? [], live, settings: await readDeliverySettings(c.env), providers: await readMediaSettings(c.env), health: await readHealth(c.env) } });
	});

	// Concurrent R2 transcodes range (admin-api: everyone with an admin role reads, admins change it, audited)
	app.get('/transcode-limit', async (c) => c.json({ success: true, result: await readTranscodeLimitView(c.env, true) }));
	app.put('/transcode-limit', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { min?: unknown; max?: unknown; actorId?: unknown } | null;
		const actorId = typeof body?.actorId === 'string' ? body.actorId : 'unknown';
		try {
			return c.json({ success: true, result: await saveTranscodeLimit(c.env, { min: body?.min, max: body?.max }, actorId) });
		} catch (error) {
			if (error instanceof TranscodeLimitError) return c.json({ success: false, code: error.problem, field: error.field, ceiling: error.ceiling, error: error.message }, 400);
			throw error;
		}
	});

	app.get('/settings', async (c) => c.json({ success: true, result: await readDeliverySettings(c.env, true) }));

	app.put('/settings', async (c) => {
		const body = (await c.req.json().catch(() => null)) as (Partial<DeliverySettings> & { actorId?: string }) | null;
		if (!body || typeof body.actorId !== 'string' || !body.actorId) return c.json({ success: false, error: 'actorId is required' }, 400);
		const { actorId, ...input } = body;
		try {
			return c.json({ success: true, result: await writeDeliverySettings(c.env, input, actorId) });
		} catch (error) {
			if (error instanceof MediaSettingsError) return c.json({ success: false, error: error.message, problems: error.problems }, 400);
			throw error;
		}
	});

	app.get('/providers', async (c) => {
		const settings = await readMediaSettings(c.env, true);
		return c.json({ success: true, result: { settings, health: await readHealth(c.env, true), problems: settingsProblems(settings) } });
	});

	app.put('/providers', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { settings?: unknown; actorId?: string } | null;
		if (!body || typeof body.actorId !== 'string' || !body.actorId) return c.json({ success: false, error: 'actorId is required' }, 400);
		if (!body.settings || typeof body.settings !== 'object') return c.json({ success: false, error: 'settings is required' }, 400);
		try {
			const settings = await saveMediaSettings(c.env, body.settings, body.actorId);
			return c.json({ success: true, result: { settings, health: await readHealth(c.env), problems: [] } });
		} catch (error) {
			if (error instanceof MediaSettingsError) return c.json({ success: false, error: error.message, problems: error.problems }, 400);
			throw error;
		}
	});

	app.put('/videos/:id/override', async (c) => {
		const id = c.req.param('id');
		if (!isMediaVideoId(id)) return c.json({ success: false, error: 'bad id' }, 400);
		const body = (await c.req.json().catch(() => null)) as { override?: unknown; actorId?: string } | null;
		if (!body || typeof body.actorId !== 'string' || !body.actorId) return c.json({ success: false, error: 'actorId is required' }, 400);
		if (body.override !== null && (typeof body.override !== 'object' || Array.isArray(body.override))) return c.json({ success: false, error: 'override must be an object or null' }, 400);
		const result = await setVideoOverride(c.env, id, body.override, body.actorId);
		if ('problem' in result) {
			if (result.problem === 'not_found' || result.problem === 'deleted') return c.json({ success: false, error: 'video not found', problem: result.problem }, 404);
			return c.json({ success: false, error: 'This override would leave the video unplayable', problem: result.problem, problems: [{ problem: result.problem }] }, 400);
		}
		return c.json({ success: true, result: { override: result.override, media: result.media } });
	});

	app.post('/health/check', async (c) => {
		let ctx: ExecutionContextLike | undefined;
		try {
			ctx = c.executionCtx;
		} catch {
			ctx = undefined;
		}
		const snapshot = await runHealthCheck(c.env, ctx, new Date(), { force: true });
		if (!snapshot) return c.json({ success: false, error: 'The health check failed; see the logs' }, 500);
		return c.json({ success: true, result: snapshot });
	});

	return app;
}
