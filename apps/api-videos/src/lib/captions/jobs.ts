/**
 * On-demand transcription jobs (AUN-CAPTIONS §5.1; shared-types caption-jobs.ts).
 *
 * api-videos owns the job row (SEARCH_DB `caption_jobs`, migration 0033) and its
 * minutes (minutes.ts, hold id = job id). It sends the work on: the video
 * review's audio chunks when the review media still hold them, otherwise an
 * audio-only extraction by the media transcoder. The processor transcribes and
 * reports progress and the end through the /internal/captions routes, so this
 * module is the only writer of the row and of the minutes.
 */
import {
	CAPTION_JOB_ERRORS,
	CAPTION_JOB_STATUSES,
	MessageType,
	captionDraftKey,
	captionMinutesFor,
	captionWorkPrefix,
	isCaptionJobActive,
	reportNeedsAction,
	resolveNeedsAction,
	type CaptionAudioJobMessage,
	type CaptionAudioReport,
	type CaptionJob,
	type CaptionJobError,
	type CaptionJobPayload,
	type CaptionJobStatus,
	type CaptionMinutesUsage,
	type ErrorReporterEnv,
	type ExecutionContextLike,
	type VideoObject,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { cancelMinutes, captionSubject, commitMinutes, readUsage, releaseMinutes, reserveMinutes } from './minutes';

export const CAPTION_PROVIDER = 'workers-ai';
export const CAPTION_MODEL = '@cf/openai/whisper-large-v3-turbo';
const SETTINGS_KEY = 'captions/settings.json';
/** Past the processor's whole retry window (backoff 1+2+4 min plus four ≤ 15-minute deliveries). */
export const POSTPROCESSING_STALE_MS = 90 * 60_000;

interface Bucket {
	get(key: string): Promise<{ text(): Promise<string> } | null>;
	head?(key: string): Promise<unknown>;
	list?(options: { prefix: string; cursor?: string }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
	delete?(keys: string | string[]): Promise<void>;
}
interface QueueLike {
	send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown>;
}

export interface CaptionJobsEnv {
	SEARCH_DB?: unknown;
	MEDIA_PRIVATE?: Bucket;
	subtitles?: Bucket;
	global_settings?: Bucket;
	queue?: QueueLike;
	TRANSCODE_QUEUE?: QueueLike;
	ENVIRONMENT?: string;
	INTERNAL_API_KEY?: unknown;
	ERRORS_INGEST_URL?: string;
}

export class CaptionJobHttpError extends Error {
	constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) {
		super(code);
	}
}

const db = (env: CaptionJobsEnv) => {
	if (!env.SEARCH_DB) throw new CaptionJobHttpError(503, 'unavailable');
	return env.SEARCH_DB as D1Database;
};

/** Caption settings (admin-editable file in global_settings; defaults per environment, AUN-CAPTIONS O4). */
export interface CaptionSettings {
	monthlyBudgetUsd: number;
	model: string;
}

export async function readCaptionSettings(env: CaptionJobsEnv): Promise<CaptionSettings> {
	const fallback: CaptionSettings = { monthlyBudgetUsd: env.ENVIRONMENT === 'production' ? 100 : 5, model: CAPTION_MODEL };
	try {
		const stored = await env.global_settings?.get(SETTINGS_KEY);
		if (!stored) return fallback;
		const raw = JSON.parse(await stored.text()) as Partial<CaptionSettings>;
		const budget = typeof raw.monthlyBudgetUsd === 'number' && raw.monthlyBudgetUsd >= 0 && raw.monthlyBudgetUsd <= 500 ? raw.monthlyBudgetUsd : fallback.monthlyBudgetUsd;
		const model = typeof raw.model === 'string' && /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(raw.model) ? raw.model : fallback.model;
		return { monthlyBudgetUsd: budget, model };
	} catch (error) {
		logger.warn('[CaptionJobs] Settings unreadable; using defaults', { error: error instanceof Error ? error.message : String(error) });
		return fallback;
	}
}

interface JobRow {
	id: string;
	video_id: string;
	channel_id: string | null;
	subject_id: string;
	requested_by: string;
	kind: 'transcribe';
	language: string;
	replace_draft: number;
	provider: string;
	model: string;
	status: CaptionJobStatus;
	progress_done: number | null;
	progress_total: number | null;
	minutes_reserved: number;
	minutes_charged: number | null;
	waived: number;
	error: string | null;
	audio_manifest_key: string | null;
	attempts: number;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
}

const toJob = (r: JobRow): CaptionJob => ({
	id: r.id,
	videoId: r.video_id,
	channelId: r.channel_id,
	subjectId: r.subject_id,
	requestedBy: r.requested_by,
	kind: 'transcribe',
	language: r.language,
	replace: Number(r.replace_draft) === 1,
	provider: r.provider,
	model: r.model,
	status: (CAPTION_JOB_STATUSES as readonly string[]).includes(r.status) ? r.status : 'failed',
	progress: r.progress_total ? { done: Number(r.progress_done ?? 0), total: Number(r.progress_total) } : null,
	minutesReserved: Number(r.minutes_reserved),
	minutesCharged: r.minutes_charged === null ? null : Number(r.minutes_charged),
	waived: Number(r.waived) === 1,
	error: r.error && (CAPTION_JOB_ERRORS as readonly string[]).includes(r.error) ? (r.error as CaptionJobError) : r.error ? 'failed' : null,
	createdAt: r.created_at,
	updatedAt: r.updated_at,
	finishedAt: r.finished_at,
});

async function readRow(env: CaptionJobsEnv, jobId: string): Promise<JobRow | null> {
	return db(env).prepare('SELECT * FROM caption_jobs WHERE id = ?').bind(jobId).first<JobRow>();
}

export async function readJob(env: CaptionJobsEnv, jobId: string): Promise<CaptionJob | null> {
	const row = await readRow(env, jobId);
	return row ? toJob(row) : null;
}

export async function listJobs(env: CaptionJobsEnv, videoId: string, limit = 20): Promise<CaptionJob[]> {
	const rows = (await db(env).prepare('SELECT * FROM caption_jobs WHERE video_id = ? ORDER BY created_at DESC LIMIT ?').bind(videoId, limit).all<JobRow>()).results ?? [];
	return rows.map(toJob);
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The video review's audio manifest, while the review media still hold it. */
export async function reviewAudioManifest(env: CaptionJobsEnv, video: object): Promise<string | null> {
	const v = video as { review?: { manifestKey?: string } | null; r2?: { result?: { review?: { manifestKey?: string } | null } | null } | null };
	const key = v.review?.manifestKey ?? v.r2?.result?.review?.manifestKey;
	if (!key || !/^review\/.+manifest\.json$/.test(key) || !env.MEDIA_PRIVATE) return null;
	const found = env.MEDIA_PRIVATE.head ? await env.MEDIA_PRIVATE.head(key) : await env.MEDIA_PRIVATE.get(key);
	return found ? key : null;
}

const videoDurationSeconds = (video: VideoObject): number | null => {
	const d = video.duration ?? (video as { r2?: { result?: { source?: { durationSeconds?: number } } } }).r2?.result?.source?.durationSeconds;
	return typeof d === 'number' && d > 0 ? d : null;
};

function jobMessage(job: CaptionJob, manifestKey: string, prompt: string | undefined, settings: CaptionSettings, now: Date): { id: string; type: MessageType; payload: CaptionJobPayload; timestamp: number } {
	return {
		id: crypto.randomUUID(),
		type: MessageType.CaptionJob,
		payload: { jobId: job.id, videoId: job.videoId, language: job.language, replace: job.replace, requestedBy: job.requestedBy, audioManifestKey: manifestKey, nextChunk: 0, prompt, model: job.model, dailyBudgetUsd: Math.round((settings.monthlyBudgetUsd / 30) * 100) / 100, requestedAt: now.toISOString() },
		timestamp: now.getTime(),
	};
}

/** Deletes the job's extracted audio and partial transcript (never the review media). */
export async function clearJobWork(env: CaptionJobsEnv, jobId: string): Promise<void> {
	const bucket = env.MEDIA_PRIVATE;
	if (!bucket?.list || !bucket.delete) return;
	try {
		let cursor: string | undefined;
		do {
			const page = await bucket.list({ prefix: captionWorkPrefix(jobId), ...(cursor ? { cursor } : {}) });
			if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	} catch (error) {
		logger.warn('[CaptionJobs] Could not delete the job work', { jobId, error: error instanceof Error ? error.message : String(error) });
	}
}

async function setStatus(env: CaptionJobsEnv, jobId: string, fields: { status: CaptionJobStatus; audio?: string | null; error?: string | null; finished?: boolean }, now: Date): Promise<void> {
	await db(env)
		.prepare(
			`UPDATE caption_jobs SET status = ?, audio_manifest_key = COALESCE(?, audio_manifest_key), error = ?, finished_at = ?, updated_at = ?
			 WHERE id = ?`,
		)
		.bind(fields.status, fields.audio ?? null, fields.error ?? null, fields.finished ? now.toISOString() : null, now.toISOString(), jobId)
		.run();
}

/** Sends the job's audio work: the transcription when its audio exists, else the extraction. */
async function dispatch(env: CaptionJobsEnv, job: CaptionJob, video: VideoObject, now: Date): Promise<CaptionJobStatus> {
	const manifest = await reviewAudioManifest(env, video);
	if (manifest) {
		if (!env.queue) throw new CaptionJobHttpError(503, 'queue_unavailable');
		await env.queue.send(jobMessage(job, manifest, video.title?.slice(0, 200), await readCaptionSettings(env), now));
		await setStatus(env, job.id, { status: 'queued', audio: manifest }, now);
		return 'queued';
	}
	if (!env.TRANSCODE_QUEUE) throw new CaptionJobHttpError(503, 'queue_unavailable');
	const message: CaptionAudioJobMessage = { kind: 'caption_audio', jobId: job.id, videoId: job.videoId, out: captionWorkPrefix(job.id), queuedAt: now.toISOString() };
	await env.TRANSCODE_QUEUE.send(message);
	await setStatus(env, job.id, { status: 'extracting' }, now);
	return 'extracting';
}

export type RequestOutcome = { job: CaptionJob; existing: boolean } | { refused: 'upgrade_required'; usage: CaptionMinutesUsage; minutes: number };

/**
 * A creator asks for captions in the language spoken in `video` (access already
 * checked). The same request while a job is active returns that job.
 */
export async function requestCaptionJob(
	env: CaptionJobsEnv,
	input: { video: VideoObject; userId: string; roles?: readonly string[] | null; language: string; replace: boolean },
	now = new Date(),
): Promise<RequestOutcome> {
	const { video } = input;
	const settings = await readCaptionSettings(env);
	const key = await sha256(`${video.id}|transcribe|${input.language}|${CAPTION_PROVIDER}`);
	const active = await db(env)
		.prepare("SELECT * FROM caption_jobs WHERE idempotency_key = ? AND status NOT IN ('ready', 'failed', 'cancelled')")
		.bind(key)
		.first<JobRow>();
	if (active) return { job: toJob(active), existing: true };

	if (video.uploadStatus && video.uploadStatus !== 'ready') throw new CaptionJobHttpError(409, 'video_not_ready');
	const duration = videoDurationSeconds(video);
	if (!duration) throw new CaptionJobHttpError(409, 'video_not_ready');
	if (!input.replace && (await env.subtitles?.get(captionDraftKey(video.id, input.language)))) throw new CaptionJobHttpError(409, 'draft_exists');

	const subject = await captionSubject(db(env), { userId: input.userId, roles: input.roles, channelOwnerId: video.userId });
	const minutes = captionMinutesFor(duration, 1);
	const jobId = crypto.randomUUID();
	const reserved = await reserveMinutes(db(env), subject, jobId, minutes, now);
	if ('usage' in reserved) return { refused: 'upgrade_required', usage: reserved.usage, minutes };

	const at = now.toISOString();
	const inserted = await db(env)
		.prepare(
			`INSERT OR IGNORE INTO caption_jobs (id, idempotency_key, video_id, channel_id, subject_id, requested_by, kind, language, replace_draft, provider, model, status, minutes_reserved, waived, attempts, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'transcribe', ?, ?, ?, ?, 'queued', ?, 0, 1, ?, ?)`,
		)
		.bind(jobId, key, video.id, video.channelId ?? null, subject.subjectId, input.userId, input.language, input.replace ? 1 : 0, CAPTION_PROVIDER, settings.model, minutes, at, at)
		.run();
	if ((inserted.meta?.changes ?? 0) === 0) {
		// A double click won the race: give these minutes back and answer with that job
		await releaseMinutes(db(env), jobId, now);
		const winner = await db(env).prepare("SELECT * FROM caption_jobs WHERE idempotency_key = ? AND status NOT IN ('ready', 'failed', 'cancelled')").bind(key).first<JobRow>();
		if (winner) return { job: toJob(winner), existing: true };
		throw new CaptionJobHttpError(409, 'try_again');
	}
	const job = (await readJob(env, jobId))!;
	try {
		const status = await dispatch(env, job, video, now);
		return { job: { ...job, status }, existing: false };
	} catch (error) {
		await releaseMinutes(db(env), jobId, now);
		await setStatus(env, jobId, { status: 'failed', error: 'failed', finished: true }, now);
		logger.error('[CaptionJobs] Could not send the job', { jobId, videoId: video.id, error: error instanceof Error ? error.message : String(error) });
		throw error instanceof CaptionJobHttpError ? error : new CaptionJobHttpError(503, 'queue_unavailable');
	}
}

export async function cancelJob(env: CaptionJobsEnv, videoId: string, jobId: string, now = new Date()): Promise<CaptionJob> {
	const row = await readRow(env, jobId);
	if (!row || row.video_id !== videoId) throw new CaptionJobHttpError(404, 'job_not_found');
	if (!isCaptionJobActive(row.status)) return toJob(row);
	// Writing the draft: too late to cancel (the draft would be free). The processor's
	// `postprocessing` report and this update are both conditional, so exactly one wins. A job
	// stuck there (its processor gave up and could not report) may be cancelled once stale:
	// every processor retry reports `postprocessing` again before it writes, which keeps a live
	// job fresh and makes a retry after this cancel stop (409) before any draft is written.
	const staleBefore = new Date(now.getTime() - POSTPROCESSING_STALE_MS).toISOString();
	const changed = await db(env)
		.prepare(
			`UPDATE caption_jobs SET status = 'cancelled', finished_at = ?, updated_at = ?
			 WHERE id = ? AND status NOT IN ('ready', 'failed', 'cancelled') AND (status != 'postprocessing' OR updated_at < ?)`,
		)
		.bind(now.toISOString(), now.toISOString(), jobId, staleBefore)
		.run();
	if ((changed.meta?.changes ?? 0) === 0) {
		const fresh = (await readRow(env, jobId))!;
		if (fresh.status === 'postprocessing') throw new CaptionJobHttpError(409, 'job_finishing');
		return toJob(fresh);
	}
	// It costs what it had transcribed (chunks done of the total) and the rest comes back; one
	// stuck writing its draft is our failure and comes back in full
	if (Number(row.waived) !== 1) {
		const hold = row.status === 'postprocessing' ? await releaseMinutes(db(env), jobId, now) : await cancelMinutes(db(env), jobId, minutesTranscribed(row), now);
		await db(env).prepare('UPDATE caption_jobs SET minutes_charged = ? WHERE id = ?').bind(hold?.charged ?? 0, jobId).run();
	}
	await clearJobWork(env, jobId);
	return (await readJob(env, jobId))!;
}

/** The part of the estimate a job had transcribed when it stopped. */
export function minutesTranscribed(row: Pick<JobRow, 'minutes_reserved' | 'progress_done' | 'progress_total'>): number {
	const total = Number(row.progress_total ?? 0);
	if (!total) return 0;
	const done = Math.min(total, Math.max(0, Number(row.progress_done ?? 0)));
	return Math.ceil((Number(row.minutes_reserved) * done) / total);
}

export async function minutesForVideo(env: CaptionJobsEnv, video: VideoObject, userId: string, roles?: readonly string[] | null, now = new Date()): Promise<CaptionMinutesUsage> {
	return readUsage(db(env), await captionSubject(db(env), { userId, roles, channelOwnerId: video.userId }), now);
}

// --- Internal: the media worker and the processor -------------------------------

type Ctx = ExecutionContextLike | undefined;

export const jobNeedsActionKey = (jobId: string) => `caption-job:${jobId}`;

function flagAdmin(env: CaptionJobsEnv, ctx: Ctx, job: CaptionJob, reason: string): void {
	reportNeedsAction('api-videos', env as ErrorReporterEnv, ctx, {
		key: jobNeedsActionKey(job.id),
		source: 'queue',
		title: 'Caption job failed',
		message: reason.slice(0, 500),
		itemType: 'video',
		itemId: job.videoId,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/captions/jobs/retry', body: { jobId: job.id } },
		retryLabel: 'Try again',
		extra: { language: job.language, jobId: job.id },
	});
}

/** The media worker extracted the job's audio (or gave up). */
export async function onAudioReport(env: CaptionJobsEnv, jobId: string, report: CaptionAudioReport, videoTitle: string | undefined, ctx: Ctx, now = new Date()): Promise<CaptionJob> {
	const row = await readRow(env, jobId);
	if (!row) throw new CaptionJobHttpError(404, 'job_not_found');
	if (row.status !== 'extracting') {
		// Cancelled (or retried) meanwhile: what the extraction wrote is not needed
		if (!isCaptionJobActive(row.status)) await clearJobWork(env, jobId);
		throw new CaptionJobHttpError(409, 'job_not_extracting');
	}
	const job = toJob(row);
	const failure = 'error' in report ? report.error : null;
	if ('manifestKey' in report && report.manifestKey === `${captionWorkPrefix(jobId)}manifest.json`) {
		if (!env.queue) throw new CaptionJobHttpError(503, 'queue_unavailable');
		await env.queue.send(jobMessage(job, report.manifestKey, videoTitle?.slice(0, 200), await readCaptionSettings(env), now));
		await setStatus(env, jobId, { status: 'queued', audio: report.manifestKey }, now);
		return (await readJob(env, jobId))!;
	}
	const reason = failure ?? 'unexpected manifest key';
	const done = await finishJob(env, jobId, { outcome: 'failed', error: 'audio_unavailable' }, ctx, now);
	// No audio track is the video's own state, not a fault
	if (!(failure && /no_audio/.test(failure))) flagAdmin(env, ctx, job, `Audio extraction failed: ${reason}`);
	return done;
}

/** The processor's progress; 409 once the job is no longer active (cancelled: the processor stops). */
export async function onProgress(env: CaptionJobsEnv, jobId: string, p: { status: CaptionJobStatus; done?: number; total?: number }, now = new Date()): Promise<boolean> {
	if (!['waiting_budget', 'transcribing', 'postprocessing'].includes(p.status)) throw new CaptionJobHttpError(400, 'invalid_status');
	const changed = await db(env)
		.prepare(
			`UPDATE caption_jobs SET status = ?, progress_done = COALESCE(?, progress_done), progress_total = COALESCE(?, progress_total), updated_at = ?
			 WHERE id = ? AND status NOT IN ('ready', 'failed', 'cancelled')
			   AND (status != 'postprocessing' OR ? = 'postprocessing')`,
		)
		.bind(p.status, p.done ?? null, p.total ?? null, now.toISOString(), jobId, p.status)
		.run();
	return (changed.meta?.changes ?? 0) > 0;
}

/** The end of a job: ready commits the minutes used, failed refunds them all. */
export async function finishJob(
	env: CaptionJobsEnv,
	jobId: string,
	end: { outcome: 'ready'; minutesUsed: number } | { outcome: 'failed'; error: CaptionJobError },
	ctx: Ctx,
	now = new Date(),
): Promise<CaptionJob> {
	const row = await readRow(env, jobId);
	if (!row) throw new CaptionJobHttpError(404, 'job_not_found');
	if (!isCaptionJobActive(row.status)) {
		if (row.status === 'cancelled') throw new CaptionJobHttpError(409, 'job_cancelled');
		return toJob(row);
	}
	const at = now.toISOString();
	if (end.outcome === 'ready') {
		const hold = Number(row.waived) === 1 ? null : await commitMinutes(db(env), jobId, end.minutesUsed, now);
		await db(env)
			.prepare("UPDATE caption_jobs SET status = 'ready', minutes_charged = ?, error = NULL, finished_at = ?, updated_at = ? WHERE id = ?")
			.bind(hold?.charged ?? 0, at, at, jobId)
			.run();
		resolveNeedsAction(env as ErrorReporterEnv, ctx, [jobNeedsActionKey(jobId)]);
	} else {
		await releaseMinutes(db(env), jobId, now);
		await db(env)
			.prepare("UPDATE caption_jobs SET status = 'failed', minutes_charged = 0, error = ?, finished_at = ?, updated_at = ? WHERE id = ?")
			.bind(end.error, at, at, jobId)
			.run();
	}
	await clearJobWork(env, jobId);
	return (await readJob(env, jobId))!;
}

/**
 * The admin's Retry of a failed job (Errors page): runs it again free of
 * charge (a platform failure, AUN-CAPTIONS §6.2), unless a newer job of the
 * same video and language is already active.
 */
export async function retryJob(env: CaptionJobsEnv, jobId: string, video: VideoObject | null, now = new Date()): Promise<CaptionJob> {
	const row = await readRow(env, jobId);
	if (!row) throw new CaptionJobHttpError(404, 'job_not_found');
	if (row.status !== 'failed') return toJob(row);
	if (!video) throw new CaptionJobHttpError(409, 'video_gone');
	const at = now.toISOString();
	const changed = await db(env)
		.prepare(
			`UPDATE caption_jobs SET status = 'queued', waived = 1, error = NULL, finished_at = NULL, progress_done = NULL, progress_total = NULL, attempts = attempts + 1, updated_at = ?
			 WHERE id = ? AND status = 'failed'
			   AND NOT EXISTS (SELECT 1 FROM caption_jobs o WHERE o.idempotency_key = caption_jobs.idempotency_key AND o.id != caption_jobs.id AND o.status NOT IN ('ready', 'failed', 'cancelled'))`,
		)
		.bind(at, jobId)
		.run();
	if ((changed.meta?.changes ?? 0) === 0) throw new CaptionJobHttpError(409, 'newer_job_active');
	const job = (await readJob(env, jobId))!;
	try {
		await dispatch(env, job, video, now);
	} catch (error) {
		await setStatus(env, jobId, { status: 'failed', error: 'failed', finished: true }, now);
		throw error;
	}
	return (await readJob(env, jobId))!;
}
