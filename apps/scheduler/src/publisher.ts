import { MessageType } from '@al-ummah/shared-types';
import type { ScheduledVideoMetadata, SearchIndexSyncPayload, VideoObject } from '@al-ummah/shared-types';
import { logger } from './lib/logger';

/** Schedule entries live at `YYYY-MM-DD/HH/<videoId>.json`: key order is time order. */
const SCHEDULE_KEY = /^(\d{4}-\d{2}-\d{2})\/(\d{2})\/([^/]+)\.json$/;
/** Entries that failed for good (SCALABILITY-AUDIT SC-3); sorts after every dated key. */
export const FAILED_PREFIX = 'failed/';

export type PublishOutcome =
  /** The video is public now (this run made it so) */
  | 'published'
  /** It already was: nothing written */
  | 'already-public'
  /** The owner cancelled, or moved the schedule later: the entry is obsolete */
  | 'cancelled'
  | 'rescheduled'
  /** The video no longer exists */
  | 'missing';

export function buildScheduleKey(date: Date, videoId: string): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${year}-${month}-${day}/${hour}/${videoId}.json`;
}

const MAX_ATTEMPTS = 8;

/**
 * Publish a scheduled video (SCALABILITY-AUDIT SC-1).
 *
 * The video document is shared with api-videos (owner edits, cancel and
 * reschedule, comments) and admin-api. The write is conditional on the etag
 * that was read; when another writer got in between, the current copy is
 * read again and every check runs again, so a cancel or reschedule made a
 * moment before is honoured and nobody's edit is overwritten.
 *
 * @param queue Optional event queue; when given, the processor adds the newly public video to the search index
 */
export async function publishVideo(
  videoBucket: R2Bucket,
  metadata: ScheduledVideoMetadata,
  queue?: Queue,
  now: () => Date = () => new Date()
): Promise<PublishOutcome> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const videoObject = await videoBucket.get(metadata.videoId);
    if (!videoObject) return 'missing';

    const videoData: VideoObject = JSON.parse(await videoObject.text());

    if (videoData.isPublic) {
      logger.warn(`Video ${metadata.videoId} is already public, skipping`);
      return 'already-public';
    }
    if (videoData.scheduledPublishStatus === 'cancelled') return 'cancelled';
    if (videoData.scheduledPublishStatus === 'published') return 'already-public';
    // Rescheduled to later than this entry says (the old entry is stale)
    const current = videoData.scheduledPublishDate ? Date.parse(videoData.scheduledPublishDate) : NaN;
    if (Number.isFinite(current) && current > now().getTime() + 60_000) return 'rescheduled';

    const at = now().toISOString();
    videoData.isPublic = true;
    videoData.publishedAt = at;
    videoData.publishedViaSchedule = true;
    videoData.scheduledPublishStatus = 'published';
    videoData.dateModified = at;

    const written = await videoBucket.put(metadata.videoId, JSON.stringify(videoData), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf: { etagMatches: videoObject.etag },
    });
    if (!written) {
      logger.info(`Video ${metadata.videoId} changed while publishing; re-checking (attempt ${attempt})`);
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5 * 2 ** Math.min(attempt, 6)));
      continue;
    }

    logger.info(`Successfully published video ${metadata.videoId} via scheduler`);

    // Search index (Story 29.9): the video is public now
    if (queue) {
      try {
        // version: when R2 stored this copy, so an owner edit made after it wins in the index (PR-8)
        const payload: SearchIndexSyncPayload = { entity: 'video', id: metadata.videoId, object: videoData, version: written.uploaded?.getTime() ?? Date.now() };
        await queue.send({ id: crypto.randomUUID(), type: MessageType.SearchIndexSync, payload, timestamp: Date.now() });
      } catch (error) {
        logger.warn(`Failed to queue search index sync for video ${metadata.videoId}`, error);
      }
    }
    return 'published';
  }
  throw new Error(`Video ${metadata.videoId} kept changing while publishing; will retry`);
}

export interface DueScan {
  due: ScheduledVideoMetadata[];
  /** R2 operations this scan used (lists + gets) */
  operations: number;
  /** True when the scan stopped at a budget, not at the first future entry */
  truncated: boolean;
}

/**
 * Due schedule entries, oldest first (SCALABILITY-AUDIT SC-2).
 *
 * Keys sort by scheduled hour, so one paginated listing from the start of
 * the bucket reaches every overdue and current entry and stops at the first
 * entry of a later hour. Bounded per run: at most `limit` due entries and
 * `maxReads` reads; whatever is left is the next run's (one minute later).
 * Every page is followed (no entry is skipped past 1000), and nothing older
 * is ignored: an entry that is days overdue still publishes.
 */
export async function listDueSchedules(
  scheduledBucket: R2Bucket,
  now: Date,
  opts: { limit?: number; maxReads?: number; pageSize?: number } = {}
): Promise<DueScan> {
  const limit = opts.limit ?? 50;
  const maxReads = opts.maxReads ?? 200;
  const pageSize = opts.pageSize ?? 1000;
  const windowEnd = new Date(now);
  windowEnd.setUTCSeconds(0, 0);
  windowEnd.setUTCMinutes(windowEnd.getUTCMinutes() + 1);
  const currentHour = buildScheduleKey(now, '').slice(0, 13); // YYYY-MM-DD/HH

  const due: ScheduledVideoMetadata[] = [];
  let operations = 0;
  let cursor: string | undefined;
  for (;;) {
    const listed = await scheduledBucket.list({ limit: pageSize, ...(cursor ? { cursor } : {}) });
    operations++;
    for (const object of listed.objects) {
      const match = SCHEDULE_KEY.exec(object.key);
      if (!match) continue;
      if (`${match[1]}/${match[2]}` > currentHour) return { due, operations, truncated: false };
      if (due.length >= limit || operations >= maxReads) return { due, operations, truncated: true };
      try {
        const entry = await scheduledBucket.get(object.key);
        operations++;
        if (!entry) continue;
        const metadata: ScheduledVideoMetadata = JSON.parse(await entry.text());
        if (new Date(metadata.scheduledPublishDate) < windowEnd) due.push(metadata);
      } catch (error) {
        logger.error(`Failed to read schedule entry ${object.key}:`, error);
      }
    }
    if (!listed.truncated) return { due, operations, truncated: false };
    cursor = (listed as { cursor?: string }).cursor;
  }
}

/**
 * Remove a video from the scheduled bucket after successful publish
 */
export async function removeSchedule(
  scheduledBucket: R2Bucket,
  metadata: ScheduledVideoMetadata
): Promise<void> {
  try {
    await scheduledBucket.delete(buildScheduleKey(new Date(metadata.scheduledPublishDate), metadata.videoId));
    logger.debug(`Removed schedule for video ${metadata.videoId}`);
  } catch (error) {
    logger.error(`Failed to remove schedule for video ${metadata.videoId}:`, error);
  }
}

/**
 * Move a permanently failed entry out of the schedule (SCALABILITY-AUDIT SC-3):
 * it is kept under failed/ for inspection and never scanned or retried again.
 */
export async function markAsFailed(
  scheduledBucket: R2Bucket,
  metadata: ScheduledVideoMetadata,
  error: Error
): Promise<void> {
  const key = buildScheduleKey(new Date(metadata.scheduledPublishDate), metadata.videoId);
  const updatedMetadata: ScheduledVideoMetadata = {
    ...metadata,
    error: error.message,
    lastAttempt: new Date().toISOString(),
  };
  // Copy first, then delete: a crash in between leaves the entry to be failed again, never lost
  await scheduledBucket.put(`${FAILED_PREFIX}${key}`, JSON.stringify(updatedMetadata), {
    httpMetadata: { contentType: 'application/json' },
  });
  await scheduledBucket.delete(key);
  logger.warn(`Moved video ${metadata.videoId} schedule to ${FAILED_PREFIX} after permanent failure`);
}
