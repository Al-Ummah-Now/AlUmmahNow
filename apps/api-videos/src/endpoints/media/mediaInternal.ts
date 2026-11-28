/**
 * R2 delivery, internal side (X-API-Key = INTERNAL_API_KEY; the /internal/* guard in index.ts).
 * apps/media calls the first two over its service binding; admin-api proxies the rest
 * behind RBAC and audit (epic #687).
 *
 *   GET  /internal/media/source/:videoId   { url, candidates }  Bunny original, then MP4 fallbacks (signed)
 *   POST /internal/media/events            TranscodeJobEvent → the video record
 *   POST /internal/media/mp4               Mp4JobEvent (remux-only job, #1182) → the video record's result.mp4
 *   POST /internal/media/retry             { ids: string[] } → transcode again
 *   GET  /internal/media/hdr-check?live=1  the latest HDR check (lib/media/hdr-check.ts), or null; live: figures only
 *   POST /internal/media/hdr-check         { actorId } → starts one (read only); started: false while one runs
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
 *   GET  /internal/media/failures?ids=a,b  why these videos failed (lib/media/failures.ts); ids without a failure are left out
 *   POST /internal/media/troubleshoot/actions  { action: retry-now | cancel, videoId, actorId } → 202 { job }
 *                                          (admin-jobs queue: retry with backoff, DLQ, Errors page item when it gives up)
 *   POST /internal/media/troubleshoot/retry-now  { videoId } (the Errors page "Retry now" of a stall) → { job }
 *   POST /internal/media/troubleshoot/jobs/retry { jobId } (the Errors page Retry of an action that gave up)
 *   PUT  /internal/media/videos/:id/override  { override | null, actorId } a video's playback override
 *                                          (lib/media/video-override.ts) → { override, media };
 *                                          400 { problem } when it would leave the video unplayable
 */
import { z } from 'zod';
import { RecordId } from '../../validation/identifiers';
import { IntegerQuery, ObjectKey } from '../../validation/legacy-request';
import { Hono } from 'hono';
import { isMediaRev, isMediaVideoId, settingsProblems, PREBUILT_REJECTIONS, R2_RUNG_STATES, SOURCE_COLOUR_KINDS, sanitizeSourceFacts, sanitizeStartup, type ErrorReporterEnv, type ExecutionContextLike } from '@al-ummah/shared-types';
import R2Repository from '../../lib/r2Repo';
import { pushMediaLive, type MediaVideo } from '../../lib/media/r2-delivery';
import { readQoeLive } from '../../lib/media/qoe-live';
import { readHealth, runHealthCheck } from '../../lib/media/health';
import { MediaSettingsError, readMediaSettings, saveMediaSettings } from '../../lib/media/settings';
import { setVideoOverride } from '../../lib/media/video-override';
import { createBackfillInternalRouter } from './backfillInternal';
import type { LibraryHints } from '../../lib/bunny/libraries';
import { apiError } from '../../lib/api-error';
import { readVideoFailures } from '../../lib/media/failures';
import { readTroubleshootJobs, type TroubleshootEnv } from '../../lib/media/troubleshoot';
import { createJob, getJob, retryJob, type JobEnv } from '../../lib/admin/jobs';
import { readHdrCheck, startHdrCheck } from '../../lib/media/hdr-check';
import { readStartTimes, type StartTimeStats } from '../../lib/media/start-times';
import { transcodeCeilingOf } from '@al-ummah/shared-types';
import { effectiveTranscodes, readTranscodeLimitView, saveTranscodeLimit, TranscodeLimitError } from '../../lib/media/transcode-limit';
import { applyJobEvent, applyMp4Event, enqueueTranscode, readDeliverySettings, sourceCandidates, writeDeliverySettings, type MediaEnv } from '../../lib/media/r2-delivery';
import { isInternalVideoKey, VIDEO_FAILURES_MAX } from '@al-ummah/shared-types';

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

const VideoId = z.string().refine((id) => isMediaVideoId(id) && !isInternalVideoKey(id));
const JobId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const FileName = z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/);
const RungName = z.string().regex(/^[0-9]{2,4}p$/);
const Count = z.number().int().nonnegative();
const Amount = z.number().nonnegative();
const Fraction = z.number().min(0).max(1);
const Label = z.string().max(80);
const At = z.iso.datetime({ offset: true });
const Size = { width: Count, height: Count };
const Mp4 = z.object({ ...Size, file: FileName.refine((file) => file.endsWith('.mp4')), rung: RungName, bytes: Count });
const Result = z.object({
	rungs: z.array(z.object({ ...Size, name: RungName, maxrate: Count, bandwidth: Count.optional(), bytes: Count.optional(), segments: Count.optional() })).min(1).max(8),
	objects: Count, bytes: Count, durationSeconds: Amount,
	source: z.object({
		...Size, durationSeconds: Amount, bytes: Count, codec: Label.optional(), hasAudio: z.boolean(), file: FileName.optional(),
		colour: z.object({ kind: z.enum(SOURCE_COLOUR_KINDS), transfer: Label.optional(), primaries: Label.optional(), matrix: Label.optional() }).optional(),
	}),
	timings: z.object({ downloadMs: Amount, transcodeMs: Amount, uploadMs: Amount, totalMs: Amount }),
	thumbnail: FileName, preview: FileName.optional(), mp4: Mp4.optional(),
	review: z.object({ manifestKey: ObjectKey.optional(), failed: z.boolean().optional() }).optional(),
	prebuilt: z.object({ used: z.boolean(), reason: z.enum(PREBUILT_REJECTIONS).optional(), rung: RungName.optional() }).optional(),
});
const Failure = z.object({
	stage: z.enum(['start', 'fetch_source', 'probe', 'encode', 'stills', 'upload', 'container']),
	stageDetail: Label.optional(), error: z.string().max(1000), attempt: Count, elapsedMs: Amount, at: At,
	source: z.object({ file: FileName.optional(), bytes: Count.optional() }).optional(),
	exitCode: z.number().int().optional(), stopReason: z.string().max(200).optional(), instanceId: Label.optional(),
	stderrTail: z.array(z.string().max(1000)).max(20).optional(),
});
const Event = z.object({
	videoId: VideoId, jobId: RecordId, at: At, attempt: Count,
	type: z.enum(['started', 'progress', 'ready', 'failed']), progress: Fraction.optional(),
	rungs: z.array(z.object({ name: RungName, state: z.enum(R2_RUNG_STATES), progress: Fraction.optional() })).max(8).optional(),
	containerSeconds: Amount.optional(), instanceType: Label.optional(), result: Result.optional(),
	error: z.string().max(1000).optional(), final: z.boolean().optional(), failure: Failure.optional(),
	sourceFacts: z.unknown().transform((value) => sanitizeSourceFacts(value) ?? undefined).optional(),
	startup: z.unknown().transform((value) => sanitizeStartup(value) ?? undefined).optional(),
}).refine((event) => event.type !== 'ready' || !!event.result);
const Mp4Event = z.object({
	videoId: VideoId, jobId: RecordId, rev: z.string().refine(isMediaRev), access: z.enum(['pub', 'priv']),
	type: z.enum(['ready', 'failed']), at: At, mp4: Mp4.optional(),
	error: z.string().max(1000).optional(), containerSeconds: Amount.optional(),
}).refine((event) => event.type !== 'ready' || !!event.mp4);
const Actor = z.object({ actorId: RecordId });
const IdInput = z.object({ videoId: VideoId });
const Retry = z.object({ ids: z.array(VideoId).min(1).max(MAX_IDS) });
const LegacyDelivery = Actor.extend({
	mode: z.enum(['bunny', 'r2', 'split']).optional(), r2Percent: z.number().min(0).max(100).optional(),
	assign: z.enum(['video', 'view']).optional(), transcode: z.boolean().optional(),
});

export function createMediaInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	// R2 backfill of existing videos and Bunny retirement (backfillInternal.ts)
	app.route('/backfill', createBackfillInternalRouter() as never);

	app.get('/source/:videoId', async (c) => {
		const id = c.req.param('videoId');
		if (!isMediaVideoId(id) || isInternalVideoKey(id)) return c.json({ success: false, error: 'bad id' }, 400);
		const video = await c.env.videos.get(id);
		if (!video) return c.json({ success: false, error: 'video not found' }, 404);
		// The source lives in the video's own Bunny library
		const record = await video.json<LibraryHints>().catch(() => null);
		const candidates = await sourceCandidates(c.env, id, record);
		if (!candidates.length) return c.json({ success: false, error: 'no Bunny host configured' }, 404);
		return c.json({ success: true, url: candidates[0], candidates });
	});

	app.post('/events', async (c) => {
		const parsed = Event.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'bad event' }, 400);
		const body = parsed.data;
		const result = await applyJobEvent(c.env as never, c.executionCtx as never, body);
		// A stale or duplicate event is not an error for the sender (it stops resending)
		return c.json({ success: true, result });
	});

	app.post('/mp4', async (c) => {
		const parsed = Mp4Event.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'bad event' }, 400);
		const body = parsed.data;
		// Stale or duplicate: not an error for the sender
		return c.json({ success: true, result: await applyMp4Event(c.env, body) });
	});

	app.post('/retry', async (c) => {
		const parsed = Retry.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'Invalid video ids' }, 400);
		const { ids } = parsed.data;
		const results = [];
		for (const id of ids) {
			const r = await enqueueTranscode(c.env, id, 'retry', { force: true });
			results.push({ videoId: id, ...r });
			// Live admin view: the job is queued again
			if (r.queued) pushMediaLive(c.env as never, c.executionCtx as never, await new R2Repository<MediaVideo>(c.env.videos).getObject(id));
		}
		return c.json({ success: true, result: { results } });
	});

	app.get('/hdr-check', async (c) => {
		const parsed = z.object({ live: z.enum(['0', '1']).optional() }).safeParse(c.req.query());
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		return c.json({ success: true, result: { run: await readHdrCheck(c.env, { live: parsed.data.live === '1' }) } });
	});

	app.post('/hdr-check', async (c) => {
		const parsed = Actor.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return apiError(c, 400, 'bad_request', { error: 'actorId is required' });
		return c.json({ success: true, result: await startHdrCheck(c.env, parsed.data.actorId) });
	});

	app.get('/jobs', async (c) => {
		const parsed = z.object({ status: z.enum(['queued', 'transcoding', 'ready', 'failed', 'cancelled']).optional(), limit: IntegerQuery.optional() }).safeParse(c.req.query());
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const db = c.env.SEARCH_DB;
		if (!db) return c.json({ success: true, result: { items: [] } });
		const { status } = parsed.data;
		const limit = Math.min(Math.max(parsed.data.limit || 50, 1), 200);
		const stmt = status
			? db.prepare('SELECT * FROM media_jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?').bind(status, limit)
			: db.prepare('SELECT * FROM media_jobs ORDER BY updated_at DESC LIMIT ?').bind(limit);
		const { results } = await stmt.all();
		return c.json({ success: true, result: { items: results ?? [] } });
	});

	app.get('/troubleshoot', async (c) => {
		const parsed = z.object({ video: VideoId.optional() }).safeParse(c.req.query());
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		return c.json({ success: true, result: await readTroubleshootJobs(c.env as TroubleshootEnv, Date.now(), parsed.data.video) });
	});

	// Why videos failed, for every admin page that shows them (lib/media/failures.ts)
	app.get('/failures', async (c) => {
		const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean);
		if (!ids.length || ids.length > VIDEO_FAILURES_MAX || !ids.every(isMediaVideoId)) return apiError(c, 400, 'invalid_request', { error: `ids must be 1-${VIDEO_FAILURES_MAX} video ids` });
		return c.json({ success: true, result: { items: await readVideoFailures(c.env as never, ids) } });
	});

	/** Retry now / Cancel run as admin jobs (owner rule: queued, retried, failures flag the admin). */
	const queueAction = async (env: Env, action: 'retry-now' | 'cancel', videoId: string, actorId: string) =>
		createJob(env as unknown as JobEnv, { kind: action === 'cancel' ? 'media.transcode-cancel' : 'media.transcode-retry', targetKind: 'video', targetId: videoId, actorId });

	app.post('/troubleshoot/actions', async (c) => {
		const parsed = Actor.extend({ videoId: VideoId, action: z.enum(['retry-now', 'cancel']) }).safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const body = parsed.data;
		const job = await queueAction(c.env, body.action, body.videoId, body.actorId);
		return c.json({ success: true, result: { job } }, 202);
	});

	app.post('/troubleshoot/retry-now', async (c) => {
		const parsed = IdInput.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'bad video id' }, 400);
		const body = parsed.data;
		const job = await queueAction(c.env, 'retry-now', body.videoId, 'errors-retry');
		if (job.status === 'failed') return c.json({ success: false, error: job.lastError ?? 'could not queue' }, 503);
		return c.json({ success: true, result: { job } });
	});

	app.post('/troubleshoot/jobs/retry', async (c) => {
		const parsed = z.object({ jobId: JobId }).safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'bad job id' }, 400);
		const body = parsed.data;
		const existing = await getJob(c.env as unknown as JobEnv, body.jobId);
		if (!existing || !existing.kind.startsWith('media.transcode-')) return c.json({ success: false, error: 'job not found' }, 404);
		const job = await retryJob(c.env as unknown as JobEnv, body.jobId);
		return c.json({ success: true, result: { job } });
	});

	app.get('/qoe-live', async (c) => {
		const parsed = z.object({ minutes: IntegerQuery.optional() }).safeParse(c.req.query());
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const minutes = parsed.data.minutes || 60;
		const live = await readQoeLive(c.env as never, minutes);
		if (!live) return c.json({ success: false, error: 'Live playback quality is unavailable' }, 503);
		return c.json({ success: true, result: live });
	});

	app.get('/summary', async (c) => {
		const parsed = z.object({ days: IntegerQuery.optional(), only: z.literal('live').optional() }).safeParse(c.req.query());
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const db = c.env.SEARCH_DB;
		const days = Math.min(Math.max(parsed.data.days || 30, 1), 120);
		const since = new Date(Date.now() - days * 86400_000).toISOString();
		if (parsed.data.only === 'live') return c.json({ success: true, result: { live: await readMediaLive(c.env) } });
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
		const parsed = z.object({ min: z.unknown(), max: z.unknown(), actorId: RecordId.default('unknown') })
			.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const body = parsed.data;
		const actorId = body.actorId;
		try {
			return c.json({ success: true, result: await saveTranscodeLimit(c.env, { min: body?.min, max: body?.max }, actorId) });
		} catch (error) {
			if (error instanceof TranscodeLimitError) return c.json({ success: false, code: error.problem, field: error.field, ceiling: error.ceiling, error: error.message }, 400);
			throw error;
		}
	});

	app.get('/settings', async (c) => c.json({ success: true, result: await readDeliverySettings(c.env, true) }));

	app.put('/settings', async (c) => {
		const parsed = LegacyDelivery.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const { actorId, ...input } = parsed.data;
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
		const parsed = Actor.extend({ settings: z.record(z.string(), z.unknown()) }).safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const body = parsed.data;
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
		const parsed = Actor.extend({ override: z.record(z.string(), z.unknown()).nullable() }).safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return apiError(c, 400, 'bad_request');
		const body = parsed.data;
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
