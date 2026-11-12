/**
 * Transcode job state and decisions (pure; tested in test/jobs.test.ts). The
 * Transcoder Durable Object (transcoder.ts) keeps one JobState per video.
 */
import { mediaPrefix, type MediaAccess, type TranscodeJobMessage, type TranscodeResult } from '@al-ummah/shared-types';

export const MAX_ATTEMPTS = 3;
/** No word from the container for this long while it runs → treat as dead. */
export const SILENCE_LIMIT_MS = 20 * 60 * 1000;
/** Hard ceiling for one attempt (a 3 h lecture at 1x is well inside). */
export const ATTEMPT_LIMIT_MS = 4 * 60 * 60 * 1000;
export const WATCHDOG_SECONDS = 60;

export type JobStatus = 'running' | 'waiting_retry' | 'ready' | 'failed';

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
	/** Container seconds of finished attempts */
	priorSeconds: number;
	error?: string;
	result?: TranscodeResult;
	finishedAt?: number;
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
	};
}

/** What a delivered queue message means for the job this video already has. */
export function onMessage(current: JobState | undefined, msg: TranscodeJobMessage): 'start' | 'duplicate' | 'supersede' {
	if (!current) return 'start';
	if (current.jobId === msg.jobId) return 'duplicate';
	return current.status === 'running' || current.status === 'waiting_retry' ? 'supersede' : 'start';
}

export function containerSeconds(job: JobState, now: number): number {
	const current = job.status === 'running' ? Math.max(0, now - job.attemptStartedAt) / 1000 : 0;
	return Math.round(job.priorSeconds + current);
}

/** After an attempt failed: retry (with delay) or give up. Fatal errors (no source, no video stream) never retry. */
export function onFailure(job: JobState, _error: string, fatal: boolean): { retry: false } | { retry: true; delaySeconds: number } {
	if (fatal || job.attempt >= MAX_ATTEMPTS) return { retry: false };
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
