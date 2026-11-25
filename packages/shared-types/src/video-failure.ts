/**
 * Why a video failed, and what to do about it: one answer for every admin page (Videos list, video page,
 * Processing, Delivery, Errors). The admin translates the codes. Pure: no I/O.
 */
import { isUploadIssueCode, sourceVerdict, type UploadIssueCode } from './media-delivery';
import { transcodeErrorReason, type TranscodeReason, type TroubleshootSource } from './media-troubleshoot';

export const VIDEO_FAILURE_REASONS = [
  // The file itself
  'audio_only',
  'half_written',
  'unreadable',
  'colour_unsupported',
  'source_changed',
  'source_missing',
  'upload_missing',
  // Our side
  'container_start_failed',
  'capacity_full',
  'container_refused',
  'source_not_ready',
  'launch_lost',
  'container_stopped',
  'container_restarted',
  'attempt_timeout',
  'container_silent',
  'upload_failed',
  'start_failed',
  'stalled',
  // Not known yet
  'no_video_stream',
  'encode_failed',
  'bunny_failed',
  'unknown',
] as const;
export type VideoFailureReason = (typeof VIDEO_FAILURE_REASONS)[number];

/** file: the same file fails again. ours: the file is fine as far as we know. */
export type VideoFailureCause = 'file' | 'ours' | 'unknown';

/**
 * send_with_picture: the original has no picture. send_original: the file arrived changed or damaged.
 * send_again: it never arrived whole. send_sdr: its colours are an HDR format we cannot convert: exported as
 * standard video (SDR), it plays. retry: our side. retry_to_learn: an older failure that did not record
 * what the file is; a retry does. retry_then_send: retry once, then replace the file.
 */
export const VIDEO_FAILURE_STEPS = ['send_with_picture', 'send_original', 'send_again', 'send_sdr', 'retry', 'retry_to_learn', 'retry_then_send'] as const;
export type VideoFailureStep = (typeof VIDEO_FAILURE_STEPS)[number];

/** Where it failed */
export const VIDEO_FAILURE_PLACES = ['r2', 'bunny', 'upload'] as const;
export type VideoFailurePlace = (typeof VIDEO_FAILURE_PLACES)[number];

export interface VideoFailureExplained {
  where: VideoFailurePlace;
  reason: VideoFailureReason;
  cause: VideoFailureCause;
  step: VideoFailureStep;
}

const FILE_STEP: Partial<Record<VideoFailureReason, VideoFailureStep>> = {
  audio_only: 'send_with_picture',
  half_written: 'send_again',
  unreadable: 'send_original',
  colour_unsupported: 'send_sdr',
  source_changed: 'send_original',
  source_missing: 'send_again',
  upload_missing: 'send_again',
};
const OURS: ReadonlySet<VideoFailureReason> = new Set<VideoFailureReason>(['container_start_failed', 'capacity_full', 'container_refused', 'source_not_ready', 'launch_lost', 'container_stopped', 'container_restarted', 'attempt_timeout', 'container_silent', 'upload_failed', 'start_failed', 'stalled']);

const explained = (where: VideoFailurePlace, reason: VideoFailureReason, step?: VideoFailureStep): VideoFailureExplained => {
  const file = FILE_STEP[reason];
  const cause: VideoFailureCause = file ? 'file' : OURS.has(reason) ? 'ours' : 'unknown';
  return { where, reason, cause, step: step ?? file ?? (cause === 'ours' ? 'retry' : 'retry_then_send') };
};

/** A failed R2 transcode: what the container saw in the file decides, then the job's own error. */
export function explainTranscodeFailure(job: { reason: TranscodeReason | null; source: TroubleshootSource | null }, code?: UploadIssueCode | null): VideoFailureExplained {
  if (job.reason === 'source_changed' || code === 'source_changed') return explained('r2', 'source_changed');
  // Our side failed before or after the file mattered, whatever it is
  if (job.reason && job.reason !== 'cancelled' && OURS.has(job.reason)) return explained('r2', job.reason);
  const verdict = job.source ? sourceVerdict(job.source) : (code ?? null);
  if (verdict && verdict !== 'has_video') return explained('r2', verdict);
  if (job.reason === 'no_video_stream') return explained('r2', 'no_video_stream', verdict === 'has_video' ? undefined : 'retry_to_learn');
  return explained('r2', job.reason && job.reason !== 'cancelled' ? job.reason : 'unknown');
}

export interface FailedVideoState {
  uploadStatus?: string | null;
  issue?: { kind: string; code?: string | null } | null;
  r2?: { status: string; error?: string | null } | null;
  /** R2 decides the video's state: Bunny holds no copy, or its copy failed */
  r2Decides?: boolean;
  /** The failed job: its raw error (or the record's own) and what the container saw */
  job?: { error?: string | null; source: TroubleshootSource | null } | null;
}

/** Why the video failed; null when it did not. An R2 failure counts too while Bunny's copy plays. */
export function explainVideoFailure(v: FailedVideoState): VideoFailureExplained | null {
  const code = isUploadIssueCode(v.issue?.code) ? v.issue.code : null;
  if (v.r2?.status === 'failed') return explainTranscodeFailure({ reason: transcodeErrorReason(v.job?.error ?? v.r2.error), source: v.job?.source ?? null }, code);
  // The only copy is being transcoded again: what it failed of last time is being found out anew
  if (v.r2Decides && v.issue?.kind !== 'needs_reupload' && (v.r2?.status === 'queued' || v.r2?.status === 'transcoding')) return null;
  if (v.issue?.kind === 'stalled') return explained('bunny', 'stalled');
  if (v.issue?.kind === 'encode_failed') {
    if (v.r2Decides) return explained('r2', code ?? 'encode_failed');
    return explained('bunny', code ?? 'bunny_failed');
  }
  if (code) return explained('upload', code);
  if (v.issue?.kind === 'needs_reupload') return explained('upload', 'upload_missing');
  return v.uploadStatus === 'failed' ? explained('upload', 'unknown') : null;
}

/** One failed video, as GET /api/media/failures answers it. */
export interface VideoFailure extends VideoFailureExplained {
  videoId: string;
  title: string | null;
  /** A copy of it plays meanwhile */
  plays: boolean;
  /** The failed transcode; null when it failed before one */
  jobId: string | null;
  /** The raw error, scrubbed */
  error: string | null;
  /** What the container saw in the file */
  source: TroubleshootSource | null;
  failedAt: string | null;
  /** The file's name: the import's, else as its uploader picked it */
  fileName: string | null;
  /** The import that sent it */
  importBatchId: string | null;
}

/** Most videos one read explains */
export const VIDEO_FAILURES_MAX = 100;
