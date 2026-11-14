/**
 * Internal caption-job endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). Not part of the public contract.
 *
 *   POST /internal/captions/jobs/:jobId/audio     the media worker extracted the audio (CaptionAudioReport)
 *   POST /internal/captions/jobs/:jobId/progress  the processor's progress { status, done?, total? }; 409 when no longer active
 *   POST /internal/captions/jobs/:jobId/finish    { outcome: 'ready', minutesUsed } | { outcome: 'failed', error }
 *   POST /internal/captions/jobs/retry            { jobId } the admin Errors page's Retry (free of charge);
 *                                                 404 when the video is gone or a newer job of it runs
 */
import { Hono } from 'hono';
import { CAPTION_JOB_ERRORS, type CaptionAudioReport, type CaptionJobError, type CaptionJobStatus, type VideoObject } from '@al-ummah/shared-types';
import R2Repository from '../../lib/r2Repo';
import { CaptionJobHttpError, finishJob, onAudioReport, onProgress, readJob, retryJob, type CaptionJobsEnv } from '../../lib/captions/jobs';
import { logger } from '../../lib/logger';

type Env = CaptionJobsEnv & { videos: R2Bucket };
type Ctx = { waitUntil(promise: Promise<unknown>): void } | undefined;

const ctxOf = (c: { executionCtx: Ctx }): Ctx => {
	try {
		return c.executionCtx;
	} catch {
		return undefined;
	}
};

export function createCaptionJobsInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	app.onError((error, c) => {
		if (error instanceof CaptionJobHttpError) return c.json({ success: false, error: error.code }, error.status as 400);
		logger.error('[CaptionJobs] Internal call failed', { path: c.req.path, error: error.message });
		return c.json({ success: false, error: 'internal_error' }, 500);
	});

	const video = (env: Env, videoId: string) => new R2Repository<VideoObject>(env.videos).getObject(videoId);

	app.post('/jobs/retry', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { jobId?: unknown } | null;
		const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
		if (!jobId) return c.json({ success: false, error: 'jobId is required' }, 400);
		const job = await readJob(c.env, jobId);
		if (!job) return c.json({ success: false, error: 'No such caption job' }, 404);
		try {
			const retried = await retryJob(c.env, jobId, await video(c.env, job.videoId));
			return c.json({ success: true, result: { status: retried.status } });
		} catch (error) {
			// Nothing left to retry (the Errors page dismisses the item on 404)
			if (error instanceof CaptionJobHttpError && ['video_gone', 'newer_job_active'].includes(error.code)) return c.json({ success: false, error: error.code }, 404);
			throw error;
		}
	});

	app.post('/jobs/:jobId/audio', async (c) => {
		const body = (await c.req.json().catch(() => null)) as Partial<{ ok: boolean; manifestKey: string; error: string; retryable: boolean }> | null;
		if (!body || typeof body.ok !== 'boolean') return c.json({ success: false, error: 'invalid_report' }, 400);
		const report: CaptionAudioReport = body.ok
			? { ok: true, manifestKey: String(body.manifestKey ?? '') }
			: { ok: false, error: String(body.error ?? 'failed').slice(0, 300), retryable: body.retryable === true };
		const job = await readJob(c.env, c.req.param('jobId'));
		if (!job) return c.json({ success: false, error: 'job_not_found' }, 404);
		const title = (await video(c.env, job.videoId))?.title;
		const done = await onAudioReport(c.env, job.id, report, title, ctxOf(c as never));
		return c.json({ success: true, result: { status: done.status } });
	});

	app.post('/jobs/:jobId/progress', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { status?: unknown; done?: unknown; total?: unknown } | null;
		const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);
		const active = await onProgress(c.env, c.req.param('jobId'), { status: String(body?.status ?? '') as CaptionJobStatus, done: num(body?.done), total: num(body?.total) });
		if (!active) return c.json({ success: false, error: 'job_not_active' }, 409);
		return c.json({ success: true });
	});

	app.post('/jobs/:jobId/finish', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { outcome?: unknown; minutesUsed?: unknown; error?: unknown } | null;
		const ctx = ctxOf(c as never);
		if (body?.outcome === 'ready' && typeof body.minutesUsed === 'number' && Number.isInteger(body.minutesUsed) && body.minutesUsed >= 0) {
			const job = await finishJob(c.env, c.req.param('jobId'), { outcome: 'ready', minutesUsed: body.minutesUsed }, ctx);
			return c.json({ success: true, result: { status: job.status } });
		}
		if (body?.outcome === 'failed') {
			const error = (CAPTION_JOB_ERRORS as readonly string[]).includes(String(body.error)) ? (body.error as CaptionJobError) : 'failed';
			const job = await finishJob(c.env, c.req.param('jobId'), { outcome: 'failed', error }, ctx);
			return c.json({ success: true, result: { status: job.status } });
		}
		return c.json({ success: false, error: 'invalid_outcome' }, 400);
	});

	return app;
}
