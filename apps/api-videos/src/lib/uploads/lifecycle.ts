/**
 * The end of an upload: completed, or flagged for a re-upload. Never silent.
 *
 * - markUploadComplete: Bunny holds every byte -> `processing`, once
 *   (idempotent), and the post-upload steps are enqueued.
 * - flagNeedsReupload: an upload that cannot finish (the browser gave up, the
 *   bytes are gone at Bunny, it stopped and never came back) -> `failed` with
 *   `processingIssue { kind: 'needs_reupload' }`, and a VideoUploadFailed
 *   message. The processor stores the uploader's notification; the uploader's
 *   video list shows a Re-upload action; admins see it in the processing-health
 *   view (`processingIssue.kind === 'needs_reupload'`, lib/processing).
 * - sweepStalledUploads: the hourly safety net for uploads nobody reports
 *   (tab closed for good): checks Bunny and either completes or flags them.
 *
 * Re-uploading the same video (uploadResume) clears the flag; completing does too.
 */
import { z } from 'zod';
import R2Repository from '../r2Repo';
import { Video as BusinessVideo } from '../types';
import Queue, { MessageType } from '../queue';
import { logger } from '../logger';
import { processingAttempt } from '../notification-events';
import { bunnyTusRequestHeaders } from '../bunny/tus';
import { startProcessingLoop, type ProcessingEnv } from '../processing/loop';
import { refundUploadSession } from '../../middleware/upload-limits';
import { enqueueTranscode, type MediaEnv } from '../media/r2-delivery';
import { completeOriginal } from '../media/originals';
import { reviewGateFor, type ReviewGateEnv } from '../review/gate';

export interface VideoTusUpload {
  sessionId: string;
  bunnyUploadUrl: string;
  fileSize: number;
  createdAt: string;
}

/** Last Bunny offset the sweep saw, to tell a slow upload from a stopped one. */
export interface UploadWatch {
  offset: number;
  at: string;
}

export type UploadVideo = z.infer<typeof BusinessVideo> & {
  tusUpload?: VideoTusUpload;
  uploadWatch?: UploadWatch;
};

interface SecretLike { text?(): Promise<string>; get?(): Promise<string> }

export interface UploadLifecycleEnv {
  videos: R2Bucket;
  channels?: R2Bucket;
  queue?: unknown;
  PROCESSING_CHECK_QUEUE?: unknown;
  SEARCH_DB?: D1Database;
  'bunny-stream-key': SecretLike | string;
  bunny_stream_library_id: SecretLike | string;
  global_settings?: unknown;
  VIDEO_REVIEW_ALLOWED?: string;
}

const UNFINISHED = new Set(['initiated', 'uploading', 'failed', undefined]);

/** Drop the upload-side flags once the bytes are in (or a re-upload starts). */
function clearUploadFlags(video: UploadVideo): void {
  if (video.processingIssue?.kind === 'needs_reupload') delete video.processingIssue;
  delete video.uploadWatch;
  // A new upload gets its own "ready" / "failed" announcement
  delete (video as { processingAnnounced?: unknown }).processingAnnounced;
}

/**
 * Bunny has every byte: mark the video `processing` and enqueue the
 * post-upload steps. Idempotent: only the call that moves the video sends the
 * message, so a retried final PATCH, a HEAD after completion or the sweep
 * never process it twice. Never throws.
 */
export async function markUploadComplete(
  env: UploadLifecycleEnv,
  upload: { videoId: string; userId: string; fileSize: number; uploadId?: string },
): Promise<boolean> {
  try {
    const repository = new R2Repository<UploadVideo>(env.videos);
    let changed = false;
    // Pre-publication review (wiki AUN-VIDEO-REVIEW): decided before the video can turn ready, so
    // a gated upload is never visible to others, not even for a moment. Null with mode off/shadow.
    const current = await repository.getObject(upload.videoId);
    const gate = current ? await reviewGateFor(env as ReviewGateEnv, current as { channelId?: string | null }) : null;
    // Conditional write on the fresh video (SCALABILITY-AUDIT AV-3); a video
    // that processing already marked ready stays ready.
    await repository.updateObject(upload.videoId, (video) => {
      changed = false;
      if (video.uploadStatus === 'ready' || video.uploadStatus === 'processing') {
        if (!video.tusUpload && !video.uploadWatch) return false;
        delete video.tusUpload;
        delete video.uploadWatch;
        return true;
      }
      video.uploadStatus = 'processing';
      if (gate?.state && !(video as { review?: unknown }).review) (video as { review?: unknown }).review = gate.state;
      // Both sources' time to playable start here (epic #687)
      (video as { uploadCompletedAt?: string }).uploadCompletedAt = new Date().toISOString();
      delete video.tusUpload;
      clearUploadFlags(video);
      changed = true;
      return true;
    });
    if (!changed) return false;

    await new Queue(env.queue).send(MessageType.VideoUploadCompleted, {
      videoId: upload.videoId,
      userId: upload.userId,
      uploadId: upload.uploadId,
      fileSize: upload.fileSize,
      timestamp: new Date().toISOString(),
    });
    // Dual write: the same upload transcoded to R2 by apps/media (lib/media/r2-delivery.ts; never throws)
    // Our own original (TUS PATCH copies, docs/media-delivery/ORIGINALS.md): when it covers the file, the
    // R2 transcode reads it now instead of waiting for Bunny's encode
    await completeOriginal(env as never, upload.videoId, upload.fileSize);
    await enqueueTranscode(env as unknown as MediaEnv, upload.videoId, 'upload', { uploaderId: upload.userId });
    // Check Bunny until the encode finishes (lib/processing/loop.ts)
    await startProcessingLoop(env as unknown as ProcessingEnv, upload.videoId, { reason: 'upload-complete' }).catch((error) =>
      logger.error('[Uploads] Could not start the processing check loop', { videoId: upload.videoId, error: error instanceof Error ? error.message : String(error) }),
    );
    logger.info('[Uploads] Upload completed', { videoId: upload.videoId, fileSize: upload.fileSize });
    return true;
  } catch (error) {
    logger.error('[Uploads] Marking the upload complete failed (bytes are at Bunny; uploadComplete, the next HEAD or the sweep retries it)', {
      videoId: upload.videoId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export type FlagResult = 'flagged' | 'already-flagged' | 'finished' | 'missing' | 'forbidden';

/**
 * The upload cannot finish: `failed` + needs_reupload, and the uploader and
 * admins are told (VideoUploadFailed -> uploader notification; the flag is in
 * the processing-health view). Idempotent: an already flagged video is not
 * announced again. A finished video is never flagged.
 */
export async function flagNeedsReupload(
  env: UploadLifecycleEnv,
  videoId: string,
  opts: { reason: string; source: 'client' | 'sweep'; ownerId?: string; now?: Date },
): Promise<FlagResult> {
  const now = opts.now ?? new Date();
  const repository = new R2Repository<UploadVideo>(env.videos);
  let result = 'missing' as FlagResult;
  let flagged: UploadVideo | null = null;
  const saved = await repository.updateObject(videoId, (video) => {
    flagged = null;
    if (opts.ownerId !== undefined && video.userId !== opts.ownerId) {
      result = 'forbidden';
      return false;
    }
    if (!UNFINISHED.has(video.uploadStatus)) {
      result = 'finished';
      return false;
    }
    if (video.uploadStatus === 'failed' && video.processingIssue?.kind === 'needs_reupload') {
      result = 'already-flagged';
      return false;
    }
    video.uploadStatus = 'failed';
    video.processingIssue = { kind: 'needs_reupload', reason: opts.reason.slice(0, 500), at: now.toISOString() };
    delete video.uploadWatch;
    video.dateModified = now.toISOString();
    result = 'flagged';
    flagged = video;
    return true;
  });
  if (!saved) return 'missing';
  if (result !== 'flagged' || !flagged) return result;

  const video = flagged as UploadVideo;
  logger.error('[Uploads] Upload needs a re-upload', { videoId, userId: video.userId, source: opts.source, reason: opts.reason });
  // The failed upload gives its session back to the tier holder it was counted against
  await refundUploadSession(env.SEARCH_DB, await uploadSubjectOf(env, video), video.dateCreated, { source: opts.source, nowMs: now.getTime() }).catch((error) =>
    logger.error('[Uploads] Upload session refund failed', { videoId, error: error instanceof Error ? error.message : String(error) }),
  );
  await new Queue(env.queue).send(MessageType.VideoUploadFailed, {
    videoId,
    userId: video.userId,
    channelId: video.channelId,
    title: video.title,
    error: opts.reason,
    attempt: processingAttempt({ ...video, id: videoId }, 'failed'),
    kind: 'needs_reupload',
    source: opts.source,
    timestamp: now.toISOString(),
  });
  return 'flagged';
}

/** Whose creator-tier counters an upload moved: the channel owner, else the uploader. */
async function uploadSubjectOf(env: UploadLifecycleEnv, video: UploadVideo): Promise<string> {
  const channelId = video.channelId;
  if (!channelId || channelId === video.userId || !env.channels) return video.userId;
  try {
    const channel = (await (await env.channels.get(channelId))?.json<{ userId?: string }>()) ?? null;
    return channel?.userId || video.userId;
  } catch {
    return video.userId;
  }
}

/** A re-upload of the same video starts: back to `uploading`, flag cleared. */
export function reopenForReupload(video: UploadVideo): boolean {
  if (video.uploadStatus !== 'failed' || video.processingIssue?.kind !== 'needs_reupload') return false;
  video.uploadStatus = 'uploading';
  clearUploadFlags(video);
  return true;
}

/** No bytes moved at Bunny for this long: the upload has stopped. */
export const STALLED_AFTER_MS = 6 * 3600 * 1000;
/** Initiated but never started (no TUS upload created) for this long. */
export const NEVER_STARTED_AFTER_MS = 24 * 3600 * 1000;
const SWEEP_LIMIT = 50;

export interface StalledSweepStats {
  candidates: number;
  watching: number;
  completed: number;
  flagged: number;
  skipped: number;
  errors: number;
}

function ageMs(iso: string | undefined, now: Date): number {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? now.getTime() - t : 0;
}

/**
 * Hourly: unfinished uploads that went quiet (content_ownership: upload_status
 * initiated/uploading, not modified for STALLED_AFTER_MS). For each, Bunny
 * decides: every byte there -> complete; upload gone -> flag; offset unchanged
 * since the last sweep for STALLED_AFTER_MS -> flag (the user can still resume
 * by picking the same file); never started for NEVER_STARTED_AFTER_MS -> flag.
 * Bunny or storage trouble skips the video until the next run.
 */
export async function sweepStalledUploads(
  env: UploadLifecycleEnv,
  opts: { now?: Date; limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<StalledSweepStats> {
  const now = opts.now ?? new Date();
  const doFetch = opts.fetchImpl ?? fetch;
  const stats: StalledSweepStats = { candidates: 0, watching: 0, completed: 0, flagged: 0, skipped: 0, errors: 0 };
  if (!env.SEARCH_DB) return stats;

  const cutoff = now.getTime() - STALLED_AFTER_MS;
  const rows = await env.SEARCH_DB.prepare(
    `SELECT id FROM content_ownership
      WHERE kind = 'video' AND is_deleted = 0 AND upload_status IN ('initiated', 'uploading')
        AND COALESCE(updated_at, created_at, 0) < ?1
      ORDER BY COALESCE(updated_at, created_at, 0) ASC LIMIT ?2`,
  ).bind(cutoff, opts.limit ?? SWEEP_LIMIT).all<{ id: string }>();
  const ids = (rows.results ?? []).map((r) => r.id);
  stats.candidates = ids.length;

  const repository = new R2Repository<UploadVideo>(env.videos);
  for (const videoId of ids) {
    try {
      const object = await env.videos.get(videoId);
      if (!object) { stats.skipped++; continue; }
      const video = (await object.json()) as UploadVideo;
      if (video.uploadStatus !== 'initiated' && video.uploadStatus !== 'uploading') { stats.skipped++; continue; }

      const upload = video.tusUpload;
      if (!upload?.bunnyUploadUrl) {
        if (ageMs(video.dateModified || video.dateCreated, now) < NEVER_STARTED_AFTER_MS) { stats.skipped++; continue; }
        const r = await flagNeedsReupload(env, videoId, { reason: 'The upload never started. Upload the video file again.', source: 'sweep', now });
        if (r === 'flagged') stats.flagged++; else stats.skipped++;
        continue;
      }

      let res: Response;
      try {
        res = await doFetch(upload.bunnyUploadUrl, {
          method: 'HEAD',
          headers: { ...(await bunnyTusRequestHeaders(env, videoId)), 'Tus-Resumable': '1.0.0' },
        });
      } catch {
        stats.skipped++; // Bunny unreachable: next run
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        const r = await flagNeedsReupload(env, videoId, { reason: 'The upload stopped and the upload service no longer has its data. Upload the video file again.', source: 'sweep', now });
        if (r === 'flagged') stats.flagged++; else stats.skipped++;
        continue;
      }
      if (!res.ok) { stats.skipped++; continue; }

      const offset = Number(res.headers.get('Upload-Offset') ?? NaN);
      if (!Number.isFinite(offset)) { stats.skipped++; continue; }
      if (upload.fileSize > 0 && offset >= upload.fileSize) {
        if (await markUploadComplete(env, { videoId, userId: video.userId, fileSize: upload.fileSize })) stats.completed++;
        else stats.skipped++;
        continue;
      }

      const watch = video.uploadWatch;
      if (watch && watch.offset === offset && ageMs(watch.at, now) >= STALLED_AFTER_MS) {
        const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;
        const r = await flagNeedsReupload(env, videoId, {
          reason: `The upload stopped at ${mb(offset)} of ${mb(upload.fileSize)}. Pick the same file again to continue, or upload it again.`,
          source: 'sweep',
          now,
        });
        if (r === 'flagged') stats.flagged++; else stats.skipped++;
        continue;
      }
      if (!watch || watch.offset !== offset) {
        await repository.updateObject(videoId, (fresh) => {
          if (fresh.uploadStatus !== 'initiated' && fresh.uploadStatus !== 'uploading') return false;
          fresh.uploadWatch = { offset, at: now.toISOString() };
          return true;
        });
      }
      stats.watching++;
    } catch (error) {
      stats.errors++;
      logger.error('[Uploads] Stalled-upload sweep failed for a video', { videoId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (stats.flagged || stats.errors) logger.warn('[Uploads] Stalled-upload sweep', { ...stats });
  else logger.info('[Uploads] Stalled-upload sweep', { ...stats });
  return stats;
}
