/**
 * Transcode job state and decisions (pure; tested in test/jobs.test.ts). The
 * Transcoder Durable Object (transcoder.ts) keeps one JobState per video.
 */
import { reviewMediaPrefix, type ReviewExtractionOptions, type TranscodeStartup } from '@al-ummah/shared-types';
import { mediaPrefix, prebuiltStagingPrefix, sanitizeRungs, scrubOpsText, startFailureReason, type MediaAccess, type R2RungProgress, type TranscodeFailure, type TranscodeJobMessage, type TranscodeResult, type TranscodeStartFailure, type TranscoderJobView } from '@al-ummah/shared-types';

/** Plain words for a start failure (shared with the admin's troubleshooting panel, media-troubleshoot.ts). */
export { startFailureReason };

export const MAX_ATTEMPTS = 3;

/**
 * A job that could not start (container start failed, capacity full): the queue redelivers it after
 * these delays (seconds, per failed delivery). Short, because a start failure is either passing (a
 * rollout, capacity) and should resume as soon as it clears, or a broken image that only a release
 * fixes; the old 60 s doubling to 15 min left jobs waiting minutes after the cause was gone
 * (2026-11-15: 2.7 min of pure backoff after the fixed image rolled out).
 */
export const START_RETRY_DELAYS = [15, 30, 60, 120, 300, 300, 300, 300];
/** Deliveries before a job that never started is given up and reported (queue max_retries 8 + the first). */
export const START_MAX_DELIVERIES = START_RETRY_DELAYS.length + 1;

/** What the consumer does after a delivery could not start its job. */
export function startRetry(attempts: number): { giveUp: false; delaySeconds: number } | { giveUp: true } {
	if (attempts >= START_MAX_DELIVERIES) return { giveUp: true };
	return { giveUp: false, delaySeconds: START_RETRY_DELAYS[Math.min(Math.max(1, attempts), START_RETRY_DELAYS.length) - 1]! };
}

/**
 * Failures that are the platform's, not the job's: a launch lost to a restart, a container restarted
 * under the job, or stopped by SIGTERM (a deploy's rollout). They retry soon and do not use up the
 * job's attempts, up to INFRA_RETRY_LIMIT in a row (so a real loop still ends).
 */
export const INFRA_RETRY_LIMIT = 6;
export const INFRA_RETRY_SECONDS = 15;
export function isInfraFailure(error: string, exitCode?: number): boolean {
	if (error === 'launch_lost' || error === 'container_restarted') return true;
	return error === 'container_stopped' && exitCode === 143;
}
/** No word from the container for this long while it runs → treat as dead. */
export const SILENCE_LIMIT_MS = 20 * 60 * 1000;
/** Hard ceiling for one attempt (a 3 h lecture at 1x is well inside). */
export const ATTEMPT_LIMIT_MS = 4 * 60 * 60 * 1000;
export const WATCHDOG_SECONDS = 60;
/**
 * A launch that never got the container's answer within this long is lost: the Durable Object or
 * its container was restarted mid-start (a `wrangler deploy` restarts both). Cold starts take
 * well under a minute; image pulls after a deploy a few.
 */
export const LAUNCH_LIMIT_MS = 5 * 60 * 1000;

/**
 * stopping: a failed attempt is being torn down (its container's stop is ours, not a crash);
 * cancelled: an admin cancelled it (videos admin → Delivery), never retried
 */
export type JobStatus = 'running' | 'stopping' | 'waiting_retry' | 'ready' | 'failed' | 'cancelled';

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
	/** When the container accepted this attempt (POST /jobs answered, or it reported in); unset while starting */
	launchedAt?: number;
	/** How this attempt started (Transcoder.launch; FFmpeg's time added when the container reports it) */
	startup?: TranscodeStartup;
	lastSeenAt: number;
	progress: number;
	/** Per-rung state from the container's latest progress event */
	rungs?: R2RungProgress[];
	/** Container seconds of finished attempts */
	priorSeconds: number;
	/** Platform failures in a row (isInfraFailure); they do not count as attempts */
	infraRetries?: number;
	/** The pending retry was for a platform failure: it keeps the attempt number */
	retryKeepsAttempt?: boolean;
	/** When the scheduled retry runs (ms), while waiting_retry */
	nextRetryAt?: number;
	error?: string;
	result?: TranscodeResult;
	/** The latest failed attempt, as reported */
	failure?: TranscodeFailure;
	finishedAt?: number;
	/** Pre-publication review: also extract frames and audio under `reviewPrefix` (MEDIA_PRIVATE) */
	review?: ReviewExtractionOptions;
	reviewPrefix?: string;
	/** D11: the creator's pre-encoded renditions to verify (and their MEDIA_PRIVATE staging prefix) */
	prebuilt?: { stagingId: string; rungs: string[]; prefix: string };
	/** What the kept original must hash to (an import) */
	sha256?: string;
}

const iso = (ms: number | undefined) => (ms && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** The job as the admin's troubleshooting panel sees it (GET /internal/jobs/:videoId). */
export function jobView(job: JobState): TranscoderJobView {
	return {
		jobId: job.jobId,
		status: job.status,
		attempt: job.attempt,
		maxAttempts: job.error === 'source_unavailable' ? SOURCE_WAIT_ATTEMPTS : MAX_ATTEMPTS,
		attemptStartedAt: iso(job.attemptStartedAt),
		launchedAt: iso(job.launchedAt),
		lastSeenAt: iso(job.lastSeenAt),
		nextRetryAt: job.status === 'waiting_retry' ? iso(job.nextRetryAt) : null,
		progress: Number.isFinite(job.progress) ? job.progress : null,
		error: job.error ? scrubOpsText(job.error).slice(0, 300) : null,
	};
}

/**
 * A delivery of `jobId` could not start (container start failed, capacity full): what the
 * Transcoder keeps so the admin sees attempt n of max, the next try and why. Pure.
 */
export function startFailureNote(jobId: string, error: string, deliveries: number, now: number): TranscodeStartFailure {
	const next = startRetry(deliveries);
	return {
		jobId,
		deliveries,
		maxDeliveries: START_MAX_DELIVERIES,
		reason: startFailureReason(error),
		error: scrubOpsText(error).slice(0, 300),
		at: new Date(now).toISOString(),
		nextRetryAt: next.giveUp ? null : new Date(now + next.delaySeconds * 1000).toISOString(),
	};
}

/** A cancelled job's stand-in when it never started, so a later delivery of it is a duplicate. */
export function cancelledJob(msg: Pick<TranscodeJobMessage, 'videoId' | 'jobId' | 'rev' | 'access' | 'queuedAt'>, now: number): JobState {
	return { ...newJob({ kind: 'transcode', reason: 'retry', ...msg }, now), status: 'cancelled', error: 'cancelled', finishedAt: now };
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
		...(msg.sha256 ? { sha256: msg.sha256 } : {}),
		...(msg.review ? { review: msg.review, reviewPrefix: reviewMediaPrefix(msg.videoId, msg.rev) } : {}),
		...(msg.prebuilt ? { prebuilt: { ...msg.prebuilt, prefix: prebuiltStagingPrefix(msg.videoId, msg.prebuilt.stagingId) } } : {}),
	};
}

/** A staged pre-encoded file the container may read: <rung>/<file> of this job's rungs, nothing else. */
export function stagedKey(prebuilt: { rungs: string[]; prefix: string }, rel: string): string | null {
	const m = /^([A-Za-z0-9_-]{1,16})\/([A-Za-z0-9._-]{1,64})$/.exec(rel);
	if (!m || !prebuilt.rungs.includes(m[1]!) || m[2] === '.' || m[2] === '..') return null;
	return `${prebuilt.prefix}${rel}`;
}

/**
 * A running attempt whose launch was lost: no container ever took it and nothing was heard for
 * LAUNCH_LIMIT_MS. Jobs saved before `launchedAt` existed count as launched while they report in
 * (lastSeenAt), so a real running transcode is never mistaken for a lost one.
 */
export function launchLost(job: JobState, now: number): boolean {
	return job.status === 'running' && !job.launchedAt && now - job.attemptStartedAt > LAUNCH_LIMIT_MS && now - job.lastSeenAt > LAUNCH_LIMIT_MS;
}

/**
 * What a delivered queue message means for the job this video already has. The same job again is
 * a duplicate, unless its launch was lost (the queue redelivers when the consumer died mid-start).
 */
export function onMessage(current: JobState | undefined, msg: TranscodeJobMessage, now: number = Date.now()): 'start' | 'duplicate' | 'supersede' | 'relaunch' {
	if (!current) return 'start';
	if (current.jobId === msg.jobId) return launchLost(current, now) ? 'relaunch' : 'duplicate';
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

export function onFailure(job: JobState, error: string, fatal: boolean, infra = false): { retry: false } | { retry: true; delaySeconds: number; keepsAttempt?: boolean } {
	if (fatal) return { retry: false };
	if (infra && (job.infraRetries ?? 0) < INFRA_RETRY_LIMIT) return { retry: true, delaySeconds: INFRA_RETRY_SECONDS, keepsAttempt: true };
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
	// Started but never taken by a container (restarted mid-launch): retry now, not after the silence limit
	if (launchLost(job, now)) return { kind: 'failed', error: 'launch_lost', fatal: false };
	if (status && status.status === 'idle' && now - job.attemptStartedAt > 2 * 60 * 1000) {
		// A restarted container (it lost the job)
		return { kind: 'failed', error: 'container_restarted', fatal: false };
	}
	if (now - job.lastSeenAt > SILENCE_LIMIT_MS) return { kind: 'failed', error: 'container_silent', fatal: false };
	return { kind: 'ok' };
}

/**
 * A later watchdog run already scheduled? Reads @cloudflare/containers' own schedule table
 * (`container_schedules`, time in seconds); any read problem counts as "none", so the caller
 * schedules one (a spare run is harmless, a missing one leaves a job unwatched).
 */
export function hasWatchdogDue(sql: Pick<SqlStorage, 'exec'>, nowMs: number): boolean {
	try {
		const row = sql.exec(`SELECT COUNT(*) AS n FROM container_schedules WHERE callback = 'watchdog' AND time > ?`, Math.floor(nowMs / 1000)).toArray()[0] as { n?: number } | undefined;
		return Number(row?.n) > 0;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Container self-test (GET /priv/_selftest, the release smoke): one real container start
// ---------------------------------------------------------------------------

export interface SelfTestResult {
	ok: boolean;
	/** start() → the container answered /status */
	startMs: number;
	at: string;
	/** Plain category only (startFailureReason); the raw error goes to the log, never the answer */
	error?: string;
	/** The answer is a stored earlier run */
	cached?: boolean;
	/** Not tested: every instance is busy (capacity full), which is not a broken image */
	skipped?: string;
	/** Worker version (CF_VERSION_METADATA) the run belongs to */
	version?: string;
	/** Real starts made for this version so far */
	runs?: number;
	/** UTC day (YYYY-MM-DD) and real starts made that day, across every version */
	day?: string;
	dayRuns?: number;
}

/** Never more than one real start per this interval, for any version (the route is public). */
export const SELFTEST_MIN_GAP_MS = 60 * 1000;
/** At most this many real starts per deployed Worker version, whatever callers ask. */
export const SELFTEST_MAX_RUNS = 10;
/** At most this many real starts per UTC day across all versions, so alternating versions cannot reset the cap. */
export const SELFTEST_MAX_DAY_RUNS = 30;
/** The release smoke fails a cold start slower than this. */
export const SELFTEST_START_LIMIT_MS = 60 * 1000;

/**
 * Start a container now, or answer with the stored run? The first call after a deploy (a new
 * version) runs; a pass is then reused for that version; a failure may rerun up to
 * SELFTEST_MAX_RUNS per version. Every real start, whatever the version, is at least
 * SELFTEST_MIN_GAP_MS after the last one and within SELFTEST_MAX_DAY_RUNS a day, which bounds what
 * anyone calling the public route can cost.
 */
export function selfTestDue(last: SelfTestResult | undefined, now: number, version: string | undefined): boolean {
	if (!last) return true;
	if (!(now - Date.parse(last.at) >= SELFTEST_MIN_GAP_MS)) return false;
	if (last.day === utcDay(now) && (last.dayRuns ?? 1) >= SELFTEST_MAX_DAY_RUNS) return false;
	if (last.version !== version) return true;
	if (last.ok) return false;
	return (last.runs ?? 1) < SELFTEST_MAX_RUNS;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Counters for the next real start of `version` at `now`. */
export function selfTestRuns(last: SelfTestResult | undefined, version: string | undefined, now: number): Pick<SelfTestResult, 'runs' | 'day' | 'dayRuns'> {
	const day = utcDay(now);
	return {
		runs: last && last.version === version ? (last.runs ?? 1) + 1 : 1,
		day,
		dayRuns: last && last.day === day ? (last.dayRuns ?? 1) + 1 : 1,
	};
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

/**
 * The startup times of an attempt (TranscodeStartup): `t0` when the Transcoder began it, `ready` when the
 * container answered on its port, `accepted` when it took the job. A retry has no dispatch time (it
 * waited on purpose). Pure.
 */
export function startupTimes(job: Pick<JobState, 'queuedAt' | 'attempt'>, cold: boolean, t0: number, ready: number, accepted: number, firstAttempt: boolean): TranscodeStartup {
	const queued = Date.parse(job.queuedAt);
	return {
		cold,
		readyMs: Math.max(0, ready - t0),
		acceptMs: Math.max(0, accepted - t0),
		...(firstAttempt && Number.isFinite(queued) ? { dispatchMs: Math.max(0, t0 - queued) } : {}),
	};
}
