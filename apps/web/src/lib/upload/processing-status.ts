import type { UploadQueueItem } from '@al-ummah/shared-types';

/**
 * Server-side processing of an uploaded video, after its bytes are uploaded.
 * Same values as the video record's `uploadStatus` and the realtime
 * `video_processing_update` event (watch page, studio badge, admin health).
 */
export type ProcessingPhase = 'processing' | 'ready' | 'failed';

/** Maps an upload-status / realtime status to a phase; anything not terminal is still processing. */
export function phaseFromStatus(status: string | undefined | null): ProcessingPhase {
  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';
  return 'processing';
}

export function isTerminalPhase(phase: ProcessingPhase | undefined): boolean {
  return phase === 'ready' || phase === 'failed';
}

/** Status poll backoff while a video processes: 5 s, 10 s, 20 s, then every 30 s. */
export const PROCESSING_POLL_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const;

export function nextProcessingPollDelay(attempt: number): number {
  const delays = PROCESSING_POLL_DELAYS_MS;
  return delays[Math.min(Math.max(0, attempt), delays.length - 1)];
}

/**
 * The batch queue's notice:
 * - `keepOpen` while any file still uploads from this tab (leaving would pause
 *   it), so the batch view never tells the uploader they can leave;
 * - `processing` once every file is uploaded and some still process;
 * - `allReady` once every uploaded file is processed and ready;
 * - null before the batch starts, or when nothing uploaded is still processing
 *   but not all are ready (each row says what happened).
 */
export type BatchNotice = 'keepOpen' | 'processing' | 'allReady' | null;

export function batchNotice(
  items: Pick<UploadQueueItem, 'status' | 'videoId'>[],
  phases: Record<string, ProcessingPhase | undefined>,
  batchRunning: boolean,
): BatchNotice {
  const inFlight = items.some(
    (item) => item.status === 'uploading' || item.status === 'paused' || (batchRunning && item.status === 'pending'),
  );
  if (inFlight) return 'keepOpen';
  const uploaded = items.filter((item) => item.status === 'completed');
  if (uploaded.length === 0) return null;
  const phaseOf = (item: Pick<UploadQueueItem, 'videoId'>) => (item.videoId && phases[item.videoId]) || 'processing';
  if (uploaded.some((item) => phaseOf(item) === 'processing')) return 'processing';
  return uploaded.every((item) => phaseOf(item) === 'ready') ? 'allReady' : null;
}
