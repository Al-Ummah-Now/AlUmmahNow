/**
 * Transcode job state and decisions (pure; tested in test/jobs.test.ts). The
 * Transcoder Durable Object (transcoder.ts) keeps one JobState per video.
 */
import { reviewMediaPrefix, type ReviewExtractionOptions } from '@al-ummah/shared-types';
import { mediaPrefix, sanitizeRungs, type MediaAccess, type R2RungProgress, type TranscodeFailure, type TranscodeJobMessage, type TranscodeResult } from '@al-ummah/shared-types';

export const MAX_ATTEMPTS = 3;
/** No word from the container for this long while it runs → treat as dead. */
export const SILENCE_LIMIT_MS = 20 * 60 * 1000;
/** Hard ceiling for one attempt (a 3 h lecture at 1x is well inside). */
export const ATTEMPT_LIMIT_MS = 4 * 60 * 60 * 1000;
export const WATCHDOG_SECONDS = 60;

/** stopping: a failed attempt is being torn down (its container's stop is ours, not a crash) */
export type JobStatus = 'running' | 'stopping' | 'waiting_retry' | 'ready' | 'failed';

export interface JobState {
	videoId: string;
	jobId: string;
	rev: string;
	access: MediaAccess;
	prefix: string;
	queuedAt: string;
	reason: TranscodeJobMessage['reason'];
	status: JobStatus;
	attempt: number;
	/** Current attempt's container start (ms) */
	attemptStartedAt: number;
	lastSeenAt: number;
	progress: number;
	/** Per-rung state from the container's latest progress event */
	rungs?: R2RungProgress[];
	/** Container seconds of finished attempts */
	priorSeconds: number;
	error?: string;
	result?: TranscodeResult;
	/** The latest failed attempt, as reported */
	failure?: TranscodeFailure;
	finishedAt?: number;
	/** Pre-publication review: also extract frames and audio under `reviewPrefix` (MEDIA_PRIVATE) */
	review?: ReviewExtractionOptions;
	reviewPrefix?: string;
}

export function newJob(msg: TranscodeJobMessage, now: number): JobState {
	return {
		videoId: msg.videoId,
		jobId: msg.jobId,
		rev: msg.rev,
		access: msg.access,
		prefix: mediaPrefix(msg.access, msg.videoId, msg.rev),
		queuedAt: msg.queuedAt,
		reason: msg.reason,
		status: 'running',
		attempt: 1,
		attemptStartedAt: now,
		lastSeenAt: now,
		progress: 0,
		priorSeconds: 0,
		...(msg.review ? { review: msg.review, reviewPrefix: reviewMediaPrefix(msg.videoId, msg.rev) } : {}),
	};
}

/** What a delivered queue message means for the job this video already has. */
export function onMessage(current: JobState | undefined, msg: TranscodeJobMessage): 'start' | 'duplicate' | 'supersede' {
	if (!current) return 'start';
	if (current.jobId === msg.jobId) return 'duplicate';
	return current.status === 'running' || current.status === 'stopping' || current.status === 'waiting_retry' ? 'supersede' : 'start';
}

export function containerSeconds(job: JobState, now: number): number {
	const current = job.status === 'running' ? Math.max(0, now - job.attemptStartedAt) / 1000 : 0;
	return Math.round(job.priorSeconds + current);
}

/** After an attempt failed: retry (with delay) or give up. Fatal errors (no source, no video stream) never retry. */
/**
 * No source yet: Bunny's CDN never serves /original, so the transcode reads Bunny's MP4
 * fallback, which exists only once Bunny has encoded. Wait for it in 5-minute steps, up
 * to 2 h (api-videos also re-queues the job when Bunny reports the encode finished).
 */
export const SOURCE_WAIT_ATTEMPTS = 24;

export function onFailure(job: JobState, error: string, fatal: boolean): { retry: false } | { retry: true; delaySeconds: number } {
	if (fatal) return { retry: false };
	if (error === 'source_unavailable') return job.attempt >= SOURCE_WAIT_ATTEMPTS ? { retry: false } : { retry: true, delaySeconds: 300 };
	if (job.attempt >= MAX_ATTEMPTS) return { retry: false };
	return { retry: true, delaySeconds: 60 * job.attempt * job.attempt };
}

/** Watchdog verdict for a running job given what /status said (null = container unreachable). */
export function watchdogVerdict(
	job: JobState,
	status: { status: string; error?: string; result?: TranscodeResult; jobId?: string } | null,
	now: number,
): { kind: 'ok' } | { kind: 'ready'; result: TranscodeResult } | { kind: 'failed'; error: string; fatal: boolean } {
	if (job.status !== 'running') return { kind: 'ok' };
	if (now - job.attemptStartedAt > ATTEMPT_LIMIT_MS) return { kind: 'failed', error: 'attempt_timeout', fatal: false };
	if (status && status.jobId === job.jobId) {
		if (status.status === 'ready' && status.result) return { kind: 'ready', result: status.result };
		if (status.status === 'failed') return { kind: 'failed', error: status.error || 'container_failed', fatal: false };
		return { kind: 'ok' };
	}
	if (status && status.status === 'idle' && now - job.attemptStartedAt > 2 * 60 * 1000) {
		// A restarted container (it lost the job)
		return { kind: 'failed', error: 'container_restarted', fatal: false };
	}
	if (now - job.lastSeenAt > SILENCE_LIMIT_MS) return { kind: 'failed', error: 'container_silent', fatal: false };
	return { kind: 'ok' };
}

/** Keys an outbound PUT may write for this job (and nothing else). */
export function keyAllowed(prefix: string, key: string): boolean {
	if (!key.startsWith(`${prefix}/`)) return false;
	const rest = key.slice(prefix.length + 1);
	return /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/.test(rest) && !rest.split('/').some((p) => p === '.' || p === '..');
}

/** Progress reports to api-videos: at most one per this interval, except when a rung changes state. */
export const PROGRESS_REPORT_MS = 10_000;

/** The rung states without their % ("360p:done,720p:uploading"): a change in it is a state change. */
export function rungStatesKey(rungs: R2RungProgress[] | undefined): string {
	return (rungs ?? []).map((r) => `${r.name}:${r.state}`).join(',');
}

/** Should this progress event go to api-videos now? `last` is the previous report (time and rung states). */
export function progressReportDue(last: { at: number; states: string } | undefined, rungs: R2RungProgress[] | undefined, now: number): boolean {
	if (!last) return true;
	if (rungStatesKey(rungs) !== last.states) return true;
	return now - last.at >= PROGRESS_REPORT_MS;
}

/**
 * A container progress event: updates the job (progress, rung states) and says
 * what to report to api-videos now, if anything, and the new `last` to keep.
 */
export function onProgressEvent(
	job: JobState,
	ev: { progress: number; rungs?: unknown },
	last: { at: number; states: string } | undefined,
	now: number,
): { report: { type: 'progress'; progress: number; rungs?: R2RungProgress[] } | null; last?: { at: number; states: string } } {
	const rungs = sanitizeRungs(ev.rungs);
	if (typeof ev.progress === 'number' && Number.isFinite(ev.progress)) job.progress = ev.progress;
	if (rungs) job.rungs = rungs;
	if (!progressReportDue(last, job.rungs, now)) return { report: null };
	return {
		report: { type: 'progress', progress: job.progress, ...(job.rungs ? { rungs: job.rungs } : {}) },
		last: { at: now, states: rungStatesKey(job.rungs) },
	};
}

/** Remux-only jobs (the public MP4 backfill) give up after this many failed deliveries. */
export const MP4_MAX_ATTEMPTS = 3;

/**
 * What the queue consumer does with a remux-only job's outcome: ack it, or retry later (busy: a
 * transcode of the video runs; failed: a transient error). `giveUp`: the last failure, reported.
 */
export function mp4QueueAction(
	result: { outcome: 'ready' | 'busy' | 'failed'; fatal?: boolean },
	attempts: number,
): { ack: true; giveUp: boolean } | { ack: false; delaySeconds: number } {
	if (result.outcome === 'ready') return { ack: true, giveUp: false };
	if (result.outcome === 'busy') return { ack: false, delaySeconds: 600 };
	if (result.fatal || attempts >= MP4_MAX_ATTEMPTS) return { ack: true, giveUp: true };
	return { ack: false, delaySeconds: Math.min(900, 120 * 2 ** Math.max(0, attempts - 1)) };
}

// ---------------------------------------------------------------------------
// Live recording review (VR9): review frames and audio from a live stream's HLS VOD
// ---------------------------------------------------------------------------

/** The recording's directory (the `vod.internal` handler serves only under it) and its playlist file. */
export function liveVodSource(vodUrl: string): { base: string; file: string } | null {
	let url: URL;
	try {
		url = new URL(vodUrl);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password) return null;
	// Raw path (Bunny's token path keeps its %2F encoding): base = up to and including the last "/"
	const raw = vodUrl.slice(url.origin.length).split('?')[0]!;
	const cut = raw.lastIndexOf('/');
	const file = raw.slice(cut + 1);
	if (!/^[A-Za-z0-9._-]+\.m3u8$/.test(file)) return null;
	return { base: `${url.origin}${raw.slice(0, cut + 1)}`, file };
}

/**
 * GET http://vod.internal/<rel> → `${base}<rel>`: only a relative path under the recording's
 * directory (no `..`, no scheme, no host), so the container can read that recording and nothing else.
 */
export function liveVodTarget(base: string, rel: string): string | null {
	if (!rel || rel.startsWith('/') || rel.includes('..') || rel.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.includes('//')) return null;
	return `${base}${rel}`;
}

/** Same queue policy as a remux-only job: busy waits, a passing failure retries, then give up. */
export const liveReviewQueueAction = (result: { outcome: 'ready' | 'busy' | 'failed'; fatal?: boolean }, attempts: number) => mp4QueueAction(result, attempts);

/** The review media prefix of a live recording job. */
export const liveReviewPrefix = (streamId: string, rev: string) => reviewMediaPrefix(streamId, rev);
