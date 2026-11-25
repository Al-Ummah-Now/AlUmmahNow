/**
 * Pure helpers of the transcode troubleshooting panel (TranscodeTroubleshooting.tsx): which actions a
 * job offers, the words for each state, reason and Cloudflare problem, and the logs filter check.
 * Server and client safe; tested in test/transcode-troubleshoot.test.ts.
 */
import { formatBytes, formatDuration, numberFormat, sourceVerdict, TROUBLESHOOT_FILTER, type SourceVerdict, type TroubleshootSource, type TroubleshootApiError, type TroubleshootJob, type TroubleshootState, type TroubleshootStatus, type TranscodeReason } from '@al-ummah/shared-types';
import type { MessageKey, Translator } from '@/i18n/translate';

export const TROUBLESHOOT_REFRESH_MS = 30_000;

export const STATE_LABEL: Record<TroubleshootState, MessageKey> = {
  queued: 'transcodeTroubleshoot.states.queued',
  start_retry: 'transcodeTroubleshoot.states.start_retry',
  running: 'transcodeTroubleshoot.states.running',
  waiting_retry: 'transcodeTroubleshoot.states.waiting_retry',
  failed: 'transcodeTroubleshoot.states.failed',
  cancelled: 'transcodeTroubleshoot.states.cancelled',
};

/** Chip colours; the words carry the state, never the colour alone. */
export const STATE_CHIP: Record<TroubleshootState, string> = {
  queued: 'bg-chip-pending-bg text-chip-pending-fg',
  start_retry: 'bg-danger-bg text-danger-fg',
  running: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  waiting_retry: 'bg-chip-pending-bg text-chip-pending-fg',
  failed: 'bg-danger-bg text-danger-fg',
  cancelled: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
};

export const REASON_LABEL: Record<TranscodeReason, MessageKey> = {
  container_start_failed: 'transcodeTroubleshoot.reasons.container_start_failed',
  capacity_full: 'transcodeTroubleshoot.reasons.capacity_full',
  container_refused: 'transcodeTroubleshoot.reasons.container_refused',
  source_not_ready: 'transcodeTroubleshoot.reasons.source_not_ready',
  source_missing: 'transcodeTroubleshoot.reasons.source_missing',
  launch_lost: 'transcodeTroubleshoot.reasons.launch_lost',
  container_stopped: 'transcodeTroubleshoot.reasons.container_stopped',
  container_restarted: 'transcodeTroubleshoot.reasons.container_restarted',
  attempt_timeout: 'transcodeTroubleshoot.reasons.attempt_timeout',
  container_silent: 'transcodeTroubleshoot.reasons.container_silent',
  no_video_stream: 'transcodeTroubleshoot.reasons.no_video_stream',
  source_changed: 'transcodeTroubleshoot.reasons.source_changed',
  encode_failed: 'transcodeTroubleshoot.reasons.encode_failed',
  upload_failed: 'transcodeTroubleshoot.reasons.upload_failed',
  cancelled: 'transcodeTroubleshoot.reasons.cancelled',
  start_failed: 'transcodeTroubleshoot.reasons.start_failed',
  unknown: 'transcodeTroubleshoot.reasons.unknown',
};

export const API_ERROR_LABEL: Record<TroubleshootApiError, MessageKey> = {
  forbidden: 'transcodeTroubleshoot.errForbidden',
  not_found: 'transcodeTroubleshoot.errNotFound',
  rate_limited: 'transcodeTroubleshoot.errRateLimited',
  unavailable: 'transcodeTroubleshoot.errUnavailable',
};

export const SOURCE_VERDICT_LABEL: Record<SourceVerdict, MessageKey> = {
  has_video: 'transcodeTroubleshoot.source.hasVideo',
  audio_only: 'transcodeTroubleshoot.source.audioOnly',
  half_written: 'transcodeTroubleshoot.source.halfWritten',
  unreadable: 'transcodeTroubleshoot.source.unreadable',
};

const STREAM_LABEL: Record<NonNullable<TroubleshootSource['streams']>[number]['kind'], MessageKey> = {
  video: 'transcodeTroubleshoot.source.kinds.video',
  audio: 'transcodeTroubleshoot.source.kinds.audio',
  cover: 'transcodeTroubleshoot.source.kinds.cover',
  subtitle: 'transcodeTroubleshoot.source.kinds.subtitle',
  other: 'transcodeTroubleshoot.source.kinds.other',
};

/**
 * What a failed job's file is, in words: the verdict, then its size, length, streams and any empty
 * bytes. `isReason`: the verdict says why there is no video, so it stands in for the reason's own line.
 */
export function sourceLines(source: TroubleshootSource, reason: TroubleshootJob['reason'], t: Translator, locale: string): { verdict: string; isReason: boolean; details: string[] } {
  const verdict = sourceVerdict(source);
  const percent = numberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  return {
    verdict: t(SOURCE_VERDICT_LABEL[verdict]),
    isReason: reason === 'no_video_stream' && verdict !== 'has_video',
    details: [
      formatBytes(locale as never, source.bytes),
      ...(source.durationSeconds ? [formatDuration(locale as never)(source.durationSeconds)] : []),
      // The codec names stay left to right inside Arabic text
      ...(source.streams ?? []).map((s) => t('transcodeTroubleshoot.source.stream', { kind: t(STREAM_LABEL[s.kind]), codec: `\u2068${s.codec}\u2069` })),
      ...(source.zeroStartPercent || source.zeroEndPercent ? [t('transcodeTroubleshoot.source.zeros', { start: percent.format(source.zeroStartPercent / 100), end: percent.format(source.zeroEndPercent / 100) })] : []),
    ],
  };
}

/** Retry now: anything not transcoding right now. Cancel: anything still going. */
export function jobActions(job: Pick<TroubleshootJob, 'state'>): { retry: boolean; cancel: boolean } {
  return {
    retry: job.state !== 'running',
    cancel: job.state === 'queued' || job.state === 'start_retry' || job.state === 'running' || job.state === 'waiting_retry',
  };
}

/** A logs filter the server will accept: empty, or a video / job id. */
export function filterProblem(value: string): boolean {
  const v = value.trim();
  return v !== '' && !TROUBLESHOOT_FILTER.test(v);
}

/** The "Right now" note above the figures: why Cloudflare details are missing, if they are. */
export function statusNote(status: TroubleshootStatus): MessageKey | null {
  if (status.token === 'missing') return 'transcodeTroubleshoot.noToken';
  if (status.token === 'unreadable') return 'transcodeTroubleshoot.unreadableToken';
  if (status.containers === null && status.queues === null) return 'transcodeTroubleshoot.notHere';
  return null;
}

/** Jobs of one video first (the ?video= link from the Errors page), then as api-videos sorted them. */
export function orderJobs(items: TroubleshootJob[], focus: string | null): TroubleshootJob[] {
  if (!focus) return items;
  return [...items.filter((j) => j.videoId === focus), ...items.filter((j) => j.videoId !== focus)];
}
