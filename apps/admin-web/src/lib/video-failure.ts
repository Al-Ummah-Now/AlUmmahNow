/** The words for why a video failed and what to do (shared-types video-failure.ts). Server and client safe; tested. */
import type { VideoFailure, VideoFailureReason, VideoFailureStep } from '@al-ummah/shared-types';
import type { MessageKey } from '@/i18n/translate';
import { REASON_LABEL, SOURCE_VERDICT_LABEL } from '@/app/(protected)/delivery/troubleshoot-view';

export const FAILURE_REASON_LABEL: Record<VideoFailureReason, MessageKey> = {
  ...REASON_LABEL,
  audio_only: SOURCE_VERDICT_LABEL.audio_only,
  half_written: SOURCE_VERDICT_LABEL.half_written,
  unreadable: SOURCE_VERDICT_LABEL.unreadable,
  upload_missing: 'videoFailure.reasons.upload_missing',
  stalled: 'videoFailure.reasons.stalled',
  bunny_failed: 'videoFailure.reasons.bunny_failed',
  unknown: 'videoFailure.reasons.unknown',
};

/** An imported file is sent again by an admin; any other one by its uploader. */
const STEP_LABEL: Record<VideoFailureStep, { own: MessageKey; imported: MessageKey }> = {
  send_with_picture: { own: 'videoFailure.steps.send_with_picture', imported: 'videoFailure.steps.send_with_picture_imported' },
  send_original: { own: 'videoFailure.steps.send_original', imported: 'videoFailure.steps.send_original_imported' },
  send_again: { own: 'videoFailure.steps.send_again', imported: 'videoFailure.steps.send_again_imported' },
  send_sdr: { own: 'videoFailure.steps.send_sdr', imported: 'videoFailure.steps.send_sdr_imported' },
  retry: { own: 'videoFailure.steps.retry', imported: 'videoFailure.steps.retry' },
  retry_to_learn: { own: 'videoFailure.steps.retry_to_learn', imported: 'videoFailure.steps.retry_to_learn' },
  retry_then_send: { own: 'videoFailure.steps.retry_then_send', imported: 'videoFailure.steps.retry_then_send_imported' },
};

export const failureReasonLabel = (reason: string): MessageKey => (Object.hasOwn(FAILURE_REASON_LABEL, reason) ? FAILURE_REASON_LABEL[reason as VideoFailureReason] : FAILURE_REASON_LABEL.unknown);

export function failureStepLabel(f: Pick<VideoFailure, 'step' | 'importBatchId'>): MessageKey {
  const step = Object.hasOwn(STEP_LABEL, f.step) ? STEP_LABEL[f.step] : STEP_LABEL.retry_then_send;
  return f.importBatchId ? step.imported : step.own;
}

/** The one place that says everything about a video's failure. */
export const failureHref = (videoId: string) => `/delivery?video=${encodeURIComponent(videoId)}#transcode-troubleshooting`;

/** The same file fails again: Retry says so first. */
export const causedByFile = (f: Pick<VideoFailure, 'cause'> | null | undefined) => f?.cause === 'file';

/** Ids to ask about: those that may have failed. */
export function failureIds(rows: readonly { id: string; failed: boolean }[]): string[] {
  return [...new Set(rows.filter((r) => r.failed).map((r) => r.id))];
}

/**
 * Retry: an R2 failure transcodes again, anything else asks Bunny again. `r2Failed`: those whose row says so, for
 * when why they failed could not be read.
 */
export function splitRetry(ids: readonly string[], failures: Readonly<Record<string, Pick<VideoFailure, 'where'>>>, r2Failed: ReadonlySet<string> = new Set()): { r2: string[]; bunny: string[] } {
  const onR2 = (id: string) => (failures[id] ? failures[id].where === 'r2' : r2Failed.has(id));
  return { r2: ids.filter(onR2), bunny: ids.filter((id) => !onR2(id)) };
}
