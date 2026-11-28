/**
 * Internal caption-job endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). Not part of the public contract.
 *
 *   POST /internal/captions/jobs/:jobId/audio     the media worker extracted the audio (CaptionAudioReport)
 *   POST /internal/captions/jobs/:jobId/progress  the processor's progress { status, done?, total? }; 409 when no longer active
 *   POST /internal/captions/jobs/:jobId/finish    { outcome: 'ready', minutesUsed } | { outcome: 'failed', error }
 *   POST /internal/captions/jobs/retry            { jobId } the admin Errors page's Retry (free of charge);
 *                                                 404 when the video is gone or a newer job of it runs
 *   POST /internal/captions/metadata-translations { videoId, lang, sourceHash, title, description, provider, model }
 *                                                 the processor's viewer-side title translation (§5.9); 409 when the
 *                                                 video changed meanwhile, 404 when it is gone or no longer public
 */
import { z } from 'zod';
import { RecordId, SubtitleLanguage } from '../../validation/identifiers';
import { Hono } from 'hono';
import { CAPTION_JOB_ERRORS, captionWorkPrefix, type VideoObject } from '@al-ummah/shared-types';
import R2Repository from '../../lib/r2Repo';
import { CaptionJobHttpError, finishJob, onAudioReport, onProgress, readJob, retryJob, type CaptionJobsEnv } from '../../lib/captions/jobs';
import { logger } from '../../lib/logger';
import { apiError } from '../../lib/api-error';
import { isVideoPubliclyVisible } from '../../lib/visibility';
import { saveViewerTranslation, TranslateHttpError } from '../../lib/translate/inline';

type Env = CaptionJobsEnv & { videos: R2Bucket };
type Ctx = { waitUntil(promise: Promise<unknown>): void } | undefined;

const ctxOf = (c: { executionCtx: Ctx }): Ctx => {
	try {
		return c.executionCtx;
	} catch {
		return undefined;
	}
};

const Retry = z.object({ jobId: RecordId });
const Metadata = z.object({
	videoId: RecordId, lang: SubtitleLanguage, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
	title: z.string().min(1).max(4000), description: z.string().max(20_000).nullish(),
	provider: z.string().min(1).max(128).optional(), model: z.string().min(1).max(256).optional(),
});
const Audio = z.discriminatedUnion('ok', [
	z.object({ ok: z.literal(true), manifestKey: z.string().max(512) }),
	z.object({ ok: z.literal(false), error: z.string().max(300).default('failed'), retryable: z.boolean().default(false) }),
]);
const Progress = z.object({
	status: z.enum(['waiting_budget', 'transcribing', 'translating', 'postprocessing']),
	done: z.number().int().nonnegative().optional(), total: z.number().int().nonnegative().optional(),
});
const Finish = z.discriminatedUnion('outcome', [
	z.object({ outcome: z.literal('ready'), minutesUsed: z.number().int().nonnegative() }),
	z.object({ outcome: z.literal('failed'), error: z.enum(CAPTION_JOB_ERRORS).default('failed') }),
]);

export function createCaptionJobsInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	app.onError((error, c) => {
		if (error instanceof CaptionJobHttpError) return c.json({ success: false, error: error.code }, error.status as 400);
		logger.error('[CaptionJobs] Internal call failed', { path: c.req.path, error: error.message });
		return c.json({ success: false, error: 'internal_error' }, 500);
	});

	const video = (env: Env, videoId: string) => new R2Repository<VideoObject>(env.videos).getObject(videoId);

	app.post('/jobs/retry', async (c) => {
		const parsed = Retry.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'jobId is required' }, 400);
		const { jobId } = parsed.data;
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

	app.post('/metadata-translations', async (c) => {
		const parsed = Metadata.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'invalid' }, 400);
		const body = parsed.data;
		const stored = await video(c.env, body.videoId);
		if (!stored || !isVideoPubliclyVisible(stored as never)) return c.json({ success: false, error: 'video_gone' }, 404);
		try {
			await saveViewerTranslation(c.env, stored, {
				lang: body.lang,
				sourceHash: body.sourceHash,
				title: body.title,
				description: body.description ?? null,
				provider: body.provider ?? 'unknown',
				model: body.model ?? 'unknown',
			});
		} catch (error) {
			if (error instanceof TranslateHttpError) return c.json({ success: false, error: error.code }, error.status as 400);
			throw error;
		}
		return c.json({ success: true });
	});

	app.post('/jobs/:jobId/audio', async (c) => {
		const parsed = Audio.safeParse(await c.req.json().catch(() => null));
		const jobId = c.req.param('jobId');
		if (!parsed.success || !RecordId.safeParse(jobId).success ||
			('manifestKey' in parsed.data && parsed.data.manifestKey !== captionWorkPrefix(jobId) + 'manifest.json')) {
			return apiError(c, 400, 'invalid_report', { error: 'invalid_report' });
		}
		const report = parsed.data;
		const job = await readJob(c.env, jobId);
		if (!job) return c.json({ success: false, error: 'job_not_found' }, 404);
		const title = (await video(c.env, job.videoId))?.title;
		const done = await onAudioReport(c.env, job.id, report, title, ctxOf(c as never));
		return c.json({ success: true, result: { status: done.status } });
	});

	app.post('/jobs/:jobId/progress', async (c) => {
		const parsed = Progress.safeParse(await c.req.json().catch(() => null));
		const jobId = c.req.param('jobId');
		if (!parsed.success || !RecordId.safeParse(jobId).success) return c.json({ success: false, error: 'invalid_status' }, 400);
		const active = await onProgress(c.env, jobId, parsed.data);
		if (!active) return c.json({ success: false, error: 'job_not_active' }, 409);
		return c.json({ success: true });
	});

	app.post('/jobs/:jobId/finish', async (c) => {
		const parsed = Finish.safeParse(await c.req.json().catch(() => null));
		const jobId = c.req.param('jobId');
		if (!parsed.success || !RecordId.safeParse(jobId).success) return c.json({ success: false, error: 'invalid_outcome' }, 400);
		const job = await finishJob(c.env, jobId, parsed.data, ctxOf(c as never));
		return c.json({ success: true, result: { status: job.status } });
	});

	return app;
}
