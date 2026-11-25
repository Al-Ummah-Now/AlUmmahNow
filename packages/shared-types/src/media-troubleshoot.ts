/**
 * R2 transcode troubleshooting (videos admin → Delivery → "Transcode troubleshooting").
 * Owner, 2026-11-14: "why the logs are not on admin to troubleshoot?" A job that waits must say
 * why in plain words, without Cloudflare access.
 *
 * Shared by apps/media (start failure categories), api-videos (the per-job view, stall rules) and
 * admin-api / admin-web (the panel). Pure: no I/O.
 */

// ---------------------------------------------------------------------------
// Raw errors → one reason code (the admin translates the code; the raw text stays for details)
// ---------------------------------------------------------------------------

export const TRANSCODE_REASONS = [
  'container_start_failed',
  'capacity_full',
  'container_refused',
  'source_not_ready',
  'source_missing',
  'launch_lost',
  'container_stopped',
  'container_restarted',
  'attempt_timeout',
  'container_silent',
  'no_video_stream',
  'source_changed',
  'encode_failed',
  'upload_failed',
  'cancelled',
  'start_failed',
  'unknown',
] as const;
export type TranscodeReason = (typeof TRANSCODE_REASONS)[number];

/**
 * Plain words for a start failure (what the Errors page and the logs show): the categories of
 * apps/media's queue consumer, kept as English text because they are written into job errors.
 */
export function startFailureReason(error: string): string {
  if (/no container instance|max_instances|capacity|not available at this time|too many/i.test(error)) return 'capacity full';
  if (/just exited|crashed while checking for ports|not running, consider calling start|exited \(code/i.test(error)) return 'container start failed';
  if (/refused the job/i.test(error)) return 'container refused the job';
  return 'start failed';
}

const START_CATEGORY: Record<string, TranscodeReason> = {
  'capacity full': 'capacity_full',
  'container start failed': 'container_start_failed',
  'container refused the job': 'container_refused',
};

/** The reason code of a raw job error (container exits, watchdog verdicts, FFmpeg stages). */
export function transcodeErrorReason(raw: string | null | undefined): TranscodeReason | null {
  const error = (raw ?? '').trim();
  if (!error) return null;
  // Exact codes from the Transcoder and its watchdog first
  const head = error.split(/[:\s]/, 1)[0]!.toLowerCase();
  const exact: Record<string, TranscodeReason> = {
    launch_lost: 'launch_lost',
    container_stopped: 'container_stopped',
    container_restarted: 'container_restarted',
    attempt_timeout: 'attempt_timeout',
    container_silent: 'container_silent',
    source_unavailable: 'source_not_ready',
    source_missing: 'source_missing',
    no_video_stream: 'no_video_stream',
    source_changed: 'source_changed',
    cancelled: 'cancelled',
  };
  if (exact[head]) return exact[head]!;
  // "capacity full: …" / "container start failed: …" (apps/media writes the category first)
  for (const [text, code] of Object.entries(START_CATEGORY)) if (error.toLowerCase().startsWith(text)) return code;
  const category = startFailureReason(error);
  if (START_CATEGORY[category]) return START_CATEGORY[category]!;
  if (/source_unavailable|source not ready/i.test(error)) return 'source_not_ready';
  if (/source_missing|source missing/i.test(error)) return 'source_missing';
  if (/no_video_stream/i.test(error)) return 'no_video_stream';
  if (/^launch:/i.test(error)) return 'start_failed';
  // bounded gap: an unbounded `.*` here backtracks polynomially on long error text (CodeQL js/polynomial-redos)
  if (/upload|PUT [^\n]{0,200}?\b[45]\d\d\b|R2/i.test(error) && !/ffmpeg/i.test(error)) return 'upload_failed';
  if (/ffmpeg|encode|exit code|codec|invalid data/i.test(error)) return 'encode_failed';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// The per-job view (api-videos /internal/media/troubleshoot)
// ---------------------------------------------------------------------------

/**
 * What the panel shows for a job, in order of the pipeline:
 * - queued: waiting for its first start
 * - start_retry: its starts failed; the queue sends it again at nextRetryAt
 * - running: a container is working on it
 * - waiting_retry: an attempt failed; the next one runs at nextRetryAt
 * - failed / cancelled: finished without a rendition
 */
export const TROUBLESHOOT_STATES = ['queued', 'start_retry', 'running', 'waiting_retry', 'failed', 'cancelled'] as const;
export type TroubleshootState = (typeof TROUBLESHOOT_STATES)[number];

/** A start that failed, as the media queue consumer records it on the video's Transcoder. */
export interface TranscodeStartFailure {
  jobId: string;
  /** Queue deliveries so far (1 = the first) */
  deliveries: number;
  /** Deliveries before the job is given up (queue max_retries + 1) */
  maxDeliveries: number;
  /** Plain category (startFailureReason) and the raw error (scrubbed, clipped) */
  reason: string;
  error: string;
  at: string;
  nextRetryAt: string | null;
}

/** The Transcoder Durable Object's view of a video's job (GET /internal/jobs/:videoId on apps/media). */
export interface TranscoderJobView {
  jobId: string;
  status: 'running' | 'stopping' | 'waiting_retry' | 'ready' | 'failed' | 'cancelled';
  attempt: number;
  maxAttempts: number;
  attemptStartedAt: string | null;
  launchedAt: string | null;
  lastSeenAt: string | null;
  nextRetryAt: string | null;
  progress: number | null;
  error: string | null;
}

export interface TroubleshootJob {
  videoId: string;
  jobId: string;
  title: string | null;
  state: TroubleshootState;
  /** n of max: transcode attempts, or start deliveries while it never started */
  attempt: number;
  maxAttempts: number | null;
  queuedAt: string | null;
  startedAt: string | null;
  nextRetryAt: string | null;
  lastSeenAt: string | null;
  progress: number | null;
  reason: TranscodeReason | null;
  /** The raw last error, scrubbed of URLs' query strings and credentials */
  error: string | null;
  /** The container instance is named by the video id; its Durable Object id matches the Containers API */
  instance: { name: string; durableObjectId: string | null; state: string | null } | null;
  /** The transcoder could not be asked (no binding locally, or it failed): what api-videos knows only */
  transcoderUnavailable?: boolean;
}

export interface TroubleshootJobs {
  items: TroubleshootJob[];
  at: string;
  /** apps/media is bound and answered */
  transcoder: 'ok' | 'unbound' | 'error';
}

/** What media_jobs and the transcoder say → the panel's state (pure, tested). */
export function troubleshootState(row: { status: string; job_id: string }, job: TranscoderJobView | null, start: TranscodeStartFailure | null): TroubleshootState {
  if (row.status === 'cancelled' || job?.status === 'cancelled') return 'cancelled';
  if (row.status === 'failed') return 'failed';
  if (job && job.jobId === row.job_id) {
    if (job.status === 'running' || job.status === 'stopping') return 'running';
    if (job.status === 'waiting_retry') return 'waiting_retry';
    if (job.status === 'failed') return 'failed';
  }
  if (start && start.jobId === row.job_id) return 'start_retry';
  if (row.status === 'transcoding') return 'running';
  return 'queued';
}

// ---------------------------------------------------------------------------
// Stall rules (api-videos sweep → Errors page item media-transcode:<videoId>, resolved when ready)
// ---------------------------------------------------------------------------

/** A running job with no word from its container for this long is stalled (the watchdog gives up at 20 min). */
export const STALL_RUNNING_MS = 10 * 60 * 1000;
/** A retry that has not run this long after its time is stalled. */
export const STALL_RETRY_LATE_MS = 5 * 60 * 1000;
/** A job still waiting for its first start after this long is stalled (the sweep re-queues at 60 min). */
export const STALL_QUEUED_MS = 30 * 60 * 1000;

export type TranscodeStall =
  | { kind: 'no_progress'; minutes: number }
  | { kind: 'retry_late'; minutes: number }
  | { kind: 'queued_too_long'; minutes: number };

const minutesSince = (iso: string | null | undefined, now: number): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60_000)) : null;
};

/**
 * Whether a job (media_jobs row + the transcoder's view) is stalled now. Pure. `slotsFull`: every slot
 * of the admin's max concurrent transcodes is busy, so a job that never started is waiting its turn.
 */
export function transcodeStall(
  row: { status: string; job_id: string; queued_at: string | null },
  job: TranscoderJobView | null,
  now: number,
  opts: { slotsFull?: boolean } = {},
): TranscodeStall | null {
  if (row.status !== 'queued' && row.status !== 'transcoding') return null;
  const mine = job && job.jobId === row.job_id ? job : null;
  if (mine?.status === 'running') {
    const seen = mine.lastSeenAt ?? mine.attemptStartedAt;
    const t = seen ? Date.parse(seen) : NaN;
    if (Number.isFinite(t) && now - t > STALL_RUNNING_MS) return { kind: 'no_progress', minutes: minutesSince(seen, now)! };
    return null;
  }
  if (mine?.status === 'waiting_retry') {
    const t = mine.nextRetryAt ? Date.parse(mine.nextRetryAt) : NaN;
    if (Number.isFinite(t) && now - t > STALL_RETRY_LATE_MS) return { kind: 'retry_late', minutes: minutesSince(mine.nextRetryAt, now)! };
    return null;
  }
  if (mine) return null;
  // Never started (no job on the transcoder, or an older one); waiting for a slot is not a stall
  if (opts.slotsFull) return null;
  const t = row.queued_at ? Date.parse(row.queued_at) : NaN;
  if (Number.isFinite(t) && now - t > STALL_QUEUED_MS) return { kind: 'queued_too_long', minutes: minutesSince(row.queued_at, now)! };
  return null;
}

// ---------------------------------------------------------------------------
// Text that leaves the server: no query strings (signed URLs), no credentials
// ---------------------------------------------------------------------------

/**
 * Removes URL query strings (signed Bunny/R2 URLs carry tokens there) and anything that looks like
 * a credential: bearer tokens, JWTs, key/token/secret/signature/password fields. From
 * scripts/ops/media-diagnostics.ts (#1407).
 */
export function scrubOpsText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"']*/g, (url) => {
      // One greedy pass per URL, then cut at the query (linear; a `[^?]+\?` pattern backtracks on long input)
      const q = url.indexOf('?');
      return q >= 0 ? `${url.slice(0, q)}?…` : url;
    })
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer …')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '…jwt…')
    .replace(/("?(?:[a-z_-]*(?:token|secret|password|signature|api[_-]?key|authorization|x-amz-[a-z-]+))"?\s*[:=]\s*)("[^"]*"|[^\s,}&]+)/gi, '$1"…"');
}

// ---------------------------------------------------------------------------
// Live container status and logs (admin-api, read with the admin-set Cloudflare token)
// ---------------------------------------------------------------------------

export interface TroubleshootContainerInstance {
  id: string;
  state: string | null;
  durableObjectId: string | null;
  location: string | null;
  createdAt: string | null;
}

export interface TroubleshootStatus {
  at: string;
  /** No Cloudflare token set: only our own figures */
  token: 'missing' | 'ok' | 'unreadable';
  containers:
    | { ok: true; application: string; applicationId: string; maxInstances: number | null; inUse: number; instances: TroubleshootContainerInstance[]; health: Record<string, number> | null }
    | { ok: false; error: TroubleshootApiError }
    | null;
  queues:
    | { ok: true; queue: { name: string; backlog: number | null }; dlq: { name: string; backlog: number | null } }
    | { ok: false; error: TroubleshootApiError }
    | null;
  /** From media_jobs: waiting jobs and the oldest wait */
  waiting: { queued: number; oldestQueuedAt: string | null; oldestQueuedSeconds: number | null } | null;
}

/** A Cloudflare read that failed, as a code the admin translates (never the raw response). */
export type TroubleshootApiError = 'forbidden' | 'not_found' | 'rate_limited' | 'unavailable';

export interface TroubleshootLogLine {
  at: string;
  source: 'worker' | 'container';
  level: string | null;
  message: string;
  /** Short, scrubbed context: job and video ids, attempt, exit code */
  detail: string | null;
}

export interface TroubleshootLogs {
  at: string;
  token: 'missing' | 'ok' | 'unreadable';
  lines: TroubleshootLogLine[];
  /** Per source: read, or why not */
  sources: { worker: 'ok' | TroubleshootApiError | 'skipped'; container: 'ok' | TroubleshootApiError | 'skipped' };
  hours: number;
}

export const TROUBLESHOOT_LOG_HOURS = [1, 6, 24] as const;

/** What the Test button checks on the token, and reports missing. */
export const TROUBLESHOOT_TOKEN_CHECKS = ['observability', 'containers', 'queues', 'analytics'] as const;
export type TroubleshootTokenCheck = (typeof TROUBLESHOOT_TOKEN_CHECKS)[number];

export interface TroubleshootTokenView {
  set: boolean;
  last4: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** The stored token no longer opens (the key it was sealed with changed): set it again */
  unreadable?: boolean;
  test: { ok: boolean; at: string; checks: { name: TroubleshootTokenCheck; ok: boolean }[] } | null;
}

/** Ids the panel may filter logs by (video and job ids): nothing else reaches a query. */
export const TROUBLESHOOT_FILTER = /^[A-Za-z0-9-]{8,64}$/;
